import { describe, it, expect } from 'vitest';
import { scoreRoute } from '../src/lib/shadow.js';

// --- Test geometry helpers --------------------------------------------------

const M_PER_DEG_LAT = 111000;
const mPerDegLng = (lat) => 111000 * Math.cos(lat * Math.PI / 180);

// A square building centred on (lat, lng), `halfM` metres to each side.
function squareBuilding(lat, lng, halfM, height) {
  const dLat = halfM / M_PER_DEG_LAT;
  const dLng = halfM / mPerDegLng(lat);
  const verts = [
    { lat: lat - dLat, lng: lng - dLng },
    { lat: lat - dLat, lng: lng + dLng },
    { lat: lat + dLat, lng: lng + dLng },
    { lat: lat + dLat, lng: lng - dLng },
  ];
  return { verts, centroid: { lat, lng }, radius: Math.sqrt(2) * halfM, height };
}

// A straight route between two [lng, lat] coordinate pairs.
const route = (a, b) => ({ geometry: { coordinates: [a, b] } });

// Sun due south (azimuth 180° → shadows fall north), 45° above horizon.
const SUN = { azDeg: 180, altDeg: 45 };
const CLAT = 46.5, CLNG = 6.6;

describe('scoreRoute — sun angle', () => {
  it('scores 0 and shades every segment at night', () => {
    const rt = route([CLNG, CLAT], [CLNG + 0.001, CLAT]);
    const res = scoreRoute(rt, [], [], { azDeg: 180, altDeg: -5 });
    expect(res.score).toBe(0);
    expect(res.segShade.every(s => s.shade)).toBe(true);
  });

  it('scores 1 in full sun with no obstacles', () => {
    const rt = route([CLNG, CLAT], [CLNG + 0.001, CLAT]);
    const res = scoreRoute(rt, [], [], SUN);
    expect(res.score).toBe(1);
  });
});

describe('scoreRoute — buildings', () => {
  it('fully shades a route running inside a building', () => {
    const building = squareBuilding(CLAT, CLNG, 40, 10);
    // Short route entirely within the 80 m-wide footprint.
    const rt = route([CLNG - 0.0001, CLAT], [CLNG + 0.0001, CLAT]);
    const res = scoreRoute(rt, [building], [], SUN);
    expect(res.score).toBe(0);
  });

  it('partially shades a route that is half under a building', () => {
    const building = squareBuilding(CLAT, CLNG, 20, 10);
    // First half inside the footprint, second half well clear of it (~150 m east).
    const rt = {
      geometry: {
        coordinates: [
          [CLNG, CLAT],
          [CLNG + 0.0002, CLAT],   // still around the building
          [CLNG + 0.003, CLAT],    // out in the open
        ],
      },
    };
    const res = scoreRoute(rt, [building], [], SUN);
    expect(res.score).toBeGreaterThan(0);
    expect(res.score).toBeLessThan(1);
    const shades = res.segShade.map(s => s.shade);
    expect(shades).toContain(true);
    expect(shades).toContain(false);
  });
});

describe('scoreRoute — trees and seasons', () => {
  // Sun at 45° → shadow length == tree height. Sun due south → shadow falls north.
  // A point one shadow-length north of the trunk sits in the tree's shadow.
  const tree = { lat: CLAT, lng: CLNG, height: 10, crownRadius: 4, isDeciduous: true };
  const shadedLat = CLAT + 10 / M_PER_DEG_LAT; // 10 m north of the trunk
  const rt = route([CLNG, shadedLat - 0.000005], [CLNG, shadedLat + 0.000005]);

  it('shades the route under a deciduous tree in summer (full canopy)', () => {
    const res = scoreRoute(rt, [], [tree], SUN, 1.0);
    expect(res.score).toBeLessThan(0.1);
  });

  it('lets sun through the same tree in winter (bare branches)', () => {
    const res = scoreRoute(rt, [], [tree], SUN, 0.05);
    expect(res.score).toBeGreaterThan(0.9);
  });
});

describe('scoreRoute — forests', () => {
  // A square forest centred on (lat, lng), `halfM` metres to each side.
  function squareForest(lat, lng, halfM, { height = 15, isDeciduous = false } = {}) {
    const dLat = halfM / M_PER_DEG_LAT;
    const dLng = halfM / mPerDegLng(lat);
    const verts = [
      { lat: lat - dLat, lng: lng - dLng },
      { lat: lat - dLat, lng: lng + dLng },
      { lat: lat + dLat, lng: lng + dLng },
      { lat: lat + dLat, lng: lng - dLng },
    ];
    return {
      verts,
      bbox: { s: lat - dLat, w: lng - dLng, n: lat + dLat, e: lng + dLng },
      height,
      isDeciduous,
    };
  }

  it('shades a route running deep inside an evergreen forest', () => {
    const forest = squareForest(CLAT, CLNG, 200);
    const rt = route([CLNG - 0.0001, CLAT], [CLNG + 0.0001, CLAT]);
    const res = scoreRoute(rt, [], [], SUN, 1.0, [forest]);
    expect(res.score).toBeLessThan(0.2);
    expect(res.segShade.every(s => s.shade)).toBe(true);
  });

  it('keeps the sun-side edge of a forest sunny', () => {
    const forest = squareForest(CLAT, CLNG, 200);
    // Sun due south → the canopy shadow falls north. A route just south of the
    // forest (sun side) is in full sun.
    const southLat = CLAT - 220 / M_PER_DEG_LAT;
    const rt = route([CLNG - 0.0001, southLat], [CLNG + 0.0001, southLat]);
    const res = scoreRoute(rt, [], [], SUN, 1.0, [forest]);
    expect(res.score).toBe(1);
  });

  it('shades a route just past the north edge (canopy shadow overhang)', () => {
    const forest = squareForest(CLAT, CLNG, 200, { height: 15 });
    // Sun at 45° → shadow length == canopy height (15 m). 10 m north of the
    // edge is still inside the cast shadow.
    const northLat = CLAT + 210 / M_PER_DEG_LAT;
    const rt = route([CLNG - 0.0001, northLat], [CLNG + 0.0001, northLat]);
    const res = scoreRoute(rt, [], [], SUN, 1.0, [forest]);
    expect(res.score).toBeLessThan(0.2);
  });

  it('keeps a clearing (multipolygon hole) sunny inside a forest', () => {
    const forest = squareForest(CLAT, CLNG, 500);
    // 200 m-wide clearing centred on the route — larger than the 15 m canopy
    // shadow overhang, so the sampled points stay in the sun.
    forest.holes = [squareForest(CLAT, CLNG, 100).verts];
    const rt = route([CLNG - 0.0001, CLAT], [CLNG + 0.0001, CLAT]);
    const res = scoreRoute(rt, [], [], SUN, 1.0, [forest]);
    expect(res.score).toBe(1);
  });

  it('lets sun through a deciduous forest in winter', () => {
    const forest = squareForest(CLAT, CLNG, 200, { isDeciduous: true });
    const rt = route([CLNG - 0.0001, CLAT], [CLNG + 0.0001, CLAT]);
    const res = scoreRoute(rt, [], [], SUN, 0.05, [forest]);
    expect(res.score).toBeGreaterThan(0.9);
  });
});

describe('scoreRoute — building takes priority over tree', () => {
  it('keeps full shade under a building even when a bare winter tree overlaps', () => {
    const building = squareBuilding(CLAT, CLNG, 40, 10);
    const tree = { lat: CLAT, lng: CLNG, height: 10, crownRadius: 4, isDeciduous: true };
    const rt = route([CLNG - 0.0001, CLAT], [CLNG + 0.0001, CLAT]);
    // leafFrac 0.05 → if the tree were consulted it would only add 0.05 shade,
    // but the building must win and keep the score at 0.
    const res = scoreRoute(rt, [building], [tree], SUN, 0.05);
    expect(res.score).toBe(0);
  });
});
