import { describe, it, expect } from 'vitest';
import { haversine, bearing, angleDiff, fmtDist, fmtDur } from '../src/lib/helpers.js';

describe('haversine', () => {
  it('returns 0 for identical points', () => {
    expect(haversine(46.5, 6.6, 46.5, 6.6)).toBe(0);
  });

  it('approximates 1° of longitude at the equator (~111 km)', () => {
    expect(haversine(0, 0, 0, 1)).toBeCloseTo(111195, -2); // within ~100 m
  });

  it('is symmetric (A→B == B→A)', () => {
    const ab = haversine(46.52, 6.63, 46.53, 6.65);
    const ba = haversine(46.53, 6.65, 46.52, 6.63);
    expect(ab).toBeCloseTo(ba, 6);
  });
});

describe('bearing', () => {
  it('points north for a due-north move', () => {
    expect(bearing(46, 6, 47, 6)).toBeCloseTo(0, 5);
  });

  it('points east (~90°) for a due-east move', () => {
    expect(bearing(46, 6, 46, 7)).toBeCloseTo(90, 5);
  });

  it('points south (180°) for a due-south move', () => {
    expect(bearing(46, 6, 45, 6)).toBeCloseTo(180, 5);
  });
});

describe('angleDiff', () => {
  it('takes the shortest way around 0°', () => {
    expect(angleDiff(350, 10)).toBe(20);
  });

  it('returns 180 for opposite directions', () => {
    expect(angleDiff(0, 180)).toBe(180);
  });

  it('never exceeds 180', () => {
    for (let a = 0; a < 360; a += 37) {
      for (let b = 0; b < 360; b += 53) {
        expect(angleDiff(a, b)).toBeLessThanOrEqual(180);
      }
    }
  });
});

describe('fmtDist', () => {
  it('shows metres below 1 km', () => {
    expect(fmtDist(500)).toBe('500 m');
    expect(fmtDist(999)).toBe('999 m');
  });

  it('shows kilometres with one decimal from 1 km', () => {
    expect(fmtDist(1000)).toBe('1.0 km');
    expect(fmtDist(1500)).toBe('1.5 km');
  });
});

describe('fmtDur', () => {
  it('shows minutes below an hour', () => {
    expect(fmtDur(59)).toBe('1 min');   // rounds to nearest minute
    expect(fmtDur(1800)).toBe('30 min');
  });

  it('shows h+mm from one hour, zero-padding minutes', () => {
    expect(fmtDur(3600)).toBe('1h00');
    expect(fmtDur(3660)).toBe('1h01');
  });
});
