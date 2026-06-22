// Cache Cloudflare Worker devant Overpass.
// Reçoit les requêtes Overpass du navigateur, renvoie une réponse mise en cache
// (KV) si elle existe, sinon appelle overpass-api.de, stocke et renvoie.

const ALLOWED_ORIGINS = new Set([
  'https://meridian-way.ch',
  'http://localhost:4321', // dev Astro
]);

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const TTL = 60 * 60 * 24 * 30; // 30 jours en secondes

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
      return withCors(json(cached, { 'X-Cache': 'HIT' }), origin);
    }

    // 2) Cache vide -> on appelle Overpass en transmettant le body tel quel.
    // Overpass exige un User-Agent identifiant (sinon il répond 406), que le
    // navigateur fournit automatiquement mais pas un Worker.
    const upstream = await fetch(OVERPASS, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'MeridianWay/1.0 (+https://meridian-way.ch)',
      },
      body,
    });

    const text = await upstream.text();

    // On ne met en cache que les vraies réponses JSON réussies, jamais une
    // erreur ou une page HTML d'Overpass (sinon on cacherait une panne 30 jours).
    if (upstream.ok && !text.trimStart().startsWith('<')) {
      await env.OVERPASS_CACHE.put(cacheKey, text, { expirationTtl: TTL });
    }

    return withCors(
      json(text, { 'X-Cache': 'MISS' }, upstream.ok ? 200 : upstream.status),
      origin,
    );
  },
};

// --- petites fonctions utilitaires ---

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
