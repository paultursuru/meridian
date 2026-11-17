import { test, expect } from '@playwright/test';

// What a keyboard reaches once a search is on screen: nothing hidden, and
// nothing below the screen without the sheet opening to show it.

const START = '46.5197,6.6323';
const END = '46.5250,6.6400';
const MOBILE = { width: 390, height: 844 };

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
  // One swisstopo building, the Worker's shape: the coverage note then folds
  // its details under a summary, the sheet's only focusable below the fold.
  const verts = [[46.5221, 6.6361], [46.5221, 6.6363], [46.5223, 6.6363], [46.5223, 6.6361]]
    .map(([lat, lng]) => ({ lat, lng }));
  await page.route('**/api/buildings**', route => route.fulfill({
    json: [{ centroid: { lat: 46.5222, lng: 6.6362 }, height: 12, verts, radius: 12, hasHeight: true }],
  }));
  await page.route('https://tiles.stadiamaps.com/**', route =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  await page.clock.setFixedTime(new Date('2026-08-13T08:00:00+02:00'));
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ json: { hourly: null } }));
}

async function openResult(page) {
  await page.setViewportSize(MOBILE);
  await mockUpstreams(page);
  await page.goto(`/?from=${START}&to=${END}&dt=2026-08-13T14:00`);
  await expect(page.locator('#results')).toHaveClass(/on/, { timeout: 20_000 });
  await page.waitForTimeout(500); // the drawer slides in over 0.32s
}

test('the faded intro bubble takes no Tab stop', async ({ page }) => {
  await openResult(page);
  await expect(page.locator('#app-description')).toHaveClass(/hidden/);
  await expect(page.locator('#app-description')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('#app-description-demo')).not.toBeVisible();
});

test('Tab onto a route detail under the folded sheet opens it', async ({ page }) => {
  await openResult(page);
  const summary = page.locator('#drawer-body summary').filter({ hasText: 'Hauteurs officielles' });
  await expect(page.locator('#results')).not.toHaveClass(/expanded/);

  await summary.focus();

  await expect(page.locator('#results')).toHaveClass(/expanded/);
  await expect(summary).toBeInViewport();
});

test('the map zoom buttons are named in the page language', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Zoomer', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dézoomer', exact: true })).toBeVisible();
});

test('the routes are picked with toggle buttons, and read on from them', async ({ page }) => {
  await openResult(page);
  // No tabpanel to step into: the route's numbers follow its button.
  await expect(page.getByRole('tabpanel')).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(0);
  const shady = page.getByRole('button', { name: "Plus à l'ombre", exact: true });
  const sunny = page.getByRole('button', { name: 'Plus au soleil', exact: true });
  await expect(sunny).toHaveAttribute('aria-pressed', /true|false/);
  await shady.click();
  await expect(shady).toHaveAttribute('aria-pressed', 'true');
  await expect(sunny).toHaveAttribute('aria-pressed', 'false');
});
