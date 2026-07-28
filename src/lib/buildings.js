import { overpassFetch } from './overpass.js';

const SWISSBUILDINGS_ENDPOINT = 'https://swissbuildings-lookup.meridianway.workers.dev';

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
// Exported: the quality-note "rest estimated" line in i18n.ts quotes these
// two figures directly (hardcoded per-locale text, not a template var, since
// the value itself needs no locale-aware decimal formatting once written
// out) — keep that copy in sync if either default changes.
export const LOW_BUILDING_HEIGHT = 2.5;
export const DEFAULT_BUILDING_HEIGHT = 10;

// Estimated height in metres from OSM tags. Explicit height wins, then
// levels (~3.5 m each), then a per-type default (10 m for ordinary buildings).
export function buildingHeight(tags) {
  let fallback = DEFAULT_BUILDING_HEIGHT;
  if (LOW_BUILDING_TYPES.has(tags.building)) fallback = LOW_BUILDING_HEIGHT;
  else if (['church', 'cathedral', 'tower'].includes(tags.building)) fallback = 22;

  if (tags.height) return parseFloat(tags.height) || fallback;
  if (tags['building:levels']) return parseInt(tags['building:levels']) * 3.5 || fallback;
  return fallback;
}

// Whether buildingHeight() above actually used a real OSM measurement for this
// building rather than falling back to a type/default guess — the raw signal
// behind the "height data: N% of buildings" confidence hint (review 3.5).
export function hasHeightData(tags) {
  if (tags.height && !Number.isNaN(parseFloat(tags.height))) return true;
  if (tags['building:levels'] && !Number.isNaN(parseInt(tags['building:levels']))) return true;
  return false;
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

    out.push({ centroid, height, verts: pts, radius, hasHeight: hasHeightData(way.tags) });
  });
  return out;
}

// Coverage + descriptive stats behind the review-3.5 confidence hint: the
// fraction of buildings whose height came from a real tag rather than a
// fallback guess, the total building count, and the mean height among just
// the measured ones (averaging in the type-default guesses would misrepresent
// them as real building sizes). null when there's nothing to report (no
// buildings fetched for this route).
export function heightStats(buildings) {
  if (!buildings.length) return null;
  const known = buildings.filter(b => b.hasHeight);
  return {
    pct: known.length / buildings.length,
    count: buildings.length,
    avgHeight: known.length ? known.reduce((s, b) => s + b.height, 0) / known.length : null,
  };
}

// Resolves a search's fetch outcomes into one of four UI states (review #2
// §1.1): ok/empty/failed/partial. buildingsStatus/vegStatus are 'ok' | 'failed'
// as returned by fetchBuildings/fetchVegetation. A buildings failure wins over
// everything else, including a simultaneous vegetation failure — one warning,
// not two stacked notes.
export function resolveHeightNoteState(buildingsStatus, buildingsCount, vegStatus) {
  if (buildingsStatus === 'failed') return 'failed';
  if (buildingsCount === 0) return 'empty';
  if (vegStatus === 'failed') return 'partial';
  return 'ok';
}


// swissbuildings-lookup returns the raw union of every tile overlapping the
// bbox, unfiltered and un-deduped — it deliberately never parses building
// JSON server-side (that's what was blowing the Workers Free plan's 10ms/
// request CPU budget). So the exact-bbox filter and the tile-boundary dedup
// (adjacent swisstopo map sheets overlap slightly, so a building near a tile
// edge can appear in two tiles' data) both happen here instead, where CPU
// time isn't capped.
function insideBbox(building, bbox) {
  const [s, w, n, e] = bbox;
  const { lat, lng } = building.centroid;
  return lng >= w && lng <= e && lat >= s && lat <= n;
}

function dedupeSwissBuildings(buildings) {
  const seen = new Set();
  return buildings.filter(b => {
    const key = `${b.centroid.lat.toFixed(6)},${b.centroid.lng.toFixed(6)},${b.height.toFixed(2)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchSwissBuildings(bbox) {
  const [s, w, n, e] = bbox;
  const r = await fetch(`${SWISSBUILDINGS_ENDPOINT}/?bbox=${w},${s},${e},${n}`);
  if (!r.ok) throw new Error(`swissbuildings-lookup HTTP ${r.status}`);
  const raw = await r.json();
  return dedupeSwissBuildings(raw).filter(b => insideBbox(b, bbox));
}

// switzerland: true when both route endpoints resolved to Switzerland (see
// geocode()'s countryCode) — swaps Overpass for the pre-converted
// swissBUILDINGS3D data (docs/swisstopo-building-heights-onepager.md),
// already in the exact { centroid, height, verts, radius, hasHeight } shape
// parseBuildings() produces below, so nothing downstream changes.
export async function fetchBuildings(bbox, { switzerland = false } = {}) {
  if (switzerland) {
    try {
      const buildings = await fetchSwissBuildings(bbox);
      return { buildings, status: 'ok', source: 'swisstopo' };
    } catch (err) {
      console.warn('swissbuildings-lookup failed, shadows disabled for this query', err);
      return { buildings: [], status: 'failed', source: 'swisstopo' };
    }
  }

  const [s, w, n, e] = bbox;
  const q = `[out:json][timeout:25];(way["building"](${s},${w},${n},${e}););out body;>;out skel qt;`;
  try {
    const d = await overpassFetch(q);
    return { buildings: parseBuildings(d.elements || []), status: 'ok', source: 'osm' };
  } catch (err) {
    console.warn('Overpass buildings failed, shadows disabled for this query', err);
    return { buildings: [], status: 'failed', source: 'osm' };
  }
}
