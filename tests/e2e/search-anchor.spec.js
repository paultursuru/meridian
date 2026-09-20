import { test, expect } from '@playwright/test';

// Measured 2026-09-17: typing a name and pressing Enter resolved it against
// the whole planet. `Ouchy` came back as a farm in Queensland, `Zermat` as a
// shop in San José: 2 of 8 typed queries on the wrong continent, with nothing
// on screen saying so. The autocomplete already biased its lookup, but only
// once the *other* field held a resolved place, which on a first search it
// never does. So both paths went out unanchored.
//
// These specs assert on the outgoing request rather than on the result: the
// bias is a query parameter, and a mock can always be made to return the right
// answer whether or not the app asked for it.
//
// The timezone is pinned because the anchor is the map, and the map opens on
// the timezone's centre (TZ_CENTERS) until geolocation or a search moves it.
// Left to the host clock, these would assert on wherever the runner happens
// to sit.
const ZURICH = { lat: 47.383, lng: 8.533 };
const LISBON = { lat: 38.717, lng: -9.133 };

const START_Q = 'Ouchy';
const END_Q = 'Renens';

const START = { lat: 46.5069, lng: 6.6277 };
const END = { lat: 46.5373, lng: 6.5853 };

// Far enough to be unmistakable, and it is the actual match the live geocoder
// returned for `Ouchy`.
const QUEENSLAND = { lat: -19.0, lng: 141.0 };

function nominatimHit(q, hit, extra = {}) {
  return {
    lat: String(hit.lat),
    lon: String(hit.lng),
    display_name: q,
    address: { country_code: 'ch' },
    ...extra,
  };
}

async function mockUpstreams(page, { nominatimRows } = {}) {
  const seen = { search: [], photon: [] };

  await page.route('https://nominatim.openstreetmap.org/search**', route => {
    const url = new URL(route.request().url());
    seen.search.push(url);
    const q = url.searchParams.get('q') || '';
    const rows = nominatimRows
      ? nominatimRows(q)
      : [nominatimHit(q, q.toLowerCase().includes('renens') ? END : START)];
    return route.fulfill({ json: rows });
  });

  await page.route('https://photon.komoot.io/**', route => {
    const url = new URL(route.request().url());
    seen.photon.push(url);
    return route.fulfill({
      json: { features: [{
        geometry: { type: 'Point', coordinates: [START.lng, START.lat] },
        properties: { name: 'Ouchy', city: 'Lausanne', country: 'Suisse', countrycode: 'CH' },
      }] },
    });
  });

  await page.route('https://api.open-meteo.com/**', route => route.fulfill({
    json: { hourly: { time: [], cloud_cover: [], temperature_2m: [] } },
  }));
  await page.route('https://ors-proxy.meridianway.workers.dev/**', route => route.fulfill({
    json: { features: [{
      geometry: { type: 'LineString', coordinates: [[START.lng, START.lat, 0], [6.60, 46.52, 0], [END.lng, END.lat, 0]] },
      properties: { summary: { distance: 2400, duration: 1900 } },
    }] },
  }));
  await page.route('https://swissbuildings-lookup.meridianway.workers.dev/**', route => route.fulfill({ json: { buildings: [] } }));
  await page.route('https://overpass-cache.meridianway.workers.dev/**', route => route.fulfill({ json: { elements: [] } }));

  return seen;
}

// initAutocomplete() sets role=combobox on both fields, so this is the signal
// that the client script has run and attached its listeners.
async function waitForApp(page) {
  await page.waitForSelector('#inp-start[role="combobox"]');
  await page.waitForSelector('#inp-end[role="combobox"]');
}

// Parses a Nominatim viewbox back into its two corners.
function viewboxCorners(url) {
  const raw = url.searchParams.get('viewbox');
  if (!raw) return null;
  const [w, n, e, s] = raw.split(',').map(Number);
  return { w, n, e, s };
}

test.describe('anchored on Zurich', () => {
  test.use({ timezoneId: 'Europe/Zurich' });

  test('the typed path carries a viewbox around the map, and lands on the local match', async ({ page }) => {
    const seen = await mockUpstreams(page, {
      // Both candidates, in the order the live service returned them: the
      // Queensland farm first, the real Ouchy second.
      nominatimRows: q => (q.toLowerCase().includes('renens')
        ? [nominatimHit(q, END)]
        : [nominatimHit(q, QUEENSLAND, { importance: 0.107, address: { country_code: 'au' } }),
           nominatimHit(q, START, { importance: 0 })]),
    });

    await page.goto('/en/');
    await waitForApp(page);

    await page.fill('#inp-start', START_Q);
    await page.fill('#inp-end', END_Q);
    await page.press('#inp-end', 'Enter');

    await expect(page.locator('#results')).toHaveClass(/on/, { timeout: 20_000 });

    const typed = seen.search.find(u => (u.searchParams.get('q') || '').includes(START_Q));
    expect(typed, 'the typed query reached Nominatim').toBeTruthy();

    const box = viewboxCorners(typed);
    expect(box, 'the typed lookup carries a viewbox').toBeTruthy();
    expect(box.s).toBeLessThan(ZURICH.lat);
    expect(box.n).toBeGreaterThan(ZURICH.lat);
    expect(box.w).toBeLessThan(ZURICH.lng);
    expect(box.e).toBeGreaterThan(ZURICH.lng);

    // A bias, not a filter: the app routes outside Switzerland too, and
    // buildings.js swaps in Overpass when the country isn't ch.
    expect(typed.searchParams.get('bounded')).toBeNull();
    expect(typed.searchParams.get('countrycodes')).toBeNull();

    // More than one candidate, or there is nothing to choose between.
    expect(Number(typed.searchParams.get('limit'))).toBeGreaterThan(1);

    // And the route starts in Lausanne, not in Queensland: the scoring
    // picked the second row over the better-ranked first one.
    const from = new URL(page.url()).searchParams.get('from');
    expect(Number(from.split(',')[0])).toBeCloseTo(START.lat, 1);
  });

  test('the autocomplete is anchored on a first search, with the other field still empty', async ({ page }) => {
    const seen = await mockUpstreams(page);

    await page.goto('/en/');
    await waitForApp(page);

    // Typing into the start field while the end field is empty: before the fix
    // getAnchor() returned the empty field's place, so there was no anchor.
    await page.fill('#inp-start', START_Q);
    await expect.poll(() => seen.photon.length, { timeout: 10_000 }).toBeGreaterThan(0);

    const suggest = seen.photon.at(-1);
    expect(Number(suggest.searchParams.get('lat'))).toBeCloseTo(ZURICH.lat, 1);
    expect(Number(suggest.searchParams.get('lon'))).toBeCloseTo(ZURICH.lng, 1);
  });

  test('a restored shared link still geocodes nothing at all', async ({ page }) => {
    const seen = await mockUpstreams(page);

    await page.goto(`/en/?from=${START.lat},${START.lng}&to=${END.lat},${END.lng}&dt=2026-08-12T15:00`);
    await expect(page.locator('#results')).toHaveClass(/on/, { timeout: 20_000 });

    // The coordinates are already in the URL; re-resolving them could only
    // move the route. The anchor change must not have added a lookup here.
    expect(seen.search).toHaveLength(0);
  });
});

test.describe('anchored elsewhere', () => {
  test.use({ timezoneId: 'Europe/Lisbon' });

  // Guards the anchor against being frozen to a constant: it has to be read
  // from the map at the moment of the search. Geolocation reaches the map the
  // same way (centerMap), so it rides on this.
  test('the anchor follows the map rather than a hard-coded centre', async ({ page }) => {
    const seen = await mockUpstreams(page);

    await page.goto('/en/');
    await waitForApp(page);

    await page.fill('#inp-start', START_Q);
    await expect.poll(() => seen.photon.length, { timeout: 10_000 }).toBeGreaterThan(0);

    const suggest = seen.photon.at(-1);
    expect(Number(suggest.searchParams.get('lat'))).toBeCloseTo(LISBON.lat, 1);
    expect(Number(suggest.searchParams.get('lon'))).toBeCloseTo(LISBON.lng, 1);
  });
});
