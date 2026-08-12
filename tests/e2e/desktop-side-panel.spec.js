import { test, expect } from '@playwright/test';

// From 900px up the results dock as a side panel to the left of the map
// instead of stretching the bottom sheet across the window. What these pin is
// the part that is easy to break from either side of the breakpoint — both
// routes visible at once without tabs, and nothing (route or scrubber) left
// underneath the panel.

const START = '46.5197,6.6323';
const END = '46.5250,6.6400';
const SEARCH_URL = `/?from=${START}&to=${END}&dt=2026-07-28T14:00`;

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };

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
  await page.route('https://overpass-cache.meridianway.workers.dev/**', route =>
    route.fulfill({ json: { elements: [] } }));
  await page.route('https://swissbuildings-lookup.meridianway.workers.dev/**', route =>
    route.fulfill({ json: { buildings: [] } }));
  await page.route('https://tiles.stadiamaps.com/**', route =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
}

async function search(page, viewport) {
  await page.setViewportSize(viewport);
  await mockUpstreams(page);
  await page.goto(SEARCH_URL);
  await expect(page.locator('#results')).toHaveClass(/on/, { timeout: 20_000 });
  await expect(page.locator('#time-scrubber')).toHaveClass(/on/);
  await page.waitForTimeout(500); // the panel slides in over 0.32s
}

test('both routes are on screen at once, with no tabs to alternate between', async ({ page }) => {
  await search(page, DESKTOP);

  await expect(page.locator('#tabs')).toBeHidden();
  await expect(page.locator('#tab-sunny')).toBeVisible();
  await expect(page.locator('#tab-shady')).toBeVisible();
  // The stat each card exists for, not just the card's box.
  await expect(page.locator('#sunny-sun-pct')).toBeVisible();
  await expect(page.locator('#shady-sun-pct')).toBeVisible();
  // Expanded-only on mobile; there is nothing to expand here, so the details
  // have to be out already.
  await expect(page.locator('#sunny-dist')).toBeVisible();
  await expect(page.locator('#shady-dist')).toBeVisible();
});

test('the panel is docked to the left of the map, not stretched across it', async ({ page }) => {
  await search(page, DESKTOP);

  const box = await page.evaluate(() => {
    const r = (sel) => {
      const b = document.querySelector(sel).getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width };
    };
    return { panel: r('#results'), map: r('#map'), scrubber: r('#time-scrubber') };
  });

  expect(box.panel.left).toBe(0);
  expect(box.panel.width).toBeLessThanOrEqual(420);
  // Flush with the map's own top edge, not a rounded approximation of it:
  // offsetTop rounds and left a hairline of map showing through above the
  // panel, which is why ui.js measures with getBoundingClientRect.
  expect(Math.abs(box.panel.top - box.map.top)).toBeLessThanOrEqual(0.5);
  expect(box.panel.bottom).toBeGreaterThanOrEqual(box.map.bottom - 1);
  // The scrubber sits inside the panel instead of spanning the window.
  expect(box.scrubber.right).toBeLessThanOrEqual(box.panel.right);
  expect(box.scrubber.bottom).toBeLessThanOrEqual(box.panel.bottom);
});

test('the fitted route stays clear of the panel', async ({ page }) => {
  await search(page, DESKTOP);

  const box = await page.evaluate(() => {
    // Same exclusion as map-small-viewport.spec.js: .route-casing carries a
    // blur filter, so its rect is the filter region rather than the stroke.
    const segs = Array.from(document.querySelectorAll('.leaflet-overlay-pane path:not(.route-casing)'))
      .map(p => p.getBoundingClientRect());
    return {
      routeLeft: Math.min(...segs.map(r => r.left)),
      panelRight: document.getElementById('results').getBoundingClientRect().right,
    };
  });

  expect(box.routeLeft).toBeGreaterThanOrEqual(box.panelRight);
});

test('clicking a card selects that route', async ({ page }) => {
  await search(page, DESKTOP);

  // Whichever the preselect chose, click the other one.
  const sunnyActive = await page.locator('#tab-sunny').evaluate(el => el.classList.contains('active'));
  const other = sunnyActive ? 'shady' : 'sunny';

  await page.click(`#tab-${other} .pane-title`);
  await expect(page.locator(`#tab-${other}`)).toHaveClass(/active/);
  await expect(page.locator(`#tab-${sunnyActive ? 'sunny' : 'shady'}`)).not.toHaveClass(/active/);
});

test('every note sits under the route cards', async ({ page }) => {
  // 20:30 local is a low sun (grazing note) under a fully overcast forecast
  // (weather note), on top of the height-data note every search gets: one of
  // each family, which in the bottom sheet would straddle the cards.
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({
    json: { hourly: { time: ['2026-08-13T20:00', '2026-08-13T21:00'], cloud_cover: [95, 95], temperature_2m: [18, 17] } },
  }));
  await page.setViewportSize(DESKTOP);
  await mockUpstreams(page);
  await page.goto(`/?from=${START}&to=${END}&dt=2026-08-13T20:30`);
  await expect(page.locator('#results')).toHaveClass(/on/, { timeout: 20_000 });
  await expect(page.locator('#grazing-sun-note')).toHaveClass(/on/);
  await page.waitForTimeout(500);

  const tops = await page.evaluate(() => {
    const top = (sel) => document.querySelector(sel).getBoundingClientRect().top;
    return {
      cardsEnd: document.getElementById('tab-shady').getBoundingClientRect().bottom,
      notes: ['#grazing-sun-note', '#weather-note', '#quality-note']
        .filter(s => document.querySelector(s).classList.contains('on'))
        .map(s => top(s)),
    };
  });

  expect(tops.notes.length).toBeGreaterThanOrEqual(2);
  for (const t of tops.notes) expect(t).toBeGreaterThanOrEqual(tops.cardsEnd);
  // And in the order they are stacked in, not scattered.
  expect([...tops.notes].sort((a, b) => a - b)).toEqual(tops.notes);
});

test('the panel folds away and comes back', async ({ page }) => {
  await search(page, DESKTOP);

  await page.click('#panel-toggle');
  await page.waitForTimeout(500); // 0.32s slide
  let box = await page.evaluate(() => ({
    panel: document.getElementById('results').getBoundingClientRect().right,
    scrubber: document.getElementById('time-scrubber').getBoundingClientRect().right,
    toggle: document.getElementById('panel-toggle').getBoundingClientRect().left,
  }));
  // Panel and its scrubber both off the left edge; the way back stays put.
  expect(box.panel).toBeLessThanOrEqual(1);
  expect(box.scrubber).toBeLessThanOrEqual(1);
  expect(box.toggle).toBeLessThanOrEqual(1);
  await expect(page.locator('#panel-toggle')).toHaveAttribute('aria-expanded', 'false');

  await page.click('#panel-toggle');
  await page.waitForTimeout(500);
  box = await page.evaluate(() => ({
    panel: document.getElementById('results').getBoundingClientRect().right,
  }));
  expect(box.panel).toBeGreaterThan(300);
  await expect(page.locator('#panel-toggle')).toHaveAttribute('aria-expanded', 'true');
});

test('below the breakpoint it is still the bottom sheet', async ({ page }) => {
  await search(page, MOBILE);

  await expect(page.locator('#tabs')).toBeVisible();
  // One pane at a time — which one is the preselect's call, so count instead.
  await expect(page.locator('.tab-pane:visible')).toHaveCount(1);
  await expect(page.locator('.pane-title').first()).toBeHidden();
  await expect(page.locator('#panel-toggle')).toBeHidden(); // the handle is the control here
  await expect(page.locator('.tab-pane.active .stat-val').first()).toBeHidden(); // details need expanding

  const box = await page.evaluate(() => {
    const r = (sel) => document.querySelector(sel).getBoundingClientRect();
    return { panel: r('#results'), scrubber: r('#time-scrubber'), width: window.innerWidth };
  });
  expect(box.panel.width).toBe(box.width);
  // Still floating above the sheet rather than docked inside it.
  expect(box.scrubber.bottom).toBeLessThanOrEqual(box.panel.top);
});
