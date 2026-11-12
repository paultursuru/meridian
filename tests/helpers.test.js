import { describe, it, expect } from 'vitest';
import { haversine, bearing, angleDiff, fmtDist, fmtDur, fmtHm, localDateValue, deltaPhrase, deltaPhrases, placeShortName, summaryWhen } from '../src/lib/helpers.js';

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
    expect(fmtDist(500)).toBe('500\u00a0m');
    expect(fmtDist(999)).toBe('999\u00a0m');
  });

  it('shows kilometres with one decimal from 1 km', () => {
    expect(fmtDist(1000)).toBe('1,0\u00a0km');
    expect(fmtDist(3400)).toBe('3,4\u00a0km');
  });

  it('picks the decimal separator by language', () => {
    expect(fmtDist(3400, 'it')).toBe('3,4\u00a0km');
    expect(fmtDist(3400, 'de')).toBe('3.4\u00a0km');
    expect(fmtDist(3400, 'en')).toBe('3.4\u00a0km');
    expect(fmtDist(3400, 'rm')).toBe('3.4\u00a0km');
  });
});

describe('fmtDur', () => {
  it('shows minutes below an hour', () => {
    expect(fmtDur(59)).toBe('1\u00a0min');   // rounds to nearest minute
    expect(fmtDur(1800)).toBe('30\u00a0min');
  });

  it('shows "h mm" from one hour, zero-padding minutes', () => {
    expect(fmtDur(3600)).toBe('1\u00a0h\u00a000');
    expect(fmtDur(3660)).toBe('1\u00a0h\u00a001');
  });
});

describe('fmtHm', () => {
  it('zero-pads hours and minutes', () => {
    expect(fmtHm(5)).toBe('00:05');
    expect(fmtHm(60)).toBe('01:00');
  });

  it('formats a typical afternoon value', () => {
    expect(fmtHm(14 * 60 + 32)).toBe('14:32');
  });
});

describe('localDateValue', () => {
  it('zero-pads month and day', () => {
    expect(localDateValue(new Date(2026, 8, 5))).toBe('2026-09-05');
  });

  it('keeps the local calendar date just after local midnight', () => {
    // In any UTC+ timezone, toISOString() on this date would still say the
    // previous day — the exact bug this helper replaces (review 2.2).
    const justPastMidnight = new Date(2026, 0, 1, 0, 30);
    expect(localDateValue(justPastMidnight)).toBe('2026-01-01');
  });
});

describe('deltaPhrase', () => {
  const tr = (k, v) => `${k}|${JSON.stringify(v)}`;
  it('picks faster / same / slower when the route gains on its goal', () => {
    expect(deltaPhrase('sunny', 5, 10, 15, tr)).toBe('delta_sunny_faster|{"min":"5","sun":"5"}');
    expect(deltaPhrase('shady', 4, 12, 12, tr)).toBe('delta_shady_same|{"min":"0","sun":"4"}');
    expect(deltaPhrase('sunny', 4, 20, 15, tr)).toBe('delta_sunny_slower|{"min":"5","sun":"4"}');
  });
  it('says the same sun when the gap rounds to zero', () => {
    expect(deltaPhrase('shady', 0, 26, 24, tr)).toBe('delta_even_slower|{"min":"2"}');
    expect(deltaPhrase('sunny', 0, 24, 26, tr)).toBe('delta_even_faster|{"min":"2"}');
    expect(deltaPhrase('sunny', 0, 15, 15, tr)).toBe('delta_even_same|{"min":"0"}');
  });
  it('keeps the signed-time form for a loss', () => {
    expect(deltaPhrase('sunny', -3, 10, 15, tr)).toBe('delta_sunny_less|{"time":"−5 min","sun":"3"}');
    expect(deltaPhrase('shady', -1, 20, 12, tr)).toBe('delta_shady_less|{"time":"+8 min","sun":"1"}');
  });
});

describe('deltaPhrases', () => {
  const tr = (k, v) => `${k}|${JSON.stringify(v)}`;
  it('counts minutes of sun, not percentage points', () => {
    // Gare to Riponne, Lausanne, 21 December at 12:30: 34 % of 20 min against
    // 17 % of 15 min is 6.8 min of sun against 2.6, a gap of 4 min where the
    // percentages said 17 points.
    const sunny = { sunScore: 0.34, duration: 20 * 60 };
    const shady = { sunScore: 0.17, duration: 15 * 60 };
    expect(deltaPhrases(sunny, shady, tr)).toEqual({
      sunny: 'delta_sunny_slower|{"min":"5","sun":"4"}',
      shady: 'delta_shady_faster|{"min":"5","sun":"4"}',
    });
  });
  it('gives both tabs the same gap at the same duration', () => {
    // The demo: 71 % sun against 45 % over 19 min each.
    const sunny = { sunScore: 0.71, duration: 1140 };
    const shady = { sunScore: 0.45, duration: 1140 };
    expect(deltaPhrases(sunny, shady, tr)).toEqual({
      sunny: 'delta_sunny_same|{"min":"0","sun":"5"}',
      shady: 'delta_shady_same|{"min":"0","sun":"5"}',
    });
  });
  it('says the same sun when a longer shady route avoids none', () => {
    // Flon to Ouchy at 12:30: 37 % of 24 min against 34 % of 26 min, 8.9 min
    // of sun against 8.8.
    const sunny = { sunScore: 0.37, duration: 24 * 60 };
    const shady = { sunScore: 0.34, duration: 26 * 60 };
    expect(deltaPhrases(sunny, shady, tr)).toEqual({
      sunny: 'delta_even_faster|{"min":"2"}',
      shady: 'delta_even_slower|{"min":"2"}',
    });
  });
  it('turns the sentence around when the sunnier share is the fewer minutes', () => {
    // 40 % of 10 min is 4 min of sun, 30 % of 20 min is 6.
    const sunny = { sunScore: 0.4, duration: 10 * 60 };
    const shady = { sunScore: 0.3, duration: 20 * 60 };
    expect(deltaPhrases(sunny, shady, tr)).toEqual({
      sunny: 'delta_sunny_less|{"time":"−10 min","sun":"2"}',
      shady: 'delta_shady_less|{"time":"+10 min","sun":"2"}',
    });
  });
});

describe('placeShortName', () => {
  it('keeps what comes before the first comma', () => {
    expect(placeShortName('Lausanne-Gare, Av. de la Gare, Lausanne')).toBe('Lausanne-Gare');
    expect(placeShortName('Musée Olympique, Lausanne')).toBe('Musée Olympique');
    expect(placeShortName('  gare lausanne ')).toBe('gare lausanne');
  });
  it('keeps both coordinates of a point picked on the map', () => {
    expect(placeShortName('46.51970, 6.63230')).toBe('46.51970, 6.63230');
    expect(placeShortName('-33.86880, 151.20930')).toBe('-33.86880, 151.20930');
  });
});

describe('summaryWhen', () => {
  it('gives the time alone for today', () => {
    expect(summaryWhen('2026-11-11', '12:14', '2026-11-11', 'fr')).toBe('12:14');
  });
  it('adds the day for another date, in the page language', () => {
    expect(summaryWhen('2026-07-15', '15:00', '2026-11-11', 'fr')).toBe('15 juil., 15:00');
    expect(summaryWhen('2026-07-15', '15:00', '2026-11-11', 'en')).toBe('Jul 15, 15:00');
    expect(summaryWhen('2026-07-15', '15:00', '2026-11-11', 'de')).toBe('15. Juli, 15:00');
  });
  it('reads the date as a calendar day, not an instant', () => {
    // No shift to the 14th west of UTC, nor to the 16th east of it.
    expect(summaryWhen('2026-07-15', '00:30', '2026-11-11', 'fr')).toBe('15 juil., 00:30');
    expect(summaryWhen('2026-07-15', '23:30', '2026-11-11', 'fr')).toBe('15 juil., 23:30');
  });
});
