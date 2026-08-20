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

import { DEFAULT_BUILDING_HEIGHT, footprintShape, insideBbox } from './buildings.js';

// The openmaptiles source tops out at z14 (its TileJSON says so), and
// MapLibre reads the tile at floor(zoom), so from zoom 14 up the map holds
// full-resolution building tiles. Below that they are generalised: measured
// on Milano, a z13 tile carries 16% of the buildings its z14 children do, and
// a z12 tile carries none at all. So under this the query is worthless and
// the caller falls back to Overpass. In MapLibre's units — one below
// Leaflet's, see map.js's bboxZoom().
export const MIN_TILE_ZOOM = 14;

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
  const byKey = new Map();
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
  return [...byKey.values()];
}

// Same { buildings, status, source } contract as fetchBuildings(), plus a
// 'skipped' status meaning "the tiles can't answer this one" — too far out to
// hold building data, or nothing came back. The caller falls back to Overpass
// on anything that isn't 'ok'.
//
// `map` is injected (map.js's fitToBbox/glZoom/queryBuildingFeatures) so this
// module keeps no Leaflet or MapLibre import and stays unit-testable.
export async function fetchTileBuildings(bbox, map) {
  const t0 = now();
  try {
    // Asked before moving anything: a route long enough to fit only at z13 is
    // Overpass's either way, and pre-emptively panning the map there would
    // just add tile loads to a search that gains nothing from them.
    if (map.bboxZoom(bbox, { chrome: false }) < MIN_TILE_ZOOM) {
      return skipped('zoom', { fitMs: 0, queryMs: 0 });
    }

    // The map has to be looking at the route before its tiles can be asked
    // about it. It is about to be moved there anyway by displayRoutes; doing
    // it now just means the pan happens before the route is drawn instead of
    // with it.
    await map.fitToBbox(bbox, { chrome: false });
    const t1 = now();
    // Second check, cheap: the fit is what actually decides the zoom.
    if (map.glZoom() < MIN_TILE_ZOOM) {
      return skipped('zoom', { fitMs: t1 - t0, queryMs: 0 });
    }
    const buildings = featuresToBuildings(map.queryBuildingFeatures(), bbox);
    const timing = { fitMs: t1 - t0, queryMs: now() - t1 };
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
