import { describe, it, expect } from 'vitest';
import SunCalc from 'suncalc';
import { getSun, makeSunSampler } from '../src/lib/sun.js';

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
