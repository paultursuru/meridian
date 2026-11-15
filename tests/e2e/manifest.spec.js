import { test, expect } from '@playwright/test';

// Each language links its own manifest, so an app installed from /it/ opens
// on /it/. Installing can't be driven from here: this pins what the browser
// reads when it does.

async function stubUpstreams(page) {
  await page.route(/nominatim|photon|open-meteo|workers\.dev|stadiamaps/, route => route.abort());
}

async function manifestOf(page) {
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const res = await page.request.get(new URL(href, page.url()).href);
  expect(res.ok()).toBe(true);
  expect(res.headers()['content-type']).toContain('application/manifest+json');
  return { href, manifest: await res.json() };
}

for (const [lang, path] of [['fr', '/'], ['de', '/de/'], ['it', '/it/'], ['rm', '/rm/'], ['en', '/en/']]) {
  test(`${path} links a manifest that opens the app in ${lang}`, async ({ page }) => {
    await stubUpstreams(page);
    await page.goto(path);
    const { href, manifest } = await manifestOf(page);

    expect(href).toBe(`${path}site.webmanifest`);
    expect(manifest).toMatchObject({ lang, start_url: path, id: path, scope: '/' });
    // The page's own description, already translated and reviewed.
    expect(manifest.description).toBe(await page.locator('meta[name="description"]').getAttribute('content'));
    expect((await page.request.get(manifest.start_url)).ok()).toBe(true);
  });
}

// French existing installs look for updates at the old address.
test('the French manifest stays at /site.webmanifest', async ({ page }) => {
  const res = await page.request.get('/site.webmanifest');
  expect((await res.json()).start_url).toBe('/');
});

for (const [path, href] of [['/de/about/', '/de/site.webmanifest'], ['/lausanne/', '/site.webmanifest']]) {
  test(`${path} links ${href}`, async ({ page }) => {
    await stubUpstreams(page);
    await page.goto(path);
    expect((await manifestOf(page)).href).toBe(href);
  });
}
