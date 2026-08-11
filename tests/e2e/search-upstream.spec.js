import { test, expect } from '@playwright/test';

// The whole point of X-Upstream is that it reaches the analytics event: which
// Overpass instance serves production is otherwise only answerable by
// sampling bboxes by hand. Reading a custom header cross-origin also depends
// on the Worker exposing it, which is why the mocks below set
// Access-Control-Expose-Headers exactly as the deployed Worker does.

const START = '46.5197,6.6323';
const END = '46.5250,6.6400';
const DAY = '2026-08-12T15:00';
const NIGHT = '2026-08-12T23:00';

async function mockUpstreams(page, overpassHeaders) {
  await page.route('https://nominatim.openstreetmap.org/**', route => route.fulfill({
    json: { display_name: 'Lausanne', address: { country_code: 'ch' } },
  }));
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({
    json: { hourly: { time: [], cloud_cover: [], temperature_2m: [] } },
  }));
  await page.route('https://ors-proxy.meridianway.workers.dev/**', route => route.fulfill({
    json: { features: [
      {
        geometry: { type: 'LineString', coordinates: [[6.6323, 46.5197, 400], [6.6360, 46.5220, 400], [6.6400, 46.5250, 400]] },
        properties: { summary: { distance: 900, duration: 700 } },
      },
      {
        geometry: { type: 'LineString', coordinates: [[6.6323, 46.5197, 400], [6.6340, 46.5240, 400], [6.6400, 46.5250, 400]] },
        properties: { summary: { distance: 1000, duration: 780 } },
      },
    ] },
  }));
  await page.route('https://swissbuildings-lookup.meridianway.workers.dev/**', route => route.fulfill({
    json: { buildings: [] },
  }));
  await page.route('https://overpass-cache.meridianway.workers.dev/**', route => route.fulfill({
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'X-Cache, X-Upstream, X-Upstream-Trail',
      ...overpassHeaders,
    },
    body: JSON.stringify({ elements: [] }),
  }));
}

async function collectEvents(page) {
  await page.addInitScript(() => {
    window.__events = [];
    window.umami = { track: (name, props) => window.__events.push([name, props]) };
  });
}

const searchProps = page => page.evaluate(() => window.__events
  .filter(([n]) => n === 'search')
  .map(([, p]) => p));

async function search(page, dt, overpassHeaders) {
  await mockUpstreams(page, overpassHeaders);
  await collectEvents(page);
  await page.goto(`/?from=${START}&to=${END}&dt=${dt}`);
  await expect(page.locator('#results')).toHaveClass(/on/, { timeout: 20_000 });
  await expect.poll(async () => (await searchProps(page)).length, { timeout: 20_000 }).toBe(1);
  return (await searchProps(page))[0];
}

test('the search event names the instance that served', async ({ page }) => {
  const props = await search(page, DAY, { 'X-Cache': 'MISS', 'X-Upstream': 'overpass.osm.ch' });
  expect(props.upstream).toBe('overpass.osm.ch');
});

test('a KV hit is reported as such, not as a missing value', async ({ page }) => {
  const props = await search(page, DAY, { 'X-Cache': 'HIT' });
  expect(props.upstream).toBe('cache');
});

test('a night search makes no Overpass call and reports no upstream', async ({ page }) => {
  const props = await search(page, NIGHT, { 'X-Cache': 'MISS', 'X-Upstream': 'overpass.osm.ch' });
  expect(props.night).toBe(true);
  expect(props.upstream).toBeUndefined();
});
