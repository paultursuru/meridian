import { test, expect } from '@playwright/test';

// The share button carries a short label next to its icon, drops it where the
// drawer is too short to hold it above the tabs, and hands the current link to
// the share sheet, or to the clipboard when there is none.

const START = '46.5197,6.6323';
const END = '46.5250,6.6400';
const QUERY = `?from=${START}&to=${END}&dt=2026-07-28T14:00`;

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

async function search(page, { lang = '', width = 390, height = 844 } = {}) {
  await page.setViewportSize({ width, height });
  await mockUpstreams(page);
  await page.goto(`/${lang}${QUERY}`);
  await expect(page.locator('#results')).toHaveClass(/on/, { timeout: 20_000 });
}

// Whether the button covers any part of the sunny tab's text.
function coversTabLabel(page) {
  return page.evaluate(() => {
    const b = document.getElementById('share-btn').getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('tab-btn-sunny'));
    const t = range.getBoundingClientRect();
    return b.left < t.right && b.right > t.left && b.top < t.bottom && b.bottom > t.top;
  });
}

test('the button says what it does, in the page language', async ({ page }) => {
  await search(page);
  const btn = page.locator('#share-btn');
  await expect(btn).toHaveText('Partager');
  await expect(btn).toHaveAccessibleName('Partager cet itinéraire');

  await search(page, { lang: 'de/' });
  await expect(btn).toHaveText('Teilen');
});

test('the label clears the tabs', async ({ page }) => {
  await search(page);
  await expect(page.locator('#share-btn span')).toBeVisible();
  expect(await coversTabLabel(page)).toBe(false);
});

test('a short screen keeps the icon only, clear of the tabs', async ({ page }) => {
  await search(page, { width: 375, height: 667 });
  await expect(page.locator('#share-btn')).toBeVisible();
  await expect(page.locator('#share-btn span')).toBeHidden();
  expect(await coversTabLabel(page)).toBe(false);
});

test('without a share sheet, the link is copied', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text) => { window.__copied = text; } },
      configurable: true,
    });
  });
  await search(page);

  await page.click('#share-btn');

  await expect(page.locator('#toast')).toHaveText('Lien copié dans le presse-papier.');
  const copied = await page.evaluate(() => window.__copied);
  expect(copied).toBe(page.url());
  expect(copied).toMatch(/from=.+&to=.+&dt=/);
});

test('with a share sheet, the link goes to it', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      value: async (data) => { window.__shared = data; },
      configurable: true,
    });
  });
  await search(page);

  await page.click('#share-btn');

  await expect.poll(() => page.evaluate(() => window.__shared?.url)).toBe(page.url());
});
