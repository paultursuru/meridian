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

// swissbuildings-lookup's tiles are a uniform 0.01° grid (docs/2-search-
// latency-onepager.md step 5) — the `* 100` below encodes that grid size
// directly, same as the Worker's own overlappingCellIds(), and for the same
// reason (see that function's comment): IEEE 754 multiplication by the
// integer 100 is guaranteed consistent, division by 0.01 isn't guaranteed to
// be. Workers Free caps a Worker invocation at 50 subrequests and each R2
// tile .get() there counts as one — the Worker's own MAX_CELLS guard sits at
// 45. A long route's bbox can span well past that (a 10 km walk is ~140
// tiles unsplit, per the doc's own measurement), so split it into pieces
// here, client-side, and fire them in parallel: each gets its own
// subrequest budget, and parallel requests are faster than one large one.
const MAX_TILES_PER_REQUEST = 40; // safety margin under the Worker's 45

function estimateTileCount(bbox) {
  const [s, w, n, e] = bbox;
  const latCells = Math.floor(n * 100) - Math.floor(s * 100) + 1;
  const lngCells = Math.floor(e * 100) - Math.floor(w * 100) + 1;
  return latCells * lngCells;
}

// Splitting the *continuous* coordinate range into N equal pieces (the first
// version of this function did that) rounds unevenly at cell boundaries —
// verified on the doc's own 10 km/140-tile example: a naive 4-way split put
// 50 tiles in the worst piece, over both the 40 target and the Worker's hard
// 45. Splitting the *integer cell-index* range instead, and spreading the
// remainder across the first chunks rather than dumping it all in the last
// one, gets that same example to an exact [40,40,30,30].
const EPS = 1e-7; // ~1cm — nudges an internal split boundary off an exact cell edge, see quadrants() below

function integerChunks(lo, hi, pieces) {
  const total = hi - lo + 1;
  const base = Math.floor(total / pieces);
  const extra = total % pieces;
  const chunks = [];
  let cur = lo;
  for (let i = 0; i < pieces; i++) {
    const size = base + (i < extra ? 1 : 0);
    if (size === 0) continue;
    chunks.push([cur, cur + size - 1]);
    cur += size;
  }
  return chunks;
}

// latPieces x lngPieces grid, each cell-index-exact. Outer edges keep the
// original bbox's exact coordinates (not snapped to a cell boundary);
// internal split points sit exactly on a cell boundary, nudged by EPS so
// that boundary cell belongs to one piece's count, not both (harmless if it
// leaks into both anyway — dedupeSwissBuildings below merges it — this just
// keeps estimateTileCount's per-piece budget check accurate).
function quadrants(bbox, latPieces, lngPieces) {
  const [s, w, n, e] = bbox;
  const latChunks = integerChunks(Math.floor(s * 100), Math.floor(n * 100), latPieces);
  const lngChunks = integerChunks(Math.floor(w * 100), Math.floor(e * 100), lngPieces);
  const out = [];
  latChunks.forEach(([cLo, cHi], i) => {
    const pS = i === 0 ? s : cLo / 100;
    const pN = i === latChunks.length - 1 ? n : (cHi + 1) / 100 - EPS;
    lngChunks.forEach(([dLo, dHi], j) => {
      const pW = j === 0 ? w : dLo / 100;
      const pE = j === lngChunks.length - 1 ? e : (dHi + 1) / 100 - EPS;
      out.push([pS, pW, pN, pE]);
    });
  });
  return out;
}

// Tries the fewest pieces first, splitting along the longer axis (a walking
// route's bbox is usually long and thin); falls back to a balanced 2x2 grid
// if splitting one axis alone isn't enough. Capped at 4 total pieces per the
// doc's "split large bboxes client-side into 2-4 sub-bboxes" — this targets
// a "long-ish 10 km walk", not an unbounded route length. Genuinely longer
// routes can still exceed the Worker's MAX_CELLS guard even after this; that
// surfaces as the existing 'failed'/data-unavailable state (review #2 §1.1),
// not a crash.
function splitBbox(bbox) {
  const [s, w, n, e] = bbox;
  const longerIsLat = (n - s) >= (e - w);
  const candidates = longerIsLat ? [[2, 1], [3, 1], [4, 1], [2, 2]] : [[1, 2], [1, 3], [1, 4], [2, 2]];
  for (const [latN, lngN] of candidates) {
    const pieces = quadrants(bbox, latN, lngN);
    if (pieces.every(p => estimateTileCount(p) <= MAX_TILES_PER_REQUEST)) return pieces;
  }
  return quadrants(bbox, 2, 2);
}

async function fetchSwissBuildingsTile(bbox) {
  const [s, w, n, e] = bbox;
  const r = await fetch(`${SWISSBUILDINGS_ENDPOINT}/?bbox=${w},${s},${e},${n}`);
  if (!r.ok) throw new Error(`swissbuildings-lookup HTTP ${r.status}`);
  return r.json();
}

async function fetchSwissBuildings(bbox) {
  const pieces = estimateTileCount(bbox) > MAX_TILES_PER_REQUEST ? splitBbox(bbox) : [bbox];
  const raw = (await Promise.all(pieces.map(fetchSwissBuildingsTile))).flat();
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
    // Unlike vegetation, this fetch still blocks the first render (see
    // AppLayout.astro's two-pass search) — keep the full 1s+3s+6s retry
    // ladder here rather than overpassFetch's default single retry, which is
    // sized for the now-decorative, non-blocking vegetation call instead.
    const d = await overpassFetch(q, { backoffMs: [1000, 3000, 6000] });
    return { buildings: parseBuildings(d.elements || []), status: 'ok', source: 'osm' };
  } catch (err) {
    console.warn('Overpass buildings failed, shadows disabled for this query', err);
    return { buildings: [], status: 'failed', source: 'osm' };
  }
}
