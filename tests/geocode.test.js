import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { geocode, reverseGeocode, suggest } from '../src/lib/geocode.js';

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

  it('formats a Swiss hit in local postal style: type abbreviated, number after the street', async () => {
    mockJson({
      display_name: 'Avenue de Ruchonnet 12, Lausanne, Suisse',
      address: {
        road: 'Avenue de Ruchonnet', house_number: '12',
        postcode: '1003', city: 'Lausanne', country: 'Suisse', country_code: 'ch',
      },
    });
    // The postcode is deliberately dropped.
    await expect(reverseGeocode(46.52, 6.63)).resolves.toEqual({
      short: 'Av. de Ruchonnet 12, Lausanne',
      countryCode: 'ch',
    });
  });

  it('keeps the plain "number street, city, country" style outside Switzerland', async () => {
    mockJson({
      display_name: '12 Avenue Victor Hugo, Paris, France',
      address: {
        road: 'Avenue Victor Hugo', house_number: '12',
        postcode: '75116', city: 'Paris', country: 'France', country_code: 'fr',
      },
    });
    await expect(reverseGeocode(48.87, 2.28)).resolves.toEqual({
      short: '12 Avenue Victor Hugo, Paris, France',
      countryCode: 'fr',
    });
  });
});

describe('suggest (Photon autocomplete)', () => {
  function mockFeatures(features) {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ features }) });
  }

  it('formats Swiss suggestions in local postal style', async () => {
    mockFeatures([{
      geometry: { coordinates: [6.62, 46.52] },
      properties: {
        street: 'Avenue Ruchonnet', housenumber: '12',
        postcode: '1003', city: 'Lausanne', country: 'Suisse', countrycode: 'CH',
      },
    }]);
    const [place] = await suggest('ruchonnet');
    expect(place.line1).toBe('Av. Ruchonnet 12');
    expect(place.line2).toBe('Lausanne');
    expect(place.short).toBe('Av. Ruchonnet 12, Lausanne');
  });

  it('abbreviates chemin/boulevard/esplanade but leaves rue and voie alone', async () => {
    mockFeatures([
      { geometry: { coordinates: [6.6, 46.5] }, properties: { street: 'Chemin des Cerisiers', countrycode: 'CH' } },
      { geometry: { coordinates: [6.6, 46.5] }, properties: { street: 'Boulevard de Grancy', countrycode: 'CH' } },
      { geometry: { coordinates: [6.6, 46.5] }, properties: { street: 'Esplanade de Montbenon', countrycode: 'CH' } },
      { geometry: { coordinates: [6.6, 46.5] }, properties: { street: 'Rue du Petit-Chêne', countrycode: 'CH' } },
    ]);
    const lines = (await suggest('rue')).map(p => p.line1);
    expect(lines).toEqual([
      'Chem. des Cerisiers',
      'Bd. de Grancy',
      'Espl. de Montbenon',
      'Rue du Petit-Chêne',
    ]);
  });

  it('leaves non-Swiss suggestions in "number street" style', async () => {
    mockFeatures([{
      geometry: { coordinates: [2.29, 48.85] },
      properties: {
        street: 'Avenue des Champs-Élysées', housenumber: '10',
        city: 'Paris', country: 'France', countrycode: 'FR',
      },
    }]);
    const [place] = await suggest('champs');
    expect(place.line1).toBe('10 Avenue des Champs-Élysées');
    expect(place.short).toBe('10 Avenue des Champs-Élysées, Paris, France');
  });
});
