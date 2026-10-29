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
