import { describe, it, expect } from 'vitest';
import { resolveTimeZone, zonedTimeToUtc, minutesInZone, dateValueInZone } from '../src/lib/timezone.js';

describe('resolveTimeZone', () => {
  it('resolves the IANA zone for a given point', async () => {
    expect(await resolveTimeZone(40.7128, -74.0060)).toBe('America/New_York');
    expect(await resolveTimeZone(48.8566, 2.3522)).toBe('Europe/Paris');
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

describe('minutesInZone', () => {
  it('reads minutes-since-midnight in the given zone, not UTC', () => {
    // 14:00 UTC = 10:00 in New York (EDT, UTC-4) in July -> 600 minutes
    const d = new Date('2026-07-05T14:00:00.000Z');
    expect(minutesInZone(d, 'America/New_York')).toBe(600);
  });

  it('matches the instant used to build it via zonedTimeToUtc', () => {
    const d = zonedTimeToUtc('2026-01-05T08:45', 'Europe/Paris');
    expect(minutesInZone(d, 'Europe/Paris')).toBe(8 * 60 + 45);
  });
});

describe('dateValueInZone', () => {
  it('reads the calendar date in the given zone, not UTC', () => {
    // 23:30 in New York (EDT, UTC-4) on the 4th is 03:30 UTC on the 5th —
    // the two zones disagree on which day it is.
    const d = new Date('2026-07-05T03:30:00.000Z');
    expect(dateValueInZone(d, 'America/New_York')).toBe('2026-07-04');
    expect(dateValueInZone(d, 'UTC')).toBe('2026-07-05');
  });

  it('round-trips with zonedTimeToUtc for the review #2 §3.1 share-URL case', () => {
    // The scrubber (review #2 §3.1) re-derives the share URL's date/time from
    // the scrubbed instant via dateValueInZone + formatTimeInZone — this must
    // reproduce the same wall-clock string zonedTimeToUtc built it from.
    const d = zonedTimeToUtc('2026-07-28T20:04', 'Europe/Paris');
    expect(dateValueInZone(d, 'Europe/Paris')).toBe('2026-07-28');
  });
});
