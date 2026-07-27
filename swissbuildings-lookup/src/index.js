// Worker de lookup bbox devant R2 pour les bâtiments suisses (swissBUILDINGS3D).
// Reçoit une bbox WGS84, trouve les tuiles (feuilles de carte swisstopo) qui la
// recoupent, les récupère depuis R2, et renvoie les bâtiments dans la bbox
// exacte — même forme { centroid, height, verts, radius, hasHeight } que ce
// que buildings.js produit déjà pour OSM, donc aucun changement en aval.

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

function insideBbox(building, bbox) {
  const [w, s, e, n] = bbox;
  const { lat, lng } = building.centroid;
  return lng >= w && lng <= e && lat >= s && lat <= n;
}

// Adjacent swisstopo map sheets overlap slightly at their edges, so a
// building near a tile boundary gets extracted into both neighbours' chunks
// during the national ETL run — a query spanning that boundary would
// otherwise return it twice. Same building = same centroid + height to a
// few decimal places (no stable id survives into the collapsed output).
function dedupe(buildings) {
  const seen = new Set();
  return buildings.filter(b => {
    const key = `${b.centroid.lat.toFixed(6)},${b.centroid.lng.toFixed(6)},${b.height.toFixed(2)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const CACHE_TTL = 60 * 60 * 24 * 30; // 30 days, matches overpass-cache — swisstopo data only updates ~yearly

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

    // Cache key = the exact bbox string. A hit skips R2 entirely and returns
    // the stored JSON text as-is (no JSON.parse/stringify) — this is the
    // actual fix for the CPU-time-limit 503s on the Workers Free plan
    // (10ms/request, non-negotiable): parsing megabytes of R2 JSON plus
    // re-serializing the filtered result is what blows the budget, and a
    // cache hit does neither.
    const cached = await env.SWISSBUILDINGS_CACHE.get(bboxParam);
    if (cached) {
      return withCors(rawJson(cached), origin);
    }

    const sheets = grid.filter(t => overlaps(bbox, t.bbox));

    const chunks = await Promise.all(
      sheets.map(async t => {
        const obj = await env.TILES.get(`swissbuildings3d_3_0_${t.sheet}.json`);
        if (!obj) return [];
        return obj.json();
      }),
    );

    // Dedup only matters when >=2 tiles are merged (see dedupe() above) — a
    // guaranteed no-op, and extra CPU cost, when the bbox falls in one tile.
    const merged = sheets.length > 1 ? dedupe(chunks.flat()) : chunks.flat();
    const buildings = merged.filter(b => insideBbox(b, bbox));

    const body = JSON.stringify(buildings);
    await env.SWISSBUILDINGS_CACHE.put(bboxParam, body, { expirationTtl: CACHE_TTL });

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
// or one we just built ourselves) — skips a redundant JSON.stringify.
function rawJson(body) {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function withCors(res, origin) {
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  }
  return res;
}
