import { describe, it, expect } from 'vitest';
import { translations, LANGS, langPath, langUrl } from '../src/lib/i18n.ts';

const langs = Object.keys(translations) as Array<keyof typeof translations>;
const referenceKeys = Object.keys(translations.fr).sort();

// Extracts {placeholder} tokens from a string, sorted for comparison.
const placeholders = (s: string) =>
  [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

describe('translations', () => {
  it('cover fr, de, it, en, rm', () => {
    expect(langs.sort()).toEqual(['de', 'en', 'fr', 'it', 'rm']);
  });

  it.each(langs)('locale "%s" has exactly the same keys as the reference (fr)', (lang) => {
    expect(Object.keys(translations[lang]).sort()).toEqual(referenceKeys);
  });

  it.each(referenceKeys)('key "%s" uses the same placeholders across all locales', (key) => {
    const expected = placeholders((translations.fr as Record<string, string>)[key]);
    for (const lang of langs) {
      expect(placeholders((translations[lang] as Record<string, string>)[key])).toEqual(expected);
    }
  });
});

describe('LANGS', () => {
  it('lists exactly the translated locales', () => {
    expect([...LANGS].sort()).toEqual(Object.keys(translations).sort());
  });
});

describe('langPath', () => {
  it('keeps French at the root', () => {
    expect(langPath('fr')).toBe('/');
    expect(langPath('fr', 'about')).toBe('/about');
  });

  it('prefixes the other languages with their code', () => {
    expect(langPath('de')).toBe('/de/');
    expect(langPath('rm', 'privacy')).toBe('/rm/privacy');
  });
});

describe('langUrl', () => {
  it('builds the absolute URL of a page', () => {
    expect(langUrl('fr')).toBe('https://meridian-way.ch/');
    expect(langUrl('it', 'about/')).toBe('https://meridian-way.ch/it/about/');
  });
});
