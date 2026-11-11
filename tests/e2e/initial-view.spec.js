import { test, expect } from '@playwright/test';

// In the Swiss timezone the map opens on a city picked by the browser's
// language, with no IP lookup. Read through the autocomplete's anchor, which
// is the map's own centre once it has loaded.

const CITIES = {
  'fr-CH': { name: 'Lausanne', lat: 46.5197, lng: 6.6323 },
  'de-CH': { name: 'Zurich', lat: 47.3769, lng: 8.5417 },
};

async function anchorOnceLoaded(page) {
  const asked = [];
  await page.route('https://photon.komoot.io/**', route => {
    asked.push(new URL(route.request().url()));
    return route.fulfill({ json: { features: [] } });
  });
  await page.route('https://tiles.stadiamaps.com/**', route =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  await page.goto('/');
  await expect(page.locator('#map-splash')).toHaveClass(/hidden/, { timeout: 20_000 });
  await page.fill('#inp-start', 'gare');
  await expect.poll(() => asked.length).toBeGreaterThan(0);
  const url = asked.at(-1);
  return { lat: Number(url.searchParams.get('lat')), lng: Number(url.searchParams.get('lon')) };
}

for (const [locale, city] of Object.entries(CITIES)) {
  test.describe(`browser in ${locale}`, () => {
    test.use({ timezoneId: 'Europe/Zurich', locale });

    test(`opens on ${city.name}, even on the French page`, async ({ page }) => {
      const at = await anchorOnceLoaded(page);
      expect(at.lat).toBeCloseTo(city.lat, 2);
      expect(at.lng).toBeCloseTo(city.lng, 2);
    });
  });
}
