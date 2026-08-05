import { test, expect } from '@playwright/test';

// Sentry JAVASCRIPT-ASTRO-E, 352 events: "Invalid LatLng object: (NaN, NaN)",
// thrown from Leaflet's own requestAnimationFrame resize handler with no app
// frame in the stack.
//
// displayRoutes() calls fitBounds with 230px of vertical padding (30 top for
// the search panel, 200 bottom for the results drawer). When #map is shorter
// than that, Leaflet's getBoundsZoom does `size.subtract(padding)` -> negative,
// then Math.log of a negative scale -> NaN, and getScaleZoom converts that NaN
// into Infinity rather than throwing. _getBoundsCenterZoom has an early return
// for Infinity, so setView(center, Infinity) succeeds *silently* and leaves
// _zoom/_pixelOrigin at Infinity. Nothing fails yet. The throw only lands at
// the next container resize (soft keyboard closing, rotation), when Leaflet's
// ResizeObserver -> invalidateSize -> maplibre's _transformGL -> getCenter()
// divides Infinity by Infinity and hands (NaN, NaN) to the LatLng constructor.
//
// Two independent triggers, one test each: a container too short for the
// padding, and a zero-size bounds (identical start/end), which produces the
// same Infinity zoom on a container of any size.

const PARIS_START = '48.8738,2.2950';
const PARIS_END = '48.8606,2.3376';

// A small phone in portrait with the soft keyboard open. Firefox for Android
// (the browser on the Sentry event) resizes the layout viewport when the
// keyboard opens, so 100vh shrinks and #map measures ~204px — under the 230px
// the fitBounds call asks for.
const SQUEEZED = { width: 360, height: 420 };
const ROOMY = { width: 412, height: 915 };

async function mockUpstreams(page, { coordinates, distance = 2200 } = {}) {
  await page.route('https://nominatim.openstreetmap.org/**', route => route.fulfill({
    json: { display_name: 'Paris, France', address: { country_code: 'fr' } },
  }));
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({
    json: { hourly: { time: [], cloud_cover: [], temperature_2m: [] } },
  }));
  await page.route('https://ors-proxy.meridianway.workers.dev/**', route => route.fulfill({
    json: { features: [{
      geometry: {
        type: 'LineString',
        coordinates: coordinates ?? [[2.2950, 48.8738, 0], [2.32, 48.865, 0], [2.3376, 48.8606, 0]],
      },
      properties: { summary: { distance, duration: 1800 } },
    }] },
  }));
  await page.route('https://overpass-cache.meridianway.workers.dev/**', route =>
    route.fulfill({ json: { elements: [] } }));
  // The vector basemap is irrelevant to the projection maths and would other-
  // wise pull tiles over the network on every run.
  await page.route('https://tiles.stadiamaps.com/**', route =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
}

// Sanity check that the route actually reached the map: the corruption itself
// is invisible here (Leaflet's renderer keeps drawing finite paths off an
// Infinity origin), so this guards against the test passing on a page that
// simply never rendered a route, not against the bug.
async function routePathData(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('#map svg path')).map(p => p.getAttribute('d') || ''));
}

test.describe('fitBounds on a container smaller than its padding', () => {
  test.use({ viewport: SQUEEZED });

  test('draws a finite route and survives the resize that follows', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));

    await mockUpstreams(page);
    await page.goto(`/en/?from=${PARIS_START}&to=${PARIS_END}&dt=2026-07-28T14:00`);
    await expect(page.locator('#results')).toHaveClass(/on/, { timeout: 20_000 });

    // #map really is shorter than the 230px of padding here — if this stops
    // holding (layout change), the test below would pass vacuously.
    const mapHeight = await page.locator('#map').evaluate(el => el.getBoundingClientRect().height);
    expect(mapHeight).toBeLessThan(230);

    const paths = await routePathData(page);
    expect(paths.length).toBeGreaterThan(0);
    for (const d of paths) expect(d).not.toMatch(/NaN|Infinity/);

    // The keyboard closing / the phone rotating: Leaflet's ResizeObserver
    // fires invalidateSize inside a requestAnimationFrame, which is where the
    // production error was actually thrown.
    await page.setViewportSize(ROOMY);
    await page.waitForTimeout(1000);

    expect(pageErrors.join('\n')).not.toContain('Invalid LatLng');
    expect(pageErrors).toEqual([]);
  });
});

test.describe('framing on a small phone', () => {
  // 320x640 is about the smallest screen still in real use. The map is ~424px
  // tall there and the chrome floating on it (sun badge at the top, scrubber
  // and drawer at the bottom) covers well over half of that, so a route fitted
  // to nominal padding ends up behind it. Few users, but the result has to be
  // readable for them too.
  test.use({ viewport: { width: 320, height: 640 } });

  test('the route lands in the strip the user can actually see', async ({ page }) => {
    await mockUpstreams(page);
    await page.goto(`/en/?from=${PARIS_START}&to=${PARIS_END}&dt=2026-07-28T14:00`);
    await expect(page.locator('#results')).toHaveClass(/on/, { timeout: 20_000 });
    await expect(page.locator('#time-scrubber')).toHaveClass(/on/);

    const box = await page.evaluate(() => {
      const rect = (sel) => {
        const el = document.querySelector(sel);
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
      };
      // Scoped to the overlay pane: '#map svg path' would also match the
      // Leaflet controls' own icons (the locate button's target glyph).
      // Excluding .route-casing on top of that: it carries a blur filter, and
      // getBoundingClientRect reports the filter region (120% of the bbox by
      // default), not the stroke.
      const segs = Array.from(document.querySelectorAll('.leaflet-overlay-pane path:not(.route-casing)'))
        .map(p => p.getBoundingClientRect());
      return {
        route: { top: Math.min(...segs.map(r => r.top)), bottom: Math.max(...segs.map(r => r.bottom)) },
        badge: rect('#map-sun-info'),
        scrubber: rect('#time-scrubber'),
      };
    });

    expect(box.route.top).toBeGreaterThanOrEqual(box.badge.bottom);
    expect(box.route.bottom).toBeLessThanOrEqual(box.scrubber.top);
  });
});

test.describe('fitBounds on a zero-size bounds', () => {
  test.use({ viewport: ROOMY });

  test('identical start and end do not corrupt the map', async ({ page }) => {
    // Same point twice: boundsSize is 0, so Leaflet's scalex/scaley are
    // Infinity and the zoom goes Infinity on a container of any size. No
    // squeezing needed to reproduce this one.
    //
    // Reachable because buildShareQuery rounds to 5 decimals (~1 m), so two
    // genuinely distinct endpoints a metre apart serialise to the identical
    // string and come back equal. The mocked route has to be 0 m long to
    // match: dedupeRoutes drops anything longer than 2.5x the direct
    // distance (routing.js), which is 0 for coincident endpoints.
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));

    await mockUpstreams(page, {
      coordinates: [[2.2950, 48.8738, 0], [2.2950, 48.8738, 0]],
      distance: 0,
    });
    await page.goto(`/en/?from=${PARIS_START}&to=${PARIS_START}&dt=2026-07-28T14:00`);
    await expect(page.locator('#results')).toHaveClass(/on/, { timeout: 20_000 });

    for (const d of await routePathData(page)) expect(d).not.toMatch(/NaN|Infinity/);

    await page.setViewportSize({ width: 412, height: 700 });
    await page.waitForTimeout(1000);

    expect(pageErrors.join('\n')).not.toContain('Invalid LatLng');
    expect(pageErrors).toEqual([]);
  });
});
