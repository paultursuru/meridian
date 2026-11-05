import { test, expect } from '@playwright/test';

// That "later" really is later: no WebGL context until someone touches the
// map. Without a GPU, MapLibre rasterises on the CPU, which was seconds of
// blocked main thread on every first load.

const STADIA = 'https://tiles.stadiamaps.com';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

const style = {
  version: 8,
  sources: { openmaptiles: { type: 'vector', tiles: [`${STADIA}/data/openmaptiles/{z}/{x}/{y}.pbf`] } },
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f2f3f0' } }],
};

async function mockBasemap(page) {
  await page.route(`${STADIA}/tiles/**`, (route) => route.fulfill({ body: PNG, contentType: 'image/png' }));
  await page.route(`${STADIA}/styles/**`, (route) => route.fulfill({ json: style }));
  await page.route(`${STADIA}/data/**`, (route) =>
    route.fulfill({ body: Buffer.alloc(0), contentType: 'application/x-protobuf' }));
}

const tiles = (page) => page.locator('#map img.leaflet-tile');
const canvas = (page) => page.locator('#map canvas');

test('the first view is image tiles, with no WebGL context behind it', async ({ page }) => {
  await mockBasemap(page);
  // Counted, not stubbed: a stub would hide MapLibre asking for one.
  await page.addInitScript(() => {
    window.__glContexts = 0;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (String(type).startsWith('webgl')) window.__glContexts++;
      return getContext.call(this, type, ...rest);
    };
  });

  await page.goto('/');
  await expect(page.locator('#map-splash')).toHaveClass(/hidden/, { timeout: 20_000 });

  await expect(tiles(page)).not.toHaveCount(0);
  await expect(canvas(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.__glContexts)).toBe(0);
});

test('a gesture on the map brings the vector basemap in, and the tiles go', async ({ page }) => {
  await mockBasemap(page);
  await page.goto('/');
  await expect(page.locator('#map-splash')).toHaveClass(/hidden/, { timeout: 20_000 });
  await expect(canvas(page)).toHaveCount(0);

  await page.locator('#map').click({ position: { x: 30, y: 30 } });

  await expect(canvas(page)).toHaveCount(1, { timeout: 20_000 });
  // Dropped once the vector map has drawn over them.
  await expect(tiles(page)).toHaveCount(0, { timeout: 20_000 });
});
