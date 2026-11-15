import { test, expect } from '@playwright/test';

// Each language's app page describes the app in that language: the
// WebApplication JSON-LD carries the page's own URL and description, and a
// feature list of its own, while inLanguage keeps all five.

const PATHS = ['/', '/de/', '/it/', '/rm/', '/en/'];

async function stubUpstreams(page) {
  await page.route(/nominatim|photon|open-meteo|workers\.dev|stadiamaps|openfreemap/, route => route.abort());
}

async function webApplication(page) {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.map(text => JSON.parse(text)).find(data => data['@type'] === 'WebApplication');
}

for (const path of PATHS) {
  test(`${path} describes the app with its own URL and description`, async ({ page }) => {
    await stubUpstreams(page);
    await page.goto(path);
    const app = await webApplication(page);

    expect(app.url).toBe(await page.locator('link[rel="canonical"]').getAttribute('href'));
    expect(app.description).toBe(await page.locator('meta[name="description"]').getAttribute('content'));
    expect(app.inLanguage).toEqual(['fr', 'de', 'it', 'rm', 'en']);
    expect(app.featureList).toHaveLength(3);
  });
}

test('no language carries another one\'s feature list', async ({ page }) => {
  await stubUpstreams(page);
  const features = new Set();
  for (const path of PATHS) {
    await page.goto(path);
    (await webApplication(page)).featureList.forEach(feature => features.add(feature));
  }
  expect(features.size).toBe(PATHS.length * 3);
});
