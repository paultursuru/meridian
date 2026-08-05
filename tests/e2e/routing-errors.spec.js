import { test, expect } from '@playwright/test';

// Signalé le 2026-08-05 : un utilisateur tape "lausanne gare" et "ouchy", et
// reçoit "Erreur : ORS 400". Deux problèmes empilés.
//
// 1. "ouchy" seul est géocodé par Nominatim sur une ferme du Queensland, en
//    Australie. L'app demande donc un trajet à pied Lausanne -> Australie, et
//    ORS refuse (code 2004 : "approximated route distance must not be greater
//    than 6000000.0 meters").
// 2. Ce refus remontait brut à l'écran. Seuls les 429/503/504 étaient traduits
//    en message humain ; tout le reste s'affichait sous forme de "ORS <statut>".
//
// buildRoutes() coupe maintenant avant l'appel quand la distance à vol d'oiseau
// dépasse MAX_WALK_M, et les statuts non gérés donnent un message traduit.

const LAUSANNE = { lat: 46.5171, lng: 6.6331 };
const QUEENSLAND = { lat: -19.9078, lng: 140.9236 };
const RENENS = { lat: 46.5373, lng: 6.5853 };

async function mockUpstreams(page, { orsStatus = 200, endPoint = RENENS } = {}) {
  await page.route('https://nominatim.openstreetmap.org/search**', route => {
    const q = (new URL(route.request().url()).searchParams.get('q') || '').toLowerCase();
    // "ouchy" est le cas du signalement : c'est lui qui reçoit le point lointain.
    const hit = q.includes('ouchy') ? endPoint : q.includes('renens') ? RENENS : LAUSANNE;
    return route.fulfill({
      json: [{ lat: String(hit.lat), lon: String(hit.lng), display_name: q, address: { country_code: 'ch' } }],
    });
  });
  await page.route('https://photon.komoot.io/**', route => route.fulfill({ json: { features: [] } }));
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({
    json: { hourly: { time: [], cloud_cover: [], temperature_2m: [] } },
  }));
  await page.route('https://ors-proxy.meridianway.workers.dev/**', route => {
    if (orsStatus !== 200) {
      return route.fulfill({
        status: orsStatus,
        json: { error: { code: 2004, message: 'Request parameters exceed the server configuration limits.' } },
      });
    }
    return route.fulfill({ json: { features: [{
      geometry: { type: 'LineString', coordinates: [[LAUSANNE.lng, LAUSANNE.lat, 0], [endPoint.lng, endPoint.lat, 0]] },
      properties: { summary: { distance: 2400, duration: 1900 } },
    }] } });
  });
  await page.route('https://swissbuildings-lookup.meridianway.workers.dev/**', route => route.fulfill({ json: { buildings: [] } }));
  await page.route('https://overpass-cache.meridianway.workers.dev/**', route => route.fulfill({ json: { elements: [] } }));
}

async function waitForApp(page) {
  await page.waitForSelector('#inp-start[role="combobox"]');
  await page.waitForSelector('#inp-end[role="combobox"]');
}

async function search(page, from, to) {
  await page.fill('#inp-start', from);
  await page.keyboard.press('Escape');
  await page.fill('#inp-end', to);
  await page.keyboard.press('Escape');
  await page.click('#search-btn');
}

test('une adresse géocodée à l\'autre bout du monde donne un message explicite, pas un code ORS', async ({ page }) => {
  await mockUpstreams(page, { endPoint: QUEENSLAND });
  await page.goto('/en/');
  await waitForApp(page);

  await search(page, 'lausanne gare', 'ouchy');

  const toast = page.locator('#toast');
  await expect(toast).toHaveClass(/\bon\b/);
  await expect(toast).toHaveText(/too far apart for a walking route/i);
  await expect(toast).not.toHaveText(/ORS/);
});

test('le garde-fou de distance évite complètement l\'appel à ORS', async ({ page }) => {
  await mockUpstreams(page, { endPoint: QUEENSLAND });
  let orsCalls = 0;
  page.on('request', req => { if (req.url().includes('ors-proxy')) orsCalls++; });

  await page.goto('/en/');
  await waitForApp(page);
  await search(page, 'lausanne gare', 'ouchy');

  await expect(page.locator('#toast')).toHaveClass(/\bon\b/);
  // Le quota ORS est de 2000 requêtes par jour : ne pas en dépenser une pour
  // un trajet dont on sait déjà qu'il n'a aucun sens.
  expect(orsCalls).toBe(0);
});

test('un statut ORS non géré donne un message traduit, pas "ORS 400"', async ({ page }) => {
  await mockUpstreams(page, { orsStatus: 400 });
  await page.goto('/en/');
  await waitForApp(page);

  await search(page, 'lausanne gare', 'renens');

  const toast = page.locator('#toast');
  await expect(toast).toHaveClass(/\bon\b/);
  await expect(toast).toHaveText(/No route could be calculated/i);
  await expect(toast).not.toHaveText(/ORS|400/);
});

test('un trajet normal n\'est pas affecté par le garde-fou', async ({ page }) => {
  await mockUpstreams(page);
  await page.goto('/en/');
  await waitForApp(page);

  await search(page, 'lausanne gare', 'renens');

  await expect(page.locator('#sunny-sun-pct')).not.toBeEmpty({ timeout: 30_000 });
});
