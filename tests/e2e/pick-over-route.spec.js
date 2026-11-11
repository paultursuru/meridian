import { test, expect } from '@playwright/test';

// A point changed while routes are on screen: they no longer match the
// fields, so the search goes, leaving no stray pins or tracks. A point from
// the map starts a new trip and empties the other field; a suggestion or a
// locate button corrects one end and keeps the other. Back then leaves the
// app, as it does from the empty app.

const START = { lat: 46.5197, lng: 6.6323 };
const END = { lat: 46.5250, lng: 6.6400 };
const MOBILE = { width: 390, height: 844 };
const DAY = '2026-07-28';
const LINK = `/?from=${START.lat},${START.lng}&fromq=Gare&to=${END.lat},${END.lng}&toq=Ouchy&dt=${DAY}T14:00`;
const BEFORE = '/before-the-app';

test.use({
  viewport: MOBILE,
  geolocation: { latitude: 46.5160, longitude: 6.6290 },
  permissions: ['geolocation'],
});

async function mockUpstreams(page) {
  const line = (lat, lon) => [[START.lng, START.lat, 400], [lon, lat, 400], [END.lng, END.lat, 400]];
  const hit = q => (/ouchy/i.test(q) ? END : START);
  await page.route(`**${BEFORE}`, route => route.fulfill({ contentType: 'text/html', body: '<title>before</title>' }));
  await page.route('https://nominatim.openstreetmap.org/reverse**', route => route.fulfill({
    json: { display_name: 'Lausanne, Suisse', address: { road: 'Rue du Petit-Chêne', city: 'Lausanne', country_code: 'ch' } },
  }));
  await page.route('https://nominatim.openstreetmap.org/search**', route => {
    const q = new URL(route.request().url()).searchParams.get('q') || '';
    const { lat, lng } = hit(q);
    return route.fulfill({ json: [{ lat: String(lat), lon: String(lng), display_name: q, address: { country_code: 'ch' } }] });
  });
  await page.route('https://photon.komoot.io/**', route => {
    const q = new URL(route.request().url()).searchParams.get('q') || '';
    return route.fulfill({ json: { features: [{
      geometry: { type: 'Point', coordinates: [6.6300, 46.5210] },
      properties: { name: q, city: 'Lausanne', countrycode: 'CH', country: 'Suisse' },
    }] } });
  });
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({
    json: { hourly: { time: [], cloud_cover: [], temperature_2m: [] } },
  }));
  await page.route('**/api/route**', route => route.fulfill({
    json: { features: [
      { geometry: { type: 'LineString', coordinates: line(46.522, 6.636) }, properties: { summary: { distance: 900, duration: 700 } } },
      { geometry: { type: 'LineString', coordinates: line(46.524, 6.634) }, properties: { summary: { distance: 1000, duration: 780 } } },
    ] },
  }));
  await page.route('**/api/overpass**', route => route.fulfill({ json: { elements: [] } }));
  await page.route('**/api/buildings**', route => route.fulfill({ json: { buildings: [] } }));
  await page.route('https://tiles.stadiamaps.com/**', route => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
}

// A search typed into the empty app, which pushes its own history entry.
async function typedSearch(page) {
  await mockUpstreams(page);
  await page.goto(BEFORE);
  await page.goto('/');
  await page.fill('#inp-start', 'Gare de Lausanne');
  await page.keyboard.press('Escape');
  await page.fill('#inp-end', 'Ouchy');
  await page.keyboard.press('Escape');
  await page.press('#inp-end', 'Enter');
  await expectRoutes(page);
}

async function sharedLink(page) {
  await mockUpstreams(page);
  await page.goto(BEFORE);
  await page.goto(LINK);
  await expectRoutes(page);
}

async function expectRoutes(page) {
  await expect(page.locator('#results')).toHaveClass(/\bon\b/, { timeout: 20_000 });
  await expect(page.locator('.leaflet-overlay-pane path').first()).toBeAttached();
}

// Nothing of the old search left, and as many pins as filled fields.
async function expectSearchGone(page, pins) {
  await expect(page.locator('#results')).not.toHaveClass(/\bon\b/);
  await expect(page.locator('#time-scrubber')).not.toHaveClass(/\bon\b/);
  await expect(page.locator('.leaflet-overlay-pane path')).toHaveCount(0);
  await expect(page.locator('#map .map-pin')).toHaveCount(pins);
  await expect(page.locator('#form-summary')).toBeHidden();
  await expect(page.locator('#inp-start')).toBeVisible();
  await expect.poll(() => new URL(page.url()).search).toBe('');
}

async function pickOnMap(page, role) {
  // Until the basemap's first load the splash covers the map.
  await expect(page.locator('#map-splash')).toHaveClass(/hidden/, { timeout: 20_000 });
  // A click while the route is still being framed opens the menu where the
  // map then moves away from: wait for the view to settle.
  await page.waitForFunction(() => !document.querySelector('#map .leaflet-zoom-anim'));
  await page.waitForTimeout(300);
  // Top left, clear of the controls and of the route, which runs south-west
  // to north-east.
  await page.mouse.click(150, 280);
  await page.click(`.pick-btn[data-role="${role}"]`);
}

test('a point picked on the map starts a new trip: the other field and the routes go', async ({ page }) => {
  await typedSearch(page);

  await pickOnMap(page, 'start');
  await expect(page.locator('#inp-start')).not.toHaveValue('');
  await expect(page.locator('#inp-end')).toHaveValue('');
  await expectSearchGone(page, 1);

  // The search's entry went with it: Back leaves, as from the empty app.
  await page.goBack();
  await expect(page).toHaveURL(/\/before-the-app$/);
});

test('from a shared link too, and Back still leaves', async ({ page }) => {
  await sharedLink(page);

  await pickOnMap(page, 'end');
  await expect(page.locator('#inp-end')).not.toHaveValue('');
  await expect(page.locator('#inp-start')).toHaveValue('');
  await expectSearchGone(page, 1);

  await page.goBack();
  await expect(page).toHaveURL(/\/before-the-app$/);
});

test('in the demo too: the pick leaves it', async ({ page }) => {
  await mockUpstreams(page);
  await page.goto('/');
  await page.click('#onboarding-btn');
  await expectRoutes(page);
  // Its note hangs over the top of the map. Closing it keeps the demo on.
  await page.click('#onboarding-note-close');

  await pickOnMap(page, 'start');
  await expect(page.locator('#onboarding-note')).toBeHidden();
  await expect(page.locator('#inp-end')).toHaveValue('');
  await expectSearchGone(page, 1);
});

test('a suggestion corrects one end: the routes go, the other end and the time stay', async ({ page }) => {
  await sharedLink(page);
  await page.click('#form-summary');
  const time = await page.locator('#inp-time').inputValue();

  await page.fill('#inp-start', 'Flon');
  await page.locator('.ac-dropdown:visible .ac-item').first().click();
  await expect(page.locator('#inp-start')).toHaveValue(/Flon/);
  await expect(page.locator('#inp-end')).toHaveValue('Ouchy');
  await expect(page.locator('#inp-date')).toHaveValue(DAY);
  await expect(page.locator('#inp-time')).toHaveValue(time);
  await expectSearchGone(page, 2);

  // Both ends still set: one tap searches again.
  await page.click('#depart-toggle');
  await page.click('#depart-confirm');
  await expectRoutes(page);
});

test('a locate button corrects one end the same way', async ({ page }) => {
  await typedSearch(page);
  await page.click('#form-summary');

  await page.click('#geo-start');
  await expect(page.locator('#inp-start')).not.toHaveValue('Gare de Lausanne');
  await expect(page.locator('#inp-end')).toHaveValue('Ouchy');
  await expectSearchGone(page, 2);
});

test('with no routes on screen, a pick changes nothing else', async ({ page }) => {
  await mockUpstreams(page);
  await page.goto('/');
  // The intro bubble sits over the middle of the map.
  await page.click('#app-description-close');
  await page.fill('#inp-end', 'Ouchy');
  await page.locator('.ac-dropdown:visible .ac-item').first().click();

  await pickOnMap(page, 'start');
  await expect(page.locator('#inp-start')).not.toHaveValue('');
  await expect(page.locator('#inp-end')).toHaveValue(/Ouchy/);
  await expect(page.locator('#map .map-pin')).toHaveCount(2);
});
