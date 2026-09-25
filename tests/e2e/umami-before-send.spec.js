import { test, expect } from '@playwright/test';

// Umami's tags name umamiBeforeSend, which rounds the route points and drops
// the typed labels (tests/analytics.test.js). This pins the wiring on each page
// that loads the tracker. The tracker itself never sends from localhost.

const SHARED = '/?from=46.51860,6.56800&fromq=Chez+moi+12&to=46.53730,6.58530&toq=Renens&dt=2026-08-13T14:00';

async function stubUpstreams(page) {
  await page.route(/nominatim|photon|open-meteo|workers\.dev|stadiamaps/, route => route.abort());
}

for (const path of ['/', '/en/about', '/en/privacy']) {
  test(`${path} names the hook on the Umami tag and defines it`, async ({ page }) => {
    await stubUpstreams(page);
    await page.goto(path);
    await expect(page.locator('script[src*="umami"]')).toHaveAttribute('data-before-send', 'umamiBeforeSend');
    await expect.poll(() => page.evaluate(() => typeof window.umamiBeforeSend)).toBe('function');
  });
}

test('a shared link reaches Umami rounded and without its labels', async ({ page }) => {
  await stubUpstreams(page);
  await page.goto(SHARED);
  await expect.poll(() => page.evaluate(() => typeof window.umamiBeforeSend)).toBe('function');

  const sent = await page.evaluate(() => window.umamiBeforeSend('event', { url: location.href, referrer: '' }).url);

  expect(sent).not.toContain('fromq');
  expect(sent).not.toContain('toq');
  expect(new URL(sent).searchParams.get('from')).toBe('46.519,6.568');
  expect(new URL(sent).searchParams.get('to')).toBe('46.537,6.585');
});
