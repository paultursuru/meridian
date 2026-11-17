import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

// A search is announced once, in one sentence, through #status. The results
// panel is not a live region: the scrubber rewrites it on every step, and a
// screen reader would read the whole panel each time.

const START = '46.5197,6.6323';
const END = '46.5250,6.6400';
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
// The app puts a no-break space before % and min.
const SUMMARY = /^Plus au soleil, Soleil \d+\s%, \d+\smin\. Plus à l'ombre, Ombre \d+\s%, \d+\smin\.$/;

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
  await page.route('https://tiles.stadiamaps.com/**', route =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  await page.clock.setFixedTime(new Date('2026-08-13T08:00:00+02:00'));
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ json: { hourly: null } }));
}

test('the status region is in the accessibility tree before its first message', async ({ page }) => {
  await page.goto('/');
  const status = page.locator('#status');
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status).not.toHaveCSS('display', 'none');
  await expect(page.locator('#results')).not.toHaveAttribute('role');
  await expect(page.locator('#results')).not.toHaveAttribute('aria-live');
});

test('a search is announced in one sentence, and the scrubber announces nothing more', async ({ page }) => {
  await mockUpstreams(page);
  await page.goto(`/?from=${START}&to=${END}&dt=2026-08-13T14:00`);
  await expect(page.locator('#results')).toHaveClass(/on/, { timeout: 20_000 });

  const status = page.getByRole('status').filter({ hasText: 'Plus au soleil' });
  await expect(status).toHaveText(SUMMARY);
  // Read out, not shown: the panel says it already.
  await expect(page.locator('#status')).not.toHaveClass(/\bon\b/);
  const box = await page.locator('#status').boundingBox();
  expect(box.width * box.height).toBeLessThanOrEqual(1);

  const said = await page.locator('#status').textContent();
  const slider = page.getByRole('slider');
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#status')).toHaveText(said);
});

for (const [layout, viewport] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 800 }]]) {
  test(`axe finds no violation on the results (${layout})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockUpstreams(page);
    await page.goto(`/?from=${START}&to=${END}&dt=2026-08-13T14:00`);
    await expect(page.locator('#results')).toHaveClass(/on/, { timeout: 20_000 });
    await page.waitForTimeout(500); // the drawer slides in over 0.32s

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.incomplete.filter(r => r.error)).toEqual([]);
    expect(results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(', ')}`)).toEqual([]);
  });
}
