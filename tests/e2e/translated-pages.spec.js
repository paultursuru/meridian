import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

// The about and privacy pages sit on the same shell as the content pages:
// same nav, column and titles, plus a language switcher since they exist in
// every language.

const LANGS = ['fr', 'de', 'it', 'rm', 'en'];

async function stubUpstreams(page) {
  await page.route(/nominatim|photon|open-meteo|workers\.dev|stadiamaps|openfreemap/, route => route.abort());
}

const columnWidth = page => page.locator('.content-wrap').evaluate(el => el.getBoundingClientRect().width);

test('the about page has the content pages\' nav, column and title', async ({ page }) => {
  await stubUpstreams(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/comment-ca-marche/');
  const width = await columnWidth(page);

  await page.goto('/de/about/');
  expect(await columnWidth(page)).toBe(width);
  await expect(page.locator('.content-nav .wordmark')).toBeVisible();
  await expect(page.locator('.content-nav .open-app')).toHaveText('App öffnen');
  // A plain title: the wordmark is already in the nav.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Über die App');
});

test('the language switcher lists every language and marks the one on screen', async ({ page }) => {
  await stubUpstreams(page);
  await page.goto('/it/privacy/');
  const links = page.locator('.content-lang a');
  expect(await links.allTextContents()).toEqual(LANGS.map(l => l.toUpperCase()));
  await expect(page.locator('.content-lang a[aria-current="page"]')).toHaveText('IT');
  await expect(links.filter({ hasText: 'EN' })).toHaveAttribute('href', '/en/privacy/');
  await expect(links.filter({ hasText: 'FR' })).toHaveAttribute('href', '/privacy/');
});

test('the about page points search engines at each language; privacy stays out of the index', async ({ page }) => {
  await stubUpstreams(page);
  await page.goto('/about/');
  const hreflangs = await page.locator('head link[rel="alternate"][hreflang]').evaluateAll(
    els => els.map(el => el.getAttribute('hreflang')),
  );
  expect(hreflangs.sort()).toEqual([...LANGS, 'x-default'].sort());
  await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute('href', 'https://meridian-way.ch/about/');

  await page.goto('/privacy/');
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  // Still switchable by hand.
  await expect(page.locator('.content-lang a')).toHaveCount(LANGS.length);
});

test('the content pages, in French only, have no language switcher', async ({ page }) => {
  await stubUpstreams(page);
  await page.goto('/lausanne/');
  await expect(page.locator('.content-lang')).toHaveCount(0);
});

for (const path of ['/about/', '/privacy/']) {
  test(`${path} passes the WCAG rules`, async ({ page }) => {
    await stubUpstreams(page);
    await page.goto(path);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(violations.flatMap(v => v.nodes.map(n => `${v.id}: ${n.target.join(' ')}`))).toEqual([]);
  });
}

test('the privacy table never hyphenates a service name, only the long text beside it', async ({ page }) => {
  await stubUpstreams(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/de/privacy/');
  const hyphens = sel => page.locator(sel).first().evaluate(el => getComputedStyle(el).hyphens);
  // "Meri-dianWay" and "OpenFree-Map" read as typos.
  expect(await hyphens('tbody td:first-child')).toBe('manual');
  // German compounds still need it to fit a phone.
  expect(await hyphens('tbody td:nth-child(2)')).toBe('auto');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
