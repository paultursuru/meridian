import { test, expect } from '@playwright/test';

// A shared link waits on two reverse geocodes before its search starts. The
// about panel, the locate control and Back must answer during that wait, and
// a popstate meanwhile must not restore the link a second time.

const START = { lat: 46.5197, lng: 6.6323 };
const LINK = `/?from=${START.lat},${START.lng}&to=46.5250,6.6400&dt=2026-07-28T14:00`;

const ROUTE_A = [[6.6323, 46.5197, 400], [6.6360, 46.5220, 400], [6.6400, 46.5250, 400]];
const ROUTE_B = [[6.6323, 46.5197, 400], [6.6340, 46.5240, 400], [6.6400, 46.5250, 400]];

// Reverse geocodes are held until release() is called, so the test decides
// how long the restore lasts.
async function mockUpstreams(page) {
  const counts = { reverse: 0, ors: 0 };
  let release;
  const gate = new Promise(r => { release = r; });
  await page.route('https://nominatim.openstreetmap.org/**', async route => {
    counts.reverse++;
    await gate;
    await route.fulfill({ json: { display_name: 'Lausanne, Suisse', address: { country_code: 'ch' } } });
  });
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({
    json: { hourly: { time: [], cloud_cover: [], temperature_2m: [] } },
  }));
  await page.route('https://ors-proxy.meridianway.workers.dev/**', route => {
    counts.ors++;
    return route.fulfill({
      json: { features: [ROUTE_A, ROUTE_B].map((coordinates, i) => ({
        geometry: { type: 'LineString', coordinates },
        properties: { summary: { distance: 900 + i * 100, duration: 700 + i * 80 } },
      })) },
    });
  });
  await page.route('https://overpass-cache.meridianway.workers.dev/**', route =>
    route.fulfill({ json: { elements: [] } }));
  await page.route('https://swissbuildings-lookup.meridianway.workers.dev/**', route =>
    route.fulfill({ json: { buildings: [] } }));
  await page.route('https://tiles.stadiamaps.com/**', route =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  return { counts, release: () => release() };
}

async function landOnLink(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  const upstreams = await mockUpstreams(page);
  await page.goto(LINK);
  // Both reverse geocodes are out and held: the restore is waiting.
  await expect.poll(() => upstreams.counts.reverse).toBe(2);
  return upstreams;
}

const results = (page) => expect(page.locator('#results')).toHaveClass(/on/, { timeout: 20_000 });

test('the about panel opens and Back closes it while the link restores', async ({ page }) => {
  const { release } = await landOnLink(page);

  await page.click('#about-btn');
  await expect(page.locator('#about-drawer')).toHaveClass(/open/);
  await page.goBack();
  await expect(page.locator('#about-drawer')).not.toHaveClass(/open/);

  release();
  await results(page);
});

test('the locate control answers while the link restores', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: START.lat, longitude: START.lng });
  const { release } = await landOnLink(page);

  await page.click('.locate-control');
  await expect(page.locator('path.leaflet-interactive[stroke="#3b82f6"]')).toHaveCount(1);

  release();
  await results(page);
});

test('Forward onto the about entry does not restore the link twice', async ({ page }) => {
  const { counts, release } = await landOnLink(page);

  await page.click('#about-btn');
  await expect(page.locator('#about-drawer')).toHaveClass(/open/);
  await page.goBack();
  await expect(page.locator('#about-drawer')).not.toHaveClass(/open/);
  await page.goForward();

  release();
  await results(page);
  expect(counts.reverse).toBe(2);
  expect(counts.ors).toBe(1);
});
