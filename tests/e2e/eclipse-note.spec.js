import { test, expect } from '@playwright/test';

// The 2026-08-12 partial eclipse (sun.js#ECLIPSE_2026). The shade model is
// blind to it — the geometry is unchanged, so the scores are unchanged — and
// what these specs pin is that the app says so, on the right evening, in the
// right country, and nowhere else.

const START = '46.5197,6.6323';
const END = '46.5250,6.6400';

async function mockUpstreams(page, { countryCode = 'ch' } = {}) {
  await page.route('https://nominatim.openstreetmap.org/**', route => route.fulfill({
    json: { display_name: 'Lausanne', address: { country_code: countryCode } },
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

async function search(page, dt, opts) {
  await mockUpstreams(page, opts);
  await page.goto(`/?from=${START}&to=${END}&dt=${dt}`);
  await expect(page.locator('#time-scrubber')).toHaveClass(/on/, { timeout: 20_000 });
}

test('the note appears during the eclipse window on a Swiss route', async ({ page }) => {
  await search(page, '2026-08-12T20:00');
  await expect(page.locator('#eclipse-note')).toHaveClass(/on/);
});

test('the note stays hidden earlier the same day, and comes in on scrub', async ({ page }) => {
  await search(page, '2026-08-12T15:00');
  await expect(page.locator('#eclipse-note')).not.toHaveClass(/on/);

  await page.locator('#scrubber-range').evaluate(el => {
    el.value = String(20 * 60 + 10);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#eclipse-note')).toHaveClass(/on/);
});

test('the eclipse note replaces the grazing-sun note rather than stacking with it', async ({ page }) => {
  // 20:10 local is ~4° in Lausanne, i.e. under GRAZING_SUN_DEG: without the
  // precedence rule both notes would show at once and say "trust this less"
  // twice over.
  await search(page, '2026-08-12T20:10');
  await expect(page.locator('#eclipse-note')).toHaveClass(/on/);
  await expect(page.locator('#grazing-sun-note')).not.toHaveClass(/on/);
});

test('nothing shows on the following day', async ({ page }) => {
  await search(page, '2026-08-13T20:00');
  await expect(page.locator('#eclipse-note')).not.toHaveClass(/on/);
  await expect(page.locator('#scrubber-mark')).not.toHaveClass(/on/);
});

test('nothing shows outside Switzerland, where the swisstopo path is off too', async ({ page }) => {
  await search(page, '2026-08-12T20:00', { countryCode: 'fr' });
  await expect(page.locator('#eclipse-note')).not.toHaveClass(/on/);
  await expect(page.locator('#scrubber-mark')).not.toHaveClass(/on/);
});

test('clicking the marker scrubs to the maximum and brings the note with it', async ({ page }) => {
  await search(page, '2026-08-12T15:00');
  await expect(page.locator('#eclipse-note')).not.toHaveClass(/on/);

  await page.locator('#scrubber-mark').click();

  // The whole render path must run, not just the range's value: label, note,
  // and the share URL the drawer rewrites on every render.
  await expect(page.locator('#scrubber-time')).toHaveText('20:15');
  await expect(page.locator('#eclipse-note')).toHaveClass(/on/);
  expect(await page.locator('#scrubber-range').inputValue()).toBe(String(20 * 60 + 15));
  await expect(page).toHaveURL(/dt=2026-08-12T20%3A15/);
});

test('a marker click reports eclipse_jump once, and never as a scrub', async ({ page }) => {
  await mockUpstreams(page);
  // Umami is a third-party script that never loads here, so stand one up
  // before the app's own module runs and collect what it's asked to send.
  await page.addInitScript(() => {
    window.__events = [];
    window.umami = { track: (name, props) => window.__events.push([name, props]) };
  });
  await page.goto(`/?from=${START}&to=${END}&dt=2026-08-12T15:00`);
  await expect(page.locator('#time-scrubber')).toHaveClass(/on/, { timeout: 20_000 });

  await page.locator('#scrubber-mark').click();
  await expect(page.locator('#scrubber-time')).toHaveText('20:15');
  await page.locator('#scrubber-mark').click();
  await expect(page.locator('#scrubber-time')).toHaveText('20:15');

  const events = await page.evaluate(() => window.__events);
  // One per search however many clicks, and however many frames each travel
  // takes: the travel drives the same callback ~36 times.
  expect(events.filter(([n]) => n === 'eclipse_jump')).toHaveLength(1);
  expect(events.filter(([n]) => n === 'scrub')).toHaveLength(0);
  expect(events.find(([n]) => n === 'search')?.[1]).toMatchObject({ eclipse: true });

  // A genuine drag still counts as one, alongside the jump.
  await page.locator('#scrubber-range').evaluate(el => {
    el.value = String(18 * 60);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(await page.evaluate(() => window.__events.filter(([n]) => n === 'scrub').length)).toBe(1);
});

test('the search event carries eclipse:false on any other day', async ({ page }) => {
  await mockUpstreams(page);
  await page.addInitScript(() => {
    window.__events = [];
    window.umami = { track: (name, props) => window.__events.push([name, props]) };
  });
  await page.goto(`/?from=${START}&to=${END}&dt=2026-08-13T15:00`);
  await expect(page.locator('#time-scrubber')).toHaveClass(/on/, { timeout: 20_000 });

  await expect.poll(() => page.evaluate(
    () => window.__events.find(([n]) => n === 'search')?.[1]?.eclipse,
  )).toBe(false);
});

test('the marker spins on click, and can spin again', async ({ page }) => {
  await search(page, '2026-08-12T15:00');
  const mark = page.locator('#scrubber-mark');

  await mark.click();
  await expect(mark).toHaveClass(/spin/);
  // Cleared on animationend, otherwise a second click would be a no-op.
  await expect(mark).not.toHaveClass(/spin/, { timeout: 5000 });

  await mark.click();
  await expect(mark).toHaveClass(/spin/);
});

test('the scrubber marker lands on the minute it claims, not on the track edge', async ({ page }) => {
  await search(page, '2026-08-12T19:00');
  await expect(page.locator('#scrubber-mark')).toHaveClass(/on/);

  // Ground truth for "where is 20:15 on this track" is where the thumb stops
  // when the range is set to it, thumb inset included.
  const offBy = await page.evaluate(() => {
    const mark = document.getElementById('scrubber-mark').getBoundingClientRect();
    const range = document.getElementById('scrubber-range');
    const rr = range.getBoundingClientRect();
    const frac = (20 * 60 + 15 - Number(range.min)) / (Number(range.max) - Number(range.min));
    return Math.abs((mark.left + mark.width / 2) - (rr.left + 8 + (rr.width - 16) * frac));
  });
  expect(offBy).toBeLessThan(2);
});
