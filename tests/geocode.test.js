import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { geocode, reverseGeocode } from '../src/lib/geocode.js';

// getLang() reads document.documentElement.lang; the vitest environment is 'node'.
beforeAll(() => {
  globalThis.document = { documentElement: { lang: 'fr' } };
});

afterEach(() => {
  delete globalThis.fetch;
});

function mockJson(payload) {
  globalThis.fetch = async () => ({ ok: true, json: async () => payload });
}

// These assert on `code` rather than on the message: the message is what a
// human reads, the code is what the Umami export groups by.
describe('geocode', () => {
  it('tags an empty Nominatim result with ADDRESS_NOT_FOUND', async () => {
    mockJson([]);
    await expect(geocode('nowhere')).rejects.toMatchObject({ code: 'ADDRESS_NOT_FOUND' });
  });

  it('carries the role so the export can tell origin from destination', async () => {
    mockJson([]);
    await expect(geocode('nowhere', { role: 'end' })).rejects.toMatchObject({
      code: 'ADDRESS_NOT_FOUND',
      role: 'end',
    });
  });

  it('leaves the role undefined when the caller does not pass one', async () => {
    mockJson([]);
    await expect(geocode('nowhere')).rejects.toMatchObject({ role: undefined });
  });

  it('still keeps the user-facing message on the error, quoting the query', async () => {
    mockJson([]);
    // AppLayout shows this message as-is, so it has to stay translated.
    await expect(geocode('ouchy')).rejects.toThrow('ouchy');
  });

  it('resolves lat/lng/countryCode on a hit', async () => {
    mockJson([{ lat: '46.5171', lon: '6.6331', address: { country_code: 'ch' } }]);
    await expect(geocode('lausanne')).resolves.toEqual({
      lat: 46.5171,
      lng: 6.6331,
      countryCode: 'ch',
    });
  });
});

describe('reverseGeocode', () => {
  it('tags an unrecognised point with POSITION_UNKNOWN', async () => {
    mockJson({});
    // The geolocation catch used to report this one as a timeout.
    await expect(reverseGeocode(0, 0)).rejects.toMatchObject({ code: 'POSITION_UNKNOWN' });
  });

  it('resolves a short label and countryCode on a hit', async () => {
    mockJson({
      display_name: 'Place de la Riponne, Lausanne, Suisse',
      address: { road: 'Place de la Riponne', city: 'Lausanne', country: 'Suisse', country_code: 'ch' },
    });
    await expect(reverseGeocode(46.52, 6.63)).resolves.toEqual({
      short: 'Place de la Riponne, Lausanne, Suisse',
      countryCode: 'ch',
    });
  });
});
