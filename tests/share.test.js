import { describe, it, expect } from 'vitest';
import { buildShareQuery, parseShareQuery } from '../src/lib/share.js';

describe('buildShareQuery', () => {
  it('encodes coords, labels and datetime', () => {
    const q = buildShareQuery({
      start: { lat: 46.5197, lng: 6.6323, label: 'Place de la Riponne, Lausanne' },
      end:   { lat: 46.5167, lng: 6.6291, label: 'Gare de Lausanne' },
      date: '2026-07-05',
      time: '14:30',
    });
    const p = new URLSearchParams(q);
    expect(p.get('from')).toBe('46.51970,6.63230');
    expect(p.get('to')).toBe('46.51670,6.62910');
    expect(p.get('fromq')).toBe('Place de la Riponne, Lausanne');
    expect(p.get('toq')).toBe('Gare de Lausanne');
    expect(p.get('dt')).toBe('2026-07-05T14:30');
  });

  it('omits labels and time when absent', () => {
    const q = buildShareQuery({
      start: { lat: 0, lng: 0 },
      end:   { lat: -33.8688, lng: 151.2093 },
      date: '2026-01-10',
      time: '',
    });
    const p = new URLSearchParams(q);
    expect(p.has('fromq')).toBe(false);
    expect(p.has('toq')).toBe(false);
    expect(p.get('dt')).toBe('2026-01-10');
  });
});

describe('parseShareQuery', () => {
  it('round-trips what buildShareQuery produces', () => {
    const q = buildShareQuery({
      start: { lat: 46.5197, lng: 6.6323, label: 'Riponne' },
      end:   { lat: 46.5167, lng: 6.6291, label: 'Gare' },
      date: '2026-07-05',
      time: '14:30',
    });
    const r = parseShareQuery('?' + q);
    expect(r.start).toEqual({ lat: 46.5197, lng: 6.6323, label: 'Riponne' });
    expect(r.end).toEqual({ lat: 46.5167, lng: 6.6291, label: 'Gare' });
    expect(r.date).toBe('2026-07-05');
    expect(r.time).toBe('14:30');
  });

  it('falls back to "lat, lng" when a label is missing', () => {
    const r = parseShareQuery('?from=46.5,6.6&to=47.0,7.0');
    expect(r.start.label).toBe('46.50000, 6.60000');
    expect(r.end.label).toBe('47.00000, 7.00000');
  });

  it('returns nulls for missing or malformed params', () => {
    expect(parseShareQuery('')).toEqual({ start: null, end: null, date: null, time: null });
    expect(parseShareQuery('?from=abc,def&to=1,2,3').start).toBeNull();
    expect(parseShareQuery('?from=46.5&to=47,7').start).toBeNull();
    expect(parseShareQuery('?from=46.5,6.6&dt=oops').date).toBeNull();
  });

  it('rejects out-of-range coordinates', () => {
    expect(parseShareQuery('?from=91,6.6').start).toBeNull();
    expect(parseShareQuery('?from=-91,6.6').start).toBeNull();
    expect(parseShareQuery('?to=46.5,181').end).toBeNull();
  });

  it('accepts a date-only dt', () => {
    const r = parseShareQuery('?dt=2026-07-05');
    expect(r.date).toBe('2026-07-05');
    expect(r.time).toBeNull();
  });
});
