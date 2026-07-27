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

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }), origin);
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

    const chunks = await Promise.all(
      sheets.map(async t => {
        const obj = await env.TILES.get(`swissbuildings3d_3_0_${t.sheet}.json`);
        if (!obj) return [];
        return obj.json();
      }),
    );

    const buildings = dedupe(chunks.flat()).filter(b => insideBbox(b, bbox));

    return withCors(json(buildings), origin);
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
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
