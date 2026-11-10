import { test, expect } from '@playwright/test';

// On a phone, every control of the form takes a 44px tap. The icon may stay
// smaller: what counts is the area that answers the tap, so the check probes
// points around the control's centre instead of reading its box.

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const TARGET = 44;

async function stubUpstreams(page) {
  await page.route(/nominatim|photon|open-meteo|workers\.dev|stadiamaps|openfreemap/, route => route.abort());
}

// The element that gets a tap at each corner of a 44px square centred on the
// control: the control itself, or something inside it.
async function hitArea(locator) {
  return locator.evaluate((el, size) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const half = size / 2 - 0.5;
    const misses = [];
    for (const [dx, dy] of [[-half, -half], [half, -half], [-half, half], [half, half], [0, -half], [0, half], [-half, 0], [half, 0]]) {
      const hit = document.elementFromPoint(cx + dx, cy + dy);
      if (!hit || !(hit === el || el.contains(hit))) misses.push([dx, dy, hit?.id || hit?.className || hit?.tagName]);
    }
    return misses;
  }, TARGET);
}

test.beforeEach(async ({ page }) => {
  await stubUpstreams(page);
  await page.goto('/');
});

test('the search button is 44px tall', async ({ page }) => {
  const box = await page.locator('#search-btn').boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(TARGET);
  expect(await hitArea(page.locator('#search-btn'))).toEqual([]);
});
