import { test, expect } from '@playwright/test';

// Review #2 §3.1 + §3.2: the time scrubber re-scores routes and redraws the
// map on every drag tick, but used to leave the header ("Altitude/Azimut")
// and the share URL (`dt=`) frozen at the originally-searched time — so a
// scrubbed screen and a shared/reloaded link silently disagreed with each
// other. This is the e2e follow-up review #2's own §9.1 flagged as still
// missing ("not §3.1/§3.2 — those remain open follow-ups").

const START = '48.8738,2.2950';
const END = '48.8606,2.3376';
const SEARCH_URL = `/en/?from=${START}&to=${END}&dt=2026-07-28T14:00`;

async function mockUpstreams(page) {
  await page.route('https://nominatim.openstreetmap.org/**', route => route.fulfill({
    json: { display_name: 'Paris, France', address: { country_code: 'fr' } },
  }));
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({
    json: { hourly: { time: [], cloud_cover: [], temperature_2m: [] } },
  }));
  await page.route('https://ors-proxy.meridianway.workers.dev/**', route => route.fulfill({
    // Two distinct-enough geometries so dedupeRoutes' 0.9 overlap filter
    // keeps both and the scrubber isn't gated on a single-route search.
    json: { features: [
      {
        geometry: { type: 'LineString', coordinates: [[2.2950, 48.8738, 0], [2.3100, 48.8680, 0], [2.3376, 48.8606, 0]] },
        properties: { summary: { distance: 2200, duration: 1800 } },
      },
      {
        geometry: { type: 'LineString', coordinates: [[2.2950, 48.8738, 0], [2.3000, 48.8620, 0], [2.3376, 48.8606, 0]] },
        properties: { summary: { distance: 2400, duration: 1900 } },
      },
    ] },
  }));
  await page.route('https://overpass-cache.meridianway.workers.dev/**', route => route.fulfill({
    json: { elements: [] },
  }));
}

test('scrubbing updates the sun-info header and the share URL, not just the map', async ({ page }) => {
  await mockUpstreams(page);
  await page.goto(SEARCH_URL);

  await expect(page.locator('#time-scrubber')).toHaveClass(/on/, { timeout: 20_000 });

  const technicalLine = page.locator('#sun-info .sun-info-line').nth(2);
  const before = await technicalLine.textContent();
  const urlBefore = page.url();
  expect(urlBefore).toContain('dt=2026-07-28T14');

  const range = page.locator('#scrubber-range');
  const scrubTo = await range.evaluate(el => Number(el.min)); // sunrise end of the bounded range: guaranteed != 14:00
  await range.evaluate((el, val) => {
    el.value = String(val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, scrubTo);

  // §3.2: the header must track the scrubbed instant, not the one originally searched.
  await expect(technicalLine).not.toHaveText(before ?? '');

  // §3.1: the share URL must carry the scrubbed time, so sharing after
  // dragging reproduces what's actually on screen instead of the search time.
  const hh = String(Math.floor(scrubTo / 60)).padStart(2, '0');
  const mm = String(scrubTo % 60).padStart(2, '0');
  await expect(page).toHaveURL(new RegExp(`dt=2026-07-28T${hh}%3A${mm}`));
  expect(page.url()).not.toBe(urlBefore);
});
