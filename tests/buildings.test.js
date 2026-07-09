import { describe, it, expect } from 'vitest';
import { buildingHeight } from '../src/lib/buildings.js';

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
