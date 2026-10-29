import { describe, it, expect } from 'vitest';
import { frTypo } from '../src/lib/frTypo';

const NB = ' ';

describe('frTypo', () => {
  it('glues numbers to their unit', () => {
    expect(frTypo('1 h 30 et 37 % sur 1,4 km')).toBe(`1${NB}h${NB}30 et 37${NB}% sur 1,4${NB}km`);
    expect(frTypo('15 min, 24 °C, 100 m')).toBe(`15${NB}min, 24${NB}°C, 100${NB}m`);
  });

  it('keeps ":" and "?" on the line of the word before', () => {
    expect(frTypo('Comment ça marche ?')).toBe(`Comment ça marche${NB}?`);
    expect(frTypo('Au bord du lac : le quai')).toBe(`Au bord du lac${NB}: le quai`);
  });

  it('leaves words that only start like a unit alone', () => {
    expect(frTypo('3 maisons, 2 heures')).toBe('3 maisons, 2 heures');
  });
});
