import { describe, it, expect } from 'vitest';
import { coarsenUrl, umamiBeforeSend } from '../src/lib/analytics.js';

const SEARCH_URL = 'https://meridian-way.ch/?from=46.51860%2C6.56800&fromq=Avenue+Probe+12%2C+Ecublens&to=46.53730%2C6.58530&toq=Renens&dt=2026-09-25T08%3A27';

describe('coarsenUrl', () => {
  it('rounds the route points to ~100 m and drops the typed labels', () => {
    expect(coarsenUrl(SEARCH_URL)).toBe('https://meridian-way.ch/?from=46.519%2C6.568&to=46.537%2C6.585&dt=2026-09-25T08%3A27');
  });

  it('works on the relative referrer Umami sends for same-origin pages', () => {
    expect(coarsenUrl('/de/?from=46.5186,6.568&fromq=x&to=46.5373,6.5853')).toBe('/de/?from=46.519%2C6.568&to=46.537%2C6.585');
  });

  it('keeps utm tags and the onboarding flag', () => {
    expect(coarsenUrl('/?from=1.23456,2.34567&to=3,4&onboarding=1&utm_source=reddit'))
      .toBe('/?from=1.235%2C2.346&to=3.000%2C4.000&onboarding=1&utm_source=reddit');
  });

  it('leaves the query alone when it holds no route', () => {
    const url = 'https://meridian-way.ch/it/?utm_source=chatgpt.com';
    expect(coarsenUrl(url)).toBe(url);
  });

  it('drops a query left empty and keeps the hash', () => {
    expect(coarsenUrl('/?fromq=Home#map')).toBe('/#map');
  });

  it('does not touch a from that is not a point', () => {
    expect(coarsenUrl('/?from=newsletter')).toBe('/?from=newsletter');
  });

  it('passes through a missing value', () => {
    expect(coarsenUrl(undefined)).toBeUndefined();
    expect(coarsenUrl('')).toBe('');
  });
});

describe('umamiBeforeSend', () => {
  it('coarsens the url and the referrer and keeps the rest of the payload', () => {
    const payload = { website: 'w', url: SEARCH_URL, referrer: '/?fromq=Home&from=1,2', name: 'scrub', data: { a: 1 } };
    expect(umamiBeforeSend('event', payload)).toEqual({
      website: 'w',
      url: 'https://meridian-way.ch/?from=46.519%2C6.568&to=46.537%2C6.585&dt=2026-09-25T08%3A27',
      referrer: '/?from=1.000%2C2.000',
      name: 'scrub',
      data: { a: 1 },
    });
  });
});
