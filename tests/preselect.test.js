import { describe, it, expect } from 'vitest';
import { preselectTab, isWarmSeason, SHADE_TEMP_C } from '../src/lib/preselect.js';

// Months are 0-based (Date#getMonth): 6 = July, 0 = January.
const LAUSANNE = 46.5, SYDNEY = -33.9;

describe('isWarmSeason', () => {
  it('flags May–September in the northern hemisphere', () => {
    expect(isWarmSeason(6, LAUSANNE)).toBe(true);   // July
    expect(isWarmSeason(4, LAUSANNE)).toBe(true);   // May
    expect(isWarmSeason(0, LAUSANNE)).toBe(false);  // January
    expect(isWarmSeason(9, LAUSANNE)).toBe(false);  // October
  });

  it('shifts by six months in the southern hemisphere', () => {
    expect(isWarmSeason(0, SYDNEY)).toBe(true);   // January = summer
    expect(isWarmSeason(11, SYDNEY)).toBe(true);  // December
    expect(isWarmSeason(6, SYDNEY)).toBe(false);  // July = winter
  });
});

describe('preselectTab', () => {
  it('prefers shade when the forecast is hot', () => {
    expect(preselectTab({ altDeg: 30, temperature: 28, month: 2, lat: LAUSANNE })).toBe('shady');
    expect(preselectTab({ altDeg: 30, temperature: SHADE_TEMP_C, month: 2, lat: LAUSANNE })).toBe('shady');
  });

  it('prefers sun when the forecast is cool, even with a high sun', () => {
    // The old altitude-only heuristic got this wrong: 45° sun on a cold
    // spring day used to preselect the shady tab.
    expect(preselectTab({ altDeg: 45, temperature: 12, month: 2, lat: LAUSANNE })).toBe('sunny');
  });

  it('falls back to season + altitude when no forecast exists', () => {
    // High summer sun → shade
    expect(preselectTab({ altDeg: 60, temperature: null, month: 6, lat: LAUSANNE })).toBe('shady');
    // Same altitude in winter (impossible in Lausanne, but the point is the month gate)
    expect(preselectTab({ altDeg: 60, temperature: null, month: 0, lat: LAUSANNE })).toBe('sunny');
    // Summer but low sun (morning/evening) → sun
    expect(preselectTab({ altDeg: 25, temperature: null, month: 6, lat: LAUSANNE })).toBe('sunny');
  });

  it('uses the southern-hemisphere season in the fallback', () => {
    expect(preselectTab({ altDeg: 60, temperature: null, month: 0, lat: SYDNEY })).toBe('shady');
    expect(preselectTab({ altDeg: 60, temperature: null, month: 6, lat: SYDNEY })).toBe('sunny');
  });
});
