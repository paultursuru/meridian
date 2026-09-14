// Buildings read straight out of the vector basemap, instead of asked of
// Overpass (11.2s median outside Switzerland, against 889ms for the Swiss R2
// path). The `openmaptiles` source the map already loads carries a `building`
// layer with footprint geometry and heights, in memory, queryable
// synchronously, at no network cost.
//
// Two invariants the basemap terms depend on, so don't break them: what is
// read here is used for the current render and discarded, never persisted or
// redistributed, and it never feeds route generation, which stays
// OpenRouteService's.

import { DEFAULT_BUILDING_HEIGHT, footprintShape, insideBbox, routesBbox } from './buildings.js';

// The openmaptiles source tops out at z14 (its TileJSON says so), and
// MapLibre reads the tile at floor(zoom), so from zoom 14 up the map holds
// full-resolution building tiles. Below that they are generalised: measured
// on Milano, a z13 tile carries 16% of the buildings its z14 children do, and
// a z12 tile carries none at all. So under this the query is worthless and
// the caller falls back to Overpass. In MapLibre's units — one below
// Leaflet's, see map.js's bboxZoom().
export const MIN_TILE_ZOOM = 14;

// A route too long to fit at z14 in one view is read cell by cell instead of
// being handed straight to Overpass. The grid is bookkeeping, not framing:
// the map is moved to z14 and the cells record which parts of the route that
// view has already answered for. Nothing here depends on which way the route
// runs, and the cell never decides the zoom.
//
// Held as an integer reciprocal (200 means 0.005 degrees) because a cell index
// is computed by multiplying, which IEEE 754 keeps consistent where dividing
// by 0.005 does not. Same reasoning as the swisstopo cell grid in
// buildings.js.
//
// Deliberately smaller than a z14 view: cells have to be small enough that
// several fall inside one view, which is what keeps the pans down. About
// 400 x 550 m at 46 degrees north.
const CELL_PER = 200;

// Margin added around a cell before its buildings are kept, matching the one
// routesBbox() puts around the whole route: a building just outside the cell
// still casts into it. Only the filter is widened, never the fit, so this
// costs no zoom.
const CELL_PAD = 0.0015;

// Ceiling on the grid, not on the pans: one view covers several cells, and how
// many depends on the screen, so this sits well above the number of times the
// map actually moves. It exists only so a route long enough to be hopeless is
// handed over before the map moves at all. The wall-clock budget below is what
// really guards the cost. About 25 km of route.
const MAX_CELLS = 64;

// Wall-clock ceiling for the whole segmented attempt, split adaptively across
// however many segments remain — not a per-segment constant — so an early
// slow segment doesn't just guarantee every later one also times out. Kept
// well under the 12s Overpass budget it falls back to: on a genuinely bad
// connection, both are going to struggle, and losing this budget on top of
// Overpass's own would make the worst case worse instead of better.
const SEGMENTED_BUDGET_MS = 6000;

// OpenMapTiles' own fallback when a building carries neither height nor
// levels. buildings.js uses 10 m instead, so passing render_height through as
// a measurement would halve every unknown building's shadow *and* count it as
// real data in the coverage note.
const OMT_DEFAULT_HEIGHT = 5;
const METRES_PER_LEVEL = 3.5; // same as buildingHeight()'s levels rule

function numeric(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// Mirrors buildingHeight()/hasHeightData() for tile attributes: explicit
// height wins, then levels, then render_height (which OpenMapTiles derives
// from one or the other). What it can't mirror is the per-type fallback — the
// tile layer carries no `building=garage` tag, so a shed gets the generic
// default here where Overpass would give it LOW_BUILDING_HEIGHT.
export function tileBuildingHeight(props = {}) {
  const height = numeric(props.height);
  if (height !== null && height > 0) return { height, hasHeight: true };

  const levels = numeric(props.levels);
  if (levels !== null && levels > 0) return { height: levels * METRES_PER_LEVEL, hasHeight: true };

  const render = numeric(props.render_height);
  if (render !== null && render > 0 && render !== OMT_DEFAULT_HEIGHT) {
    return { height: render, hasHeight: true };
  }
  // Trade-off, deliberate: a real 5 m building is indistinguishable from the
  // OpenMapTiles default here, so it is treated as unknown and gets the app's
  // 10 m. Overshooting a handful of low buildings beats halving every
  // unknown one.
  return { height: DEFAULT_BUILDING_HEIGHT, hasHeight: false };
}

// Outer rings only, holes dropped: a courtyard doesn't change where the
// building's outline casts.
function outerRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates.slice(0, 1);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map(poly => poly[0]).filter(Boolean);
  return [];
}

function ringVerts(ring) {
  const pts = ring.map(([lng, lat]) => ({ lat, lng }));
  // GeoJSON rings repeat their first point; the Overpass path's ways don't.
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (pts.length > 1 && first.lat === last.lat && first.lng === last.lng) pts.pop();
  return pts;
}

// A building sitting on a tile boundary is delivered once per tile it touches,
// each copy cut at the seam. Keyed by feature id where the tiles provide one,
// so the copies collapse; the piece with the most vertices wins, being the
// one that lost the least to the cut.
function dedupeKey(feature, partIndex, building) {
  if (feature.id !== undefined && feature.id !== null) return `${feature.id}#${partIndex}`;
  const { lat, lng } = building.centroid;
  return `${lat.toFixed(6)},${lng.toFixed(6)}`;
}

export function featuresToBuildings(features, bbox) {
  return [...collectBuildings(new Map(), features, bbox).values()];
}

// The same, accumulating into a caller-owned map so that a building sitting
// in two cells' filter boxes is kept once, not once per cell.
function collectBuildings(byKey, features, bbox) {
  for (const feature of features) {
    outerRings(feature.geometry).forEach((ring, partIndex) => {
      const pts = ringVerts(ring);
      if (pts.length < 3) return;
      const { centroid, radius } = footprintShape(pts);
      const { height, hasHeight } = tileBuildingHeight(feature.properties);
      const building = { centroid, height, verts: pts, radius, hasHeight };
      if (bbox && !insideBbox(building, bbox)) return;
      const key = dedupeKey(feature, partIndex, building);
      const prev = byKey.get(key);
      if (!prev || prev.verts.length < pts.length) byKey.set(key, building);
    });
  }
  return byKey;
}

function padBox([s, w, n, e], pad) {
  return [s - pad, w - pad, n + pad, e + pad];
}

// A query hands back whole tiles, not just what is on screen, so a move
// answers for more ground than it shows. This snaps the visible box out to the
// z14 tile grid to get that real extent, which on a phone is two to three
// times the width of the view itself: the difference between reading an 8 km
// route in three moves and in nine.
export function tileExtent([s, w, n, e], z) {
  const scale = 2 ** z;
  const clamp = (lat) => Math.max(-85.05112878, Math.min(85.05112878, lat));
  const x = (lng) => (lng + 180) / 360 * scale;
  const y = (lat) => {
    const r = clamp(lat) * Math.PI / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * scale;
  };
  const lngAt = (xi) => xi / scale * 360 - 180;
  const latAt = (yi) => Math.atan(Math.sinh(Math.PI * (1 - 2 * yi / scale))) * 180 / Math.PI;
  // y grows southward, so the south edge comes from rounding y(s) up.
  return [latAt(Math.ceil(y(s))), lngAt(Math.floor(x(w))), latAt(Math.floor(y(n))), lngAt(Math.ceil(x(e)))];
}

// Whether `outer` holds all of `inner`.
function covers(outer, inner) {
  return inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
}

function addCell(cells, lat, lng, per) {
  const i = Math.floor(lat * per);
  const j = Math.floor(lng * per);
  const key = `${i}/${j}`;
  if (!cells.has(key)) cells.set(key, [i / per, j / per, (i + 1) / per, (j + 1) / per]);
}

// Every grid cell the routes pass through, in the order they are walked so
// consecutive pans stay neighbours and reuse tiles already loaded. Legs are
// sampled every half cell because a route can run kilometres between two
// vertices, and both routes feed the same map, so the stretch they share is
// visited once.
export function routeCells(routes, per) {
  const cells = new Map();
  const step = 0.5 / per;
  for (const rt of routes) {
    const coords = rt?.geometry?.coordinates || [];
    if (coords.length) addCell(cells, coords[0][1], coords[0][0], per);
    for (let k = 1; k < coords.length; k++) {
      const [lng0, lat0] = coords[k - 1];
      const [lng1, lat1] = coords[k];
      const n = Math.ceil(Math.max(Math.abs(lat1 - lat0), Math.abs(lng1 - lng0)) / step);
      for (let s = 1; s <= n; s++) {
        addCell(cells, lat0 + (lat1 - lat0) * (s / n), lng0 + (lng1 - lng0) * (s / n), per);
      }
    }
  }
  return [...cells.values()];
}

// The centre of a box, as viewAt() wants it.
function centreOf([s, w, n, e]) {
  return [(s + n) / 2, (w + e) / 2];
}

// One piece when the whole route already fits in a single view, the grid
// otherwise. Each piece is { fit, filter }: where the map is sent, and the box
// its buildings are kept from. The filter is the padded cell; routesBbox()
// already carries its own padding.
function routePieces(routes, map, minZoom) {
  const bbox = routesBbox(routes);
  if (map.bboxZoom(bbox, { chrome: false }) >= minZoom) return [{ fit: bbox, filter: bbox }];
  const cells = routeCells(routes, CELL_PER);
  if (!cells.length || cells.length > MAX_CELLS) return null;
  return cells.map((cell) => ({ fit: cell, filter: padBox(cell, CELL_PAD) }));
}

// Same { buildings, status, source } contract as fetchBuildings(), plus a
// 'skipped' status meaning "the tiles can't answer this one" — too far out to
// hold building data, or nothing came back. The caller falls back to Overpass
// on anything that isn't 'ok'.
//
// `map` is injected (map.js's fitToBbox/glZoom/queryBuildingFeatures) so this
// module keeps no Leaflet or MapLibre import and stays unit-testable.
//
// `routes` is the route list itself, not its bbox: the grid follows where the
// route actually goes, so a diagonal route never pans to the empty corners of
// its bounding box.
//
// `onSegment(i, total)` is called before each pan, 1-based, only when the
// route needed splitting (total > 1). The common single-piece case fires it
// never, so a caller that just wants "buildings, please" can ignore the
// third argument entirely.
export async function fetchTileBuildings(routes, map, onSegment) {
  const t0 = now();
  try {
    const pieces = routePieces(routes, map, MIN_TILE_ZOOM);
    // Long enough that the grid alone would outlast the budget. Moving the map
    // there would just add tile loads to a search that gains nothing from them.
    if (!pieces) return skipped('zoom', { fitMs: 0, queryMs: 0 });

    const byKey = new Map();
    const pending = pieces.slice();
    const total = pieces.length;
    while (pending.length) {
      const elapsed = now() - t0;
      if (elapsed > SEGMENTED_BUDGET_MS) return skipped('timeout', { fitMs: elapsed, queryMs: 0 });

      const piece = pending.shift();

      // The map has to be looking at each piece before its tiles can be asked
      // about it. A route that fits whole is framed as before, so the very
      // common, already-fast case is untouched by any of this. A route read
      // cell by cell is not framed at all: it is moved to z14 flat, which is
      // what makes one view cover several cells instead of exactly one.
      if (total === 1) {
        await map.fitToBbox(piece.fit, { chrome: false });
      } else {
        onSegment?.(total - pending.length, total);
        const timeoutMs = Math.max(800, Math.round((SEGMENTED_BUDGET_MS - elapsed) / (pending.length + 1)));
        await map.viewAt(centreOf(piece.fit), MIN_TILE_ZOOM, { timeoutMs });
      }

      // Cheap safety check, per piece: what the map did is what counts, not
      // what it was asked for.
      if (map.glZoom() < MIN_TILE_ZOOM) return skipped('zoom', { fitMs: now() - t0, queryMs: 0 });

      const features = map.queryBuildingFeatures();
      collectBuildings(byKey, features, piece.filter);

      // The view holds several cells, and the tiles behind it reach further
      // still. Reading every cell it already covers is what keeps a long route
      // down to a few moves instead of one per cell.
      const view = map.viewportBbox?.();
      const loaded = view && tileExtent(view, MIN_TILE_ZOOM);
      for (let k = pending.length - 1; k >= 0; k--) {
        if (!loaded || !covers(loaded, pending[k].fit)) continue;
        collectBuildings(byKey, features, pending[k].filter);
        pending.splice(k, 1);
      }
    }
    const buildings = [...byKey.values()];
    const timing = { fitMs: now() - t0, queryMs: 0 };
    if (!buildings.length) return skipped('empty', timing);
    return { buildings, status: 'ok', source: 'tiles', reason: null, timing };
  } catch (err) {
    console.warn('tile buildings failed, falling back to Overpass', err);
    return skipped('error', { fitMs: now() - t0, queryMs: 0 });
  }
}

// fitMs is waiting for the basemap to finish drawing where the route is —
// tiles it needs anyway — and queryMs is the part this feature actually costs.
// Worth keeping apart while the two are being compared to an 11s Overpass call.
function now() {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function skipped(reason, timing) {
  return { buildings: [], status: 'skipped', source: 'tiles', reason, timing };
}
