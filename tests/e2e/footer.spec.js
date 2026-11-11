import { test, expect } from '@playwright/test';

// One footer for the app's about drawer, the about and privacy pages, and the
// content pages: the same links in the same order, the page you're on named
// rather than linked, and llms.txt kept apart from the human pages.

const FR_LINKS = ['À propos', 'Confidentialité', 'Comment ça marche ?', 'Lausanne en hiver'];

async function stubUpstreams(page) {
  await page.route(/nominatim|photon|open-meteo|workers\.dev|stadiamaps|openfreemap/, route => route.abort());
}

const items = footer => footer.locator('ul > li').allTextContents();

for (const [path, current] of [
  ['/about/', 'À propos'],
  ['/privacy/', 'Confidentialité'],
  ['/comment-ca-marche/', 'Comment ça marche ?'],
  ['/lausanne/', 'Lausanne en hiver'],
]) {
  test(`${path} shows the shared footer, naming itself instead of linking to itself`, async ({ page }) => {
    await stubUpstreams(page);
    await page.goto(path);
    const footer = page.locator('.site-footer');

    expect(await items(footer)).toEqual(FR_LINKS);
    await expect(footer.locator('[aria-current="page"]')).toHaveText(current);
    await expect(footer.getByRole('link', { name: current, exact: true })).toHaveCount(0);
    await expect(footer.getByRole('link')).toHaveCount(FR_LINKS.length);
    // Not a human page: below the list, not in it.
    await expect(footer.locator('ul').getByRole('link', { name: 'llms.txt' })).toHaveCount(0);
    await expect(footer.locator('.site-footer-machine a')).toHaveAttribute('href', '/llms.txt');
  });
}

test('the app drawer has the same footer, every item a link', async ({ page }) => {
  await stubUpstreams(page);
  await page.goto('/');
  const footer = page.locator('#about-drawer .site-footer');
  expect(await items(footer)).toEqual(FR_LINKS);
  await expect(footer.locator('[aria-current]')).toHaveCount(0);
});

test('a translated page lists only its own pages, with no stray separators', async ({ page }) => {
  await stubUpstreams(page);
  await page.goto('/en/privacy/');
  const footer = page.locator('.site-footer');
  expect(await items(footer)).toEqual(['About', 'Privacy']);
  // No dash or dot written between links: on a phone they ended up alone at a line end.
  expect(await footer.locator('ul').innerText()).not.toMatch(/(^|\s)[-·](\s|$)/);
});
