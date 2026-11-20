import { test, expect } from '@playwright/test';

// The language menu in the app's header: the button says the language on
// screen, and opens the four others to its left, without the about drawer.

const MOBILE = { width: 390, height: 844 };
const TARGET = 44;

test.beforeEach(async ({ page }) => {
  await page.route(/nominatim|photon|open-meteo|workers\.dev|stadiamaps|openfreemap/, route => route.abort());
});

test('the button names the language on screen and opens the four others', async ({ page }) => {
  await page.goto('/');
  const btn = page.locator('#lang-btn');
  await expect(btn).toHaveAccessibleName('Langue : FR');
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#lang-menu')).toBeHidden();

  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  const links = page.locator('#lang-menu a');
  await expect(links).toHaveText(['DE', 'IT', 'RM', 'EN']);
  await expect(links.first()).toHaveAttribute('lang', 'de');

  await links.first().click();
  await expect(page).toHaveURL(/\/de\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.locator('#lang-btn')).toHaveAccessibleName('Sprache: DE');
});

test('Escape and a click elsewhere close it', async ({ page }) => {
  await page.goto('/');
  const btn = page.locator('#lang-btn');
  await btn.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#lang-menu')).toBeHidden();
  await expect(btn).toBeFocused();
  await expect(btn).toHaveAttribute('aria-expanded', 'false');

  await btn.click();
  // The header's own left padding: nothing there to follow.
  await page.mouse.click(5, 20);
  await expect(page.locator('#lang-menu')).toBeHidden();
});

test('on a phone, both header buttons answer a 44px tap', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto('/');
  for (const id of ['#lang-btn', '#about-btn']) {
    const misses = await page.locator(id).evaluate((el, size) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const h = size / 2 - 0.5;
      return [[-h, -h], [h, -h], [-h, h], [h, h], [0, -h], [0, h], [-h, 0], [h, 0]]
        .map(([dx, dy]) => document.elementFromPoint(cx + dx, cy + dy))
        .filter(hit => !hit || !(hit === el || el.contains(hit)))
        .map(hit => hit?.id || hit?.tagName);
    }, TARGET);
    expect(misses, id).toEqual([]);
  }
});
