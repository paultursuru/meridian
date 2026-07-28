import { test, expect } from '@playwright/test';

// §2 step 3: buildings used to block on Promise.all([buildings, vegetation]),
// so a slow/failing Overpass vegetation call delayed the whole drawer even
// though buildings alone are enough to render. These verify the drawer
// renders from buildings before vegetation resolves, and that the note
// correctly upgrades from its optimistic first pass once vegetation's real
// status is known.

const START = '48.8738,2.2950';
const END = '48.8606,2.3376';
const SEARCH_URL = `/en/?from=${START}&to=${END}&dt=2026-07-28T14:00`;
const VEG_DELAY_MS = 4000;

const BUILDINGS_ELEMENTS = [
  { type: 'node', id: 1, lat: 48.8700, lon: 2.2960 }, { type: 'node', id: 2, lat: 48.8701, lon: 2.2960 },
  { type: 'node', id: 3, lat: 48.8701, lon: 2.2961 }, { type: 'node', id: 4, lat: 48.8700, lon: 2.2961 },
  { type: 'way', id: 101, nodes: [1, 2, 3, 4], tags: { building: 'yes', height: '18' } },
];

async function mockCommon(page) {
  await page.route('https://nominatim.openstreetmap.org/**', route => route.fulfill({
    json: { display_name: 'Paris, France', address: { country_code: 'fr' } },
  }));
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({
    json: { hourly: { time: [], cloud_cover: [], temperature_2m: [] } },
  }));
  await page.route('https://ors-proxy.meridianway.workers.dev/**', route => route.fulfill({
    json: { features: [{
      geometry: { type: 'LineString', coordinates: [[2.2950, 48.8738, 0], [2.32, 48.865, 0], [2.3376, 48.8606, 0]] },
      properties: { summary: { distance: 2200, duration: 1800 } },
    }] },
  }));
}

test('drawer renders from buildings before slow vegetation resolves', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await mockCommon(page);
  await page.route('https://overpass-cache.meridianway.workers.dev/**', async route => {
    const isBuildingsQuery = decodeURIComponent(route.request().postData() || '').includes('"building"');
    if (isBuildingsQuery) return route.fulfill({ json: { elements: BUILDINGS_ELEMENTS } });
    // Vegetation: deliberately slow — exactly what step 3 must no longer
    // block the first render on.
    await new Promise(r => setTimeout(r, VEG_DELAY_MS));
    return route.fulfill({ json: { elements: [] } });
  });

  await page.goto(SEARCH_URL);

  // Buildings-only render should land well before the vegetation delay ends.
  await expect(page.locator('#results')).toHaveClass(/on/, { timeout: VEG_DELAY_MS - 1000 });
  await expect(page.locator('#tab-sunny')).toBeVisible();
  // Moved onto the first render per step 3 — should already be usable here.
  await expect(page.locator('#time-scrubber')).toHaveClass(/on/);

  // renderAt -> displayRoutes redraws both route polylines at full opacity
  // (map.js); setActiveRoute is what dims the non-active one back down.
  // Right after the first render this should already hold...
  const sunnyPath = page.locator('#map path.leaflet-interactive').first();
  await expect(sunnyPath).toHaveCSS('stroke-opacity', '1');

  // ...and must *still* hold once vegetation's re-render redraws the map a
  // second time — the exact regression risk of adding a renderAt() call
  // without re-applying setActiveTab/setActiveRoute afterward.
  await page.waitForTimeout(VEG_DELAY_MS + 500);
  await expect(page.locator('#results')).toHaveClass(/on/);
  await expect(sunnyPath).toHaveCSS('stroke-opacity', '1');

  expect(errors).toEqual([]);
});

test('note upgrades from the optimistic first pass once vegetation actually fails', async ({ page }) => {
  await mockCommon(page);
  await page.route('https://overpass-cache.meridianway.workers.dev/**', route => {
    const isBuildingsQuery = decodeURIComponent(route.request().postData() || '').includes('"building"');
    if (isBuildingsQuery) return route.fulfill({ json: { elements: BUILDINGS_ELEMENTS } });
    return route.fulfill({ status: 504, body: 'upstream error' });
  });

  await page.goto(SEARCH_URL);

  const note = page.locator('#quality-note');
  // First pass: buildings ok, vegetation status still optimistically 'ok' —
  // the normal coverage note, not the vegetation-failed one, and not warn.
  await expect(note).toHaveClass(/on/);
  await expect(note).not.toHaveClass(/warn/);
  await expect(note).not.toContainText('Tree data unavailable');

  // Once the background vegetation fetch's own retry ladder gives up, the
  // note must upgrade to the 'partial' state.
  await expect(note).toContainText('Tree data unavailable', { timeout: 10_000 });
  await expect(note).not.toHaveClass(/warn/); // 'partial' is informational, not a warning
});
