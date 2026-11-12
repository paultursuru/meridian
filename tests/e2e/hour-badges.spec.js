import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

// On mobile, the notes that change how to read an hour (overcast sky, very
// low sun) live under the routes, and round badges over the scrubber point at
// them. What these pin: the folded drawer keeps its shade/sun bar in view
// however many notes are on, and a badge opens its note's sentence.

const START = '46.5197,6.6323';
const END = '46.5250,6.6400';
const MOBILE = { width: 390, height: 844 };
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

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
  // The app only asks for a forecast within its window: the page's clock is
  // set to that morning. Hours are unix seconds, as the app requests them.
  await page.clock.setFixedTime(new Date('2026-08-13T08:00:00+02:00'));
  const hour = (iso) => Date.parse(iso) / 1000;
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({
    json: { hourly: { time: [hour('2026-08-13T20:00:00+02:00'), hour('2026-08-13T21:00:00+02:00')], cloud_cover: [95, 95], temperature_2m: [18, 17] } },
  }));
}

// 20:30 is a low sun (grazing note) under a fully overcast forecast.
async function searchAtDusk(page) {
  await page.setViewportSize(MOBILE);
  await mockUpstreams(page);
  await page.goto(`/?from=${START}&to=${END}&dt=2026-08-13T20:30`);
  await expect(page.locator('#results')).toHaveClass(/on/, { timeout: 20_000 });
  await expect(page.locator('#weather-note')).toHaveClass(/on/);
  await expect(page.locator('#grazing-sun-note')).toHaveClass(/on/);
  await page.waitForTimeout(500); // the drawer slides in over 0.32s
}

test('the folded drawer keeps the shade/sun bar in view, the notes become badges', async ({ page }) => {
  await searchAtDusk(page);

  const bar = await page.locator('#tab-sunny .ratio-track').boundingBox();
  expect(bar.y + bar.height).toBeLessThanOrEqual(MOBILE.height);
  await expect(page.locator('#badge-weather')).toBeVisible();
  await expect(page.locator('#badge-weather')).toHaveAccessibleName('Ciel couvert à 95 %');
  await expect(page.locator('#badge-grazing')).toBeVisible();
  // Over the scrubber, not on the drawer.
  const badge = await page.locator('#badge-weather').boundingBox();
  const scrubber = await page.locator('#time-scrubber').boundingBox();
  expect(badge.y + badge.height).toBeLessThanOrEqual(scrubber.y);
});

test('a badge opens its note, another badge, Escape or a tap elsewhere puts it away', async ({ page }) => {
  await searchAtDusk(page);
  const bubble = page.locator('#hour-bubble');

  await page.click('#badge-weather');
  await expect(bubble).toBeVisible();
  await expect(bubble).toHaveText(/Ciel couvert prévu \(95 % de nuages\)/);
  await expect(page.locator('#badge-weather')).toHaveAttribute('aria-expanded', 'true');

  await page.click('#badge-grazing');
  await expect(bubble).toHaveText(/Le soleil est très bas/);
  await expect(page.locator('#badge-weather')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#badge-grazing')).toHaveAttribute('aria-expanded', 'true');

  await page.keyboard.press('Escape');
  await expect(bubble).toBeHidden();
  await expect(page.locator('#badge-grazing')).toHaveAttribute('aria-expanded', 'false');

  await page.click('#badge-weather');
  await page.mouse.click(100, 300); // the map
  await expect(bubble).toBeHidden();
});

test('the badges and their bubble pass the WCAG rules', async ({ page }) => {
  await searchAtDusk(page);
  await page.addStyleTag({ content: '*, *::before { transition: none !important; }' });
  await page.click('#badge-weather');

  const { violations, incomplete } = await new AxeBuilder({ page })
    .include('#time-scrubber').include('#hour-notes').withTags(WCAG_TAGS).analyze();
  expect(violations.flatMap(v => v.nodes.map(n => `${v.id}: ${n.target.join(' ')}`))).toEqual([]);
  // A rule that crashes lands in "incomplete", and the line above would pass without it.
  expect(incomplete.filter(rule => rule.error).map(rule => rule.id)).toEqual([]);
});
