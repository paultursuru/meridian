import { test, expect } from '@playwright/test';

// Reported 2026-08-06: scrubbing into the grazing-sun window made the note
// appear, which grew the *expanded* drawer under a scrubber that stayed where
// it was, so the drawer covered the control the user was still dragging.
// Collapsing and re-expanding fixed it, which is what identified the cause:
// updateScrubberPosition (ui.js) reads drawer.offsetHeight for the expanded
// case but only ran on expand/collapse and window resize, never on a content
// change. A ResizeObserver on #results now covers it.
//
// The same class of bug is reachable without the grazing note at all: the
// vegetation-failed line and the weather note both land after their background
// fetches resolve. This spec pins the invariant rather than the one trigger.

const START = '46.5197,6.6323';
const END = '46.5250,6.6400';
// 19:30 local is ~10° sun altitude (note hidden); scrubbing to 20:30 is ~2.3°
// (note shown). Both inside the scrubber's sunrise..sunset bounds.
const SEARCH_URL = `/?from=${START}&to=${END}&dt=2026-08-12T19:30`;

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
}

// Positive gap = the scrubber sits clear above the drawer's top edge.
async function gap(page) {
  return page.evaluate(() => {
    const s = document.getElementById('time-scrubber').getBoundingClientRect();
    const d = document.getElementById('results').getBoundingClientRect();
    return d.top - s.bottom;
  });
}

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`the expanded drawer never covers the scrubber when a note appears mid-scrub (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mockUpstreams(page);
    await page.goto(SEARCH_URL);

    await expect(page.locator('#time-scrubber')).toHaveClass(/on/, { timeout: 20_000 });
    await expect(page.locator('#grazing-sun-note')).not.toHaveClass(/on/);

    await page.click('#drawer-handle');
    await expect(page.locator('#results')).toHaveClass(/expanded/);
    await page.waitForTimeout(500); // let the 0.32s expand transition settle

    expect(await gap(page)).toBeGreaterThanOrEqual(0);

    // Scrub into the grazing window: this is what grows the drawer.
    await page.locator('#scrubber-range').evaluate(el => {
      el.value = String(20 * 60 + 30);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await expect(page.locator('#grazing-sun-note')).toHaveClass(/on/);
    await page.waitForTimeout(300);

    // The regression: the drawer grew and the scrubber did not follow.
    expect(await gap(page)).toBeGreaterThanOrEqual(0);
  });
}
