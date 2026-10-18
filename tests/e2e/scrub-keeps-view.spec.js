import { test, expect } from '@playwright/test';

// Zooming on a street, then sliding the time to watch its shade move, is the
// gesture the app invites. Every scrubber tick used to refit the map on the
// route's two ends, which threw that zoom away on the first tick, and the
// vegetation pass did the same up to ~13 s after the first results.
// The two pins stand for the view: their spread is the zoom, their position
// the pan, and they are redrawn on every render.

const START = '46.5197,6.6323';
const END = '46.5250,6.6400';
const LINK = `/en/?from=${START}&to=${END}&dt=2026-07-15T13:00`;

const ROUTE_A = [[6.6323, 46.5197, 400], [6.6360, 46.5220, 400], [6.6400, 46.5250, 400]];
const ROUTE_B = [[6.6323, 46.5197, 400], [6.6340, 46.5240, 400], [6.6400, 46.5250, 400]];

// Spy on window.umami and block the real script so it cannot overwrite it.
async function captureEvents(page) {
  await page.addInitScript(() => {
    window.__events = [];
    window.umami = { track: (name, data) => window.__events.push({ name, data }) };
  });
  await page.route('https://cloud.umami.is/**', route => route.abort());
}

const eventsOfType = (page, name) => page.evaluate(n => window.__events.filter(e => e.name === n), name);

async function mockUpstreams(page, { vegetation = Promise.resolve() } = {}) {
  await page.route('https://nominatim.openstreetmap.org/**', route => route.fulfill({
    json: { display_name: 'Lausanne, Suisse', address: { country_code: 'ch' } },
  }));
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({
    json: { hourly: { time: [], cloud_cover: [], temperature_2m: [] } },
  }));
  await page.route('**/api/route**', route => route.fulfill({
    json: { features: [ROUTE_A, ROUTE_B].map((coordinates, i) => ({
      geometry: { type: 'LineString', coordinates },
      properties: { summary: { distance: 900 + i * 100, duration: 700 + i * 80 } },
    })) },
  }));
  await page.route('**/api/buildings**', route => route.fulfill({ json: [] }));
  await page.route('**/api/overpass**', async route => {
    await vegetation;
    return route.fulfill({ json: { elements: [] } });
  });
  // An empty style: no tiles, so nothing can stand in for the mocks above.
  await page.route('https://tiles.stadiamaps.com/**', route =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
}

async function open(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(LINK);
  await expect(page.locator('#time-scrubber')).toHaveClass(/on/, { timeout: 20_000 });
}

// Null while a pin is hidden: Leaflet hides markers during a zoom animation,
// and a new search clears them until its first render.
async function pins(page) {
  const [a, b] = await Promise.all(['.map-pin.start', '.map-pin.end'].map(s => page.locator(s).boundingBox()));
  if (!a || !b) return null;
  return { ax: Math.round(a.x), ay: Math.round(a.y), bx: Math.round(b.x), by: Math.round(b.y) };
}

const spread = (p) => (p ? Math.hypot(p.bx - p.ax, p.by - p.ay) : NaN);

// Two identical reads in a row: no fit or zoom animation in flight. Reading
// mid-animation would compare views that were never at rest.
async function settledPins(page) {
  let last = null;
  await expect.poll(async () => {
    const now = await pins(page);
    const same = now !== null && last !== null && JSON.stringify(now) === JSON.stringify(last);
    last = now;
    return same;
  }, { intervals: [150] }).toBe(true);
  return last;
}

async function zoomIn(page) {
  const before = await settledPins(page);
  await page.click('.leaflet-control-zoom-in');
  await expect.poll(async () => spread(await pins(page))).toBeGreaterThan(spread(before) * 1.5);
  return settledPins(page);
}

async function scrubTo(page, end) {
  await page.locator('#scrubber-range').evaluate((el, which) => {
    el.value = which === 'min' ? el.min : el.max;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, end);
}

test('a scrub keeps the zoom the user made', async ({ page }) => {
  await mockUpstreams(page);
  await open(page);
  const zoomed = await zoomIn(page);

  await scrubTo(page, 'min');
  // The tick did redraw: the link holds the new instant.
  await expect(page).not.toHaveURL(/dt=2026-07-15T13%3A00/);
  expect(await settledPins(page)).toEqual(zoomed);

  await scrubTo(page, 'max');
  expect(await settledPins(page)).toEqual(zoomed);
});

test('the vegetation pass landing late keeps the zoom too', async ({ page }) => {
  let release;
  const vegetation = new Promise(r => { release = r; });
  await captureEvents(page);
  await mockUpstreams(page, { vegetation });
  await open(page);
  const zoomed = await zoomIn(page);

  release();
  // The search event goes out once vegetation has been applied.
  await expect.poll(async () => (await eventsOfType(page, 'search')).length).toBe(1);
  expect(await settledPins(page)).toEqual(zoomed);
});

test('a new search still frames its route', async ({ page }) => {
  await mockUpstreams(page);
  await open(page);
  const zoomed = await zoomIn(page);

  await page.click('#depart-toggle');
  await page.fill('#inp-time', '15:00');
  await page.click('#depart-confirm');
  await expect(page).toHaveURL(/dt=2026-07-15T15%3A00/);

  // Back out to the route's frame. Not to the pixel: the fit pads for the
  // drawer, whose height can still be settling on the first render.
  await expect.poll(async () => spread(await pins(page))).toBeLessThan(spread(zoomed) / 1.5);
});

test('the about panel casts no shadow on the map while closed', async ({ page }) => {
  await mockUpstreams(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/');
  // Wired in the same pass as the fields.
  await page.waitForSelector('#inp-start[role="combobox"]');
  const shadow = () => page.locator('#about-drawer').evaluate(el => getComputedStyle(el).boxShadow);

  expect(await shadow()).toBe('none');
  await page.click('#about-btn');
  await expect(page.locator('#about-drawer')).toHaveClass(/open/);
  await expect.poll(shadow).not.toBe('none');
});

test.describe('drawer_open says how the drawer was opened', () => {
  test('a tap on the handle, and nothing for closing it', async ({ page }) => {
    await captureEvents(page);
    await mockUpstreams(page);
    await open(page);

    await page.click('#drawer-handle');
    await expect(page.locator('#results')).toHaveClass(/expanded/);
    await page.click('#drawer-handle');
    await expect(page.locator('#results')).not.toHaveClass(/expanded/);

    expect((await eventsOfType(page, 'drawer_open')).map(e => e.data)).toEqual([{ via: 'tap' }]);
  });

  test('a drag up', async ({ page }) => {
    await captureEvents(page);
    await mockUpstreams(page);
    await open(page);

    // The drawer slides in: measured mid-transition, the handle sits under
    // other elements. A trial click waits for it to stand still.
    await page.locator('#drawer-handle').click({ trial: true });
    const box = await page.locator('#drawer-handle').boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 120, { steps: 6 });
    await page.mouse.up();

    await expect(page.locator('#results')).toHaveClass(/expanded/);
    expect((await eventsOfType(page, 'drawer_open')).map(e => e.data)).toEqual([{ via: 'drag' }]);
  });

  test('the keyboard', async ({ page }) => {
    await captureEvents(page);
    await mockUpstreams(page);
    await open(page);

    await page.focus('#drawer-handle');
    await page.keyboard.press('Enter');

    await expect(page.locator('#results')).toHaveClass(/expanded/);
    expect((await eventsOfType(page, 'drawer_open')).map(e => e.data)).toEqual([{ via: 'key' }]);
  });
});
