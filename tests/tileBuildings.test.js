import { describe, it, expect, vi } from 'vitest';
import {
  tileBuildingHeight,
  featuresToBuildings,
  fetchTileBuildings,
  routeCells,
  tileExtent,
  MIN_TILE_ZOOM,
} from '../src/lib/tileBuildings.js';
import { DEFAULT_BUILDING_HEIGHT, routesBbox } from '../src/lib/buildings.js';

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

// [lng, lat] pairs, the shape OpenRouteService returns.
function route(coords) {
  return { geometry: { type: 'LineString', coordinates: coords } };
}

describe('routeCells', () => {
  // per = 50, so cells are 0.02 degrees.
  it('walks a leg that spans several cells, however few vertices it has', () => {
    // One straight leg, two vertices, 0.09 degrees of latitude. Sampling only
    // the vertices would visit 2 cells and leave the middle of the route
    // unread.
    const cells = routeCells([route([[9.0, 45.0], [9.0, 45.09]])], 50);
    expect(cells).toHaveLength(5);
    for (const [s, w, n, e] of cells) {
      expect(n - s).toBeCloseTo(0.02, 10);
      expect(e - w).toBeCloseTo(0.02, 10);
    }
  });

  it('visits a stretch both routes share only once', () => {
    const a = route([[9.0, 45.0], [9.0, 45.05]]);
    expect(routeCells([a, a], 50)).toEqual(routeCells([a], 50));
  });

  it('follows the route rather than the corners of its bbox', () => {
    // A diagonal: the 2x2 grid over this bbox would pan to two corners the
    // route never enters.
    const cells = routeCells([route([[9.0, 45.0], [9.06, 45.06]])], 50);
    expect(cells).toHaveLength(4);
    expect(cells[0]).toEqual([45, 9, 45.02, 9.02]);
  });

  it('handles an empty route', () => {
    expect(routeCells([route([])], 50)).toEqual([]);
  });
});

describe('tileExtent', () => {
  // A query hands back whole tiles, so the ground a move answers for is the
  // tiles under the view, not the view itself.
  it('grows a view out to whole tile edges', () => {
    const view = [45.0, 9.0, 45.005, 9.005];
    const ext = tileExtent(view, MIN_TILE_ZOOM);
    expect(ext[0]).toBeLessThan(view[0]);
    expect(ext[1]).toBeLessThan(view[1]);
    expect(ext[2]).toBeGreaterThan(view[2]);
    expect(ext[3]).toBeGreaterThan(view[3]);
    // A z14 tile is 360/2^14 degrees of longitude.
    expect(ext[3] - ext[1]).toBeCloseTo(360 / 2 ** 14, 6);
  });

  it('leaves a box that is already whole tiles alone', () => {
    const once = tileExtent([45.0, 9.0, 45.005, 9.005], MIN_TILE_ZOOM);
    const twice = tileExtent(once, MIN_TILE_ZOOM);
    twice.forEach((v, i) => expect(v).toBeCloseTo(once[i], 9));
  });
});

describe('fetchTileBuildings', () => {
  // Short enough to fit in one view.
  const routes = [route([[9.0, 45.0], [9.02, 45.02]])];
  const bbox = routesBbox(routes);
  const mapAt = (zoom, features) => ({
    bboxZoom: () => zoom,
    fitToBbox: vi.fn().mockResolvedValue(undefined),
    viewAt: vi.fn().mockResolvedValue(undefined),
    viewportBbox: () => null,
    glZoom: () => zoom,
    queryBuildingFeatures: () => features,
  });

  it('frames the whole route when it fits, without touching the grid', async () => {
    const map = mapAt(15, [square(45.01, 9.01, 0.0002, { height: 20 })]);
    const onSegment = vi.fn();
    const res = await fetchTileBuildings(routes, map, onSegment);
    expect(map.fitToBbox).toHaveBeenCalledWith(bbox, { chrome: false });
    expect(map.viewAt).not.toHaveBeenCalled();
    expect(onSegment).not.toHaveBeenCalled();
    expect(res.status).toBe('ok');
    expect(res.source).toBe('tiles');
    expect(res.buildings).toHaveLength(1);
  });

  it('skips when the fit lands lower than predicted', async () => {
    const map = mapAt(MIN_TILE_ZOOM, [square(45.01, 9.01)]);
    map.glZoom = () => MIN_TILE_ZOOM - 1;
    const res = await fetchTileBuildings(routes, map);
    expect(res.status).toBe('skipped');
    expect(res.reason).toBe('zoom');
  });

  it('skips an empty answer rather than reporting a building-free area', async () => {
    const res = await fetchTileBuildings(routes, mapAt(15, []));
    expect(res.status).toBe('skipped');
    expect(res.reason).toBe('empty');
  });

  it('skips when the map throws', async () => {
    const map = mapAt(15, []);
    map.fitToBbox = vi.fn().mockRejectedValue(new Error('no map'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await fetchTileBuildings(routes, map);
    expect(res.status).toBe('skipped');
    expect(res.reason).toBe('error');
  });

  describe('routes read cell by cell', () => {
    // 0.02 degrees due north: five 0.005 cells, and too long to frame whole.
    const longRoutes = [route([[9.0, 45.0], [9.0, 45.02]])];
    const CELLS = 5;

    // The map is moved to a flat z14, never made to frame a cell, so the mock
    // reports a view of a fixed size around wherever it was last sent.
    const cellMap = (features, { view = 0.0025 } = {}) => {
      const map = {
        bboxZoom: () => MIN_TILE_ZOOM - 1, // never fits whole
        fitToBbox: vi.fn().mockResolvedValue(undefined),
        glZoom: () => MIN_TILE_ZOOM,
        queryBuildingFeatures: () => features,
        viewportBbox: () => (map.centre ? [map.centre[0] - view, map.centre[1] - view, map.centre[0] + view, map.centre[1] + view] : null),
      };
      map.viewAt = vi.fn((centre) => { map.centre = centre; return Promise.resolve(); });
      return map;
    };

    it('moves to a flat z14 on the route rather than framing a box', async () => {
      const map = cellMap([square(45.001, 9.001, 0.0002, { height: 20 })]);
      const res = await fetchTileBuildings(longRoutes, map);
      expect(res.status).toBe('ok');
      expect(map.fitToBbox).not.toHaveBeenCalled();
      for (const [centre, zoom] of map.viewAt.mock.calls) {
        expect(zoom).toBe(MIN_TILE_ZOOM);
        expect(centre).toHaveLength(2);
      }
    });

    // The point of the whole thing: a move answers for every cell under the
    // tiles it loaded, so a long route costs a few moves instead of one per
    // cell. Without it an 8 km route on a phone runs out of budget.
    it('reads every cell the loaded tiles already cover', async () => {
      // One building in the first cell, one in the last: collapsing moves must
      // not cost the far end of the route.
      const map = cellMap([
        square(45.001, 9.001, 0.0002, { height: 20 }),
        square(45.018, 9.001, 0.0002, { height: 30 }),
      ]);
      const onSegment = vi.fn();
      const res = await fetchTileBuildings(longRoutes, map, onSegment);

      expect(res.status).toBe('ok');
      expect(res.buildings.map(b => b.height).sort()).toEqual([20, 30]);
      expect(map.viewAt.mock.calls.length).toBeLessThan(CELLS);
      // Progress is still reported against the cells, so it jumps forward.
      expect(onSegment).toHaveBeenCalled();
      expect(onSegment.mock.calls.every(([i, n]) => n === CELLS && i <= CELLS)).toBe(true);
      expect(onSegment.mock.calls.at(-1)[0]).toBeLessThanOrEqual(CELLS);
    });

    it('falls back to one move per cell when the view is unknown', async () => {
      const map = cellMap([square(45.001, 9.001, 0.0002, { height: 20 })]);
      map.viewportBbox = () => null;
      const res = await fetchTileBuildings(longRoutes, map);
      expect(res.status).toBe('ok');
      expect(map.viewAt).toHaveBeenCalledTimes(CELLS);
    });

    // Cells are read with a margin so a building just outside one still casts
    // into it, so a building near a cell edge passes two cells' filters.
    // Counting it twice would double its shadow and skew the coverage note.
    it('counts a building sitting between two cells once', async () => {
      // 45.005 is a cell edge; both neighbours keep anything within 0.0015 of
      // it. One feature carries an id and the other does not: two dedupe keys,
      // two code paths.
      const map = cellMap([
        square(45.005, 9.001, 0.0002, { height: 20 }, 42),
        square(45.0051, 9.002, 0.0002, { height: 20 }),
      ]);
      const res = await fetchTileBuildings(longRoutes, map);
      expect(res.status).toBe('ok');
      expect(res.buildings).toHaveLength(2);
    });

    it('gives up without moving the map when the route is hopelessly long', async () => {
      const map = cellMap([square(45.001, 9.001)]);
      const res = await fetchTileBuildings([route([[9.0, 45.0], [9.0, 45.4]])], map);
      expect(res.status).toBe('skipped');
      expect(res.reason).toBe('zoom');
      expect(map.viewAt).not.toHaveBeenCalled();
      expect(map.fitToBbox).not.toHaveBeenCalled();
    });
  });
});
