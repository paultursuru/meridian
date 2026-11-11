import { test, expect } from '@playwright/test';

// On a phone, a result folds the search form into one line, so the map gets
// the room. The line opens the form again; an arrow folds it back.

const START = '46.5197,6.6323';
const END = '46.5250,6.6400';
const START_Q = 'Lausanne-Gare, Av. de la Gare, Lausanne';
const END_Q = 'Musée Olympique, Lausanne';
const LINK = `/?from=${START}&fromq=${encodeURIComponent(START_Q)}&to=${END}&toq=${encodeURIComponent(END_Q)}`;
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

async function mockUpstreams(page) {
  const line = (lat, lon) => [[6.6323, 46.5197, 400], [lon, lat, 400], [6.64, 46.525, 400]];
  await page.route('https://nominatim.openstreetmap.org/reverse**', route => route.fulfill({
    json: { display_name: 'Lausanne, Suisse', address: { country_code: 'ch' } },
  }));
  await page.route('https://nominatim.openstreetmap.org/search**', route => {
    const q = new URL(route.request().url()).searchParams.get('q') || '';
    const [lat, lon] = (/ouchy/i.test(q) ? END : START).split(',');
    return route.fulfill({ json: [{ lat, lon, display_name: q, address: { country_code: 'ch' } }] });
  });
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({
    json: { hourly: { time: [], cloud_cover: [], temperature_2m: [] } },
  }));
  await page.route('**/api/route**', route => route.fulfill({
    json: { features: [
      { geometry: { type: 'LineString', coordinates: line(46.522, 6.636) }, properties: { summary: { distance: 900, duration: 700 } } },
      { geometry: { type: 'LineString', coordinates: line(46.524, 6.634) }, properties: { summary: { distance: 1000, duration: 780 } } },
    ] },
  }));
  await page.route('**/api/overpass**', route => route.fulfill({ json: { elements: [] } }));
  await page.route('**/api/buildings**', route => route.fulfill({ json: { buildings: [] } }));
  await page.route('https://tiles.stadiamaps.com/**', route => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  await page.route('https://photon.komoot.io/**', route => route.fulfill({ json: { features: [{
    geometry: { type: 'Point', coordinates: [6.6264, 46.5076] },
    properties: { name: 'Ouchy', city: 'Lausanne', countrycode: 'CH', country: 'Suisse' },
  }] } }));
}

async function openLink(page, viewport, dt = '2026-07-28T14:00') {
  await page.setViewportSize(viewport);
  await mockUpstreams(page);
  await page.goto(`${LINK}&dt=${dt}`);
  await expect(page.locator('#results')).toHaveClass(/\bon\b/, { timeout: 20_000 });
}

const mapTop = page => page.locator('#map').evaluate(el => el.getBoundingClientRect().top);

// A search typed into the empty app: unlike a shared link, it pushes its own
// history entry, so Back undoes it in place.
async function searchFromEmptyApp(page) {
  await page.setViewportSize(MOBILE);
  await mockUpstreams(page);
  await page.goto('/');
  await page.fill('#inp-start', 'Gare de Lausanne');
  await page.keyboard.press('Escape');
  await page.fill('#inp-end', 'Ouchy');
  await page.keyboard.press('Escape');
  await page.press('#inp-end', 'Enter');
  await expect(page.locator('#form-summary')).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/[?&]from=/);
}

test('a result folds the form into one line, which gives the map the room', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await mockUpstreams(page);
  await page.goto('/');
  const openTop = await mapTop(page);

  await page.goto(`${LINK}&dt=2026-07-28T14:00`);
  await expect(page.locator('#results')).toHaveClass(/\bon\b/, { timeout: 20_000 });

  const summary = page.locator('#form-summary');
  await expect(summary).toBeVisible();
  await expect(page.locator('#inp-start')).toBeHidden();
  await expect(page.locator('#search-btn')).toBeHidden();
  // The names before their first comma, and the day: the link is not for today.
  await expect(page.locator('#summary-start')).toHaveText('Lausanne-Gare');
  await expect(page.locator('#summary-end')).toHaveText('Musée Olympique');
  await expect(page.locator('#summary-when')).toHaveText('28 juil., 14:00');
  await expect(summary).toHaveAccessibleName(/Lausanne-Gare\s+vers\s+Musée Olympique/);
  expect(await mapTop(page)).toBeLessThan(openTop - 100);
});

test('the line opens the form, the arrow folds it, and focus follows', async ({ page }) => {
  await openLink(page, MOBILE);
  // Read once two frames agree: under load the first fit can still be moving.
  const pin = async () => {
    for (;;) {
      const a = await page.locator('.map-pin.start').boundingBox();
      await page.waitForTimeout(100);
      const b = await page.locator('.map-pin.start').boundingBox();
      if (a && b && Math.round(a.y) === Math.round(b.y)) return b;
    }
  };
  const before = await pin();

  await page.click('#form-summary');
  await expect(page.locator('#inp-start')).toBeVisible();
  await expect(page.locator('#form-summary')).toBeHidden();
  await expect(page.locator('#form-fold')).toBeFocused();
  // The map's top edge moved down; what was on screen stayed put.
  expect(Math.round((await pin()).y)).toBe(Math.round(before.y));

  await page.click('#form-fold');
  await expect(page.locator('#inp-start')).toBeHidden();
  await expect(page.locator('#form-summary')).toBeFocused();
  expect(Math.round((await pin()).y)).toBe(Math.round(before.y));
});

test('a search from the opened form folds it again, onto its own line', async ({ page }) => {
  await openLink(page, MOBILE);
  await page.click('#form-summary');
  await page.click('#depart-toggle');
  await page.fill('#inp-time', '16:30');
  await page.click('#depart-confirm');
  await expect(page).toHaveURL(/dt=2026-07-28T16%3A30/, { timeout: 20_000 });

  await expect(page.locator('#form-summary')).toBeFocused();
  await expect(page.locator('#summary-when')).toHaveText('28 juil., 16:30');
});

test('the scrubber moves the time on the line', async ({ page }) => {
  await openLink(page, MOBILE);
  await expect(page.locator('#time-scrubber')).toHaveClass(/\bon\b/);
  const range = page.locator('#scrubber-range');
  await range.evaluate((el) => {
    el.value = el.min;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#summary-when')).not.toHaveText('28 juil., 14:00');
  await expect(page.locator('#summary-when')).toHaveText(/^28 juil\., 0\d:\d\d$/);
});

test('a point picked on the map opens the form, to search again from it', async ({ page }) => {
  await openLink(page, MOBILE);
  await expect(page.locator('#form-summary')).toBeVisible();

  // Until the basemap's first load the splash covers the map.
  await expect(page.locator('#map-splash')).toHaveClass(/hidden/, { timeout: 20_000 });
  // Top left, clear of the controls and of the route, which runs south-west
  // to north-east.
  await page.mouse.click(150, 280);
  await page.click('.pick-btn[data-role="start"]');
  await expect(page.locator('#inp-start')).toBeVisible();
  await expect(page.locator('#form-summary')).toBeHidden();
  await expect(page.locator('#search-btn')).toBeVisible();

  await page.click('#search-btn');
  await expect(page.locator('#form-summary')).toBeVisible({ timeout: 20_000 });
});

test('Back to the empty app brings the open form back, without the line', async ({ page }) => {
  await searchFromEmptyApp(page);
  // From the opened form too: the arrow goes with the line.
  await page.click('#form-summary');

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('#form-summary')).toBeHidden();
  await expect(page.locator('#form-fold')).toBeHidden();
  await expect(page.locator('#inp-start')).toBeVisible();
});

test('Escape folds the reopened form, once what is open in it has closed', async ({ page }) => {
  await openLink(page, MOBILE);
  await page.locator('#form-summary').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#form-fold')).toBeFocused();

  // The date popover closes first, and gives focus back to its button.
  await page.locator('#depart-toggle').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#inp-date')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#depart-popover')).not.toHaveClass(/open/);
  await expect(page.locator('#depart-toggle')).toBeFocused();
  await expect(page.locator('#inp-start')).toBeVisible();

  // Then a suggestion list.
  await page.locator('#inp-end').fill('Ouchy');
  await expect(page.locator('.ac-dropdown:visible .ac-item')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.ac-dropdown:visible')).toHaveCount(0);
  await expect(page.locator('#inp-start')).toBeVisible();

  // Then the form, onto its line.
  await page.keyboard.press('Escape');
  await expect(page.locator('#inp-start')).toBeHidden();
  await expect(page.locator('#form-summary')).toBeFocused();
});

test('Escape leaves the empty app\'s form alone', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await mockUpstreams(page);
  await page.goto('/');
  await page.locator('#search-btn').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#inp-start')).toBeVisible();
  await expect(page.locator('#form-summary')).toBeHidden();
});

test('Back with focus on the line puts it on the form, not on a field', async ({ page }) => {
  await searchFromEmptyApp(page);
  await expect(page.locator('#form-summary')).toBeFocused();

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('#inp-start')).toBeVisible();
  // No field focused, so no keyboard comes up; Tab goes on to the first one.
  await expect(page.locator('#search-panel')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#inp-start')).toBeFocused();
});

test('the demo keeps the form open: its note points at the fields', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await mockUpstreams(page);
  await page.goto('/');
  await page.click('#onboarding-btn');
  await expect(page.locator('#results')).toHaveClass(/\bon\b/, { timeout: 20_000 });

  await expect(page.locator('#onboarding-note')).toBeVisible();
  await expect(page.locator('#inp-start')).toBeVisible();
  await expect(page.locator('#form-summary')).toBeHidden();
  await expect(page.locator('#form-fold')).toBeHidden();
});

test('a wide screen keeps its one-row form', async ({ page }) => {
  await openLink(page, DESKTOP);
  await expect(page.locator('#inp-start')).toBeVisible();
  await expect(page.locator('#search-btn')).toBeVisible();
  await expect(page.locator('#form-summary')).toBeHidden();
  await expect(page.locator('#form-fold')).toBeHidden();
});
