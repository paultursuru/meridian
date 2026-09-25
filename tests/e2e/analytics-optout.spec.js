import { test, expect } from '@playwright/test';

// The visit statistics switch, in the About panel and on the privacy page.
// It writes the key Umami's tracker reads before every send. What this can't
// show is the real tracker going quiet: it only sends from meridian-way.ch.

const KEY = 'umami.disabled';
const stored = page => page.evaluate(k => localStorage.getItem(k), KEY);

// Umami never loads here, so stand one up before the app's module runs.
async function collectEvents(page) {
  await page.addInitScript(() => {
    window.__events = [];
    window.umami = { track: (...args) => window.__events.push(args) };
  });
}

const eventCount = page => page.evaluate(() => window.__events.length);

async function openAbout(page) {
  await page.goto('/');
  // initAutocomplete() puts role=combobox on the field: the app script runs.
  await page.waitForSelector('#inp-end[role="combobox"]');
  await page.click('#about-btn');
  await expect(page.locator('#about-drawer')).toHaveClass(/open/);
  return page.locator('#about-drawer .optout-switch');
}

test('the About panel switch opts out and back in, and the state survives a reload', async ({ page }) => {
  let sw = await openAbout(page);
  await expect(sw).toBeChecked();
  expect(await stored(page)).toBeNull();

  await sw.click();
  await expect(sw).not.toBeChecked();
  expect(await stored(page)).toBe('1');

  sw = await openAbout(page);
  await expect(sw).not.toBeChecked();

  await sw.click();
  await expect(sw).toBeChecked();
  expect(await stored(page)).toBeNull();

  sw = await openAbout(page);
  await expect(sw).toBeChecked();
});

test('the privacy page switch shares its state with the app', async ({ page }) => {
  await page.goto('/en/privacy');
  const sw = page.locator('.privacy-optout .optout-switch');
  await expect(sw).toBeChecked();

  await sw.click();
  await expect(sw).not.toBeChecked();
  expect(await stored(page)).toBe('1');

  await expect(await openAbout(page)).not.toBeChecked();
});

test('toggling sends no analytics event', async ({ page }) => {
  await collectEvents(page);
  const sw = await openAbout(page);
  const before = await eventCount(page);

  await sw.click();
  await sw.click();

  expect(await eventCount(page)).toBe(before);
});

test('a refused write leaves the switch on', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Quota', 'QuotaExceededError'); };
  });
  const sw = await openAbout(page);

  await sw.click();

  await expect(sw).toBeChecked();
});
