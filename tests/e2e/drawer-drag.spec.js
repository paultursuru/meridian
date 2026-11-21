import { test, expect } from '@playwright/test';

// Reported 2026-11-20: only the handle, a 26 px strip, could be dragged, and on
// some phones it was hard to catch. Now the part above the routes drags the
// sheet, so does the whole folded sheet, and the sheet follows the finger.
// Expanded, the routes scroll: a pull down only closes the sheet once they
// are back at the top.
//
// Real touch events through CDP: the browser decides between scrolling and
// the drag on its own, as it does on a phone. Playwright's touchscreen only taps.

const START = '46.5197,6.6323';
const END = '46.5250,6.6400';
const LINK = `/?from=${START}&to=${END}&dt=2026-08-13T15:00`;

const ROUTE_A = [[6.6323, 46.5197, 400], [6.6360, 46.5220, 400], [6.6400, 46.5250, 400]];
const ROUTE_B = [[6.6323, 46.5197, 400], [6.6340, 46.5240, 400], [6.6400, 46.5250, 400]];

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function captureEvents(page) {
  await page.addInitScript(() => {
    window.__events = [];
    window.umami = { track: (name, data) => window.__events.push({ name, data }) };
  });
  await page.route('https://cloud.umami.is/**', route => route.abort());
}

const eventsOfType = (page, name) => page.evaluate(n => window.__events.filter(e => e.name === n), name);

async function mockUpstreams(page) {
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
  await page.route('**/api/overpass**', route => route.fulfill({ json: { elements: [] } }));
  // An empty style: no tiles, so nothing can stand in for the mocks above.
  await page.route('https://tiles.stadiamaps.com/**', route =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
}

async function open(page) {
  await captureEvents(page);
  await mockUpstreams(page);
  await page.goto(LINK);
  await expect(page.locator('#time-scrubber')).toHaveClass(/on/, { timeout: 20_000 });
  await settled(page);
}

// The drawer's slide is over. Playwright's own stability check (two frames at
// the same place) can pass on a loaded machine before the slide has started.
const settled = page => page.waitForFunction(() => document.getElementById('results').getAnimations().length === 0);

// The same value twice, 100 ms apart: a fling has stopped scrolling.
async function still(read) {
  let last;
  await expect.poll(async () => {
    const now = await read();
    const same = now === last;
    last = now;
    return same;
  }, { intervals: [100] }).toBe(true);
}

const drawerTop = page => page.evaluate(() => Math.round(document.getElementById('results').getBoundingClientRect().top));

async function center(page, selector) {
  const box = await page.locator(selector).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// A finger down at (x, y0), moved to y1 at about a frame a step, then lifted.
// midway runs with the finger still down, halfway through.
async function drag(page, x, y0, y1, { midway } = {}) {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: y == null ? [] : [{ x, y }] });
  const steps = 10;
  await touch('touchStart', y0);
  for (let i = 1; i <= steps; i++) {
    await touch('touchMove', y0 + (y1 - y0) * i / steps);
    await page.waitForTimeout(16);
    if (i === steps / 2 && midway) await midway();
  }
  await touch('touchEnd');
  await cdp.detach();
}

test('a drag up on the tabs opens the folded drawer, which follows the finger', async ({ page }) => {
  await open(page);
  const folded = await drawerTop(page);
  const tab = await center(page, '#tab-btn-sunny');

  let midTop;
  await drag(page, tab.x, tab.y, tab.y - 160, { midway: async () => { midTop = await drawerTop(page); } });

  expect(midTop).toBeLessThan(folded - 30);
  await expect(page.locator('#results')).toHaveClass(/expanded/);
  expect((await eventsOfType(page, 'drawer_open')).map(e => e.data)).toEqual([{ via: 'drag' }]);
});

test('folded, a drag up on the routes opens the drawer', async ({ page }) => {
  await open(page);
  // Folded, most of the routes are below the screen: grab their top.
  const box = await page.locator('#drawer-body').boundingBox();
  await drag(page, box.x + box.width / 2, box.y + 30, box.y - 130);
  await expect(page.locator('#results')).toHaveClass(/expanded/);
});

test('expanded, a drag down scrolls the routes, and closes only from the top', async ({ page }) => {
  await open(page);
  // Two short routes fit on screen: a block stands in for a long route's
  // details, so the routes have something to scroll.
  await page.evaluate(() => {
    const filler = document.createElement('div');
    filler.style.height = '600px';
    document.getElementById('drawer-body').append(filler);
  });
  await page.click('#drawer-handle');
  await expect(page.locator('#results')).toHaveClass(/expanded/);
  await settled(page);
  const body = page.locator('#drawer-body');
  const box = await body.boundingBox();
  const x = box.x + box.width / 2;
  const scrollTop = () => body.evaluate(el => el.scrollTop);

  await drag(page, x, box.y + box.height - 20, box.y + 20);
  await expect.poll(scrollTop).toBeGreaterThan(100);
  await still(scrollTop);
  const scrolled = await scrollTop();

  await drag(page, x, box.y + 20, box.y + 80);
  await expect.poll(scrollTop).toBeLessThan(scrolled);
  await expect(page.locator('#results')).toHaveClass(/expanded/);

  await still(scrollTop);
  await body.evaluate(el => { el.scrollTop = 0; });
  await drag(page, x, box.y + 20, box.y + 220);
  await expect(page.locator('#results')).not.toHaveClass(/expanded/);
});

test('a tap on a tab still switches the tab, and leaves the drawer as it was', async ({ page }) => {
  await open(page);
  const other = page.locator('.tab-btn:not(.active)');
  const id = await other.getAttribute('id');
  await other.tap();
  await expect(page.locator(`#${id}`)).toHaveClass(/active/);
  await expect(page.locator('#results')).not.toHaveClass(/expanded/);
});
