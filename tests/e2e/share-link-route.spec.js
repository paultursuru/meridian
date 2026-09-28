import { test, expect } from '@playwright/test';

// A shared link opens on the route its sender was looking at: the URL carries
// r=sunny|shady, every change of route rewrites it, and on arrival it wins over
// the weather's pick. A January noon with no forecast makes that pick 'sunny',
// so r=shady is the one that proves the link decided.

const START = '46.5197,6.6323';
const END = '46.5250,6.6400';
const LINK = `/?from=${START}&to=${END}&dt=2026-01-15T12:00`;

const ROUTE_A = [[6.6323, 46.5197, 400], [6.6360, 46.5220, 400], [6.6400, 46.5250, 400]];
const ROUTE_B = [[6.6323, 46.5197, 400], [6.6340, 46.5240, 400], [6.6400, 46.5250, 400]];

async function mockUpstreams(page) {
  await page.route('https://nominatim.openstreetmap.org/**', route => route.fulfill({
    json: { display_name: 'Lausanne, Suisse', address: { country_code: 'ch' } },
  }));
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({
    json: { hourly: { time: [], cloud_cover: [], temperature_2m: [] } },
  }));
  await page.route('https://ors-proxy.meridianway.workers.dev/**', route => route.fulfill({
    json: { features: [ROUTE_A, ROUTE_B].map((coordinates, i) => ({
      geometry: { type: 'LineString', coordinates },
      properties: { summary: { distance: 900 + i * 100, duration: 700 + i * 80 } },
    })) },
  }));
  await page.route('https://overpass-cache.meridianway.workers.dev/**', route =>
    route.fulfill({ json: { elements: [] } }));
  await page.route('https://swissbuildings-lookup.meridianway.workers.dev/**', route =>
    route.fulfill({ json: { buildings: [] } }));
  await page.route('https://tiles.stadiamaps.com/**', route =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
}

async function open(page, url) {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockUpstreams(page);
  await page.goto(url);
  // The scrubber starts once the weather has landed, which is when the
  // weather's pick would have been applied.
  await expect(page.locator('#time-scrubber')).toHaveClass(/on/, { timeout: 20_000 });
}

const activeTab = (page) => page.locator('.tab-btn.active');

test('a link with r opens on that route, over the weather pick', async ({ page }) => {
  await open(page, `${LINK}&r=shady`);
  await expect(activeTab(page)).toHaveAttribute('data-tab', 'shady');
  await expect(page).toHaveURL(/[?&]r=shady/);
});

test('an older link without r lets the weather pick, and gains r', async ({ page }) => {
  await open(page, LINK);
  await expect(activeTab(page)).toHaveAttribute('data-tab', 'sunny');
  await expect(page).toHaveURL(/[?&]r=sunny/);
});

test('switching tabs rewrites the link, and a scrub keeps it', async ({ page }) => {
  await open(page, LINK);
  await page.click('#tab-btn-shady');
  await expect(page).toHaveURL(/[?&]r=shady/);

  const range = page.locator('#scrubber-range');
  await range.evaluate((el) => {
    el.value = el.min;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page).not.toHaveURL(/dt=2026-01-15T12%3A00/);
  await expect(page).toHaveURL(/[?&]r=shady/);
  await expect(activeTab(page)).toHaveAttribute('data-tab', 'shady');
});

test('picking a route on the map rewrites the link too', async ({ page }) => {
  await open(page, LINK);
  await page.locator('.route-label-pill.shady').click();
  await expect(page).toHaveURL(/[?&]r=shady/);
});

test('reloading the rewritten link reopens the same route', async ({ page }) => {
  await open(page, LINK);
  await page.click('#tab-btn-shady');
  await expect(page).toHaveURL(/[?&]r=shady/);

  await page.reload();
  await expect(page.locator('#time-scrubber')).toHaveClass(/on/, { timeout: 20_000 });
  await expect(activeTab(page)).toHaveAttribute('data-tab', 'shady');
});
