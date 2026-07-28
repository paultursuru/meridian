// Worker de lookup bbox devant R2 pour les bâtiments suisses (swissBUILDINGS3D).
// Reçoit une bbox WGS84, calcule les tuiles d'une grille uniforme 0.01° qui la
// recoupent (docs/2-search-latency-onepager.md step 5), et renvoie l'union
// brute des bâtiments de ces tuiles — jamais parsés en objets JS côté Worker
// (voir plus bas pourquoi). buildings.js fait le filtre bbox exact + la dédup
// côté client, où le CPU n'est pas limité.

const ALLOWED_ORIGINS = new Set([
  'https://meridian-way.ch',
  'http://localhost:4321', // dev Astro
]);

// In-memory per-IP fixed-window limiter — no Cloudflare rate-limiting product
// needed (those are zone-level and this Worker lives on the shared
// workers.dev domain, not a zone we own). Known limitation: state is local to
// one isolate, so it resets on cold start and isn't shared across Cloudflare's
// edge locations — a deterrent against a single scripted client hammering R2
// reads, not a hard global cap.
const RATE_LIMIT = 60; // requests
const RATE_WINDOW_MS = 60_000; // per IP, per minute
const MAX_TRACKED_IPS = 10_000; // safety valve against unbounded growth on a long-lived isolate
const hits = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  if (hits.size > MAX_TRACKED_IPS) hits.clear();
  const entry = hits.get(ip);
  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

// Uniform 0.01° grid, computed directly from a bbox's corners — no grid
// file/import needed (today's swisstopo-map-sheet grid needed one because
// real sheets have irregular boundaries; a uniform grid doesn't). The index
// math must match the ETL (swisstopo-etl/build_national.py's
// swiss_cells_from_sheets) exactly, since cell ids are how the two sides
// agree on R2 object names with no lookup table connecting them — hence
// `* 100`, not `/ 0.01`: both are mathematically the cell size, but 0.01 has
// no exact binary floating-point representation, and IEEE 754 multiplication
// by the integer 100 is guaranteed bit-identical between Python and JS in a
// way division by a non-exact constant isn't guaranteed to be.
function overlappingCellIds(bbox) {
  const [w, s, e, n] = bbox;
  const latLo = Math.floor(s * 100), latHi = Math.floor(n * 100);
  const lngLo = Math.floor(w * 100), lngHi = Math.floor(e * 100);
  const ids = [];
  for (let latIdx = latLo; latIdx <= latHi; latIdx++) {
    for (let lngIdx = lngLo; lngIdx <= lngHi; lngIdx++) {
      ids.push(`${latIdx}_${lngIdx}`);
    }
  }
  return ids;
}

// Workers Free: 50 subrequests/invocation, and each R2 .get() below counts as
// one — the whole reason step 5 exists. buildings.js splits large bboxes
// client-side to stay well under this; this is the hard backstop for the
// case that doesn't, a clear error instead of a raw platform crash.
const MAX_CELLS = 45;

// Strips the outer [ ] from each tile's raw JSON-array text and rejoins them
// as one array, entirely as string operations — no JSON.parse/stringify of
// building data anywhere. That parsing (megabytes of it, for a typical
// multi-tile route bbox) is what was blowing the Workers Free plan's 10ms/
// request CPU budget (non-negotiable, unlike the Paid plan's 30s) and
// causing intermittent 503s ("Worker exceeded CPU time limit").
function concatRawJsonArrays(texts) {
  const bodies = texts
    .map(t => t.trim())
    .filter(t => t.length > 2) // drop "[]"/empty — an overlapping tile can be one of the confirmed-empty chunks that was never uploaded
    .map(t => t.slice(1, -1));
  return `[${bodies.join(',')}]`;
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }), origin);
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (isRateLimited(ip)) {
      return withCors(json({ error: 'rate limited' }, 429), origin);
    }

    const url = new URL(request.url);
    const bboxParam = url.searchParams.get('bbox');
    if (!bboxParam) {
      return withCors(json({ error: 'missing ?bbox=west,south,east,north' }, 400), origin);
    }

    const bbox = bboxParam.split(',').map(Number);
    if (bbox.length !== 4 || bbox.some(Number.isNaN)) {
      return withCors(json({ error: 'bbox must be west,south,east,north' }, 400), origin);
    }

    const cellIds = overlappingCellIds(bbox);
    if (cellIds.length === 0) {
      return withCors(rawJson('[]'), origin);
    }
    if (cellIds.length > MAX_CELLS) {
      // buildings.js splits bboxes before they'd ever reach this — a clear
      // 400 beats a raw "Too many subrequests" platform error if it somehow
      // doesn't (a bug, or a future caller that doesn't split).
      return withCors(json({ error: `bbox too large: ${cellIds.length} tiles, max ${MAX_CELLS}` }, 400), origin);
    }

    // Cache key = the sorted set of overlapping cells, not the (near-always
    // unique) exact bbox — two different routes through the same
    // neighbourhood touch the same cells, so this is what actually repeats
    // across searches. caches.default (the Cloudflare Cache API), not KV:
    // finer tiles mean nearly every route has a unique cell-set, and Free
    // KV's 1000-distinct-key-writes/day cap would put a ~1000-search/day
    // ceiling on the product. The Cache API has no such write limit.
    const cacheKey = new Request(
      `https://cache.internal/swissbuildings-tiles?cells=${cellIds.slice().sort().join(',')}`,
    );
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      // Cloned rather than returned directly — mutating headers (withCors,
      // below) on a Response straight out of the cache isn't guaranteed safe.
      return withCors(new Response(cached.body, cached), origin);
    }

    const texts = await Promise.all(
      cellIds.map(id =>
        env.TILES.get(`swissbuildings3d_3_0_${id}.json`).then(obj => (obj ? obj.text() : null)),
      ),
    );
    const body = concatRawJsonArrays(texts.filter(Boolean));

    // rawJson() already carries the step-1 Cache-Control (30d, immutable) —
    // governs the browser's own cache *and* how long this edge entry lives,
    // no separate TTL value to keep in sync between the two.
    const response = rawJson(body);
    ctx.waitUntil(caches.default.put(cacheKey, response.clone()));

    return withCors(response, origin);
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Same as json(), but for a body that's already a JSON string (a cache hit,
// or the concatenated tile text) — skips a redundant JSON.stringify. Always a
// 200 (errors go through json() instead), so it's safe to cache in the
// browser unconditionally: swisstopo data only updates ~yearly.
function rawJson(body) {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=2592000, immutable', // 30 days
    },
  });
}

function withCors(res, origin) {
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  }
  return res;
}
