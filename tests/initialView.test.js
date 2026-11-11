import { describe, it, expect } from 'vitest';
import { initialView } from '../src/lib/initialView.js';
import { TZ_CENTERS } from '../src/lib/tzCenters.js';

const LAUSANNE = [46.5197, 6.6323];
const ZURICH = [47.3769, 8.5417];

describe('initialView', () => {
  it('opens a French speaker in the Swiss timezone on Lausanne, whatever the region', () => {
    for (const lang of ['fr-CH', 'fr-FR', 'fr', 'FR-ch']) {
      expect(initialView('Europe/Zurich', lang).center, lang).toEqual(LAUSANNE);
    }
  });

  it('picks one city per language', () => {
    expect(initialView('Europe/Zurich', 'de-CH').center).toEqual(ZURICH);
    expect(initialView('Europe/Zurich', 'it-CH').center).toEqual([46.1683, 8.7944]);
    expect(initialView('Europe/Zurich', 'rm').center).toEqual([46.8508, 9.5320]);
    expect(initialView('Europe/Zurich', 'en-GB').center).toEqual([46.2044, 6.1432]);
  });

  it('falls back to Zurich for any other language, or none', () => {
    for (const lang of ['es-ES', 'pt', '', undefined]) {
      expect(initialView('Europe/Zurich', lang).center, String(lang)).toEqual(ZURICH);
    }
  });

  it('zooms on the city in Switzerland, on the region elsewhere', () => {
    expect(initialView('Europe/Zurich', 'fr-CH').zoom).toBe(12);
    expect(initialView('Europe/Paris', 'fr-FR').zoom).toBe(10);
  });

  it('ignores the language outside the Swiss timezone', () => {
    const paris = TZ_CENTERS['Europe/Paris'];
    expect(initialView('Europe/Paris', 'de-CH').center).toEqual([paris[0], paris[1]]);
  });

  it('has no guess for a timezone the table does not know', () => {
    expect(initialView('Mars/Olympus_Mons', 'fr')).toBeNull();
  });
});
