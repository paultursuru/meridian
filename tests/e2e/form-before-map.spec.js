import { test, expect } from '@playwright/test';

// map.js (Leaflet + MapLibre) is the heaviest chunk, and on a mid-range phone
// it lands seconds after the form shows. The form used to wait for it, so
// typing got no suggestions and the search button did nothing, without a word.
// Here the map module is held back while the form is used.

const LAUSANNE = { lat: 46.5171, lng: 6.6331 };
const RENENS = { lat: 46.5373, lng: 6.5853 };

async function mockUpstreams(page) {
  await page.route('https://nominatim.openstreetmap.org/search**', route => {
    const q = (new URL(route.request().url()).searchParams.get('q') || '').toLowerCase();
    const hit = q.includes('renens') ? RENENS : LAUSANNE;
    return route.fulfill({
      json: [{ lat: String(hit.lat), lon: String(hit.lng), display_name: q, address: { country_code: 'ch' } }],
    });
  });
  await page.route('https://photon.komoot.io/**', route => route.fulfill({ json: { features: [{
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [LAUSANNE.lng, LAUSANNE.lat] },
    properties: { name: 'Gare de Lausanne', city: 'Lausanne', country: 'Suisse', countrycode: 'CH' },
  }] } }));
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({
    json: { hourly: { time: [], cloud_cover: [], temperature_2m: [] } },
  }));
  await page.route('**/api/route**', route => route.fulfill({ json: { features: [{
    geometry: { type: 'LineString', coordinates: [[LAUSANNE.lng, LAUSANNE.lat, 0], [RENENS.lng, RENENS.lat, 0]] },
    properties: { summary: { distance: 2400, duration: 1900 } },
  }] } }));
  await page.route('**/api/buildings**', route => route.fulfill({ json: [] }));
  await page.route('**/api/overpass**', route => route.fulfill({ json: { elements: [] } }));
  // An empty style: no tiles, so nothing can stand in for the mocks above.
  await page.route('https://tiles.stadiamaps.com/**', route =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
}

// The dev server serves map.js as its own module: held until released.
async function holdMap(page) {
  let release;
  const held = new Promise(r => { release = r; });
  await page.route('**/src/lib/map.js*', async route => {
    await held;
    await route.continue();
  });
  return release;
}

async function openWithMapHeld(page) {
  await mockUpstreams(page);
  const release = await holdMap(page);
  await page.goto('/en/');
  // initAutocomplete puts role=combobox on the field: the form is wired.
  await page.waitForSelector('#inp-start[role="combobox"]');
  await expect(page.locator('#map-splash')).not.toHaveClass(/hidden/);
  return release;
}

test.use({ timezoneId: 'Europe/Zurich' });

test('a search started before the map has loaded finishes once it has', async ({ page }) => {
  const release = await openWithMapHeld(page);

  await page.fill('#inp-start', 'lausanne gare');
  await page.keyboard.press('Escape');
  await page.fill('#inp-end', 'renens');
  await page.keyboard.press('Escape');
  await page.click('#search-btn');

  // Geocoding and routing went ahead; drawing waits on the map, and says so.
  await expect(page.locator('#status')).toHaveText(/Loading map/);
  await expect(page.locator('#results')).not.toHaveClass(/\bon\b/);

  release();
  await expect(page.locator('#results')).toHaveClass(/\bon\b/);
  await expect(page.locator('.map-pin.start')).toBeVisible();
});

test('suggestions come before the map, anchored on the timezone guess', async ({ page }) => {
  const asked = [];
  page.on('request', req => { if (req.url().startsWith('https://photon.komoot.io/')) asked.push(req.url()); });
  const release = await openWithMapHeld(page);

  await page.fill('#inp-start', 'gare');
  await expect(page.locator('.ac-item').first()).toBeVisible();
  // No map centre yet: the anchor is the guess the map will open on.
  const url = new URL(asked.at(-1));
  expect(url.searchParams.get('lat')).not.toBeNull();
  expect(url.searchParams.get('lon')).not.toBeNull();

  release();
});

test('a suggestion picked before the map gets its pin once the map is there', async ({ page }) => {
  const release = await openWithMapHeld(page);

  await page.fill('#inp-start', 'gare');
  await page.locator('.ac-item').first().click();
  await expect(page.locator('#inp-start')).toHaveValue(/Gare de Lausanne/);
  await expect(page.locator('.map-pin.start')).toHaveCount(0);

  release();
  await expect(page.locator('.map-pin.start')).toBeVisible();
});
