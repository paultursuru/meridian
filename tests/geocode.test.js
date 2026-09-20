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

// Same, but keeps the URL so the tests can assert on the query string.
function mockJsonCapturing(payload) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return { ok: true, json: async () => payload };
  };
  return calls;
}

// Trimmed Nominatim rows: the scoring only reads lat, lon and importance.
const LAUSANNE = { lat: 46.5197, lng: 6.6323 };
const place = (name, lat, lon, importance) => ({
  display_name: name,
  lat: String(lat),
  lon: String(lon),
  importance,
  address: { country_code: name.includes('Suisse') ? 'ch' : 'xx' },
});

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

  it('asks for a single result and no viewbox when it has no anchor', async () => {
    const calls = mockJsonCapturing([{ lat: '46.5171', lon: '6.6331', address: {} }]);
    await geocode('lausanne');
    expect(calls[0]).toContain('limit=1');
    expect(calls[0]).not.toContain('viewbox');
  });

  it('biases the lookup with a viewbox around the anchor, without filtering', async () => {
    const calls = mockJsonCapturing([{ lat: '46.5171', lon: '6.6331', address: {} }]);
    await geocode('lausanne', { near: LAUSANNE });
    expect(calls[0]).toContain('viewbox=');
    // A wider list for the scoring to choose from.
    expect(calls[0]).toContain('limit=8');
    // The app routes outside Switzerland too (buildings.js falls back to
    // Overpass), so the box must stay a bias: neither of these may appear.
    expect(calls[0]).not.toContain('bounded');
    expect(calls[0]).not.toContain('countrycodes');
  });

  it('prefers the local match over a better-ranked one on another continent', async () => {
    // The 2026-09-17 measurement: `Ouchy` resolved to a farm in Queensland.
    mockJsonCapturing([
      place('Ouchy, Taldora, Queensland, Australie', -19.0, 141.0, 0.107),
      place('Ouchy, Place de la Navigation, Lausanne, Suisse', 46.5069, 6.6277, 0),
    ]);
    await expect(geocode('Ouchy', { near: LAUSANNE })).resolves.toMatchObject({
      lat: 46.5069,
      countryCode: 'ch',
    });
  });

  it('still lets a distant well-known place win over a nearby obscure one', async () => {
    // The other half of the bias: proximity alone would answer `Rome` with a
    // lane outside Lausanne.
    mockJsonCapturing([
      place('Rome, Roma Capitale, Latium, Italie', 41.8933, 12.4829, 0.856),
      place('Rome, Quintenas, Ardèche, France', 46.55, 6.65, 0.3),
    ]);
    await expect(geocode('Rome', { near: LAUSANNE })).resolves.toMatchObject({
      lat: 41.8933,
    });
  });

  it('keeps the anchor out of the way of results in the same town', async () => {
    // Inside the free radius the penalty is nil, so importance decides.
    mockJsonCapturing([
      place('Lausanne-Ouchy, Lausanne, Suisse', 46.5069, 6.6277, 0.107),
      place("Château d'Ouchy, Place du Port, Lausanne, Suisse", 46.5063, 6.6289, 0.354),
    ]);
    await expect(geocode('Ouchy', { near: LAUSANNE })).resolves.toMatchObject({
      lat: 46.5063,
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
