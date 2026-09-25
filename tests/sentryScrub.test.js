import { describe, it, expect } from 'vitest';
import { stripQuery, scrubEvent, scrubBreadcrumb } from '../src/lib/sentryScrub.js';

const SEARCH_URL = 'https://meridian-way.ch/?from=46.51860%2C6.56800&fromq=Avenue+Probe+12&to=46.53730%2C6.58530&toq=Renens&dt=2026-09-25T08%3A27';

function addressNotFound() {
  const err = new Error('Adresse introuvable : "Avenue Probe 12"');
  err.code = 'ADDRESS_NOT_FOUND';
  return err;
}

describe('stripQuery', () => {
  it('drops the query and the hash', () => {
    expect(stripQuery(SEARCH_URL)).toBe('https://meridian-way.ch/');
    expect(stripQuery('/de/?from=1,2#x')).toBe('/de/');
  });

  it('leaves a missing url alone', () => {
    expect(stripQuery(undefined)).toBeUndefined();
  });
});

describe('scrubEvent', () => {
  it('strips the page URL and the referrer', () => {
    const event = scrubEvent({ request: { url: SEARCH_URL, headers: { Referer: SEARCH_URL, 'User-Agent': 'UA' } } });
    expect(event.request.url).toBe('https://meridian-way.ch/');
    expect(event.request.headers).toEqual({ Referer: 'https://meridian-way.ch/', 'User-Agent': 'UA' });
  });

  it('reports a user-facing error by its code', () => {
    const err = addressNotFound();
    const event = scrubEvent({ exception: { values: [{ type: 'Error', value: err.message }] } }, { originalException: err });
    expect(event.exception.values[0].value).toBe('ADDRESS_NOT_FOUND');
  });

  it('keeps the message of a technical error', () => {
    const err = new Error('ORS 503 after retries');
    err.code = 'ROUTING_UNAVAILABLE';
    const event = scrubEvent({ exception: { values: [{ type: 'Error', value: err.message }] } }, { originalException: err });
    expect(event.exception.values[0].value).toBe('ORS 503 after retries');
  });
});

describe('scrubBreadcrumb', () => {
  it('strips geocoder queries from fetch breadcrumbs', () => {
    const crumb = scrubBreadcrumb({
      category: 'fetch',
      data: { method: 'GET', url: 'https://nominatim.openstreetmap.org/search?q=Avenue%20Probe%2012&format=json', status_code: 200 },
    });
    expect(crumb.data).toEqual({ method: 'GET', url: 'https://nominatim.openstreetmap.org/search', status_code: 200 });
  });

  it('strips both ends of a navigation', () => {
    const crumb = scrubBreadcrumb({ category: 'navigation', data: { from: '/', to: '/?from=1,2&fromq=Avenue+Probe+12' } });
    expect(crumb.data).toEqual({ from: '/', to: '/' });
  });

  it('replaces a user-facing error logged to the console', () => {
    const err = addressNotFound();
    const crumb = scrubBreadcrumb(
      { category: 'console', level: 'error', message: `Error: ${err.message}`, data: { arguments: [err], logger: 'console' } },
      { input: [err], level: 'error' },
    );
    expect(crumb.message).toBe('Error: ADDRESS_NOT_FOUND');
    expect(crumb.data).toEqual({ arguments: ['Error: ADDRESS_NOT_FOUND'], logger: 'console' });
  });

  it('keeps other console messages', () => {
    const crumb = scrubBreadcrumb(
      { category: 'console', level: 'warn', message: 'Overpass vegetation failed', data: { arguments: ['Overpass vegetation failed'] } },
      { input: ['Overpass vegetation failed'], level: 'warn' },
    );
    expect(crumb.message).toBe('Overpass vegetation failed');
  });

  it('drops the place name a clicked suggestion carries as its title', () => {
    const crumb = scrubBreadcrumb({ category: 'ui.click', message: 'ul#ac-start > li.ac-item[title="Avenue Probe 12, Ecublens"] > span' });
    expect(crumb.message).toBe('ul#ac-start > li.ac-item > span');
  });
});
