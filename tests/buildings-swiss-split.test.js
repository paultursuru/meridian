import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchBuildings } from '../src/lib/buildings.js';

// docs/2-search-latency-onepager.md step 5: swissbuildings-lookup's tiles
// are a uniform 0.01deg grid, capped at 45 tiles/request (Workers Free
// subrequest limit). buildings.js must split a bbox that would exceed that
// into 2-4 parallel sub-requests. The first version of this splitting logic
// shipped a real bug — a naive continuous-range split put up to 50 tiles in
// one piece on the doc's own 10 km/140-tile example — so these tests pin the
// exact per-request tile counts, not just "it doesn't crash".

function tileCountFromUrl(urlStr) {
  const u = new URL(urlStr);
  const [w, s, e, n] = u.searchParams.get('bbox').split(',').map(Number);
  const latCells = Math.floor(n * 100) - Math.floor(s * 100) + 1;
  const lngCells = Math.floor(e * 100) - Math.floor(w * 100) + 1;
  return latCells * lngCells;
}

function mockFetch(responder) {
  const calls = [];
  global.fetch = vi.fn((url) => {
    calls.push(String(url));
    return Promise.resolve(responder(String(url)));
  });
  return calls;
}

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchBuildings (switzerland) — client-side bbox splitting', () => {
  it('fires a single request for a small bbox (no split needed)', async () => {
    const calls = mockFetch(() => jsonResponse([]));
    // Lausanne-scale route bbox, ~12 tiles — well under the 40 threshold.
    const bbox = [46.5155, 6.598, 46.5255, 6.640]; // s,w,n,e
    await fetchBuildings(bbox, { switzerland: true });
    expect(calls.length).toBe(1);
  });

  it("splits the doc's own 10 km/140-tile example into pieces that all fit under budget", async () => {
    const calls = mockFetch(() => jsonResponse([]));
    const bbox = [46.50, 6.55, 46.59, 6.68]; // s,w,n,e — matches the doc's "~140 tiles" 10km example
    await fetchBuildings(bbox, { switzerland: true });
    expect(calls.length).toBeGreaterThan(1);
    const tileCounts = calls.map(tileCountFromUrl);
    for (const c of tileCounts) expect(c).toBeLessThanOrEqual(45); // Worker's hard MAX_CELLS
    for (const c of tileCounts) expect(c).toBeLessThanOrEqual(40); // client's own target margin
    expect(calls.length).toBeLessThanOrEqual(4); // doc: "2-4 sub-bboxes"
  });

  it('merges and dedupes buildings returned by different pieces', async () => {
    const shared = { centroid: { lat: 46.55, lng: 6.60 }, height: 12, verts: [], radius: 5, hasHeight: true };
    const onlyInFirst = { centroid: { lat: 46.51, lng: 6.56 }, height: 8, verts: [], radius: 3, hasHeight: true };
    let call = 0;
    mockFetch(() => jsonResponse(call++ === 0 ? [shared, onlyInFirst] : [shared]));
    const bbox = [46.50, 6.55, 46.59, 6.68];
    const { buildings, status } = await fetchBuildings(bbox, { switzerland: true });
    expect(status).toBe('ok');
    // The shared building must appear exactly once despite being returned by
    // more than one piece (adjacent tiles can legitimately overlap).
    const atShared = buildings.filter(b => b.centroid.lat === 46.55 && b.centroid.lng === 6.60);
    expect(atShared.length).toBe(1);
    expect(buildings.some(b => b.centroid.lat === 46.51)).toBe(true);
  });

  it("reports 'failed' if any one piece's request fails, same as an unsplit fetch", async () => {
    let call = 0;
    mockFetch(() => (call++ === 1 ? jsonResponse('', false, 504) : jsonResponse([])));
    const bbox = [46.50, 6.55, 46.59, 6.68];
    const { buildings, status } = await fetchBuildings(bbox, { switzerland: true });
    expect(status).toBe('failed');
    expect(buildings).toEqual([]);
  });
});
