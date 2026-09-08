import { test, expect } from '@playwright/test';

// The "installed app" polish: the handful of declarations that decide whether
// the PWA reads as an app or as a web page in a browser. None of them has any
// effect in a desktop tab, which is exactly why they went missing.
//
// Two of the five are only assertable as source: 100dvh and the tap highlight
// need browser chrome that collapses and a finger, neither of which exists in
// headless Chromium. Those are pinned as declarations, to catch a revert.
//
// The safe-area wiring is testable for real, because it is arithmetic:
// Playwright cannot give the page a notch, but the insets reach the layout
// through four custom properties, and overriding those on :root is
// indistinguishable, to every rule downstream, from running on a device that
// has one. That is what the second describe block does, and it is the part
// that can actually break: the drawer's peek is read back by ui.js to dock the
// scrubber, so an inset that CSS honours but JS cannot parse would slide the
// scrubber under the drawer on a real iPhone and nowhere else.

const START = '46.5197,6.6323';
const END = '46.5250,6.6400';
const SEARCH_URL = `/?from=${START}&to=${END}&dt=2026-08-13T14:00`;

// iPhone 14/15 in portrait, the shape this whole item is about.
const PHONE = { width: 390, height: 844 };

// The insets a notched iPhone reports in portrait, standalone. Left/right are
// 0 there, since they only open up in landscape, so the two exercised below
// are the two that matter on the first screen.
const NOTCH = { top: '47px', right: '0px', bottom: '34px', left: '0px' };

async function mockUpstreams(page) {
  await page.route('https://nominatim.openstreetmap.org/**', route => route.fulfill({
    json: { display_name: 'Lausanne, Suisse', address: { country_code: 'ch' } },
  }));
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({
    json: { hourly: { time: [], cloud_cover: [], temperature_2m: [] } },
  }));
  await page.route('https://ors-proxy.meridianway.workers.dev/**', route => route.fulfill({
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
  await page.route('https://overpass-cache.meridianway.workers.dev/**', route => route.fulfill({
    json: { elements: [] },
  }));
  await page.route('https://swissbuildings-lookup.meridianway.workers.dev/**', route => route.fulfill({
    json: { buildings: [] },
  }));
  // The basemap is irrelevant here and would otherwise pull tiles every run.
  await page.route('https://tiles.stadiamaps.com/**', route => route.fulfill({
    json: { version: 8, sources: {}, layers: [] },
  }));
}

// Every declaration the page actually applied for `selector`, concatenated.
// Reads the live stylesheets rather than the file, so it follows whatever the
// build does to main.css.
//
// selectorText before cssRules, not the other way round: since CSS nesting
// shipped, a plain CSSStyleRule also carries a (usually empty) cssRules, so
// testing that first walks straight past every rule in the sheet and finds
// nothing. Grouped selectors are split, since a declaration shared by four
// selectors is still that rule's declaration.
async function declarationsFor(page, selector) {
  return page.evaluate((sel) => {
    const out = [];
    const walk = (rules) => {
      for (const rule of rules) {
        if (rule.selectorText) {
          if (rule.selectorText.split(',').some(s => s.trim() === sel)) out.push(rule.style.cssText);
        } else if (rule.cssRules) walk(rule.cssRules);
      }
    };
    for (const sheet of document.styleSheets) {
      try { walk(sheet.cssRules); } catch { /* cross-origin, not ours */ }
    }
    return out.join(' ');
  }, selector);
}

test.use({ viewport: PHONE });

test.describe('the installed-app declarations', () => {
  test.beforeEach(async ({ page }) => {
    await mockUpstreams(page);
    await page.goto('/');
    await expect(page.locator('#map')).toBeVisible();
  });

  test('the viewport reaches the edges of the screen', async ({ page }) => {
    // Without viewport-fit=cover iOS letterboxes the page inside the safe
    // area, and env(safe-area-inset-*) reports 0 whatever the hardware, which
    // would leave every calc() in the block below silently inert.
    const content = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(content).toContain('viewport-fit=cover');
  });

  test('the status bar is told to match the theme colour', async ({ page }) => {
    await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]'))
      .toHaveAttribute('content', 'black');
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]'))
      .toHaveAttribute('content', 'yes');
  });

  test('the app is sized to the visible viewport, not the collapsed-chrome one', async ({ page }) => {
    // 100vh is the viewport with the browser's bars hidden. This app never
    // scrolls (body is overflow: hidden), so on iOS those bars never collapse
    // and the bottom of the app, drawer and scrubber, stays underneath them.
    // Only assertable as a declaration: headless Chromium has no bars, so dvh
    // and vh measure the same here.
    for (const selector of ['body', '#app']) {
      expect(await declarationsFor(page, selector)).toContain('100dvh');
    }
    // Still worth checking they agree with the window in this browser: a typo
    // in the fallback would show up as a body that no longer fills it.
    const height = await page.evaluate(() => document.getElementById('app').getBoundingClientRect().height);
    expect(height).toBe(PHONE.height);
  });

  test('the page does not bounce or pull to refresh', async ({ page }) => {
    const behavior = await page.evaluate(() =>
      getComputedStyle(document.documentElement).overscrollBehaviorY);
    expect(behavior).toBe('none');
  });

  test('taps do not flash grey, and press feedback replaces the flash', async ({ page }) => {
    const highlight = await page.evaluate(() =>
      getComputedStyle(document.getElementById('about-btn')).webkitTapHighlightColor);
    expect(highlight).toBe('rgba(0, 0, 0, 0)');
    // The replacement, which is the half that is easy to forget: :hover never
    // fires on touch, so removing the highlight on its own leaves a tap with
    // no acknowledgement at all.
    expect(await declarationsFor(page, 'button:active')).toContain('opacity');
  });
});

test.describe('safe-area insets, simulated', () => {
  // Applied before the app runs: an inset present from the first layout is the
  // real case, and it means the first fit and the first scrubber dock both see
  // it, rather than a resize papering over a value read too early.
  async function withNotch(page) {
    await page.addInitScript((notch) => {
      const apply = () => {
        const root = document.documentElement;
        root.style.setProperty('--safe-top', notch.top);
        root.style.setProperty('--safe-right', notch.right);
        root.style.setProperty('--safe-bottom', notch.bottom);
        root.style.setProperty('--safe-left', notch.left);
      };
      if (document.documentElement) apply();
      else document.addEventListener('DOMContentLoaded', apply);
    }, NOTCH);
  }

  test('the header clears the notch', async ({ page }) => {
    await mockUpstreams(page);
    await withNotch(page);
    await page.goto('/');
    await expect(page.locator('#map')).toBeVisible();

    const top = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.getElementById('header')).paddingTop));
    expect(top).toBe(8 + 47);
  });

  test('the collapsed drawer keeps its whole peek above the home indicator', async ({ page }) => {
    await mockUpstreams(page);
    await page.goto(SEARCH_URL);
    await expect(page.locator('#time-scrubber')).toHaveClass(/on/, { timeout: 20_000 });
    await page.waitForTimeout(500);
    const plain = await page.evaluate(() =>
      document.getElementById('results').getBoundingClientRect().top);

    // Same page, with the inset. The peek has to grow by exactly the indicator
    // it now has to clear: the 168px of content the peek was designed around
    // is otherwise the 134px above the indicator plus 34px underneath it.
    const notched = await page.context().newPage();
    await mockUpstreams(notched);
    await withNotch(notched);
    await notched.setViewportSize(PHONE);
    await notched.goto(SEARCH_URL);
    await expect(notched.locator('#time-scrubber')).toHaveClass(/on/, { timeout: 20_000 });
    await notched.waitForTimeout(500);
    const shifted = await notched.evaluate(() =>
      document.getElementById('results').getBoundingClientRect().top);

    expect(plain - shifted).toBe(34);
    await notched.close();
  });

  test('the scrubber follows the drawer up instead of sliding under it', async ({ page }) => {
    // The one that only breaks on a device: the peek is a CSS custom property
    // that ui.js parses to dock the scrubber. An unregistered property hands
    // JS the literal string "calc(168px + 34px)", parseFloat reads 168, and
    // the scrubber docks a home indicator's worth too low, over the drawer.
    await mockUpstreams(page);
    await withNotch(page);
    await page.goto(SEARCH_URL);
    await expect(page.locator('#time-scrubber')).toHaveClass(/on/, { timeout: 20_000 });
    await page.waitForTimeout(500);

    const peek = await page.evaluate(() => parseFloat(
      getComputedStyle(document.getElementById('results')).getPropertyValue('--drawer-peek')));
    expect(peek).toBe(168 + 34);

    const gap = await page.evaluate(() => {
      const s = document.getElementById('time-scrubber').getBoundingClientRect();
      const d = document.getElementById('results').getBoundingClientRect();
      return d.top - s.bottom;
    });
    expect(gap).toBeGreaterThanOrEqual(0);
  });

  test('the expanded drawer scrolls its last line clear of the home indicator', async ({ page }) => {
    await mockUpstreams(page);
    await withNotch(page);
    await page.goto(SEARCH_URL);
    await expect(page.locator('#time-scrubber')).toHaveClass(/on/, { timeout: 20_000 });

    await page.click('#drawer-handle');
    await expect(page.locator('#results')).toHaveClass(/expanded/);
    await page.waitForTimeout(500);

    // Expanded, the drawer sits flush on the bottom edge, so the indicator is
    // over its content rather than over the strip below the peek: a padding
    // problem rather than a peek problem, and a separate declaration.
    const bottom = await page.evaluate(() => {
      const el = document.getElementById('results');
      el.scrollTop = el.scrollHeight;
      const last = [...el.children].reverse().find(c => c.getBoundingClientRect().height > 0);
      return {
        padding: parseFloat(getComputedStyle(el).paddingBottom),
        content: last.getBoundingClientRect().bottom,
        window: window.innerHeight,
      };
    });
    expect(bottom.padding).toBe(34);
    expect(bottom.content).toBeLessThanOrEqual(bottom.window - 34);
  });
});
