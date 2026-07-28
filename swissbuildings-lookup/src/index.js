// Worker de lookup bbox devant R2 pour les bâtiments suisses (swissBUILDINGS3D).
// Reçoit une bbox WGS84, trouve les tuiles (feuilles de carte swisstopo) qui la
// recoupent, et renvoie l'union brute des bâtiments de ces tuiles — jamais
// parsés en objets JS côté Worker (voir plus bas pourquoi). buildings.js fait
// le filtre bbox exact + la dédup côté client, où le CPU n'est pas limité.

import grid from './output_grid.json';

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

function overlaps(bbox, tileBbox) {
  const [qw, qs, qe, qn] = bbox;
  const [tw, ts, te, tn] = tileBbox;
  return qw < te && qe > tw && qs < tn && qn > ts;
}

// Strips the outer [ ] from each tile's raw JSON-array text and rejoins them
// as one array, entirely as string operations — no JSON.parse/stringify of
// building data anywhere. That parsing (megabytes of it, for a typical
// multi-tile route bbox) is what was blowing the Workers Free plan's
// 10ms/request CPU budget (non-negotiable, unlike the Paid plan's 30s) and
// causing intermittent 503s ("Worker exceeded CPU time limit").
function concatRawJsonArrays(texts) {
  const bodies = texts
    .map(t => t.trim())
    .filter(t => t.length > 2) // drop "[]"/empty — an overlapping tile can be one of the confirmed-empty chunks that was never uploaded
    .map(t => t.slice(1, -1));
  return `[${bodies.join(',')}]`;
}

const CACHE_TTL = 60 * 60 * 24 * 30; // 30 days, matches overpass-cache — swisstopo data only updates ~yearly
// KV rejects values over 25 MiB (26_214_400 bytes) — hit for real on a bbox
// spanning enough/dense-enough tiles (confirmed: a 0.1°x0.1° box near Zürich
// produced a 46 MB union). Skip the cache write rather than 500 on a bbox
// that happens to be unusually large — the response itself still goes out.
const KV_MAX_VALUE_SIZE = 20_000_000;

export default {
  async fetch(request, env) {
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

    const sheets = grid.filter(t => overlaps(bbox, t.bbox));
    if (sheets.length === 0) {
      return withCors(rawJson('[]'), origin);
    }

    // Cache key = the sorted set of overlapping tiles, not the (near-always
    // unique) exact bbox — two different routes through the same
    // neighbourhood touch the same tiles, so this is what actually repeats
    // across searches. The cached value is the raw union of those tiles'
    // buildings, unfiltered and un-deduped (see buildings.js for why that's
    // fine to send to the client as-is).
    const cacheKey = sheets.map(t => t.sheet).sort().join(',');
    const cached = await env.SWISSBUILDINGS_CACHE.get(cacheKey);
    if (cached) {
      return withCors(rawJson(cached), origin);
    }

    const texts = await Promise.all(
      sheets.map(t =>
        env.TILES.get(`swissbuildings3d_3_0_${t.sheet}.json`).then(obj => (obj ? obj.text() : null)),
      ),
    );
    const body = concatRawJsonArrays(texts.filter(Boolean));

    if (body.length < KV_MAX_VALUE_SIZE) {
      await env.SWISSBUILDINGS_CACHE.put(cacheKey, body, { expirationTtl: CACHE_TTL });
    } else {
      console.warn(`swissbuildings-lookup: skipping cache, ${body.length} bytes for [${cacheKey}]`);
    }

    return withCors(rawJson(body), origin);
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
