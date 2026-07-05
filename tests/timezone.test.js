import { describe, it, expect } from 'vitest';
import { resolveTimeZone, zonedTimeToUtc } from '../src/lib/timezone.js';

describe('resolveTimeZone', () => {
  it('resolves the IANA zone for a given point', () => {
    expect(resolveTimeZone(40.7128, -74.0060)).toBe('America/New_York');
    expect(resolveTimeZone(48.8566, 2.3522)).toBe('Europe/Paris');
  });
});

describe('zonedTimeToUtc', () => {
  it('converts a wall-clock time in a summer (DST) zone to UTC', () => {
    // 10:00 in New York in July is EDT (UTC-4) -> 14:00 UTC
    const d = zonedTimeToUtc('2026-07-05T10:00', 'America/New_York');
    expect(d.toISOString()).toBe('2026-07-05T14:00:00.000Z');
  });

  it('converts a wall-clock time in a winter (standard time) zone to UTC', () => {
    // 10:00 in New York in January is EST (UTC-5) -> 15:00 UTC
    const d = zonedTimeToUtc('2026-01-05T10:00', 'America/New_York');
    expect(d.toISOString()).toBe('2026-01-05T15:00:00.000Z');
  });

  it('differs from naive local-time parsing across zones', () => {
    // Same wall-clock string, different zones -> different absolute instants
    const nyc = zonedTimeToUtc('2026-07-05T10:00', 'America/New_York');
    const paris = zonedTimeToUtc('2026-07-05T10:00', 'Europe/Paris');
    expect(nyc.getTime()).not.toBe(paris.getTime());
  });
});
