import { describe, it, expect, beforeAll } from 'vitest';
import { buildingHeight, hasHeightData, heightStats, resolveHeightNoteState, heightNote } from '../src/lib/buildings.js';
import { tr } from '../src/lib/i18n.ts';

describe('buildingHeight', () => {
  it('defaults ordinary untagged buildings to 10 m', () => {
    expect(buildingHeight({ building: 'yes' })).toBe(10);
    expect(buildingHeight({ building: 'residential' })).toBe(10);
  });

  it('defaults single-storey outbuildings to 2.5 m (review 2.6)', () => {
    for (const type of ['garage', 'garages', 'carport', 'shed', 'hut', 'kiosk']) {
      expect(buildingHeight({ building: type })).toBe(2.5);
    }
  });

  it('defaults churches and towers to 22 m', () => {
    expect(buildingHeight({ building: 'church' })).toBe(22);
    expect(buildingHeight({ building: 'tower' })).toBe(22);
  });

  it('lets an explicit height tag win over the type default', () => {
    expect(buildingHeight({ building: 'shed', height: '6' })).toBe(6);
    expect(buildingHeight({ building: 'yes', height: '12 m' })).toBe(12); // unit suffix tolerated
  });

  it('derives height from building:levels at 3.5 m per level', () => {
    expect(buildingHeight({ building: 'yes', 'building:levels': '4' })).toBe(14);
  });

  it('falls back to the type default on unparseable height or levels', () => {
    expect(buildingHeight({ building: 'shed', height: 'tall' })).toBe(2.5);
    expect(buildingHeight({ building: 'yes', 'building:levels': 'many' })).toBe(10);
  });
});

describe('hasHeightData (review 3.5)', () => {
  it('is true for a parseable explicit height', () => {
    expect(hasHeightData({ building: 'yes', height: '12 m' })).toBe(true);
  });

  it('is true for parseable building:levels', () => {
    expect(hasHeightData({ building: 'yes', 'building:levels': '4' })).toBe(true);
  });

  it('is false with no height tags at all', () => {
    expect(hasHeightData({ building: 'yes' })).toBe(false);
  });

  it('is false when the tags present are unparseable', () => {
    expect(hasHeightData({ building: 'yes', height: 'tall' })).toBe(false);
    expect(hasHeightData({ building: 'yes', 'building:levels': 'many' })).toBe(false);
  });
});

describe('heightStats (review 3.5)', () => {
  it('returns null for an empty building list', () => {
    expect(heightStats([])).toBeNull();
  });

  it('returns pct, count and the mean height of just the measured buildings', () => {
    const buildings = [
      { hasHeight: true, height: 10 }, { hasHeight: true, height: 20 },
      { hasHeight: false, height: 2.5 }, { hasHeight: false, height: 10 },
    ];
    expect(heightStats(buildings)).toEqual({ pct: 0.5, count: 4, avgHeight: 15 });
  });

  it('returns pct 1 when every building has real height data', () => {
    expect(heightStats([{ hasHeight: true, height: 8 }])).toEqual({ pct: 1, count: 1, avgHeight: 8 });
  });

  it('returns avgHeight null when no building has real height data', () => {
    const buildings = [{ hasHeight: false, height: 10 }, { hasHeight: false, height: 2.5 }];
    expect(heightStats(buildings)).toEqual({ pct: 0, count: 2, avgHeight: null });
  });
});

describe('resolveHeightNoteState (review #2 §1.1)', () => {
  it('is "ok" when buildings fetched fine and vegetation fetched fine', () => {
    expect(resolveHeightNoteState('ok', 5, 'ok')).toBe('ok');
  });

  it('is "empty" when the buildings fetch succeeded but found nothing', () => {
    expect(resolveHeightNoteState('ok', 0, 'ok')).toBe('empty');
  });

  it('is "failed" when the buildings fetch threw', () => {
    expect(resolveHeightNoteState('failed', 0, 'ok')).toBe('failed');
  });

  it('is "partial" when buildings are fine but vegetation failed', () => {
    expect(resolveHeightNoteState('ok', 5, 'failed')).toBe('partial');
  });

  it('collapses a simultaneous buildings + vegetation failure into one "failed" state, not two notes', () => {
    expect(resolveHeightNoteState('failed', 0, 'failed')).toBe('failed');
  });

  it('prioritises "empty" over a vegetation failure when there are simply no buildings', () => {
    expect(resolveHeightNoteState('ok', 0, 'failed')).toBe('empty');
  });
});

describe('heightNote', () => {
  // tr() reads document.documentElement.lang; the vitest environment is 'node'.
  beforeAll(() => {
    globalThis.document = { documentElement: { lang: 'fr' } };
  });

  const measured = (n) => Array.from({ length: n }, () => ({ hasHeight: true, height: 12 }));
  const guessed = (n) => Array.from({ length: n }, () => ({ hasHeight: false, height: 10 }));
  const note = (buildings, { buildingsStatus = 'ok', vegStatus = 'ok', source = 'osm' } = {}) =>
    heightNote({ buildingsStatus, buildings, vegStatus, source });

  it('warns when the buildings fetch failed', () => {
    expect(note([], { buildingsStatus: 'failed' })).toEqual({
      state: 'failed',
      text: tr('height_data_failed') + ' ' + tr('height_data_retry'),
      level: 'warn',
    });
  });

  it('says so when no building came back', () => {
    expect(note([])).toEqual({ state: 'empty', text: tr('height_data_none'), level: 'info' });
  });

  it('names the source and gives the stats, with no "estimated" line at 100%', () => {
    const { state, text, level } = note(measured(3), { source: 'swisstopo' });
    expect(state).toBe('ok');
    expect(level).toBe('info');
    expect(text.split('\n')).toEqual([
      tr('height_data_note_swisstopo'),
      tr('height_data_line_stats', { n: '3', pct: '100', avgPart: tr('height_data_avg_suffix', { avg: '12' }) }),
    ]);
  });

  it('adds the "estimated" line below 100%', () => {
    expect(note([...measured(1), ...guessed(1)]).text.split('\n')).toEqual([
      tr('height_data_note_osm'),
      tr('height_data_line_stats', { n: '2', pct: '50', avgPart: tr('height_data_avg_suffix', { avg: '12' }) }),
      tr('height_data_line_estimated'),
    ]);
  });

  it('gates the "estimated" line on the rounded pct', () => {
    // 249 of 250 is 99.6%, shown as 100%.
    expect(note([...measured(249), ...guessed(1)]).text).not.toContain(tr('height_data_line_estimated'));
  });

  it('leaves the average out when no height was measured', () => {
    expect(note(guessed(2)).text.split('\n')[1])
      .toBe(tr('height_data_line_stats', { n: '2', pct: '0', avgPart: '' }));
  });

  it('appends the vegetation line on a partial result, keeping the buildings note', () => {
    const { state, text } = note(measured(2), { vegStatus: 'failed' });
    const lines = text.split('\n');
    expect(state).toBe('partial');
    expect(lines[0]).toBe(tr('height_data_note_osm'));
    expect(lines.at(-1)).toBe(tr('vegetation_failed'));
  });
});
