import { describe, it, expect } from 'vitest';
import { nextSaturday, shareExample } from '../src/lib/shareExample.js';

const day = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate()];

describe('nextSaturday', () => {
  it('goes forward to the coming Saturday', () => {
    expect(day(nextSaturday(new Date(2026, 10, 6, 12)))).toEqual([2026, 11, 7]); // Friday
    expect(day(nextSaturday(new Date(2026, 10, 8, 12)))).toEqual([2026, 11, 14]); // Sunday
  });

  it('keeps today on a Saturday before 15:00, then skips a week', () => {
    expect(day(nextSaturday(new Date(2026, 10, 7, 14, 59)))).toEqual([2026, 11, 7]);
    expect(day(nextSaturday(new Date(2026, 10, 7, 15, 0)))).toEqual([2026, 11, 14]);
  });

  it('crosses a month and a year', () => {
    expect(day(nextSaturday(new Date(2026, 11, 28, 9)))).toEqual([2027, 1, 2]);
  });
});

describe('shareExample', () => {
  it('links to Saturday 15:00 in the sun outside April to September', () => {
    const { href, route, words } = shareExample(new Date(2026, 10, 6, 12));
    const p = new URLSearchParams(href.slice(2));
    expect(p.get('dt')).toBe('2026-11-07T15:00');
    expect(p.get('r')).toBe('sunny');
    expect(route).toBe('sunny');
    expect(words).toBe('au soleil');
  });

  it('switches to the shade from April to September', () => {
    expect(shareExample(new Date(2027, 3, 1, 12)).route).toBe('shady');  // Sat 3 April
    expect(shareExample(new Date(2027, 8, 30, 12)).route).toBe('sunny'); // Sat 2 October
  });

  it('follows the month of the Saturday, not of today', () => {
    expect(shareExample(new Date(2027, 2, 29, 12)).route).toBe('shady'); // Monday 29 March, Sat 3 April
  });
});
