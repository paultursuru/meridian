import { test, expect } from '@playwright/test';

// Content pages report which link took a reader into the app. The click
// leaves the page, so the events are collected on the test side.

async function collectEvents(page) {
  const sent = [];
  await page.exposeFunction('__track', (name, props) => { if (name) sent.push([name, props]); });
  await page.addInitScript(() => { window.umami = { track: (name, props) => window.__track(name, props) }; });
  return sent;
}

async function stubUpstreams(page) {
  await page.route(/nominatim|photon|open-meteo|workers\.dev|stadiamaps|openfreemap/, route => route.abort());
}

const LINKS = [
  ['/lausanne/', '.route-link', 'route'],
  ['/lausanne/', '.method a[data-app-link]', 'method'],
  ['/lausanne/', '.content-nav .open-app', 'nav'],
  ['/comment-ca-marche/', '.content-nav .wordmark', 'logo'],
];

for (const [path, selector, link] of LINKS) {
  test(`${path} reports a click on its ${link} link into the app`, async ({ page }) => {
    const sent = await collectEvents(page);
    await stubUpstreams(page);
    await page.goto(path);

    await page.locator(selector).click();

    await expect.poll(() => sent.filter(([name]) => name === 'app_open'))
      .toEqual([['app_open', { page: path.slice(1, -1), link }]]);
  });
}

test('a link that stays on the content pages reports nothing', async ({ page }) => {
  const sent = await collectEvents(page);
  await stubUpstreams(page);
  await page.goto('/lausanne/');

  await page.locator('.method a[href="/comment-ca-marche/"]').click();
  await expect(page).toHaveURL(/comment-ca-marche/);

  expect(sent.filter(([name]) => name === 'app_open')).toEqual([]);
});

// The app's logo leads back to the app in the language on screen.
for (const path of ['/', '/en/', '/de/', '/it/', '/rm/']) {
  test(`the logo on ${path} links to ${path}`, async ({ page }) => {
    await stubUpstreams(page);
    await page.goto(path);
    await expect(page.locator('#header h1 a')).toHaveAttribute('href', path);
  });
}

test('the route link is a filled button in both moods, like the 404 one', async ({ page }) => {
  await stubUpstreams(page);
  const bg = (sel) => page.locator(sel).evaluate(el => getComputedStyle(el).backgroundColor);

  await page.goto('/lausanne/');
  const btn = page.locator('.route-link');
  expect((await btn.boundingBox()).height).toBeGreaterThanOrEqual(44);
  // The page opens on the sun side: the sun's yellow, edged in amber on the cream card.
  await expect.poll(() => bg('.route-link')).toBe('rgb(255, 201, 60)');
  expect(await btn.evaluate(el => getComputedStyle(el).borderTopColor)).toBe('rgb(179, 125, 0)');
  await page.click('.opt-shade');
  await expect.poll(() => bg('.route-link')).toBe('rgb(240, 242, 160)');

  await page.goto('/nowhere-at-all/');
  await expect.poll(() => bg('.open-app-btn')).toBe('rgb(240, 242, 160)');
});
