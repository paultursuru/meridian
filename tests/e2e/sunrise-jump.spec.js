import { test, expect } from '@playwright/test';

// A night search has no sun/shade split to offer, so the note's button is the
// only way out of it. These specs pin that both halves of that funnel are
// reported: the impression when the note reaches the screen, and the click.

const START = '46.5197,6.6323';
const END = '46.5250,6.6400';
const NIGHT = '2026-08-12T23:00';
const DAY = '2026-08-12T15:00';

async function mockUpstreams(page) {
  await page.route('https://nominatim.openstreetmap.org/**', route => route.fulfill({
    json: { display_name: 'Lausanne', address: { country_code: 'ch' } },
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

// Umami is a third-party script that never loads here, so stand one up before
// the app's own module runs and collect what it's asked to send.
async function collectEvents(page) {
  await page.addInitScript(() => {
    window.__events = [];
    window.umami = { track: (name, props) => window.__events.push([name, props]) };
  });
}

const stages = page => page.evaluate(() => window.__events
  .filter(([n]) => n === 'sunrise_jump')
  .map(([, p]) => p?.stage));

async function search(page, dt) {
  await mockUpstreams(page);
  await collectEvents(page);
  await page.goto(`/?from=${START}&to=${END}&dt=${dt}`);
}

test('a night search reports one impression', async ({ page }) => {
  await search(page, NIGHT);
  await expect(page.locator('#night-note')).toHaveClass(/on/, { timeout: 20_000 });

  await expect.poll(() => stages(page)).toEqual(['shown']);
  // The note replaces the tabs rather than sitting alongside them.
  await expect(page.locator('#tabs')).toBeHidden();
});

test('a daytime search reports nothing', async ({ page }) => {
  await search(page, DAY);
  await expect(page.locator('#time-scrubber')).toHaveClass(/on/, { timeout: 20_000 });

  await expect(page.locator('#night-note')).not.toHaveClass(/on/);
  expect(await stages(page)).toEqual([]);
});

test('clicking the button reports the click and lands on a daytime search', async ({ page }) => {
  await search(page, NIGHT);
  await expect(page.locator('#night-note')).toHaveClass(/on/, { timeout: 20_000 });

  await page.locator('#night-sunrise-btn').click();

  // The button jumps to the next sunrise, which is by construction no longer
  // night: the note goes away and the scrubber takes over.
  await expect(page.locator('#time-scrubber')).toHaveClass(/on/, { timeout: 20_000 });
  await expect(page.locator('#night-note')).not.toHaveClass(/on/);
  await expect(page).toHaveURL(/dt=2026-08-13T0/);

  // The search it triggers is a daytime one, so it must not add a second
  // impression on top of the click.
  await expect.poll(() => stages(page)).toEqual(['shown', 'clicked']);
});

test('a double tap on the button counts once', async ({ page }) => {
  await search(page, NIGHT);
  await expect(page.locator('#night-note')).toHaveClass(/on/, { timeout: 20_000 });

  // Both clicks land in the same task, before the search they trigger has had
  // a chance to hide the button — which is exactly what a fat-fingered double
  // tap does, and what the guard is there for.
  await page.locator('#night-sunrise-btn').evaluate(el => { el.click(); el.click(); });

  await expect(page.locator('#time-scrubber')).toHaveClass(/on/, { timeout: 20_000 });
  expect((await stages(page)).filter(s => s === 'clicked')).toHaveLength(1);
});

test('the search event still marks the night search as single', async ({ page }) => {
  await search(page, NIGHT);
  await expect(page.locator('#night-note')).toHaveClass(/on/, { timeout: 20_000 });

  await expect.poll(() => page.evaluate(
    () => window.__events.find(([n]) => n === 'search')?.[1],
  )).toMatchObject({ night: true, single: true });
});
