import { describe, it, expect } from 'vitest';
import { translations } from '../src/lib/i18n.ts';

const langs = Object.keys(translations) as Array<keyof typeof translations>;
const referenceKeys = Object.keys(translations.fr).sort();

// Extracts {placeholder} tokens from a string, sorted for comparison.
const placeholders = (s: string) =>
  [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

describe('translations', () => {
  it('cover fr, de, it, en', () => {
    expect(langs.sort()).toEqual(['de', 'en', 'fr', 'it']);
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
