// Cache Cloudflare Worker devant Overpass.
// Reçoit les requêtes Overpass du navigateur, renvoie une réponse mise en cache
// (KV) si elle existe, sinon appelle overpass-api.de, stocke et renvoie.

const ALLOWED_ORIGINS = new Set([
  'https://meridian-way.ch',
  'http://localhost:4321', // dev Astro
]);

const OVERPASS_DE = 'https://overpass-api.de/api/interpreter';
const OVERPASS_CH = 'https://overpass.osm.ch/api/interpreter'; // Swiss-only extract — measured 2026-07-28: byte-identical results to overpass-api.de, in less than half the time (0.69s vs 1.59s, Lausanne bbox), and 0.14s/empty for a bbox outside Switzerland.
// Swiss routes are the core audience and the .ch domain: try the Swiss
// instance first so they don't queue behind the world's traffic on the
// global one. Non-Swiss bboxes still go through overpass-api.de only —
// kumi.systems and private.coffee both timed out (60s) when measured and
// aren't wired in without being re-tested first.
const UPSTREAMS_CH = [OVERPASS_CH, OVERPASS_DE];
const UPSTREAMS_DEFAULT = [OVERPASS_DE];
// Coarse on purpose ("a coarse Swiss bounding-box test is enough") — this
// only decides upstream *order*, not correctness. Swisstopo's own extent is
// ~45.82-47.81°N, 5.96-10.49°E; padded slightly. Known limitation: a route
// just outside this box but still inside the padding could hit
// overpass.osm.ch and get a legitimate-looking empty result with no
// fallback, since an empty result isn't a retryable status — acceptable
// here because vegetation is decorative and the OSM buildings path is only
// used for non-Switzerland routes to begin with, so the overlap in practice
// is small.
const SWISS_BBOX = { s: 45.8, w: 5.9, n: 47.9, e: 10.6 };
const RETRYABLE_STATUS = new Set([429, 503, 504]);
const TTL = 60 * 60 * 24 * 30; // 30 jours en secondes
// Même durée que TTL, pour que le navigateur ne redemande pas une réponse que
// KV a déjà. Jamais posé sur une erreur : un 504 caché serait pire que le 504.
const CACHE_CONTROL = `public, max-age=${TTL}`;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');

    // Réponse au "preflight" CORS du navigateur (si jamais il en envoie un)
    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }), origin);
    }

    // Le front envoie le body au format "data=<requête Overpass encodée>".
    const body = await request.text();

    // Clé de cache = empreinte (hash) du body. Deux requêtes identiques
    // (même bbox) partagent donc la même entrée de cache.
    const cacheKey = await sha256(body);

    // 1) On cherche en cache (KV)
    const cached = await env.OVERPASS_CACHE.get(cacheKey);
    if (cached) {
      return withCors(json(cached, { 'X-Cache': 'HIT', 'Cache-Control': CACHE_CONTROL }), origin);
    }

    // 2) Cache vide -> on essaie les upstreams dans l'ordre (bbox suisse ->
    // instance .ch d'abord), à l'intérieur même du Worker. Un seul aller-retour
    // client, au plus 2 sous-requêtes — voir docs/2-search-latency-onepager.md
    // step 4 : c'est ça qui remplace les 10s de backoff côté client.
    const query = new URLSearchParams(body).get('data') || '';
    const upstreams = isSwissBbox(extractBbox(query)) ? UPSTREAMS_CH : UPSTREAMS_DEFAULT;
    const { text, status } = await fetchFromUpstreams(upstreams, body);

    // On ne met en cache que les vraies réponses JSON réussies, jamais une
    // erreur ou une page HTML d'Overpass (sinon on cacherait une panne 30 jours).
    if (status === 200) {
      await env.OVERPASS_CACHE.put(cacheKey, text, { expirationTtl: TTL });
    }

    return withCors(
      json(text, { 'X-Cache': 'MISS', ...(status === 200 ? { 'Cache-Control': CACHE_CONTROL } : {}) }, status),
      origin,
    );
  },
};

// --- petites fonctions utilitaires ---

// Pulls the first (south,west,north,east) group out of the raw Overpass QL
// text — buildings.js/trees.js both embed the same bbox on every clause, so
// the first match is enough. Returns null if the query has no bbox for some
// reason (defensive; every real query built by this app has one).
function extractBbox(query) {
  const m = query.match(/\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/);
  return m ? m.slice(1, 5).map(Number) : null;
}

// Overlap, not containment — a route bbox that merely touches Switzerland is
// still worth trying the Swiss instance first for. Same rectangle-overlap
// shape as swissbuildings-lookup's overlaps().
function isSwissBbox(bbox) {
  if (!bbox) return false;
  const [s, w, n, e] = bbox;
  return w < SWISS_BBOX.e && e > SWISS_BBOX.w && s < SWISS_BBOX.n && n > SWISS_BBOX.s;
}

// Tries each upstream in order, POSTing the same body to each. Stops at the
// first clean 200 (real JSON, not an HTML error page — Overpass sends those
// with a 200 too, e.g. "Dispatcher timeout"). Only moves to the next
// upstream on a retryable failure; a non-retryable status (a malformed
// query, say) would fail identically everywhere, so trying again elsewhere
// just burns a subrequest for nothing.
async function fetchFromUpstreams(upstreams, body) {
  let last = { text: '', status: 502 };
  for (const url of upstreams) {
    let res;
    try {
      // Overpass exige un User-Agent identifiant (sinon il répond 406), que le
      // navigateur fournit automatiquement mais pas un Worker.
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'MeridianWay/1.0 (+https://meridian-way.ch)',
        },
        body,
      });
    } catch (err) {
      last = { text: String(err?.message || err), status: 502 };
      continue;
    }
    const text = await res.text();
    const isHtmlError = text.trimStart().startsWith('<');
    if (res.ok && !isHtmlError) return { text, status: 200 };
    last = { text, status: isHtmlError ? 504 : res.status };
    if (!isHtmlError && !RETRYABLE_STATUS.has(res.status)) break;
  }
  return last;
}

function json(text, extraHeaders = {}, status = 200) {
  return new Response(text, {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function withCors(res, origin) {
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  return res;
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
