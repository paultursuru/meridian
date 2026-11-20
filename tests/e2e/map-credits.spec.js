import { test, expect } from '@playwright/test';

// Under the drawer layout, the results drawer covers the bottom of the map,
// where Leaflet puts its attribution. The credits move to a band at the bottom
// of the screen instead, and the drawer docks above it. Stadia, OpenMapTiles
// and OpenStreetMap ask for a visible credit.

const START = '46.5197,6.6323';
const END = '46.5250,6.6400';
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
// A 1x1 transparent PNG: enough for Leaflet to count a raster tile as drawn.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

async function mockUpstreams(page) {
  await page.route('https://nominatim.openstreetmap.org/**', route => route.fulfill({
    json: { display_name: 'Lausanne, Suisse', address: { country_code: 'ch' } },
  }));
  await page.route('**/api/route**', route => route.fulfill({
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
  await page.route('**/api/overpass**', route => route.fulfill({ json: { elements: [] } }));
  await page.route('**/api/buildings**', route => route.fulfill({ json: { buildings: [] } }));
  // Image tiles that draw, so the vector map never boots: its empty mock style
  // would credit nobody, and the test would read an empty attribution.
  await page.route('https://tiles.stadiamaps.com/**', route =>
    route.fulfill({ body: PNG, contentType: 'image/png' }));
  await page.clock.setFixedTime(new Date('2026-08-13T08:00:00+02:00'));
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ json: { hourly: null } }));
}

async function search(page) {
  await mockUpstreams(page);
  await page.goto(`/?from=${START}&to=${END}&dt=2026-08-13T14:00`);
  await expect(page.locator('#results')).toHaveClass(/on/, { timeout: 20_000 });
  await page.waitForTimeout(500); // the drawer slides in over 0.32s
}

// Each credit link is on screen and nothing sits on top of it.
function uncoveredLinks(page) {
  return page.locator('.leaflet-control-attribution a').evaluateAll(links => links.map(a => {
    const box = a.getBoundingClientRect();
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return { text: a.textContent.trim(), onScreen: box.top >= 0 && box.bottom <= innerHeight, uncovered: a.contains(top) };
  }));
}

test('mobile: the credits sit in a band over the drawer, every link in view', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await search(page);

  const credits = page.locator('#map-credits .leaflet-control-attribution');
  await expect(credits).toContainText('OpenStreetMap');
  await expect(credits).not.toContainText('Leaflet');
  for (const link of await uncoveredLinks(page)) {
    expect(link, link.text).toEqual({ text: link.text, onScreen: true, uncovered: true });
  }

  // The folded drawer's last line stays above the band.
  const bandTop = (await page.locator('#map-credits').boundingBox()).y;
  const ratio = await page.locator('#results .ratio-delta').evaluateAll(els =>
    els.map(el => el.getBoundingClientRect()).filter(r => r.height).map(r => r.bottom));
  expect(ratio.length).toBeGreaterThan(0);
  for (const bottom of ratio) expect(bottom).toBeLessThanOrEqual(bandTop);

  // Expanded, the end of the drawer's content scrolls clear of the band too.
  await page.locator('#drawer-handle').click();
  await expect(page.locator('#results')).toHaveClass(/expanded/);
  // Polled: the drawer slides up over 0.32s.
  await expect.poll(() => page.locator('#drawer-body').evaluate(body => {
    body.scrollTop = body.scrollHeight;
    return body.lastElementChild.getBoundingClientRect().bottom;
  })).toBeLessThanOrEqual(bandTop + 0.5);
});

test('desktop: the credits stay in the map corner, with the Leaflet prefix', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto('/');
  await expect(page.locator('#map-credits .leaflet-control-attribution')).toBeVisible();

  // Crossing the breakpoint moves them back.
  await page.setViewportSize(DESKTOP);
  const corner = page.locator('#map .leaflet-bottom.leaflet-right .leaflet-control-attribution');
  await expect(corner).toContainText('Leaflet');
  await expect(corner).toContainText('OpenStreetMap');
  await expect(page.locator('#map-credits')).toBeHidden();
});
