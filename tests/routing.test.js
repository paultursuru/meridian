import { describe, it, expect } from 'vitest';
import { routeOverlap, dedupeRoutes } from '../src/lib/routing.js';

// Straight west→east line at a given latitude, one point every ~15 m,
// [lon, lat, ele] like ORS geometries.
function line(lat, lonFrom, lonTo, step = 0.0002) {
  const coords = [];
  for (let lon = lonFrom; lon <= lonTo + 1e-9; lon += step) coords.push([lon, lat, 400]);
  return coords;
}

function route(coords, distance) {
  return { geometry: { coordinates: coords }, distance };
}

describe('routeOverlap', () => {
  it('is 1 for identical geometries', () => {
    const a = line(46.52, 6.60, 6.62);
    expect(routeOverlap(a, a)).toBe(1);
  });

  it('is 1 for the same street sampled at offset points', () => {
    const a = line(46.52, 6.60, 6.62, 0.0002);
    const b = line(46.52, 6.6001, 6.62, 0.0003);
    expect(routeOverlap(a, b)).toBe(1);
  });

  it('is 0 for parallel streets ~200 m apart', () => {
    const a = line(46.52, 6.60, 6.62);
    const b = line(46.522, 6.60, 6.62);
    expect(routeOverlap(a, b)).toBe(0);
  });

  it('is partial when routes share only the ends', () => {
    const shared = 0.005, total = 0.02; // 25% shared at each end
    const a = [...line(46.52, 6.60, 6.60 + shared), ...line(46.522, 6.60 + shared, 6.60 + total - shared), ...line(46.52, 6.60 + total - shared, 6.60 + total)];
    const b = line(46.52, 6.60, 6.60 + total);
    const ov = routeOverlap(a, b);
    expect(ov).toBeGreaterThan(0.3);
    expect(ov).toBeLessThan(0.7);
  });
});

describe('dedupeRoutes', () => {
  const directDist = 1500; // ~6.60→6.62 at 46.5°N

  it('keeps same-length routes on different streets (old distance dedup merged these)', () => {
    const a = route(line(46.52, 6.60, 6.62), 1540);
    const b = route(line(46.522, 6.60, 6.62), 1545);
    expect(dedupeRoutes([a, b], directDist)).toHaveLength(2);
  });

  it('drops a route with the same geometry', () => {
    const coords = line(46.52, 6.60, 6.62);
    const a = route(coords, 1540);
    const b = route(coords.slice().reverse(), 1560);
    expect(dedupeRoutes([a, b], directDist)).toHaveLength(1);
  });

  it('drops routes longer than 2.5× the direct distance', () => {
    const a = route(line(46.52, 6.60, 6.62), 1540);
    const detour = route(line(46.53, 6.60, 6.62), 4000);
    expect(dedupeRoutes([a, detour], directDist)).toHaveLength(1);
  });
});
