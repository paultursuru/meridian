import { test, expect } from '@playwright/test';

// Once its quota is spent, Stadia answers 429 to everything until the 1st and
// the map goes blank. The map then switches to OpenFreeMap, once. Both are
// mocked: the switch is what is pinned here, not either provider's tiles.
//
// The app opens on raster tiles and brings MapLibre in later (see map.js),
// so most of this starts at `loadVectorMap`.

const STADIA = 'https://tiles.stadiamaps.com';
const OFM = 'https://tiles.openfreemap.org';

// A drawable style whose tiles come from `host`, with an attribution to tell
// the two apart in the corner of the map. No maxzoom, so every zoom level asks
// for tiles of its own.
const styleFor = (host, attribution) => ({
  version: 8,
  sources: {
    openmaptiles: { type: 'vector', tiles: [`${host}/data/openmaptiles/{z}/{x}/{y}.pbf`], attribution },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#f2f3f0' } },
    { id: 'building', type: 'fill', source: 'openmaptiles', 'source-layer': 'building' },
  ],
});

// An empty body is a valid vector tile with no layers in it.
const emptyTile = (route) => route.fulfill({ body: Buffer.alloc(0), contentType: 'application/x-protobuf' });

// A 1x1 transparent PNG: enough for Leaflet to count a raster tile as drawn.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

// stadiaTiles decides what each Stadia tile request gets, so a test can
// refuse them partway through.
async function mockBasemaps(page, { stadiaStyle = 200, stadiaTiles = () => 200, stadiaRaster = () => 200 } = {}) {
  const fallbackStyles = [];
  await page.route(`${STADIA}/tiles/**`, (route) => {
    const status = stadiaRaster();
    return status === 200
      ? route.fulfill({ body: PNG, contentType: 'image/png' })
      : route.fulfill({ status, body: '' });
  });
  await page.route(`${STADIA}/styles/**`, (route) => (stadiaStyle === 200
    ? route.fulfill({ json: styleFor(STADIA, 'Stadia test') })
    : route.fulfill({ status: stadiaStyle, body: '' })));
  await page.route(`${STADIA}/data/**`, (route) => {
    const status = stadiaTiles();
    return status === 200 ? emptyTile(route) : route.fulfill({ status, body: '' });
  });
  await page.route(`${OFM}/styles/**`, (route) => {
    fallbackStyles.push(route.request().url());
    return route.fulfill({ json: styleFor(OFM, 'OpenFreeMap test') });
  });
  await page.route(`${OFM}/data/**`, emptyTile);
  return fallbackStyles;
}

// Umami never loads here, so stand one up before the app's module runs.
async function collectEvents(page) {
  await page.addInitScript(() => {
    window.__events = [];
    window.umami = { track: (name, props) => window.__events.push([name, props]) };
  });
}
const events = (page, name) => page.evaluate((n) => window.__events.filter(([e]) => e === n).map(([, p]) => p), name);

const splash = (page) => page.locator('#map-splash');
const attribution = (page) => page.locator('.leaflet-control-attribution');
const glCanvas = (page) => page.locator('#map canvas');

// The first gesture on the map is what brings MapLibre in.
async function loadVectorMap(page) {
  await page.locator('#map').click({ position: { x: 30, y: 30 } });
  await expect(glCanvas(page)).toHaveCount(1, { timeout: 20_000 });
}

test('a refused style loads the fallback once the vector map is asked for', async ({ page }) => {
  await collectEvents(page);
  const fallbackStyles = await mockBasemaps(page, { stadiaStyle: 429 });
  await page.goto('/');

  // The raster tiles draw, so the splash goes without MapLibre at all.
  await expect(splash(page)).toHaveClass(/hidden/, { timeout: 20_000 });
  expect(fallbackStyles).toEqual([]);

  await loadVectorMap(page);
  await expect(attribution(page)).toContainText('OpenFreeMap test');
  expect(fallbackStyles).toEqual([`${OFM}/styles/positron`]);
  expect(await events(page, 'basemap_fallback')).toEqual([{ status: 429, resource: 'style' }]);
});

test('refused raster tiles bring the vector map in on their own, and the splash goes', async ({ page }) => {
  await collectEvents(page);
  const fallbackStyles = await mockBasemaps(page, { stadiaRaster: () => 429, stadiaStyle: 429 });
  await page.goto('/');

  // Nothing is clicked: drawing no tile at all is what asks for MapLibre.
  await expect(glCanvas(page)).toHaveCount(1, { timeout: 20_000 });
  await expect(splash(page)).toHaveClass(/hidden/, { timeout: 20_000 });
  await expect(attribution(page)).toContainText('OpenFreeMap test');
  expect(fallbackStyles).toEqual([`${OFM}/styles/positron`]);
});

test('tiles refused after the first draw switch the map, and the attribution follows', async ({ page }) => {
  await collectEvents(page);
  let refuse = false;
  const fallbackStyles = await mockBasemaps(page, { stadiaTiles: () => (refuse ? 429 : 200) });
  await page.goto('/');
  await expect(splash(page)).toHaveClass(/hidden/, { timeout: 20_000 });
  await loadVectorMap(page);
  await expect(attribution(page)).toContainText('Stadia test');

  // The quota runs out mid-visit: the next tiles the map asks for are refused.
  refuse = true;
  await page.click('.leaflet-control-zoom-in');

  await expect(attribution(page)).toContainText('OpenFreeMap test');
  await expect(attribution(page)).not.toContainText('Stadia test');
  expect(fallbackStyles).toHaveLength(1);
  await expect.poll(() => events(page, 'basemap_fallback')).toEqual([{ status: 429, resource: 'tiles' }]);
});

test('a server error is a hiccup: the map stays on Stadia, and still lifts the splash', async ({ page }) => {
  await collectEvents(page);
  const fallbackStyles = await mockBasemaps(page, { stadiaTiles: () => 503 });
  await page.goto('/');
  await expect(splash(page)).toHaveClass(/hidden/, { timeout: 20_000 });
  // MapLibre doesn't redraw after a failed tile: with every tile failing, its
  // own first draw rests on map.js asking for one.
  await loadVectorMap(page);

  expect(fallbackStyles).toEqual([]);
  expect(await events(page, 'basemap_fallback')).toEqual([]);
  await expect(attribution(page)).toContainText('Stadia test');
});
