import { describe, it, expect } from 'vitest';
import { fmtDurWithClimb } from '../src/lib/ui.js';

describe('fmtDurWithClimb', () => {
  it('formats a sub-hour walk in minutes', () => {
    expect(fmtDurWithClimb({ duration: 1800 })).toBe('30 min');
  });

  it('formats a 70-minute walk as h+mm, not raw minutes', () => {
    // ui.js used to carry its own fmtDur that never handled hours, so a
    // 70-min route showed "70 min" instead of "1h10" (review 5.3).
    expect(fmtDurWithClimb({ duration: 4200 })).toBe('1h10');
  });

  it('adds ~4 min per 100 m of ascent, tipping a sub-hour walk over the hour mark', () => {
    // 55 min flat + 250 m climb (10 min) = 65 min total.
    expect(fmtDurWithClimb({ duration: 3300, elevation: { up: 250, down: 0 } })).toBe('1h05');
  });

  it('ignores descent — only ascent adds time', () => {
    expect(fmtDurWithClimb({ duration: 1800, elevation: { up: 0, down: 300 } })).toBe('30 min');
  });
});
