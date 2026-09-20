import { test, expect } from '@playwright/test';

// The hardware Back button and iOS's swipe-back undo the search. A search
// started from the empty app pushes one history entry carrying its share URL;
// every later search, scrub or re-render replaces it. Back from it empties the
// app without a reload, and the next Back leaves. A shared link pushes nothing,
// so Back there goes straight back to wherever the link was opened. The results
// drawer has no entry of its own (it has its vertical gesture); the about panel
// keeps one.
//
// page.goBack() stands in for a hardware Back press. What it can't stand in
// for is iOS standalone's swipe-back firing popstate on a same-document entry,
// or a browser's Back button skipping an entry it judges was pushed without a
// user gesture: both still need a real device.

const START = { lat: 46.5197, lng: 6.6323 };
const END = { lat: 46.5250, lng: 6.6400 };
const START_Q = 'Gare de Lausanne';
const END_Q = 'Ouchy';
// Not the 12th, whose eclipse note would ride along on a Swiss route.
const DAY = '2026-08-13';
const SEARCH_URL = `/?from=${START.lat},${START.lng}&to=${END.lat},${END.lng}&dt=${DAY}T14:00`;

// A page before the app, so "Back leaves the app" has somewhere to land.
const BEFORE = '/before-the-app';
const LEFT_THE_APP = /\/before-the-app$/;

// iPhone 14/15 portrait: the drawer is a bottom sheet with a handle. The
// geolocation grant is for the field's locate button; with no shared link it
// also recentres the initial map, which nothing here depends on.
test.use({
  viewport: { width: 390, height: 844 },
  geolocation: { latitude: START.lat, longitude: START.lng },
  permissions: ['geolocation'],
});

const hitFor = q => (/ouchy/i.test(q) ? END : START);

// Returns `held`: set held.ors, held.weather or held.overpass to a promise and
// requests to that upstream wait on it, to catch a search mid-flight.
async function mockUpstreams(page, { orsStatus = 200 } = {}) {
  const held = { ors: null, weather: null, overpass: null };
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
  await page.route('https://photon.komoot.io/**', route => {
    const q = new URL(route.request().url()).searchParams.get('q') || '';
    const hit = hitFor(q);
    return route.fulfill({ json: { features: [{
      geometry: { type: 'Point', coordinates: [hit.lng, hit.lat] },
      properties: { name: q, city: 'Lausanne', countrycode: 'CH', country: 'Suisse' },
    }] } });
  });
  await page.route('https://api.open-meteo.com/**', async route => {
    await held.weather;
    return route.fulfill({ json: { hourly: { time: [], cloud_cover: [], temperature_2m: [] } } });
  });
  await page.route('https://ors-proxy.meridianway.workers.dev/**', async route => {
    await held.ors;
    if (orsStatus !== 200) {
      return route.fulfill({ status: orsStatus, json: { error: { code: 2099, message: 'refused' } } });
    }
    return route.fulfill({ json: { features: [
      {
        geometry: { type: 'LineString', coordinates: [[6.6323, 46.5197, 400], [6.6360, 46.5220, 400], [6.6400, 46.5250, 400]] },
        properties: { summary: { distance: 900, duration: 700 } },
      },
      {
        geometry: { type: 'LineString', coordinates: [[6.6323, 46.5197, 400], [6.6340, 46.5240, 400], [6.6400, 46.5250, 400]] },
        properties: { summary: { distance: 1000, duration: 780 } },
      },
    ] } });
  });
  await page.route('https://overpass-cache.meridianway.workers.dev/**', async route => {
    await held.overpass;
    return route.fulfill({ json: { elements: [] } });
  });
  await page.route('https://swissbuildings-lookup.meridianway.workers.dev/**', route => route.fulfill({
    json: { buildings: [] },
  }));
  // Buildings are mocked above, so the tiles must be blocked too or the real
  // basemap answers over them. An empty style keeps the map "loaded" without a
  // network call.
  await page.route('https://tiles.stadiamaps.com/**', route => route.fulfill({
    json: { version: 8, sources: {}, layers: [] },
  }));
  return held;
}

// A held upstream and the function that lets it answer.
function hold(held, upstream) {
  let release;
  held[upstream] = new Promise(r => { release = r; });
  return release;
}

async function openApp(page, path = '/') {
  await page.goto(BEFORE);
  await page.goto(path);
  // initAutocomplete() puts role=combobox on the field: the app script runs.
  await page.waitForSelector('#inp-end[role="combobox"]');
}

const historyLength = page => page.evaluate(() => history.length);

// Umami never loads here, so stand one up before the app's module runs.
async function collectEvents(page) {
  await page.addInitScript(() => {
    window.__events = [];
    window.umami = { track: (name, props) => window.__events.push([name, props]) };
  });
}

const backResets = page => page.evaluate(() => window.__events
  .filter(([n]) => n === 'back_reset')
  .map(([, p]) => p));

// Escape closes the suggestion list, so what's searched is what was typed.
async function typeAddresses(page) {
  await page.fill('#inp-start', START_Q);
  await page.keyboard.press('Escape');
  await page.fill('#inp-end', END_Q);
  await page.keyboard.press('Escape');
}

async function pickSuggestion(page, field, q) {
  await page.fill(field, q);
  await page.locator('.ac-dropdown:visible .ac-item').first().click();
  await expect(page.locator(field)).toHaveValue(new RegExp(q));
}

// A search at a set time through the "leave later" popover, the one path that
// fixes the hour: "leave now" would make the scrubber depend on when the suite
// runs. Resolves once that search is drawn and its URL written.
async function searchAt(page, time, date = DAY) {
  await page.click('#depart-toggle');
  await page.fill('#inp-date', date);
  await page.fill('#inp-time', time);
  await page.click('#depart-confirm');
  await expect(page).toHaveURL(new RegExp(`dt=${date}T${time.replace(':', '%3A')}`), { timeout: 20_000 });
  await expect(page.locator('#results')).toHaveClass(/\bon\b/);
}

async function scrubToSunrise(page) {
  await expect(page.locator('#time-scrubber')).toHaveClass(/\bon\b/, { timeout: 20_000 });
  const range = page.locator('#scrubber-range');
  const to = await range.evaluate(el => Number(el.min));
  await range.evaluate((el, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, to);
  const hh = String(Math.floor(to / 60)).padStart(2, '0');
  const mm = String(to % 60).padStart(2, '0');
  await expect(page).toHaveURL(new RegExp(`dt=${DAY}T${hh}%3A${mm}`));
}

async function expectSearchShown(page) {
  await expect(page.locator('#results')).toHaveClass(/\bon\b/, { timeout: 20_000 });
  await expect(page).toHaveURL(/[?&]from=.+&to=/);
}

// Everything a search puts on screen is gone, and the URL is bare again.
async function expectEmptyApp(page) {
  await expect(page.locator('#results')).not.toHaveClass(/\bon\b/);
  await expect(page.locator('#results')).not.toHaveClass(/expanded/);
  expect(new URL(page.url()).search).toBe('');
  await expect(page.locator('#inp-start')).toHaveValue('');
  await expect(page.locator('#inp-end')).toHaveValue('');
  await expect(page.locator('.leaflet-overlay-pane path')).toHaveCount(0);
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(0);
  await expect(page.locator('#time-scrubber')).not.toHaveClass(/\bon\b/);
  await expect(page.locator('#map-sun-info')).not.toHaveClass(/\bon\b/);
  await expect(page.locator('#quality-note')).not.toHaveClass(/\bon\b/);
  await expect(page.locator('#status')).not.toHaveClass(/\bon\b/);
  await expect(page.locator('#search-btn')).toBeEnabled();
}

// Every way of filling the fields ends in the same handleSearch, but each is
// its own path to it: none of them may skip the entry.
const SEARCH_PATHS = {
  'typed addresses + Enter': async page => {
    await typeAddresses(page);
    await page.press('#inp-end', 'Enter');
  },
  'autocomplete + search button': async page => {
    await pickSuggestion(page, '#inp-start', START_Q);
    await pickSuggestion(page, '#inp-end', END_Q);
    await page.click('#search-btn');
  },
  'geolocated start + typed end': async page => {
    await page.click('#geo-start');
    await expect(page.locator('#inp-start')).not.toHaveValue('');
    await page.fill('#inp-end', END_Q);
    await page.keyboard.press('Escape');
    await page.press('#inp-end', 'Enter');
  },
  'points picked on the map + search button': async page => {
    // The splash swallows clicks until the basemap loads, and the intro
    // bubble sits over the middle of the map.
    await expect(page.locator('#map-splash')).toHaveClass(/hidden/, { timeout: 20_000 });
    await page.click('#app-description-close');
    const box = await page.locator('#map').boundingBox();
    for (const [role, dy] of [['start', 0.45], ['end', 0.6]]) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height * dy);
      await page.click(`.pick-btn[data-role="${role}"]`);
      await expect(page.locator(`#inp-${role}`)).not.toHaveValue('');
    }
    await page.click('#search-btn');
  },
};

test.describe('Back undoes the search', () => {
  for (const [how, runSearch] of Object.entries(SEARCH_PATHS)) {
    test(`${how}: Back empties the app, the next Back leaves it`, async ({ page }) => {
      await mockUpstreams(page);
      await collectEvents(page);
      await openApp(page);
      const before = await historyLength(page);

      await runSearch(page);
      await expectSearchShown(page);
      expect(await historyLength(page)).toBe(before + 1);

      await page.goBack();
      await expectEmptyApp(page);
      expect(await backResets(page)).toEqual([{ loading: false }]);

      await page.goBack();
      await expect(page).toHaveURL(LEFT_THE_APP);
    });
  }

  test('a scrub before Back leaves the empty app with a bare URL', async ({ page }) => {
    await mockUpstreams(page);
    await openApp(page);

    await typeAddresses(page);
    await searchAt(page, '14:00');
    // Every tick rewrites the URL: it must land on the search's entry, never
    // on the empty app's underneath.
    await scrubToSunrise(page);

    await page.goBack();
    await expectEmptyApp(page);
  });

  test('a search that fails adds no entry', async ({ page }) => {
    await mockUpstreams(page, { orsStatus: 400 });
    await openApp(page);
    const before = await historyLength(page);

    await typeAddresses(page);
    await page.press('#inp-end', 'Enter');
    await expect(page.locator('#toast')).toHaveClass(/\bon\b/, { timeout: 20_000 });

    expect(await historyLength(page)).toBe(before);
    expect(new URL(page.url()).search).toBe('');
    await page.goBack();
    await expect(page).toHaveURL(LEFT_THE_APP);
  });

  test('Forward after Back runs the search again', async ({ page }) => {
    await mockUpstreams(page);
    await openApp(page);
    await typeAddresses(page);
    await searchAt(page, '10:00');
    const length = await historyLength(page);

    await page.goBack();
    await expectEmptyApp(page);

    await page.goForward();
    await expectSearchShown(page);
    await expect(page).toHaveURL(new RegExp(`dt=${DAY}T10%3A00`));
    await expect(page.locator('#inp-start')).toHaveValue(START_Q);
    await expect(page.locator('#inp-end')).toHaveValue(END_Q);
    // Replayed in place, not pushed again.
    expect(await historyLength(page)).toBe(length);

    await page.goBack();
    await expectEmptyApp(page);
  });
});

test.describe('a shared link', () => {
  test('Back leaves straight away: the recipient never saw an empty app', async ({ page }) => {
    await mockUpstreams(page);
    await openApp(page, SEARCH_URL);
    await expectSearchShown(page);

    await page.goBack();
    await expect(page).toHaveURL(LEFT_THE_APP);
  });

  test('a search of their own from it still leaves on Back', async ({ page }) => {
    await mockUpstreams(page);
    await openApp(page, SEARCH_URL);
    await expectSearchShown(page);
    const before = await historyLength(page);

    await searchAt(page, '16:30');
    expect(await historyLength(page)).toBe(before);

    await page.goBack();
    await expect(page).toHaveURL(LEFT_THE_APP);
  });
});

test.describe('no entry leaks', () => {
  test('chained searches, a scrub and a sunrise jump share one entry', async ({ page }) => {
    await mockUpstreams(page);
    await openApp(page);
    const before = await historyLength(page);

    await typeAddresses(page);
    await searchAt(page, '10:00');
    await searchAt(page, '15:30');
    await scrubToSunrise(page);
    await searchAt(page, '23:00');
    await page.click('#night-sunrise-btn');
    await expect(page).toHaveURL(/dt=2026-08-14T0/, { timeout: 20_000 });

    expect(await historyLength(page)).toBe(before + 1);
    await page.goBack();
    await expectEmptyApp(page);
    await page.goBack();
    await expect(page).toHaveURL(LEFT_THE_APP);
  });

  test('search then Back, three times over, keeps the stack where it was', async ({ page }) => {
    await mockUpstreams(page);
    await openApp(page);
    const before = await historyLength(page);

    for (let i = 0; i < 3; i++) {
      await typeAddresses(page);
      await page.press('#inp-end', 'Enter');
      await expectSearchShown(page);
      await page.goBack();
      await expectEmptyApp(page);
    }

    // The one entry Back stepped off stays ahead as Forward; each new search
    // replaces it instead of adding to it.
    expect(await historyLength(page)).toBe(before + 1);
    await page.goBack();
    await expect(page).toHaveURL(LEFT_THE_APP);
  });
});

test.describe('the results drawer', () => {
  test('expanding and collapsing it never touches history', async ({ page }) => {
    await mockUpstreams(page);
    await openApp(page, SEARCH_URL);
    await expectSearchShown(page);
    const before = await historyLength(page);

    for (let i = 0; i < 5; i++) {
      await page.click('#drawer-handle');
      await expect(page.locator('#results')).toHaveClass(/expanded/);
      await page.click('#drawer-handle');
      await expect(page.locator('#results')).not.toHaveClass(/expanded/);
    }

    expect(await historyLength(page)).toBe(before);
  });

  test('Back with it expanded undoes the search, not just the drawer', async ({ page }) => {
    await mockUpstreams(page);
    await openApp(page);
    await typeAddresses(page);
    await searchAt(page, '14:00');

    await page.click('#drawer-handle');
    await expect(page.locator('#results')).toHaveClass(/expanded/);

    await page.goBack();
    await expectEmptyApp(page);
  });
});

test.describe('the about panel', () => {
  test('over a route, Back closes it and leaves the search alone', async ({ page }) => {
    await mockUpstreams(page);
    await collectEvents(page);
    await openApp(page);
    await typeAddresses(page);
    await searchAt(page, '14:00');
    const url = page.url();

    await page.click('#about-btn');
    await expect(page.locator('#about-drawer')).toHaveClass(/open/);

    await page.goBack();
    await expect(page.locator('#about-drawer')).not.toHaveClass(/open/);
    await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
    await expect(page.locator('#results')).toHaveClass(/\bon\b/);
    expect(page.url()).toBe(url);
    // Closing a panel is not undoing a search.
    expect(await backResets(page)).toEqual([]);

    await page.goBack();
    await expectEmptyApp(page);
    expect(await backResets(page)).toEqual([{ loading: false }]);
  });

  test('on the empty app, Back closes it and keeps a half-filled form', async ({ page }) => {
    await mockUpstreams(page);
    await openApp(page);
    await page.fill('#inp-start', START_Q);
    await page.keyboard.press('Escape');

    await page.click('#about-btn');
    await expect(page.locator('#about-drawer')).toHaveClass(/open/);

    await page.goBack();
    await expect(page.locator('#about-drawer')).not.toHaveClass(/open/);
    await expect(page.locator('#inp-start')).toHaveValue(START_Q);
  });

  test('opening and closing it via the UI does not grow the history stack', async ({ page }) => {
    await mockUpstreams(page);
    await openApp(page, SEARCH_URL);
    await expectSearchShown(page);
    const before = await historyLength(page);

    for (let i = 0; i < 5; i++) {
      await page.click('#about-btn');
      await expect(page.locator('#about-drawer')).toHaveClass(/open/);
      await page.click('#about-close');
      await expect(page.locator('#about-drawer')).not.toHaveClass(/open/);
    }

    // The first open grows the stack by one entry; every open/close after that
    // reuses it. Without the history.back() in the dismiss path, each open would
    // add another entry and Back would need five presses to leave.
    const after = await historyLength(page);
    expect(after).toBeLessThanOrEqual(before + 1);
  });
});

test.describe('a search still in flight', () => {
  test('Back during a second search: that search never lands', async ({ page }) => {
    const held = await mockUpstreams(page);
    await collectEvents(page);
    await openApp(page);
    await typeAddresses(page);
    await searchAt(page, '10:00');
    const length = await historyLength(page);

    const release = hold(held, 'ors');
    const asked = page.waitForRequest(/ors-proxy/);
    await page.click('#depart-toggle');
    await page.fill('#inp-time', '16:00');
    await page.click('#depart-confirm');
    await asked;

    await page.goBack();
    await expectEmptyApp(page);
    // Back as a way out of a search still loading, told apart in the data.
    expect(await backResets(page)).toEqual([{ loading: true }]);

    const answered = page.waitForResponse(/ors-proxy/);
    release();
    await answered;
    // A stale search that still drew would do it within a frame of its answer.
    await page.waitForTimeout(500);
    await expectEmptyApp(page);
    // #toast only exists once something has been shown.
    await expect(page.locator('#toast.on')).toHaveCount(0);
    expect(await historyLength(page)).toBe(length);
  });

  test('Back on a drawn route still waiting for its weather: not counted as loading, and nothing comes back', async ({ page }) => {
    const held = await mockUpstreams(page);
    await collectEvents(page);
    const release = hold(held, 'weather');
    await openApp(page);
    await typeAddresses(page);
    // Weather is only asked for within the forecast horizon, so not for DAY.
    const t = new Date(Date.now() + 86_400_000);
    const tomorrow = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    // The route is drawn before the weather is awaited; the search button stays
    // disabled until it answers.
    await searchAt(page, '10:00', tomorrow);
    await expect(page.locator('#search-btn')).toBeDisabled();

    await page.goBack();
    await expectEmptyApp(page);
    expect(await backResets(page)).toEqual([{ loading: false }]);

    const answered = page.waitForResponse(/open-meteo/);
    release();
    await answered;
    // Past the weather, a stale search would bring the scrubber back.
    await page.waitForTimeout(500);
    await expectEmptyApp(page);
  });

  test('Back before the vegetation pass lands: it never redraws', async ({ page }) => {
    const held = await mockUpstreams(page);
    const release = hold(held, 'overpass');
    await openApp(page);
    await typeAddresses(page);
    // The first render doesn't wait for vegetation, so this resolves while
    // Overpass is still held.
    await searchAt(page, '10:00');

    await page.goBack();
    await expectEmptyApp(page);

    const answered = page.waitForResponse(/overpass-cache/);
    release();
    await answered;
    await page.waitForTimeout(500);
    await expectEmptyApp(page);
  });
});
