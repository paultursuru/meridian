import { describe, it, expect } from 'vitest';
import { buildingHeight, hasHeightData, heightStats } from '../src/lib/buildings.js';

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
