import { test, expect } from '@playwright/test';

// The "what do I do?" button on the empty app opens a demo: a real search from
// Lausanne station to the Olympic Museum at a fixed summer afternoon, with the
// date popover open to show that date and a note under it to explain the
// result. The demo is a share link plus onboarding=1, so it can also be landed
// on. Back from it returns to the empty app; touching a field leaves it the
// same way, without leaving a history entry behind to spend a Back on.

const BEFORE = '/before-the-app';
const LEFT_THE_APP = /\/before-the-app$/;
const SHARED_URL = '/?from=46.5197,6.6323&to=46.5250,6.6400&dt=2026-08-13T14:00';

test.use({ viewport: { width: 390, height: 844 } });

const hitFor = q => (/ouchy/i.test(q) ? { lat: 46.5250, lng: 6.6400 } : { lat: 46.5197, lng: 6.6323 });

async function mockUpstreams(page) {
  await page.route(`**${BEFORE}`, route => route.fulfill({ contentType: 'text/html', body: '<title>before</title>' }));
  await page.route('https://nominatim.openstreetmap.org/search**', route => {
    const q = new URL(route.request().url()).searchParams.get('q') || '';
    const hit = hitFor(q);
    return route.fulfill({
      json: [{ lat: String(hit.lat), lon: String(hit.lng), display_name: q, address: { country_code: 'ch' } }],
    });
  });
  await page.route('https://nominatim.openstreetmap.org/reverse**', route => route.fulfill({
    json: { display_name: 'Lausanne, Suisse', address: { country_code: 'ch' } },
  }));
  await page.route('https://photon.komoot.io/**', route => route.fulfill({ json: { features: [] } }));
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({
    json: { hourly: { time: [], cloud_cover: [], temperature_2m: [] } },
  }));
  await page.route('https://ors-proxy.meridianway.workers.dev/**', route => route.fulfill({ json: { features: [
    {
      geometry: { type: 'LineString', coordinates: [[6.6291, 46.5167, 400], [6.6300, 46.5120, 400], [6.6339, 46.5086, 400]] },
      properties: { summary: { distance: 1500, duration: 1140 } },
    },
    {
      geometry: { type: 'LineString', coordinates: [[6.6291, 46.5167, 400], [6.6330, 46.5140, 400], [6.6339, 46.5086, 400]] },
      properties: { summary: { distance: 1500, duration: 1140 } },
    },
  ] } }));
  await page.route('https://overpass-cache.meridianway.workers.dev/**', route => route.fulfill({ json: { elements: [] } }));
  await page.route('https://swissbuildings-lookup.meridianway.workers.dev/**', route => route.fulfill({
    json: { buildings: [] },
  }));
  await page.route('https://tiles.stadiamaps.com/**', route => route.fulfill({
    json: { version: 8, sources: {}, layers: [] },
  }));
}

// Umami never loads here, so stand one up before the app's module runs.
async function collectEvents(page) {
  await page.addInitScript(() => {
    window.__events = [];
    window.umami = { track: (name, props) => window.__events.push([name, props]) };
  });
}
const events = (page, name) => page.evaluate(n => window.__events.filter(([e]) => e === n).map(([, p]) => p), name);

async function openApp(page, path = '/') {
  await mockUpstreams(page);
  await collectEvents(page);
  await page.goto(BEFORE);
  await page.goto(path);
  await page.waitForSelector('#inp-end[role="combobox"]');
}

async function openDemo(page) {
  await page.click('#onboarding-btn');
  await expect(page.locator('#results')).toHaveClass(/on/, { timeout: 20_000 });
}

async function expectEmptyApp(page) {
  await expect(page.locator('#results')).not.toHaveClass(/on/);
  await expect(page.locator('#inp-start')).toHaveValue('');
  await expect(page.locator('#inp-end')).toHaveValue('');
  await expect(page.locator('#onboarding-note')).toBeHidden();
  await expect(page.locator('#depart-popover')).toBeHidden();
  await expect(page.locator('#onboarding-btn')).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
}

test('the empty app offers the demo, above the map attribution', async ({ page }) => {
  await openApp(page);
  const btn = page.locator('#onboarding-btn');
  await expect(btn).toBeVisible();
  const [b, a] = await Promise.all([btn.boundingBox(), page.locator('.leaflet-control-attribution').boundingBox()]);
  expect(b.y + b.height).toBeLessThanOrEqual(a.y);
});

test('a shared link shows results, not the demo button', async ({ page }) => {
  await openApp(page, SHARED_URL);
  await expect(page.locator('#results')).toHaveClass(/on/, { timeout: 20_000 });
  await expect(page.locator('#onboarding-btn')).toBeHidden();
});

test('the button opens the demo: a real search, its date shown, its note, a URL that reopens it', async ({ page }) => {
  await openApp(page);
  await openDemo(page);

  await expect(page.locator('#inp-start')).toHaveValue('Lausanne-Gare');
  await expect(page.locator('#inp-end')).toHaveValue('Musée Olympique, Lausanne');
  await expect(page.locator('#depart-popover')).toBeVisible();
  await expect(page.locator('#inp-date')).toHaveValue('2026-07-15');
  await expect(page.locator('#inp-time')).toHaveValue('15:00');
  await expect(page.locator('#onboarding-note')).toBeVisible();
  await expect(page.locator('#app-description')).toHaveClass(/hidden/);
  await expect(page.locator('#onboarding-btn')).toBeHidden();

  const params = new URL(page.url()).searchParams;
  expect(params.get('onboarding')).toBe('1');
  expect(params.get('dt')).toBe('2026-07-15T15:00');

  expect(await events(page, 'onboarding')).toEqual([{ via: 'button' }]);
  await expect.poll(() => events(page, 'search')).toHaveLength(1);
  expect((await events(page, 'search'))[0].onboarding).toBe(true);
});

test('the demo is fitted below the popover and its note', async ({ page }) => {
  await openApp(page);
  await openDemo(page);
  await page.waitForTimeout(500);

  const stack = await page.locator('#depart-overlays').boundingBox();
  for (const pin of ['.map-pin.start', '.map-pin.end']) {
    expect((await page.locator(pin).boundingBox()).y).toBeGreaterThanOrEqual(stack.y + stack.height);
  }
});

test('closing the popover keeps the note, moved up under the button', async ({ page }) => {
  await openApp(page);
  await openDemo(page);
  const before = await page.locator('#onboarding-note').boundingBox();

  await page.keyboard.press('Escape');
  await expect(page.locator('#depart-popover')).toBeHidden();
  await expect(page.locator('#onboarding-note')).toBeVisible();
  expect((await page.locator('#onboarding-note').boundingBox()).y).toBeLessThan(before.y);
});

test('Back from the demo returns to the empty app, and the next Back leaves', async ({ page }) => {
  await openApp(page);
  await openDemo(page);

  await page.goBack();
  await expectEmptyApp(page);

  await page.goBack();
  await expect(page).toHaveURL(LEFT_THE_APP);
});

test('touching a field leaves the demo, with no Back to spend on it', async ({ page }) => {
  await openApp(page);
  await openDemo(page);

  await page.focus('#inp-start');
  await expectEmptyApp(page);
  // That was not a Back gesture.
  expect(await events(page, 'back_reset')).toEqual([]);

  await page.goBack();
  await expect(page).toHaveURL(LEFT_THE_APP);
});

test('a link with onboarding=1 opens the demo, and a field leaves it in place', async ({ page }) => {
  await openApp(page);
  const href = await page.locator('#onboarding-btn').getAttribute('href');

  await page.goto(href);
  await expect(page.locator('#results')).toHaveClass(/on/, { timeout: 20_000 });
  await expect(page.locator('#onboarding-note')).toBeVisible();
  await expect(page.locator('#depart-popover')).toBeVisible();
  expect(await events(page, 'onboarding')).toEqual([{ via: 'link' }]);

  // Landed on, so there is no empty app underneath: the entry becomes one.
  await page.focus('#inp-end');
  await expectEmptyApp(page);
});

test('a search of your own after the demo is not marked as the demo', async ({ page }) => {
  await openApp(page);
  await openDemo(page);
  await expect.poll(() => events(page, 'search')).toHaveLength(1);

  await page.focus('#inp-start');
  await page.fill('#inp-start', 'Gare de Lausanne');
  await page.fill('#inp-end', 'Ouchy');
  await page.press('#inp-end', 'Enter');
  await expect(page.locator('#results')).toHaveClass(/on/, { timeout: 20_000 });

  await expect.poll(() => events(page, 'search')).toHaveLength(2);
  expect((await events(page, 'search'))[1].onboarding).toBeUndefined();
  expect(new URL(page.url()).searchParams.has('onboarding')).toBe(false);
  await expect(page.locator('#onboarding-note')).toBeHidden();
});
