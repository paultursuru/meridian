import { test, expect } from '@playwright/test';

// Clicking the map offers to use that spot as the start or the end, so a walk
// can be planned without typing an address. The parts worth pinning are the
// ones that are invisible from the UI: that the picked point reaches the field
// as a resolved place (not just text), that a failed reverse-geocode still
// leaves a usable point behind, and that a click on a route is not a pick.

const LAUSANNE = '/?';

// Nominatim's reverse endpoint is the one this feature calls; the search
// endpoint is what a typed address would use. Kept separate so a test can fail
// one without the other.
async function mockGeo(page, { reverse = { display_name: 'Rue de Bourg 12, Lausanne, Suisse', address: { country_code: 'ch', road: 'Rue de Bourg', house_number: '12', city: 'Lausanne', country: 'Suisse' } }, reverseStatus = 200 } = {}) {
  await page.route('https://nominatim.openstreetmap.org/reverse**', route =>
    reverseStatus === 200 ? route.fulfill({ json: reverse }) : route.fulfill({ status: reverseStatus, body: '' }));
  await page.route('https://tiles.stadiamaps.com/**', route =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
}

async function ready(page) {
  await page.goto(LAUSANNE);
  // The splash covers the map until the basemap's first load, and it is also
  // the point at which the app script has finished wiring the map up — click
  // before that and the click lands on the splash, not on Leaflet.
  await expect(page.locator('#map-splash')).toHaveClass(/hidden/, { timeout: 20_000 });
  // The intro bubble sits over the middle of the map; dismiss it so the clicks
  // below land on the map itself.
  await page.click('#app-description-close');
}

// Clicks the map at an offset from its own top-left, away from the Leaflet
// controls and the sun badge.
async function clickMap(page, dx = 420, dy = 260) {
  const box = await page.locator('#map').boundingBox();
  await page.mouse.click(box.x + dx, box.y + dy);
}

test('picking a start from the map fills the field and drops a pin', async ({ page }) => {
  await mockGeo(page);
  await ready(page);

  await clickMap(page);
  await expect(page.locator('.pick-menu')).toBeVisible();

  await page.click('.pick-btn[data-role="start"]');
  await expect(page.locator('.pick-menu')).toHaveCount(0);

  // Resolved address, not the provisional coordinates.
  await expect(page.locator('#inp-start')).toHaveValue(/Rue de Bourg/);
  // A pin is on the map, and the field holds a real place, so the country code
  // reached it — that is what routes a Swiss search to swissBUILDINGS3D.
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(1);
  expect(await page.evaluate(() => document.getElementById('inp-start').value)).not.toBe('');
});

test('the map does not move under the picked point', async ({ page }) => {
  await mockGeo(page);
  await ready(page);

  const before = await page.evaluate(() => document.querySelector('.leaflet-map-pane').style.transform);
  await clickMap(page);
  await page.click('.pick-btn[data-role="end"]');
  await expect(page.locator('#inp-end')).toHaveValue(/Rue de Bourg/);
  await page.waitForTimeout(800); // a flyTo would have finished by now

  const after = await page.evaluate(() => document.querySelector('.leaflet-map-pane').style.transform);
  expect(after).toBe(before);
});

test('a failed reverse-geocode leaves the coordinates in the field', async ({ page }) => {
  await mockGeo(page, { reverseStatus: 500 });
  await ready(page);

  await clickMap(page);
  await page.click('.pick-btn[data-role="start"]');

  // Five decimals, the same precision shared links use.
  await expect(page.locator('#inp-start')).toHaveValue(/^-?\d+\.\d{5}, -?\d+\.\d{5}$/);
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(1);
});

test('a whole search can be set up without typing anything', async ({ page }) => {
  await mockGeo(page);
  await ready(page);

  await expect(page.locator('.input-wrap.has-value')).toHaveCount(0);

  await clickMap(page, 380, 220);
  await page.click('.pick-btn[data-role="start"]');
  await expect(page.locator('#inp-start')).not.toHaveValue('');

  await clickMap(page, 560, 380);
  await page.click('.pick-btn[data-role="end"]');
  await expect(page.locator('#inp-end')).not.toHaveValue('');

  // Both fields register as filled, i.e. syncInputState ran for each pick —
  // that is what the ✕ buttons and the rest of the form state hang off.
  await expect(page.locator('.input-wrap.has-value')).toHaveCount(2);
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(2);
});

test('the menu reports the pick', async ({ page }) => {
  const events = [];
  await page.exposeFunction('__track', (name, data) => events.push({ name, data }));
  await page.addInitScript(() => {
    window.umami = { track: (name, data) => window.__track(name, data) };
  });
  await mockGeo(page);
  await ready(page);

  await clickMap(page);
  await page.click('.pick-btn[data-role="end"]');
  await expect(page.locator('#inp-end')).not.toHaveValue('');

  const pick = events.find(e => e.name === 'point_picked');
  expect(pick).toBeTruthy();
  expect(pick.data).toEqual({ role: 'end', method: 'map' });
});

test('clicking a drawn route selects it instead of offering to pick a point', async ({ page }) => {
  await mockGeo(page);
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({
    json: { hourly: { time: [], cloud_cover: [], temperature_2m: [] } },
  }));
  await page.route('https://ors-proxy.meridianway.workers.dev/**', route => route.fulfill({
    json: { features: [
      { geometry: { type: 'LineString', coordinates: [[6.6323, 46.5197, 400], [6.6360, 46.5220, 400], [6.6400, 46.5250, 400]] },
        properties: { summary: { distance: 900, duration: 700 } } },
      { geometry: { type: 'LineString', coordinates: [[6.6323, 46.5197, 400], [6.6340, 46.5240, 400], [6.6400, 46.5250, 400]] },
        properties: { summary: { distance: 1000, duration: 780 } } },
    ] },
  }));
  await page.route('https://overpass-cache.meridianway.workers.dev/**', route =>
    route.fulfill({ json: { elements: [] } }));
  await page.route('https://swissbuildings-lookup.meridianway.workers.dev/**', route =>
    route.fulfill({ json: { buildings: [] } }));

  await page.goto('/?from=46.5197,6.6323&to=46.5250,6.6400&dt=2026-07-28T14:00');
  await expect(page.locator('#results')).toHaveClass(/on/, { timeout: 20_000 });
  await page.waitForTimeout(800);

  // Click the middle of a drawn segment rather than a computed coordinate:
  // whichever route it belongs to, the assertions below hold.
  const seg = page.locator('.leaflet-overlay-pane path:not(.route-casing)').first();
  await seg.click({ force: true });

  await expect(page.locator('.pick-menu')).toHaveCount(0);
  await expect(page.locator('.tab-pane.active')).toHaveCount(1);
});
