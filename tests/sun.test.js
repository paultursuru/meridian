import { describe, it, expect } from 'vitest';
import SunCalc from 'suncalc';
import { getSun, makeSunSampler, isGrazingSun, GRAZING_SUN_DEG } from '../src/lib/sun.js';

// Lausanne — a fixed location for deterministic results.
const LAT = 46.52, LNG = 6.63;

describe('getSun', () => {
  it('places the sun due south (~180°) and above the horizon at solar noon (N hemisphere)', () => {
    const noon = SunCalc.getTimes(new Date('2026-06-21T00:00:00Z'), LAT, LNG).solarNoon;
    const { azDeg, altDeg } = getSun(noon, LAT, LNG);
    expect(Math.abs(azDeg - 180)).toBeLessThan(1); // within ~1° of due south
    expect(altDeg).toBeGreaterThan(0);
  });

  it('reports the sun below the horizon at night (nadir)', () => {
    const nadir = SunCalc.getTimes(new Date('2026-06-21T00:00:00Z'), LAT, LNG).nadir;
    const { altDeg } = getSun(nadir, LAT, LNG);
    expect(altDeg).toBeLessThan(0);
  });

  it('always returns a compass azimuth in [0, 360)', () => {
    for (let h = 0; h < 24; h += 3) {
      const d = new Date(Date.UTC(2026, 5, 21, h, 0, 0));
      const { azDeg } = getSun(d, LAT, LNG);
      expect(azDeg).toBeGreaterThanOrEqual(0);
      expect(azDeg).toBeLessThan(360);
    }
  });
});

describe('makeSunSampler', () => {
  const departure = new Date('2026-06-21T10:00:00Z');

  it('matches getSun at departure', () => {
    const sunAt = makeSunSampler(departure, LAT, LNG);
    expect(sunAt(0)).toEqual(getSun(departure, LAT, LNG));
  });

  it('moves the sun after an hour of walking', () => {
    const sunAt = makeSunSampler(departure, LAT, LNG);
    const later = new Date(departure.getTime() + 3600 * 1000);
    expect(sunAt(3600)).toEqual(getSun(later, LAT, LNG));
    expect(Math.abs(sunAt(3600).azDeg - sunAt(0).azDeg)).toBeGreaterThan(5);
  });

  it('memoizes within a quantization bucket', () => {
    const sunAt = makeSunSampler(departure, LAT, LNG, 60);
    expect(sunAt(10)).toBe(sunAt(20)); // same 60 s bucket → same object
  });
});

describe('isGrazingSun (review 7.3)', () => {
  it('is false at night, where the night note already explains things', () => {
    expect(isGrazingSun(-0.1)).toBe(false);
    expect(isGrazingSun(-20)).toBe(false);
    expect(isGrazingSun(0)).toBe(false);
  });

  it('is true while the sun is up but under the threshold', () => {
    expect(isGrazingSun(0.1)).toBe(true);
    expect(isGrazingSun(2.3)).toBe(true);   // Lausanne at the 2026-08-12 eclipse
    expect(isGrazingSun(GRAZING_SUN_DEG - 0.01)).toBe(true);
  });

  it('is false once the buildings-only model is trustworthy again', () => {
    expect(isGrazingSun(GRAZING_SUN_DEG)).toBe(false);
    expect(isGrazingSun(30)).toBe(false);
  });

  it('brackets the altitude where a 150 m bbox padding stops containing shadows', () => {
    // A 10 m building's shadow is height/tan(alt); at the threshold it is
    // already 114 m, i.e. most of the padding buildings.js fetches.
    const shadow = 10 / Math.tan(GRAZING_SUN_DEG * Math.PI / 180);
    expect(shadow).toBeGreaterThan(100);
    expect(shadow).toBeLessThan(150);
  });
});
