import { overpassFetch } from './overpass.js';

export function routesBbox(routes) {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  routes.forEach(rt => rt.geometry.coordinates.forEach(([lng, lat]) => {
    if (lat < s) s = lat; if (lat > n) n = lat;
    if (lng < w) w = lng; if (lng > e) e = lng;
  }));
  const p = 0.0015; // ~150m padding
  return [s - p, w - p, n + p, e + p];
}

// Single-storey outbuildings: without this, an untagged shed gets the generic
// 10 m default and shades like a three-storey apartment block.
const LOW_BUILDING_TYPES = new Set([
  'garage', 'garages', 'carport', 'shed', 'hut', 'cabin',
  'kiosk', 'garbage_shed', 'greenhouse', 'roof', 'service',
]);
const LOW_BUILDING_HEIGHT = 2.5;

// Estimated height in metres from OSM tags. Explicit height wins, then
// levels (~3.5 m each), then a per-type default (10 m for ordinary buildings).
export function buildingHeight(tags) {
  let fallback = 10;
  if (LOW_BUILDING_TYPES.has(tags.building)) fallback = LOW_BUILDING_HEIGHT;
  else if (['church', 'cathedral', 'tower'].includes(tags.building)) fallback = 22;

  if (tags.height) return parseFloat(tags.height) || fallback;
  if (tags['building:levels']) return parseInt(tags['building:levels']) * 3.5 || fallback;
  return fallback;
}

function parseBuildings(els) {
  const nodes = {};
  els.filter(e => e.type === 'node').forEach(nd => { nodes[nd.id] = { lat: nd.lat, lng: nd.lon }; });

  const out = [];
  els.filter(e => e.type === 'way' && e.tags && e.tags.building).forEach(way => {
    const pts = (way.nodes || []).map(id => nodes[id]).filter(Boolean);
    if (pts.length < 3) return;

    const centroid = {
      lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
      lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length,
    };

    const height = buildingHeight(way.tags);

    // Max distance from centroid to any vertex — used as bounding radius for shadow pre-filter
    const cosLat = Math.cos(centroid.lat * Math.PI / 180);
    const radius = pts.reduce((max, p) => {
      const dlat = (p.lat - centroid.lat) * 111000;
      const dlng = (p.lng - centroid.lng) * 111000 * cosLat;
      return Math.max(max, Math.sqrt(dlat * dlat + dlng * dlng));
    }, 0);

    out.push({ centroid, height, verts: pts, radius });
  });
  return out;
}


export async function fetchBuildings(bbox) {
  const [s, w, n, e] = bbox;
  const q = `[out:json][timeout:25];(way["building"](${s},${w},${n},${e}););out body;>;out skel qt;`;
  try {
    const d = await overpassFetch(q);
    return parseBuildings(d.elements || []);
  } catch (err) {
    console.warn('Overpass buildings failed, shadows disabled for this query', err);
    return [];
  }
}
