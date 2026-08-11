import { test, expect } from '@playwright/test';

// The install banner used to appear as soon as the browser said the app was
// installable, which is on page load, before the user has seen a single route.
// 61 % of sessions saw it and 4 % of Android accepted. These pin that it now
// waits for a search to actually put results on screen, and that the
// 'prompted' event moves with it so the funnel keeps its denominator.

const START_Q = 'EPFL, Ecublens';
const END_Q = 'Renens';
const START = { lat: 46.5186, lng: 6.5680 };
const END = { lat: 46.5373, lng: 6.5853 };

async function mockUpstreams(page) {
  await page.route('https://nominatim.openstreetmap.org/search**', route => {
    const q = new URL(route.request().url()).searchParams.get('q') || '';
    const hit = q.toLowerCase().includes('renens') ? END : START;
    return route.fulfill({
      json: [{ lat: String(hit.lat), lon: String(hit.lng), display_name: q, address: { country_code: 'ch' } }],
    });
  });
  await page.route('https://photon.komoot.io/**', route => route.fulfill({ json: { features: [] } }));
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({
    json: { hourly: { time: [], cloud_cover: [], temperature_2m: [] } },
  }));
  await page.route('https://ors-proxy.meridianway.workers.dev/**', route => route.fulfill({
    json: { features: [{
      geometry: { type: 'LineString', coordinates: [[START.lng, START.lat, 400], [6.575, 46.528, 400], [END.lng, END.lat, 400]] },
      properties: { summary: { distance: 2400, duration: 1900 } },
    }] },
  }));
  await page.route('https://swissbuildings-lookup.meridianway.workers.dev/**', route => route.fulfill({ json: { buildings: [] } }));
  await page.route('https://overpass-cache.meridianway.workers.dev/**', route => route.fulfill({ json: { elements: [] } }));
}

// Umami never loads here, so stand one up before the app's module runs.
async function collectEvents(page) {
  await page.addInitScript(() => {
    window.__events = [];
    window.umami = { track: (name, props) => window.__events.push([name, props]) };
  });
}

const installEvents = page => page.evaluate(() => window.__events
  .filter(([n]) => n === 'install')
  .map(([, p]) => p?.stage));

// initAutocomplete() puts role=combobox on both fields, a reliable signal that
// the app's own script has run and its listeners are attached.
async function waitForApp(page) {
  await page.waitForSelector('#inp-start[role="combobox"]');
  await page.waitForSelector('#inp-end[role="combobox"]');
}

// Chrome only fires this on a real installable page over HTTPS, so the app's
// listener is driven directly. preventDefault() exists on a plain Event, which
// is all the handler needs of it.
const fireInstallable = page => page.evaluate(() =>
  window.dispatchEvent(new Event('beforeinstallprompt')));

test('an installable page alone does not ask: the banner waits for results', async ({ page }) => {
  await mockUpstreams(page);
  await collectEvents(page);
  await page.goto('/en/');
  await waitForApp(page);

  await fireInstallable(page);

  await expect(page.locator('#install-banner')).not.toHaveClass(/on/);
  await expect(page.locator('#install-banner')).toBeHidden();
  expect(await installEvents(page)).toEqual([]);
});

test('the banner appears once a search has put routes on screen', async ({ page }) => {
  await mockUpstreams(page);
  await collectEvents(page);
  await page.goto('/en/');
  await waitForApp(page);

  await fireInstallable(page);
  await expect(page.locator('#install-banner')).toBeHidden();

  await page.fill('#inp-start', START_Q);
  await page.keyboard.press('Escape');
  await page.fill('#inp-end', END_Q);
  await page.keyboard.press('Escape');
  await page.click('#search-btn');

  await expect(page.locator('#sunny-sun-pct')).not.toBeEmpty({ timeout: 30_000 });
  await expect(page.locator('#install-banner')).toBeVisible();
  expect(await installEvents(page)).toEqual(['prompted']);
});

test('a second search does not offer the banner again', async ({ page }) => {
  await mockUpstreams(page);
  await collectEvents(page);
  await page.goto('/en/');
  await waitForApp(page);
  await fireInstallable(page);

  await page.fill('#inp-start', START_Q);
  await page.keyboard.press('Escape');
  await page.fill('#inp-end', END_Q);
  await page.keyboard.press('Escape');
  await page.click('#search-btn');
  await expect(page.locator('#sunny-sun-pct')).not.toBeEmpty({ timeout: 30_000 });

  await page.click('#install-banner-close');
  await expect(page.locator('#install-banner')).toBeHidden();

  await page.click('#search-btn');
  await expect(page.locator('#search-btn')).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('#install-banner')).toBeHidden();
  expect(await installEvents(page)).toEqual(['prompted']);
});
