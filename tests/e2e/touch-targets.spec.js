import { test, expect } from '@playwright/test';

// On a phone, the form's controls take a 44px tap, the comfortable size; the
// swap button, squeezed between the two fields, keeps at least the 24px WCAG
// AA floor. The icon may stay smaller: what counts is the area that answers
// the tap, so the check probes points around the control's centre instead of
// reading its box.

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const TARGET = 44;
const FLOOR = 24;

async function stubUpstreams(page) {
  await page.route(/nominatim|photon|open-meteo|workers\.dev|stadiamaps|openfreemap/, route => route.abort());
}

// The points of a width x height box centred on the control that a tap does
// not reach it from, with what gets the tap instead. Empty when the whole box
// answers.
async function hitArea(locator, width = TARGET, height = width) {
  return locator.evaluate((el, [w, h]) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const hx = w / 2 - 0.5;
    const hy = h / 2 - 0.5;
    const misses = [];
    for (const [dx, dy] of [[-hx, -hy], [hx, -hy], [-hx, hy], [hx, hy], [0, -hy], [0, hy], [-hx, 0], [hx, 0]]) {
      const hit = document.elementFromPoint(cx + dx, cy + dy);
      if (!hit || !(hit === el || el.contains(hit))) misses.push([dx, dy, hit?.id || hit?.className || hit?.tagName]);
    }
    return misses;
  }, [width, height]);
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

test('the form icons answer a 44px tap', async ({ page }) => {
  // The clear buttons only show once their field has text.
  await page.fill('#inp-start', 'Lausanne-Gare');
  await page.fill('#inp-end', 'Musée olympique');
  await page.locator('#search-panel .input-label').first().click();
  for (const id of ['#clear-start', '#geo-start', '#clear-end', '#geo-end', '#about-btn']) {
    expect(await hitArea(page.locator(id)), id).toEqual([]);
  }
});

test('the swap button is 44px wide and leaves taps on the fields to them', async ({ page }) => {
  const swap = page.locator('#swap-btn');
  expect(await hitArea(swap, TARGET, FLOOR)).toEqual([]);

  // Just inside each field, straight above and below the button.
  const { x, width } = await swap.boundingBox();
  const start = await page.locator('#inp-start').boundingBox();
  const end = await page.locator('#inp-end').boundingBox();
  const at = (px, py) => page.evaluate(([a, b]) => document.elementFromPoint(a, b)?.id, [px, py]);
  for (const dx of [-TARGET / 2 + 1, 0, TARGET / 2 - 1]) {
    expect(await at(x + width / 2 + dx, start.y + start.height - 3)).toBe('inp-start');
    expect(await at(x + width / 2 + dx, end.y + 3)).toBe('inp-end');
  }
});

test('the bubbles close with a 44px tap', async ({ page }) => {
  expect(await hitArea(page.locator('#app-description-close'))).toEqual([]);
  // The demo's note, shown as the demo shows it, without running a search.
  await page.evaluate(() => document.getElementById('onboarding-note').classList.add('on'));
  expect(await hitArea(page.locator('#onboarding-note-close'))).toEqual([]);
});
