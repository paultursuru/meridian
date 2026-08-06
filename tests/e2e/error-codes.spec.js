import { test, expect } from '@playwright/test';

// Every user-facing error must reach the Umami event with a code rather than
// 'unknown'. Both ends are asserted: the toast and the payload.

const LAUSANNE = { lat: 46.5171, lng: 6.6331 };
const RENENS = { lat: 46.5373, lng: 6.5853 };

// Spy on window.umami and block the real script so it cannot overwrite the
// spy. What is under test is our call sites, not Umami's delivery.
async function captureEvents(page) {
  await page.addInitScript(() => {
    window.__events = [];
    window.umami = { track: (name, data) => window.__events.push({ name, data }) };
  });
  await page.route('https://cloud.umami.is/**', route => route.abort());
}

function eventsOfType(page, name) {
  return page.evaluate(n => window.__events.filter(e => e.name === n), name);
}

async function mockUpstreams(page, { orsStatus = 200, orsFeatures, unknownQuery = null, reverseEmpty = false } = {}) {
  await page.route('https://nominatim.openstreetmap.org/search**', route => {
    const q = (new URL(route.request().url()).searchParams.get('q') || '').toLowerCase();
    if (unknownQuery && q.includes(unknownQuery)) return route.fulfill({ json: [] });
    const hit = q.includes('renens') ? RENENS : LAUSANNE;
    return route.fulfill({
      json: [{ lat: String(hit.lat), lon: String(hit.lng), display_name: q, address: { country_code: 'ch' } }],
    });
  });
  await page.route('https://nominatim.openstreetmap.org/reverse**', route => route.fulfill({
    json: reverseEmpty ? {} : {
      display_name: 'Place de la Riponne, Lausanne',
      address: { road: 'Place de la Riponne', city: 'Lausanne', country: 'Suisse', country_code: 'ch' },
    },
  }));
  await page.route('https://photon.komoot.io/**', route => route.fulfill({ json: { features: [] } }));
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({
    json: { hourly: { time: [], cloud_cover: [], temperature_2m: [] } },
  }));
  await page.route('https://ors-proxy.meridianway.workers.dev/**', route => {
    if (orsStatus !== 200) return route.fulfill({ status: orsStatus, json: { error: { message: 'upstream' } } });
    return route.fulfill({ json: { features: orsFeatures ?? [{
      geometry: { type: 'LineString', coordinates: [[LAUSANNE.lng, LAUSANNE.lat, 0], [RENENS.lng, RENENS.lat, 0]] },
      properties: { summary: { distance: 2400, duration: 1900 } },
    }] } });
  });
  await page.route('https://swissbuildings-lookup.meridianway.workers.dev/**', route => route.fulfill({ json: { buildings: [] } }));
  await page.route('https://overpass-cache.meridianway.workers.dev/**', route => route.fulfill({ json: { elements: [] } }));
}

async function waitForApp(page) {
  await page.waitForSelector('#inp-start[role="combobox"]');
  await page.waitForSelector('#inp-end[role="combobox"]');
}

async function search(page, from, to) {
  await page.fill('#inp-start', from);
  await page.keyboard.press('Escape');
  await page.fill('#inp-end', to);
  await page.keyboard.press('Escape');
  await page.click('#search-btn');
}

test('an unknown address reports ADDRESS_NOT_FOUND and which field failed', async ({ page }) => {
  await captureEvents(page);
  await mockUpstreams(page, { unknownQuery: 'zzzz' });
  await page.goto('/en/');
  await waitForApp(page);

  await search(page, 'lausanne gare', 'zzzz');

  await expect(page.locator('#toast')).toHaveClass(/\bon\b/);
  const [ev] = await eventsOfType(page, 'search');
  expect(ev.data.code).toBe('ADDRESS_NOT_FOUND');
  expect(ev.data.field).toBe('end');
  // The typed address stays in the message, which is never sent.
  expect(JSON.stringify(ev.data)).not.toContain('zzzz');
});

test('the failing field tells origin from destination', async ({ page }) => {
  await captureEvents(page);
  await mockUpstreams(page, { unknownQuery: 'zzzz' });
  await page.goto('/en/');
  await waitForApp(page);

  await search(page, 'zzzz', 'renens');

  await expect(page.locator('#toast')).toHaveClass(/\bon\b/);
  const [ev] = await eventsOfType(page, 'search');
  expect(ev.data).toMatchObject({ code: 'ADDRESS_NOT_FOUND', field: 'start' });
});

test('the address-not-found message shows without the "Error:" prefix', async ({ page }) => {
  await captureEvents(page);
  await mockUpstreams(page, { unknownQuery: 'zzzz' });
  await page.goto('/en/');
  await waitForApp(page);

  await search(page, 'lausanne gare', 'zzzz');

  const toast = page.locator('#toast');
  await expect(toast).toHaveText(/Address not found/i);
  await expect(toast).not.toHaveText(/^Error:/i);
});

test('an empty ORS response reports NO_ROUTE', async ({ page }) => {
  await captureEvents(page);
  await mockUpstreams(page, { orsFeatures: [] });
  await page.goto('/en/');
  await waitForApp(page);

  await search(page, 'lausanne gare', 'renens');

  await expect(page.locator('#toast')).toHaveText(/No route found/i);
  const [ev] = await eventsOfType(page, 'search');
  expect(ev.data.code).toBe('NO_ROUTE');
});

test('a routing service that is down says the addresses are fine', async ({ page }) => {
  await captureEvents(page);
  await mockUpstreams(page, { orsStatus: 503 });
  await page.goto('/en/');
  await waitForApp(page);

  await search(page, 'lausanne gare', 'renens');

  const toast = page.locator('#toast');
  await expect(toast).toHaveClass(/\bon\b/, { timeout: 15_000 }); // 1s + 3s of backoff
  await expect(toast).toHaveText(/routing service is not responding/i);
  await expect(toast).not.toHaveText(/more precise addresses/i);
  const [ev] = await eventsOfType(page, 'search');
  expect(ev.data.code).toBe('ROUTING_UNAVAILABLE');
});

test.describe('geolocation', () => {
  // Playwright expects latitude/longitude, not the lat/lng shape used elsewhere.
  test.use({ geolocation: { latitude: LAUSANNE.lat, longitude: LAUSANNE.lng }, permissions: ['geolocation'] });

  test('an unrecognised point is no longer reported as a timeout', async ({ page }) => {
    await captureEvents(page);
    await mockUpstreams(page, { reverseEmpty: true });
    await page.goto('/en/');
    await waitForApp(page);

    await page.click('#geo-start');

    const toast = page.locator('#toast');
    await expect(toast).toHaveClass(/\bon\b/, { timeout: 15_000 });
    // Geolocation worked; Nominatim just has nothing at that point.
    await expect(toast).toHaveText(/Position not recognized/i);
    await expect(toast).not.toHaveText(/Location unavailable/i);

    const [ev] = await eventsOfType(page, 'geo_error');
    expect(ev.data).toMatchObject({ code: 'POSITION_UNKNOWN', source: 'field' });
  });
});
