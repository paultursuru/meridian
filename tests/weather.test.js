import { describe, it, expect, vi, afterEach } from 'vitest';
import { isForecastable, closestHourIndex, fetchCloudCover } from '../src/lib/weather.js';

const NOW = new Date('2026-07-05T12:00:00Z');

// 2026-07-05T12:00:00Z in unix seconds; hourly slots are built from it.
const T12 = 1783252800;
const HOUR = 3600;

describe('isForecastable', () => {
  it('accepts now and the near future', () => {
    expect(isForecastable(NOW, NOW)).toBe(true);
    expect(isForecastable(new Date('2026-07-10T12:00:00Z'), NOW)).toBe(true);
    expect(isForecastable(new Date('2026-07-20T11:00:00Z'), NOW)).toBe(true);
  });

  it('rejects dates beyond the 15-day forecast horizon', () => {
    expect(isForecastable(new Date('2026-07-21T12:00:00Z'), NOW)).toBe(false);
    expect(isForecastable(new Date('2026-12-25T12:00:00Z'), NOW)).toBe(false);
  });

  it('tolerates a just-past datetime but rejects the further past', () => {
    expect(isForecastable(new Date('2026-07-05T08:00:00Z'), NOW)).toBe(true);
    expect(isForecastable(new Date('2026-07-01T12:00:00Z'), NOW)).toBe(false);
  });
});

describe('closestHourIndex', () => {
  const times = [T12, T12 + HOUR, T12 + 2 * HOUR, T12 + 3 * HOUR]; // 12:00Z → 15:00Z

  it('picks the exact matching hour', () => {
    expect(closestHourIndex(times, new Date((T12 + 2 * HOUR) * 1000))).toBe(2);
  });

  it('rounds to the nearest hour', () => {
    const at = (sec) => new Date((T12 + sec) * 1000);
    expect(closestHourIndex(times, at(HOUR + 1700))).toBe(1); // 13:28Z
    expect(closestHourIndex(times, at(HOUR + 2000))).toBe(2); // 13:33Z
  });

  it('clamps to the edges of the day', () => {
    expect(closestHourIndex(times, new Date('2026-07-04T00:00:00Z'))).toBe(0);
    expect(closestHourIndex(times, new Date('2026-07-09T00:00:00Z'))).toBe(3);
  });
});

describe('fetchCloudCover', () => {
  afterEach(() => vi.unstubAllGlobals());

  const target = new Date('2026-07-05T14:00:00Z');

  function stubFetch(response) {
    const spy = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', spy);
    return spy;
  }

  it('returns the cloud cover of the hour closest to the target', async () => {
    stubFetch({
      ok: true,
      json: async () => ({
        hourly: {
          time: [T12 + HOUR, T12 + 2 * HOUR, T12 + 3 * HOUR], // 13:00Z, 14:00Z, 15:00Z
          cloud_cover: [10, 85, 40],
        },
      }),
    });
    const w = await fetchCloudCover(46.52, 6.63, target, NOW);
    expect(w).toEqual({ cloudCover: 85 });
  });

  it('requests the UTC day containing the target instant', async () => {
    const spy = stubFetch({ ok: true, json: async () => ({ hourly: { time: [T12], cloud_cover: [50] } }) });
    await fetchCloudCover(46.52, 6.63, target, NOW);
    expect(spy.mock.calls[0][0]).toContain('start_date=2026-07-05&end_date=2026-07-05');
  });

  it('skips the request entirely when the date is too far in the future', async () => {
    const spy = stubFetch({ ok: true, json: async () => ({}) });
    const w = await fetchCloudCover(46.52, 6.63, new Date('2026-09-01T12:00:00Z'), NOW);
    expect(w).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns null on HTTP error', async () => {
    stubFetch({ ok: false, status: 429 });
    expect(await fetchCloudCover(46.52, 6.63, target, NOW)).toBeNull();
  });

  it('returns null on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    expect(await fetchCloudCover(46.52, 6.63, target, NOW)).toBeNull();
  });

  it('returns null on an empty or malformed payload', async () => {
    stubFetch({ ok: true, json: async () => ({ hourly: { time: [], cloud_cover: [] } }) });
    expect(await fetchCloudCover(46.52, 6.63, target, NOW)).toBeNull();
  });
});
