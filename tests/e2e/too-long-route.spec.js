import { test, expect } from '@playwright/test';

// Mississauga -> Toronto: past the grid ceiling, even on a straight line. That
// whole bbox is too heavy to be worth fetching, so the search should not ask,
// and should not tell the visitor to try again.
const MISSISSAUGA = { lat: 43.578, lng: -79.666 };
const TORONTO = { lat: 43.645, lng: -79.38 };
const routeFeature = (...points) => ({
  geometry: { type: 'LineString', coordinates: points.map(p => [p.lng, p.lat, 0]) },
  properties: { summary: { distance: 25000, duration: 18000 } },
});

async function mockUpstreams(page) {
  const overpassRequests = { buildings: 0, vegetation: 0 };
  const hitFor = (url) => (new URL(url).searchParams.get('q') || '').toLowerCase().includes('toronto') ? TORONTO : MISSISSAUGA;
  await page.route('https://nominatim.openstreetmap.org/search**', route => {
    const hit = hitFor(route.request().url());
    return route.fulfill({
      json: [{ lat: String(hit.lat), lon: String(hit.lng), display_name: 'Ontario', address: { country_code: 'ca' } }],
    });
  });
  await page.route('https://nominatim.openstreetmap.org/reverse**', route => route.fulfill({
    json: { display_name: 'Ontario', address: { country_code: 'ca' } },
  }));
  await page.route('https://photon.komoot.io/**', route => {
    const hit = hitFor(route.request().url());
    return route.fulfill({ json: { features: [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [hit.lng, hit.lat] },
      properties: { name: 'Ontario', country: 'Canada', countrycode: 'CA' },
    }] } });
  });
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({
    json: { hourly: { time: [], cloud_cover: [], temperature_2m: [] } },
  }));
  await page.route('**/api/route**', route => route.fulfill({ json: { features: [
    routeFeature(MISSISSAUGA, TORONTO),
    routeFeature(MISSISSAUGA, { lat: 43.66, lng: -79.5 }, TORONTO),
  ] } }));
  await page.route('**/api/overpass**', route => {
    const isBuildings = decodeURIComponent(route.request().postData() || '').includes('"building"');
    overpassRequests[isBuildings ? 'buildings' : 'vegetation']++;
    return route.fulfill({ json: { elements: [] } });
  });
  await page.route('https://tiles.stadiamaps.com/**', route =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  return overpassRequests;
}

// Umami never loads here, so stand one up before the app's module runs.
async function collectEvents(page) {
  await page.addInitScript(() => {
    window.__events = [];
    window.umami = { track: (name, props) => window.__events.push([name, props]) };
  });
}
const searchEvents = (page) => page.evaluate(() => window.__events.filter(([name]) => name === 'search').map(([, props]) => props));

async function expectRoutesWithoutBuildingShade(page, overpassRequests) {
  const note = page.locator('#quality-note');
  // Well under the 12s the Overpass budget would have cost.
  await expect(note).toContainText('too long', { timeout: 5000 });
  await expect(note).toHaveClass(/warn/);
  await expect(note).not.toContainText('try again');
  await expect(page.locator('#results')).toHaveClass(/on/);
  await expect(page.locator('#results')).toHaveClass(/data-failed/);
  await expect.poll(() => searchEvents(page)).toEqual([
    expect.objectContaining({ status: 'failed', cause: 'too_long', source: 'tiles', buildings: 0 }),
  ]);
  expect(overpassRequests.buildings).toBe(0);
  // The verdict only covers buildings: trees are still asked for.
  expect(overpassRequests.vegetation).toBeGreaterThan(0);
}

test('a shared link to a route too long for the grid skips Overpass and says why', async ({ page }) => {
  const overpassRequests = await mockUpstreams(page);
  await collectEvents(page);
  await page.goto(`/en/?from=${MISSISSAUGA.lat},${MISSISSAUGA.lng}&to=${TORONTO.lat},${TORONTO.lng}&dt=2026-07-28T14:00`);
  await expectRoutesWithoutBuildingShade(page, overpassRequests);
});

test('a typed route too long for the grid skips Overpass and says why', async ({ page }) => {
  const overpassRequests = await mockUpstreams(page);
  await collectEvents(page);
  await page.goto('/en/');
  await page.fill('#inp-start', 'mississauga');
  await page.fill('#inp-end', 'toronto');
  // A daytime departure, whenever this runs: at night no buildings are asked for.
  await page.click('#depart-toggle');
  await page.fill('#inp-date', '2026-07-28');
  await page.fill('#inp-time', '14:00');
  await page.click('#depart-confirm');
  await expectRoutesWithoutBuildingShade(page, overpassRequests);
});
