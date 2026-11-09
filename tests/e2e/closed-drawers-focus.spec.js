import { test, expect } from '@playwright/test';

// A closed drawer is parked off screen by a transform, which alone leaves its
// controls in the Tab order: focus would vanish from view for a long stretch.

const START = '46.5197,6.6323';
const END = '46.5250,6.6400';
const SEARCH_URL = `/?from=${START}&to=${END}&dt=2026-07-28T14:00`;
const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };

async function mockUpstreams(page) {
  const line = (lat, lon) => [[6.6323, 46.5197, 400], [lon, lat, 400], [6.64, 46.525, 400]];
  await page.route('https://nominatim.openstreetmap.org/**', route => route.fulfill({
    json: { display_name: 'Lausanne, Suisse', address: { country_code: 'ch' } },
  }));
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

// Tabs through the whole page and returns the stops that landed off screen.
async function offScreenStops(page) {
  const off = [];
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const box = el.getBoundingClientRect();
      const out = box.right <= 0 || box.left >= innerWidth || box.bottom <= 0 || box.top >= innerHeight;
      return { name: el.id || el.textContent.trim().slice(0, 30), out };
    });
    if (!stop) break;
    if (stop.out) off.push(stop.name);
  }
  return off;
}

async function search(page, viewport) {
  await page.setViewportSize(viewport);
  await mockUpstreams(page);
  await page.goto(SEARCH_URL);
  await expect(page.locator('#results')).toHaveClass(/on/, { timeout: 20_000 });
  await expect(page.locator('#results')).toHaveCSS('visibility', 'visible');
  // Measured mid-slide, a stop would count as off screen for the wrong reason.
  await page.waitForFunction(() => document.getElementById('results').getAnimations().length === 0);
}

for (const [device, viewport] of Object.entries({ desktop: DESKTOP, mobile: MOBILE })) {
  test(`on load, every Tab stop is on screen (${device})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockUpstreams(page);
    await page.goto('/');
    expect(await offScreenStops(page)).toEqual([]);
  });

  test(`the About drawer takes Tab stops only while open (${device})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockUpstreams(page);
    await page.goto('/');

    await page.locator('#about-btn').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#about-close')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#about-drawer :focus')).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(page.locator('#about-drawer')).not.toHaveClass(/open/);
    await expect(page.locator('#about-btn')).toBeFocused();
    expect(await offScreenStops(page)).toEqual([]);
  });

  test(`with results open, every Tab stop is on screen (${device})`, async ({ page }) => {
    await search(page, viewport);
    expect(await offScreenStops(page)).toEqual([]);
    await page.locator('#share-btn').focus();
    await expect(page.locator('#share-btn')).toBeFocused();
  });
}

test('the side panel gives up its Tab stops when collapsed, and takes them back', async ({ page }) => {
  await search(page, DESKTOP);

  await page.locator('#panel-toggle').click();
  await expect(page.locator('#results')).toHaveCSS('visibility', 'hidden');
  expect(await offScreenStops(page)).toEqual([]);

  await page.locator('#panel-toggle').click();
  await expect(page.locator('#results')).toHaveCSS('visibility', 'visible');
  await page.locator('#share-btn').focus();
  await expect(page.locator('#share-btn')).toBeFocused();
});
