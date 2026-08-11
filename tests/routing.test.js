import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { routeOverlap, dedupeRoutes, buildRoutes } from '../src/lib/routing.js';

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
  it('keeps same-length routes on different streets (old distance dedup merged these)', () => {
    const a = route(line(46.52, 6.60, 6.62), 1540);
    const b = route(line(46.522, 6.60, 6.62), 1545);
    expect(dedupeRoutes([a, b])).toHaveLength(2);
  });

  it('drops a route with the same geometry', () => {
    const coords = line(46.52, 6.60, 6.62);
    const a = route(coords, 1540);
    const b = route(coords.slice().reverse(), 1560);
    expect(dedupeRoutes([a, b])).toHaveLength(1);
  });

  it('drops alternatives far longer than the best route', () => {
    const a = route(line(46.52, 6.60, 6.62), 1540);
    const detour = route(line(46.53, 6.60, 6.62), 4000);
    expect(dedupeRoutes([a, detour])).toHaveLength(1);
  });

  it('keeps a heavily detoured route when it is the only way (Ecublens VD 2026-08-06)', () => {
    // 598 m apart as the crow flies, but the motorway and the railway push the
    // real walk to 1.7 km and 2.0 km. The old 2.5×-direct cap (1495 m) dropped
    // both and the UI reported "aucun itinéraire trouvé".
    const a = route(line(46.52, 6.60, 6.62), 1726.9);
    const b = route(line(46.522, 6.60, 6.62), 2041.3);
    expect(dedupeRoutes([a, b])).toHaveLength(2);
  });

  it('never returns empty for a non-empty ORS response', () => {
    const only = route(line(46.52, 6.60, 6.62), 50_000);
    expect(dedupeRoutes([only])).toHaveLength(1);
  });
});

// buildRoutes calls tr() through onStatus; the vitest environment is 'node'.
beforeAll(() => {
  globalThis.document = { documentElement: { lang: 'fr' } };
});

afterEach(() => {
  delete globalThis.fetch;
  vi.useRealTimers();
});

const LAUSANNE = { lat: 46.5171, lng: 6.6331 };
const RENENS   = { lat: 46.5373, lng: 6.5853 };

function mockOrs(status) {
  globalThis.fetch = async () => ({ ok: status === 200, status, json: async () => ({ features: [] }) });
}

describe('buildRoutes error codes', () => {
  it('codes exhausted 503 retries as ROUTING_UNAVAILABLE, not ROUTE_FAILED', async () => {
    // ROUTE_FAILED would tell the user to fix an address that was fine.
    vi.useFakeTimers();
    mockOrs(503);
    const p = buildRoutes(LAUSANNE, RENENS, () => {});
    const assertion = expect(p).rejects.toMatchObject({ code: 'ROUTING_UNAVAILABLE' });
    await vi.runAllTimersAsync(); // skip the 1s + 3s backoff
    await assertion;
  });

  it('keeps 429 on its own RATE_LIMIT code', async () => {
    vi.useFakeTimers();
    mockOrs(429);
    const p = buildRoutes(LAUSANNE, RENENS, () => {});
    const assertion = expect(p).rejects.toMatchObject({ code: 'RATE_LIMIT' });
    await vi.runAllTimersAsync();
    await assertion;
  });

  it('still codes a non-retryable status as ROUTE_FAILED', async () => {
    mockOrs(400);
    await expect(buildRoutes(LAUSANNE, RENENS, () => {}))
      .rejects.toMatchObject({ code: 'ROUTE_FAILED' });
  });

  it('keeps the status in the message for the console and Sentry', async () => {
    mockOrs(400);
    await expect(buildRoutes(LAUSANNE, RENENS, () => {})).rejects.toThrow('ORS 400');
  });
});

// A single ORS feature: a straight line whose elevation climbs by `climbM`
// over its length, with whatever summary ORS is pretending to return.
function mockOrsFeature(summary, climbM = 0) {
  const coords = [];
  for (let i = 0; i <= 20; i++) {
    coords.push([6.60 + i * 0.0002, 46.52, 400 + (climbM * i) / 20]);
  }
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ features: [{ geometry: { coordinates: coords }, properties: { summary } }] }),
  });
}

async function firstRoute(summary, climbM) {
  mockOrsFeature(summary, climbM);
  const [rt] = await buildRoutes(LAUSANNE, RENENS, () => {});
  return rt;
}

describe('route duration', () => {
  it("keeps ORS's own duration instead of re-deriving one from the distance", async () => {
    // Was distance / 4.5 km/h, which threw away the number ORS returned and
    // fed a made-up pace to the sun scoring.
    const rt = await firstRoute({ distance: 3000, duration: 2160 });
    expect(rt.duration).toBe(2160);
  });

  it('falls back to a flat pace only when ORS omits the duration', async () => {
    const rt = await firstRoute({ distance: 3000 });
    expect(rt.duration).toBeCloseTo(3000 / (5 / 3.6), 5);
  });

  it('adds ~4 min per 100 m of ascent, which ORS never accounts for', async () => {
    // Same 3000 m at the same ORS duration, 250 m of climb: +10 min.
    const rt = await firstRoute({ distance: 3000, duration: 2160 }, 250);
    expect(rt.elevation.up).toBe(250);
    expect(rt.duration).toBeCloseTo(2160 + 600, 5);
  });

  it('ignores descent, only the uphill costs time', async () => {
    const rt = await firstRoute({ distance: 3000, duration: 2160 }, -250);
    expect(rt.elevation.down).toBe(250);
    expect(rt.duration).toBe(2160);
  });

  it('gives scoreRoute a pace that matches the time shown to the user', async () => {
    // The whole point of folding the climb in here: distance / duration is
    // what scoreRoute walks the sun along, so it must be the same total the
    // drawer displays, not a flat-ground pace the walker never holds.
    const rt = await firstRoute({ distance: 3000, duration: 2160 }, 250);
    expect(rt.distance / rt.duration).toBeCloseTo(3000 / 2760, 5);
  });
});
