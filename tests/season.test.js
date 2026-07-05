import { describe, it, expect } from 'vitest';
import { leafFraction, deciduousLeafFrac } from '../src/lib/season.js';

// Helper: month is 0-indexed in the Date constructor (0 = January).
const dateInMonth = (month1to12) => new Date(2026, month1to12 - 1, 15);

describe('leafFraction (deciduous)', () => {
  it('is full canopy May–September', () => {
    for (const m of [5, 6, 7, 8, 9]) {
      expect(leafFraction(dateInMonth(m), true)).toBe(1.0);
    }
  });

  it('is partial in the shoulder months', () => {
    expect(leafFraction(dateInMonth(4), true)).toBe(0.70);  // April
    expect(leafFraction(dateInMonth(10), true)).toBe(0.70); // October
    expect(leafFraction(dateInMonth(3), true)).toBe(0.40);  // March
    expect(leafFraction(dateInMonth(11), true)).toBe(0.40); // November
  });

  it('is bare in winter', () => {
    for (const m of [12, 1, 2]) {
      expect(leafFraction(dateInMonth(m), true)).toBe(0.05);
    }
  });
});

describe('leafFraction (southern hemisphere)', () => {
  const SYDNEY_LAT = -33.87;

  it('is full canopy November–March', () => {
    for (const m of [11, 12, 1, 2, 3]) {
      expect(leafFraction(dateInMonth(m), true, SYDNEY_LAT)).toBe(1.0);
    }
  });

  it('is partial in the shoulder months', () => {
    expect(leafFraction(dateInMonth(10), true, SYDNEY_LAT)).toBe(0.70); // October
    expect(leafFraction(dateInMonth(4), true, SYDNEY_LAT)).toBe(0.70);  // April
    expect(leafFraction(dateInMonth(9), true, SYDNEY_LAT)).toBe(0.40);  // September
    expect(leafFraction(dateInMonth(5), true, SYDNEY_LAT)).toBe(0.40);  // May
  });

  it('is bare in the austral winter (Jun–Aug)', () => {
    for (const m of [6, 7, 8]) {
      expect(leafFraction(dateInMonth(m), true, SYDNEY_LAT)).toBe(0.05);
    }
  });

  it('mirrors the northern hemisphere with a 6-month shift', () => {
    for (let m = 1; m <= 12; m++) {
      const shifted = ((m + 5) % 12) + 1;
      expect(leafFraction(dateInMonth(m), true, SYDNEY_LAT))
        .toBe(leafFraction(dateInMonth(shifted), true, 46.5));
    }
  });
});

describe('leafFraction (evergreen)', () => {
  it('always returns full canopy regardless of month', () => {
    for (let m = 1; m <= 12; m++) {
      expect(leafFraction(dateInMonth(m), false)).toBe(1.0);
    }
  });
});

describe('deciduousLeafFrac', () => {
  it('matches leafFraction(date, true)', () => {
    const d = dateInMonth(1);
    expect(deciduousLeafFrac(d)).toBe(leafFraction(d, true));
  });

  it('passes the latitude through (January in Sydney = full canopy)', () => {
    expect(deciduousLeafFrac(dateInMonth(1), -33.87)).toBe(1.0);
  });
});
