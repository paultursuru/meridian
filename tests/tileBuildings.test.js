import { describe, it, expect, vi } from 'vitest';
import {
  tileBuildingHeight,
  featuresToBuildings,
  fetchTileBuildings,
  MIN_TILE_ZOOM,
} from '../src/lib/tileBuildings.js';
import { DEFAULT_BUILDING_HEIGHT } from '../src/lib/buildings.js';

// A square footprint of about 20m, closed the GeoJSON way.
function square(lat, lng, size = 0.0002, props = {}, id = undefined) {
  return {
    id,
    properties: props,
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [lng, lat], [lng + size, lat], [lng + size, lat + size], [lng, lat + size], [lng, lat],
      ]],
    },
  };
}

describe('tileBuildingHeight', () => {
  it('takes an explicit height', () => {
    expect(tileBuildingHeight({ height: 24, render_height: 24 })).toEqual({ height: 24, hasHeight: true });
  });

  it('parses string attributes', () => {
    expect(tileBuildingHeight({ height: '12.5' })).toEqual({ height: 12.5, hasHeight: true });
  });

  it('falls back to levels at 3.5m each', () => {
    expect(tileBuildingHeight({ levels: 4 })).toEqual({ height: 14, hasHeight: true });
  });

  it('trusts render_height when it is not the OpenMapTiles default', () => {
    expect(tileBuildingHeight({ render_height: 18 })).toEqual({ height: 18, hasHeight: true });
  });

  // The whole point of the mapping: OpenMapTiles defaults unknowns to 5m,
  // this app defaults them to 10m. Passing 5 through would halve the shadow
  // and report it as measured data.
  it('treats the 5m OpenMapTiles default as unknown', () => {
    expect(tileBuildingHeight({ render_height: 5 })).toEqual({
      height: DEFAULT_BUILDING_HEIGHT, hasHeight: false,
    });
  });

  it('keeps a 5m building that says so through levels', () => {
    expect(tileBuildingHeight({ render_height: 5, levels: 1 })).toEqual({ height: 3.5, hasHeight: true });
  });

  it('falls back on missing or junk attributes', () => {
    expect(tileBuildingHeight({})).toEqual({ height: DEFAULT_BUILDING_HEIGHT, hasHeight: false });
    expect(tileBuildingHeight({ height: 'tall' })).toEqual({ height: DEFAULT_BUILDING_HEIGHT, hasHeight: false });
  });
});

describe('featuresToBuildings', () => {
  const bbox = [45.0, 9.0, 45.1, 9.1];

  it('produces the shape the shadow code expects', () => {
    const [b] = featuresToBuildings([square(45.05, 9.05, 0.0002, { height: 20 })], bbox);
    expect(b.height).toBe(20);
    expect(b.hasHeight).toBe(true);
    expect(b.centroid.lat).toBeCloseTo(45.0501, 4);
    expect(b.radius).toBeGreaterThan(0);
    // Ring closing point dropped: four corners, not five.
    expect(b.verts).toHaveLength(4);
  });

  it('drops buildings outside the route bbox', () => {
    const feats = [square(45.05, 9.05), square(46.0, 9.05)];
    expect(featuresToBuildings(feats, bbox)).toHaveLength(1);
  });

  it('collapses the copies of a building cut at a tile boundary, keeping the biggest piece', () => {
    const whole = square(45.05, 9.05, 0.0002, { height: 20 }, 42);
    const cut = {
      id: 42,
      properties: { height: 20 },
      geometry: { type: 'Polygon', coordinates: [[[9.05, 45.05], [9.0501, 45.05], [9.0501, 45.0501], [9.05, 45.05]]] },
    };
    const out = featuresToBuildings([cut, whole], bbox);
    expect(out).toHaveLength(1);
    expect(out[0].verts).toHaveLength(4);
  });

  it('keeps the parts of a multipolygon apart', () => {
    const multi = {
      id: 7,
      properties: {},
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          square(45.05, 9.05).geometry.coordinates,
          square(45.06, 9.06).geometry.coordinates,
        ],
      },
    };
    expect(featuresToBuildings([multi], bbox)).toHaveLength(2);
  });

  it('ignores degenerate rings', () => {
    const line = { properties: {}, geometry: { type: 'Polygon', coordinates: [[[9.05, 45.05], [9.05, 45.05]]] } };
    expect(featuresToBuildings([line], bbox)).toEqual([]);
  });
});

describe('fetchTileBuildings', () => {
  const bbox = [45.0, 9.0, 45.1, 9.1];
  const mapAt = (zoom, features) => ({
    bboxZoom: () => zoom,
    fitToBbox: vi.fn().mockResolvedValue(undefined),
    glZoom: () => zoom,
    queryBuildingFeatures: () => features,
  });

  it('reads the loaded tiles once the map is on the route', async () => {
    const map = mapAt(15, [square(45.05, 9.05, 0.0002, { height: 20 })]);
    const res = await fetchTileBuildings(bbox, map);
    expect(map.fitToBbox).toHaveBeenCalledWith(bbox, { chrome: false });
    expect(res.status).toBe('ok');
    expect(res.source).toBe('tiles');
    expect(res.buildings).toHaveLength(1);
  });

  // Below z14 the map holds generalised tiles (measured: a z13 tile carries
  // 16% of the buildings its z14 children do, a z12 tile none at all), so the
  // caller must fall back rather than under-shade the route.
  it('skips a route too long to fit at building-tile zoom, without moving the map', async () => {
    const map = mapAt(MIN_TILE_ZOOM - 1, [square(45.05, 9.05)]);
    const res = await fetchTileBuildings(bbox, map);
    expect(res.status).toBe('skipped');
    expect(res.reason).toBe('zoom');
    expect(map.fitToBbox).not.toHaveBeenCalled();
  });

  it('skips when the fit lands lower than predicted', async () => {
    const map = mapAt(MIN_TILE_ZOOM, [square(45.05, 9.05)]);
    map.glZoom = () => MIN_TILE_ZOOM - 1;
    const res = await fetchTileBuildings(bbox, map);
    expect(res.status).toBe('skipped');
    expect(res.reason).toBe('zoom');
    expect(map.fitToBbox).toHaveBeenCalled();
  });

  it('skips an empty answer rather than reporting a building-free area', async () => {
    const res = await fetchTileBuildings(bbox, mapAt(15, []));
    expect(res.status).toBe('skipped');
    expect(res.reason).toBe('empty');
  });

  it('skips when the map throws', async () => {
    const map = mapAt(15, []);
    map.fitToBbox = vi.fn().mockRejectedValue(new Error('no map'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await fetchTileBuildings(bbox, map);
    expect(res.status).toBe('skipped');
    expect(res.reason).toBe('error');
  });
});
