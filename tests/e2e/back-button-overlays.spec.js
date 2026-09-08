import { test, expect } from '@playwright/test';

// The hardware Back button and iOS's swipe-back are the same item. The app
// only ever held one history entry, so Back left the site instead of closing
// whatever panel was open. Now the expanded results drawer and the about panel
// each push one entry when they open; Back closes them one layer at a time,
// and closing by any other means reclaims the entry so it can't pile up.
//
// page.goBack() stands in for a hardware Back press. What it can't stand in
// for is iOS standalone's swipe-back actually firing popstate on a
// same-document entry: that assumption still needs a real device.

const START = '46.5197,6.6323';
const END = '46.5250,6.6400';
// A plain afternoon: sun well up (scrubber shown, drawer in its normal state),
// and not the 12th, whose eclipse note would ride along on a Swiss route.
const SEARCH_URL = `/?from=${START}&to=${END}&dt=2026-08-13T14:00`;

// iPhone 14/15 portrait: below 900px the drawer is a bottom sheet with a
// handle and an .expanded state. From 900px up it docks as a side panel where
// .expanded is a no-op and none of this applies.
test.use({ viewport: { width: 390, height: 844 } });

async function mockUpstreams(page) {
  await page.route('https://nominatim.openstreetmap.org/**', route => route.fulfill({
    json: { display_name: 'Lausanne, Suisse', address: { country_code: 'ch' } },
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
  await page.route('https://overpass-cache.meridianway.workers.dev/**', route => route.fulfill({
    json: { elements: [] },
  }));
  await page.route('https://swissbuildings-lookup.meridianway.workers.dev/**', route => route.fulfill({
    json: { buildings: [] },
  }));
  // Buildings are mocked above, so the tiles must be blocked too or the real
  // basemap answers over them. An empty style keeps the map "loaded" without a
  // network call.
  await page.route('https://tiles.stadiamaps.com/**', route => route.fulfill({
    json: { version: 8, sources: {}, layers: [] },
  }));
}

async function search(page) {
  await mockUpstreams(page);
  await page.goto(SEARCH_URL);
  await expect(page.locator('#time-scrubber')).toHaveClass(/on/, { timeout: 20_000 });
}

test('Back collapses the expanded drawer without changing the URL or leaving the page', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  await search(page);
  const url = page.url(); // the share URL renderAt has already replaceState'd

  await page.click('#drawer-handle');
  await expect(page.locator('#results')).toHaveClass(/expanded/);

  await page.goBack();

  await expect(page.locator('#results')).not.toHaveClass(/expanded/);
  await expect(page.locator('#results')).toHaveClass(/on/); // still the same view
  expect(page.url()).toBe(url);
  expect(pageErrors).toEqual([]);
});

test('Back closes the about panel', async ({ page }) => {
  await search(page);

  await page.click('#about-btn');
  await expect(page.locator('#about-drawer')).toHaveClass(/open/);

  await page.goBack();

  await expect(page.locator('#about-drawer')).not.toHaveClass(/open/);
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
});

test('with both open, Back peels the about panel first, then the drawer', async ({ page }) => {
  await search(page);

  await page.click('#drawer-handle');
  await expect(page.locator('#results')).toHaveClass(/expanded/);
  await page.click('#about-btn');
  await expect(page.locator('#about-drawer')).toHaveClass(/open/);

  await page.goBack();
  await expect(page.locator('#about-drawer')).not.toHaveClass(/open/);
  await expect(page.locator('#results')).toHaveClass(/expanded/); // drawer untouched

  await page.goBack();
  await expect(page.locator('#results')).not.toHaveClass(/expanded/);
  await expect(page.locator('#results')).toHaveClass(/on/);
});

test('opening and closing the about panel via the UI does not grow the history stack', async ({ page }) => {
  await search(page);

  const before = await page.evaluate(() => history.length);

  for (let i = 0; i < 5; i++) {
    await page.click('#about-btn');
    await expect(page.locator('#about-drawer')).toHaveClass(/open/);
    await page.click('#about-close');
    await expect(page.locator('#about-drawer')).not.toHaveClass(/open/);
  }

  // The first open grows the stack by one entry; every open/close after that
  // reuses it. Without the history.back() in the dismiss path, each open would
  // add another entry and Back would need five presses to leave.
  const after = await page.evaluate(() => history.length);
  expect(after).toBeLessThanOrEqual(before + 1);
});

test('collapsing the drawer with a map tap also reclaims its history entry', async ({ page }) => {
  await search(page);
  // The splash swallows clicks (disableClickPropagation) until the basemap
  // loads, so a map tap only reaches Leaflet once it's gone.
  await expect(page.locator('#map-splash')).toHaveClass(/hidden/, { timeout: 20_000 });
  const before = await page.evaluate(() => history.length);

  await page.click('#drawer-handle');
  await expect(page.locator('#results')).toHaveClass(/expanded/);

  // A tap on the exposed strip of map above the sheet is the third way to
  // collapse it (map.js), and it has to unwind the entry like the handle does.
  // Mid-width, just below the sun badge: clear of it and of the top-left zoom
  // control, both of which swallow the click before the map sees it.
  const box = await page.locator('#map').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + 55);

  await expect(page.locator('#results')).not.toHaveClass(/expanded/);
  const after = await page.evaluate(() => history.length);
  expect(after).toBeLessThanOrEqual(before + 1);
});

test('expanding and collapsing the drawer via the handle does not grow the history stack', async ({ page }) => {
  await search(page);

  const before = await page.evaluate(() => history.length);

  for (let i = 0; i < 5; i++) {
    await page.click('#drawer-handle');
    await expect(page.locator('#results')).toHaveClass(/expanded/);
    await page.click('#drawer-handle');
    await expect(page.locator('#results')).not.toHaveClass(/expanded/);
  }

  // Same invariant as the about panel: a handle-tap collapse reclaims the
  // entry the expand pushed, so five round trips leave one entry, not five.
  const after = await page.evaluate(() => history.length);
  expect(after).toBeLessThanOrEqual(before + 1);
});
