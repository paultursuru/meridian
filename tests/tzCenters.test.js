import { describe, it, expect } from 'vitest';
import { TZ_CENTERS } from '../src/lib/tzCenters.js';

describe('TZ_CENTERS', () => {
  it('covers every timezone the runtime can resolve', () => {
    // Guards against a future tzdata update introducing a zone this table
    // (generated from zone1970.tab + backward, see src/lib/tzCenters.js)
    // doesn't know about — Intl.DateTimeFormat().resolvedOptions().timeZone
    // could then return a key with no entry.
    const missing = Intl.supportedValuesOf('timeZone').filter(z => !TZ_CENTERS[z]);
    expect(missing).toEqual([]);
  });

  it('gives every entry a plausible [lat, lng] pair', () => {
    for (const [zone, [lat, lng]] of Object.entries(TZ_CENTERS)) {
      expect(lat, `${zone} latitude`).toBeGreaterThanOrEqual(-90);
      expect(lat, `${zone} latitude`).toBeLessThanOrEqual(90);
      expect(lng, `${zone} longitude`).toBeGreaterThanOrEqual(-180);
      expect(lng, `${zone} longitude`).toBeLessThanOrEqual(180);
    }
  });

  it('resolves well-known zones to their real city, not a tzdata link target', () => {
    const [lat, lng] = TZ_CENTERS['Europe/Zurich'];
    expect(lat).toBeCloseTo(47.38, 0);
    expect(lng).toBeCloseTo(8.53, 0);
  });

  it('overrides the Iceland/Abidjan tzdata link (same civil time since 1970, very different place)', () => {
    const [lat, lng] = TZ_CENTERS['Atlantic/Reykjavik'];
    expect(lat).toBeCloseTo(64.1, 0);
    expect(lng).toBeCloseTo(-21.9, 0);
  });
});
