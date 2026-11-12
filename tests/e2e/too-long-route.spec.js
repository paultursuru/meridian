import { test, expect } from '@playwright/test';

// Two routes past what the building data can take, each on its own path:
// Mississauga -> Toronto is past the map-tile grid ceiling abroad, Lausanne ->
// Yverdon past four swissbuildings-lookup requests at home. Either way the
// search should not ask, and should not tell the visitor to try again.
const CASES = [
  {
    where: 'abroad',
    country: 'ca',
    countryName: 'Canada',
    place: 'Ontario',
    from: { name: 'mississauga', lat: 43.578, lng: -79.666 },
    to: { name: 'toronto', lat: 43.645, lng: -79.38 },
    via: { lat: 43.66, lng: -79.5 },
    source: 'tiles',
  },
  {
    where: 'in Switzerland',
    country: 'ch',
    countryName: 'Switzerland',
    place: 'Vaud',
    from: { name: 'lausanne', lat: 46.5167, lng: 6.6291 },
    to: { name: 'yverdon', lat: 46.7785, lng: 6.6411 },
    via: { lat: 46.65, lng: 6.70 },
    source: 'swisstopo',
  },
];

const routeFeature = (...points) => ({
  geometry: { type: 'LineString', coordinates: points.map(p => [p.lng, p.lat, 0]) },
  properties: { summary: { distance: 25000, duration: 18000 } },
});

async function mockUpstreams(page, { country, countryName, place, from, to, via }) {
  const requests = { buildings: 0, vegetation: 0, swissBuildings: 0 };
  const hitFor = (url) => (new URL(url).searchParams.get('q') || '').toLowerCase().includes(to.name) ? to : from;
  await page.route('https://nominatim.openstreetmap.org/search**', route => {
    const hit = hitFor(route.request().url());
    return route.fulfill({
      json: [{ lat: String(hit.lat), lon: String(hit.lng), display_name: place, address: { country_code: country } }],
    });
  });
  await page.route('https://nominatim.openstreetmap.org/reverse**', route => route.fulfill({
    json: { display_name: place, address: { country_code: country } },
  }));
  await page.route('https://photon.komoot.io/**', route => {
    const hit = hitFor(route.request().url());
    return route.fulfill({ json: { features: [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [hit.lng, hit.lat] },
      properties: { name: place, country: countryName, countrycode: country.toUpperCase() },
    }] } });
  });
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({
    json: { hourly: { time: [], cloud_cover: [], temperature_2m: [] } },
  }));
  await page.route('**/api/route**', route => route.fulfill({ json: { features: [
    routeFeature(from, to),
    routeFeature(from, via, to),
  ] } }));
  await page.route('**/api/overpass**', route => {
    const isBuildings = decodeURIComponent(route.request().postData() || '').includes('"building"');
    requests[isBuildings ? 'buildings' : 'vegetation']++;
    return route.fulfill({ json: { elements: [] } });
  });
  await page.route('**/api/buildings**', route => {
    requests.swissBuildings++;
    return route.fulfill({ status: 400, json: { error: 'bbox too large' } });
  });
  await page.route('https://tiles.stadiamaps.com/**', route =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  return requests;
}

// Umami never loads here, so stand one up before the app's module runs.
async function collectEvents(page) {
  await page.addInitScript(() => {
    window.__events = [];
    window.umami = { track: (name, props) => window.__events.push([name, props]) };
  });
}
const searchEvents = (page) => page.evaluate(() => window.__events.filter(([name]) => name === 'search').map(([, props]) => props));

async function expectRoutesWithoutBuildingShade(page, requests, source) {
  const note = page.locator('#quality-note');
  // Well under the 12s the Overpass budget would have cost.
  await expect(note).toContainText('too long', { timeout: 5000 });
  await expect(note).toHaveClass(/warn/);
  await expect(note).not.toContainText('try again');
  await expect(page.locator('#results')).toHaveClass(/on/);
  await expect(page.locator('#results')).toHaveClass(/data-failed/);
  await expect.poll(() => searchEvents(page)).toEqual([
    expect.objectContaining({ status: 'failed', cause: 'too_long', source, buildings: 0 }),
  ]);
  expect(requests.buildings).toBe(0);
  expect(requests.swissBuildings).toBe(0);
  // The verdict only covers buildings: trees are still asked for.
  expect(requests.vegetation).toBeGreaterThan(0);
}

for (const c of CASES) {
  test(`a shared link to a route too long ${c.where} skips the building lookup and says why`, async ({ page }) => {
    const requests = await mockUpstreams(page, c);
    await collectEvents(page);
    await page.goto(`/en/?from=${c.from.lat},${c.from.lng}&to=${c.to.lat},${c.to.lng}&dt=2026-07-28T14:00`);
    await expectRoutesWithoutBuildingShade(page, requests, c.source);
  });

  test(`a typed route too long ${c.where} skips the building lookup and says why`, async ({ page }) => {
    const requests = await mockUpstreams(page, c);
    await collectEvents(page);
    await page.goto('/en/');
    await page.fill('#inp-start', c.from.name);
    await page.fill('#inp-end', c.to.name);
    // A daytime departure, whenever this runs: at night no buildings are asked for.
    await page.click('#depart-toggle');
    await page.fill('#inp-date', '2026-07-28');
    await page.fill('#inp-time', '14:00');
    await page.click('#depart-confirm');
    await expectRoutesWithoutBuildingShade(page, requests, c.source);
  });
}
