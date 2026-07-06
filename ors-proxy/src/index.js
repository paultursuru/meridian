// Proxy Cloudflare Worker devant OpenRouteService.
// Garde la clé ORS côté serveur (secret Worker `ORS_KEY`) au lieu de
// l'embarquer dans le bundle client, et met en cache les réponses : deux
// calculs sur le même trajet (même à des heures différentes) envoient
// exactement le même body, donc partagent la même route.

const ALLOWED_ORIGINS = new Set([
  'https://meridian-way.ch',
  'http://localhost:4321', // dev Astro
]);

const ORS = 'https://api.openrouteservice.org/v2/directions/foot-walking/geojson';
const TTL = 60 * 60 * 24 * 7; // 7 jours : le réseau piéton bouge peu

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');

    // Preflight CORS : obligatoire ici (contrairement à overpass-cache) car le
    // front envoie du JSON — Content-Type: application/json = requête "non
    // simple", le navigateur envoie donc toujours un OPTIONS avant le POST.
    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }), origin);
    }

    // Sans la clé dans le bundle, ce Worker est la seule porte vers ORS : on
    // ne répond qu'aux origines connues. Un Origin se forge en curl, mais ça
    // bloque l'abus le plus simple (clé/URL copiée dans un autre site).
    if (!ALLOWED_ORIGINS.has(origin)) {
      return new Response('Forbidden', { status: 403 });
    }
    if (request.method !== 'POST') {
      return withCors(new Response('Method Not Allowed', { status: 405 }), origin);
    }

    const body = await request.text();

    // Même clé de cache que overpass-cache : empreinte (hash) du body.
    const cacheKey = await sha256(body);
    const cached = await env.ORS_CACHE.get(cacheKey);
    if (cached) {
      return withCors(json(cached, { 'X-Cache': 'HIT' }), origin);
    }

    const upstream = await fetch(ORS, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': env.ORS_KEY,
      },
      body,
    });

    const text = await upstream.text();

    // Statut transmis tel quel : le front retry déjà les 429/503/504.
    // On ne met jamais une erreur en cache.
    if (upstream.ok) {
      await env.ORS_CACHE.put(cacheKey, text, { expirationTtl: TTL });
    }

    return withCors(json(text, { 'X-Cache': 'MISS' }, upstream.status), origin);
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
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  }
  return res;
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
