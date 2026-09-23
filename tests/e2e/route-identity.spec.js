import { test, expect } from '@playwright/test';

// The two routes used to share one gradient and differ only by opacity, so the
// map never said which line was the sunny one. Now the selected route is drawn
// in its gradient, the other as a plain grey line under it, and each carries a
// label. These pin that the map, the labels and the tabs always agree on which
// route is selected, including across the redraws a scrub triggers.

const START = '46.5197,6.6323';
const END = '46.5250,6.6400';
const SEARCH_URL = `/?from=${START}&to=${END}&dt=2026-07-28T14:00`;

const ROUTE_A = [[6.6323, 46.5197, 400], [6.6360, 46.5220, 400], [6.6400, 46.5250, 400]];
const ROUTE_B = [[6.6323, 46.5197, 400], [6.6340, 46.5240, 400], [6.6400, 46.5250, 400]];

async function mockUpstreams(page, routes) {
  await page.route('https://nominatim.openstreetmap.org/**', route => route.fulfill({
    json: { display_name: 'Lausanne, Suisse', address: { country_code: 'ch' } },
  }));
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({
    json: { hourly: { time: [], cloud_cover: [], temperature_2m: [] } },
  }));
  await page.route('https://ors-proxy.meridianway.workers.dev/**', route => route.fulfill({
    json: { features: routes.map((coordinates, i) => ({
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

async function search(page, routes = [ROUTE_A, ROUTE_B]) {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockUpstreams(page, routes);
  await page.goto(SEARCH_URL);
  await expect(page.locator('#results')).toHaveClass(/on/, { timeout: 20_000 });
  await expect(page.locator('#time-scrubber')).toHaveClass(/on/);
}

const activeTab = (page) => page.locator('.tab-btn.active').getAttribute('data-tab');
const other = (type) => (type === 'sunny' ? 'shady' : 'sunny');

// One grey line for the unselected route, one label per route, and the
// selected label is the selected tab's.
async function expectSelected(page, type) {
  await expect(page.locator('.tab-btn.active')).toHaveAttribute('data-tab', type);
  await expect(page.locator('path.route-alt')).toHaveCount(1);
  await expect(page.locator('.route-label-pill')).toHaveCount(2);
  await expect(page.locator('.route-label-pill.active')).toHaveCount(1);
  await expect(page.locator(`.route-label-pill.active.${type}`)).toHaveCount(1);
}

test('each route is labelled, and the selected one is the selected tab', async ({ page }) => {
  await search(page);
  await expectSelected(page, await activeTab(page));

  // The label repeats the figure its tab leads with.
  await expect(page.locator('.route-label-pill.sunny'))
    .toContainText(await page.locator('#sunny-sun-pct').textContent());
  await expect(page.locator('.route-label-pill.shady'))
    .toContainText(await page.locator('#shady-shade-pct').textContent());
});

test('tapping the other label selects that route, without the pick menu', async ({ page }) => {
  await search(page);
  const target = other(await activeTab(page));

  await page.locator(`.route-label-pill.${target}`).click();

  await expectSelected(page, target);
  await expect(page.locator('.pick-menu')).toHaveCount(0);
});

test('tapping the grey line selects that route too', async ({ page }) => {
  await search(page);
  const target = other(await activeTab(page));

  // A point on the stroke itself: the middle of the path's bounding box is off
  // the line as soon as the route bends.
  const at = await page.locator('path.route-alt').evaluate((path) => {
    const p = path.getPointAtLength(path.getTotalLength() / 2);
    const m = path.getScreenCTM();
    return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
  });
  await page.mouse.click(at.x, at.y);

  await expectSelected(page, target);
  await expect(page.locator('.pick-menu')).toHaveCount(0);
});

test('a tab switch moves the gradient to that route', async ({ page }) => {
  await search(page);
  const target = other(await activeTab(page));

  await page.click(`#tab-btn-${target}`);

  await expectSelected(page, target);
});

test('the selection survives the redraw a scrub makes', async ({ page }) => {
  await search(page);
  const target = other(await activeTab(page));
  await page.click(`#tab-btn-${target}`);

  const range = page.locator('#scrubber-range');
  await range.evaluate((el) => {
    el.value = el.min;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

  await expectSelected(page, target);
});

test('a single route has nothing to tell apart: no label, no grey line', async ({ page }) => {
  await search(page, [ROUTE_A]);

  await expect(page.locator('.route-label-pill')).toHaveCount(0);
  await expect(page.locator('path.route-alt')).toHaveCount(0);
});
