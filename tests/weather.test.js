import { describe, it, expect, vi, afterEach } from 'vitest';
import { isForecastable, closestHourIndex, fetchWeather, weatherAt } from '../src/lib/weather.js';

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

describe('fetchWeather', () => {
  afterEach(() => vi.unstubAllGlobals());

  const target = new Date('2026-07-05T14:00:00Z');

  function stubFetch(response) {
    const spy = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', spy);
    return spy;
  }

  it('returns the full day\'s hourly cloud cover and temperature', async () => {
    stubFetch({
      ok: true,
      json: async () => ({
        hourly: {
          time: [T12 + HOUR, T12 + 2 * HOUR, T12 + 3 * HOUR], // 13:00Z, 14:00Z, 15:00Z
          cloud_cover: [10, 85, 40],
          temperature_2m: [21.3, 26.1, 24.9],
        },
      }),
    });
    const w = await fetchWeather(46.52, 6.63, target, NOW);
    expect(w).toEqual({
      times: [T12 + HOUR, T12 + 2 * HOUR, T12 + 3 * HOUR],
      cloudCover: [10, 85, 40],
      temperature: [21.3, 26.1, 24.9],
    });
  });

  it('defaults temperature to an empty array when the field is missing', async () => {
    stubFetch({
      ok: true,
      json: async () => ({ hourly: { time: [T12], cloud_cover: [50] } }),
    });
    const w = await fetchWeather(46.52, 6.63, target, NOW);
    expect(w).toEqual({ times: [T12], cloudCover: [50], temperature: [] });
  });

  it('requests the UTC day containing the target instant', async () => {
    const spy = stubFetch({ ok: true, json: async () => ({ hourly: { time: [T12], cloud_cover: [50] } }) });
    await fetchWeather(46.52, 6.63, target, NOW);
    expect(spy.mock.calls[0][0]).toContain('start_date=2026-07-05&end_date=2026-07-05');
  });

  it('skips the request entirely when the date is too far in the future', async () => {
    const spy = stubFetch({ ok: true, json: async () => ({}) });
    const w = await fetchWeather(46.52, 6.63, new Date('2026-09-01T12:00:00Z'), NOW);
    expect(w).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns null on HTTP error', async () => {
    stubFetch({ ok: false, status: 429 });
    expect(await fetchWeather(46.52, 6.63, target, NOW)).toBeNull();
  });

  it('returns null on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    expect(await fetchWeather(46.52, 6.63, target, NOW)).toBeNull();
  });

  it('returns null when the request is aborted (e.g. a timeout)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('The operation was aborted', 'AbortError')));
    expect(await fetchWeather(46.52, 6.63, target, NOW)).toBeNull();
  });

  it('passes an abortable signal so a hung request cannot block the caller forever', async () => {
    const spy = stubFetch({ ok: true, json: async () => ({ hourly: { time: [T12], cloud_cover: [50] } }) });
    await fetchWeather(46.52, 6.63, target, NOW);
    expect(spy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('returns null on an empty or malformed payload', async () => {
    stubFetch({ ok: true, json: async () => ({ hourly: { time: [], cloud_cover: [] } }) });
    expect(await fetchWeather(46.52, 6.63, target, NOW)).toBeNull();
  });
});

describe('weatherAt', () => {
  const hourly = {
    times: [T12, T12 + HOUR, T12 + 2 * HOUR],
    cloudCover: [10, 85, 40],
    temperature: [21.3, 26.1, 24.9],
  };

  it('samples the hour closest to the given instant', () => {
    expect(weatherAt(hourly, new Date((T12 + 2 * HOUR) * 1000))).toEqual({ cloudCover: 40, temperature: 24.9 });
  });

  it('re-samples a different instant from the same hourly object (the scrubber use case)', () => {
    expect(weatherAt(hourly, new Date(T12 * 1000))).toEqual({ cloudCover: 10, temperature: 21.3 });
    expect(weatherAt(hourly, new Date((T12 + HOUR) * 1000))).toEqual({ cloudCover: 85, temperature: 26.1 });
  });

  it('returns null when no weather was fetched', () => {
    expect(weatherAt(null, new Date())).toBeNull();
  });

  it('returns a null temperature when missing at the sampled hour', () => {
    const h = { times: [T12], cloudCover: [50], temperature: [] };
    expect(weatherAt(h, new Date(T12 * 1000))).toEqual({ cloudCover: 50, temperature: null });
  });
});
