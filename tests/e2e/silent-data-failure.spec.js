import { test, expect } from '@playwright/test';

// Review #2 §1.1: a total buildings-fetch failure used to render a confident
// sun/shade split with zero disclosure (heightStats([]) === null silently
// hid the note). This is the regression test review §9.1 kept asking for —
// intercept the overpass-cache Worker, force the exact failure mode observed
// in production (504), and assert the app now warns instead of staying silent.

// Arc de Triomphe -> Louvre, Paris — the doc's own §1.1 example route.
const START = '48.8738,2.2950';
const END = '48.8606,2.3376';
const SEARCH_URL = `/en/?from=${START}&to=${END}&dt=2026-07-28T14:00`;

async function mockUpstreams(page, { buildingsStatus = 200 } = {}) {
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
  await page.route('https://overpass-cache.meridianway.workers.dev/**', route => {
    const isBuildingsQuery = decodeURIComponent(route.request().postData() || '').includes('"building"');
    if (isBuildingsQuery && buildingsStatus !== 200) {
      return route.fulfill({ status: buildingsStatus, body: 'upstream error' });
    }
    // A single real building keeps the "ok" baseline path meaningful; an
    // empty tree/forest set keeps vegetation on its own 'ok' status too.
    const body = isBuildingsQuery
      ? { elements: [
          { type: 'node', id: 1, lat: 48.8700, lon: 2.2960 }, { type: 'node', id: 2, lat: 48.8701, lon: 2.2960 },
          { type: 'node', id: 3, lat: 48.8701, lon: 2.2961 }, { type: 'node', id: 4, lat: 48.8700, lon: 2.2961 },
          { type: 'way', id: 101, nodes: [1, 2, 3, 4], tags: { building: 'yes', height: '18' } },
        ] }
      : { elements: [] };
    return route.fulfill({ json: body });
  });
}

test('buildings fetch failing (504) shows the warning note and dims the ratio, without breaking the search', async ({ page }) => {
  await mockUpstreams(page, { buildingsStatus: 504 });
  await page.goto(SEARCH_URL);

  const note = page.locator('#quality-note');
  await expect(note).toHaveClass(/warn/, { timeout: 20_000 }); // 504 retries 3x with backoff before giving up
  await expect(note).toContainText('unavailable');
  await expect(page.locator('#results')).toHaveClass(/data-failed/);
  await expect(page.locator('.tab-pane.active .ratio-track')).toHaveCSS('opacity', '0.4');
  // Not doing: refusing to show results when buildings are missing — the
  // route must still render, just with the warning on top of it.
  await expect(page.locator('#results')).toHaveClass(/on/);
});

test('a clean fetch shows the neutral coverage note, not the warning', async ({ page }) => {
  await mockUpstreams(page, { buildingsStatus: 200 });
  await page.goto(SEARCH_URL);

  const note = page.locator('#quality-note');
  await expect(note).toHaveClass(/on/);
  await expect(note).not.toHaveClass(/warn/);
  await expect(page.locator('#results')).not.toHaveClass(/data-failed/);
});
