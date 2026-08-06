import { test, expect } from '@playwright/test';

// Review #2, top 5 du 2026-08-06, point 2 : 100 % des erreurs mesurées dans
// l'export du 2026-08-05 remontaient avec code 'unknown', parce que quatre
// `throw` ne portaient aucun code. C'est ce qui a fait que la régression §9.5
// a coûté une investigation manuelle au lieu d'un filtre dans un tableur.
//
// Ces tests vérifient les deux bouts de la chaîne : la phrase que voit
// l'utilisateur, et le code qui part réellement dans l'event Umami. Le second
// est le vrai objet de la PR, et c'est celui qu'aucun test unitaire ne peut
// couvrir puisqu'il vit dans le catch de AppLayout.

const LAUSANNE = { lat: 46.5171, lng: 6.6331 };
const RENENS = { lat: 46.5373, lng: 6.5853 };

// window.umami est remplacé par un espion avant tout script de page, et le
// vrai script est bloqué pour qu'il ne vienne pas l'écraser. On teste nos
// appels, pas la transmission d'Umami : le tag porte data-domains, donc en
// local il n'enverrait rien de toute façon.
async function captureEvents(page) {
  await page.addInitScript(() => {
    window.__events = [];
    window.umami = { track: (name, data) => window.__events.push({ name, data }) };
  });
  await page.route('https://cloud.umami.is/**', route => route.abort());
}

function eventsOfType(page, name) {
  return page.evaluate(n => window.__events.filter(e => e.name === n), name);
}

async function mockUpstreams(page, { orsStatus = 200, orsFeatures, unknownQuery = null, reverseEmpty = false } = {}) {
  await page.route('https://nominatim.openstreetmap.org/search**', route => {
    const q = (new URL(route.request().url()).searchParams.get('q') || '').toLowerCase();
    // Une adresse que Nominatim ne reconnaît pas renvoie un tableau vide :
    // c'est exactement le cas du throw de geocode.js.
    if (unknownQuery && q.includes(unknownQuery)) return route.fulfill({ json: [] });
    const hit = q.includes('renens') ? RENENS : LAUSANNE;
    return route.fulfill({
      json: [{ lat: String(hit.lat), lon: String(hit.lng), display_name: q, address: { country_code: 'ch' } }],
    });
  });
  await page.route('https://nominatim.openstreetmap.org/reverse**', route => route.fulfill({
    json: reverseEmpty ? {} : {
      display_name: 'Place de la Riponne, Lausanne',
      address: { road: 'Place de la Riponne', city: 'Lausanne', country: 'Suisse', country_code: 'ch' },
    },
  }));
  await page.route('https://photon.komoot.io/**', route => route.fulfill({ json: { features: [] } }));
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({
    json: { hourly: { time: [], cloud_cover: [], temperature_2m: [] } },
  }));
  await page.route('https://ors-proxy.meridianway.workers.dev/**', route => {
    if (orsStatus !== 200) return route.fulfill({ status: orsStatus, json: { error: { message: 'upstream' } } });
    return route.fulfill({ json: { features: orsFeatures ?? [{
      geometry: { type: 'LineString', coordinates: [[LAUSANNE.lng, LAUSANNE.lat, 0], [RENENS.lng, RENENS.lat, 0]] },
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

test('une adresse introuvable part avec ADDRESS_NOT_FOUND et le champ fautif', async ({ page }) => {
  await captureEvents(page);
  await mockUpstreams(page, { unknownQuery: 'zzzz' });
  await page.goto('/en/');
  await waitForApp(page);

  await search(page, 'lausanne gare', 'zzzz');

  await expect(page.locator('#toast')).toHaveClass(/\bon\b/);
  const [ev] = await eventsOfType(page, 'search');
  expect(ev.data.code).toBe('ADDRESS_NOT_FOUND');
  // Les deux points sont géocodés dans un seul Promise.all : sans ce champ,
  // l'export ne peut pas distinguer un départ raté d'une arrivée ratée.
  expect(ev.data.field).toBe('end');
  // L'adresse tapée ne doit jamais quitter le navigateur : elle est dans le
  // message d'erreur, et le message n'est pas envoyé.
  expect(JSON.stringify(ev.data)).not.toContain('zzzz');
});

test('le champ fautif distingue bien le départ de l\'arrivée', async ({ page }) => {
  await captureEvents(page);
  await mockUpstreams(page, { unknownQuery: 'zzzz' });
  await page.goto('/en/');
  await waitForApp(page);

  await search(page, 'zzzz', 'renens');

  await expect(page.locator('#toast')).toHaveClass(/\bon\b/);
  const [ev] = await eventsOfType(page, 'search');
  expect(ev.data).toMatchObject({ code: 'ADDRESS_NOT_FOUND', field: 'start' });
});

test('le message d\'adresse introuvable s\'affiche sans le préfixe "Error:"', async ({ page }) => {
  await captureEvents(page);
  await mockUpstreams(page, { unknownQuery: 'zzzz' });
  await page.goto('/en/');
  await waitForApp(page);

  await search(page, 'lausanne gare', 'zzzz');

  const toast = page.locator('#toast');
  await expect(toast).toHaveText(/Address not found/i);
  // La phrase est déjà complète et traduite : la préfixer la rendait plus
  // alarmante qu'utile.
  await expect(toast).not.toHaveText(/^Error:/i);
});

test('une réponse ORS vide part avec NO_ROUTE, le code que §9.5 produisait', async ({ page }) => {
  await captureEvents(page);
  await mockUpstreams(page, { orsFeatures: [] });
  await page.goto('/en/');
  await waitForApp(page);

  await search(page, 'lausanne gare', 'renens');

  await expect(page.locator('#toast')).toHaveText(/No route found/i);
  const [ev] = await eventsOfType(page, 'search');
  expect(ev.data.code).toBe('NO_ROUTE');
});

test('un service de routage à terre dit que les adresses sont bonnes', async ({ page }) => {
  await captureEvents(page);
  await mockUpstreams(page, { orsStatus: 503 });
  await page.goto('/en/');
  await waitForApp(page);

  await search(page, 'lausanne gare', 'renens');

  const toast = page.locator('#toast');
  // 1s + 3s de backoff avant que les tentatives soient épuisées.
  await expect(toast).toHaveClass(/\bon\b/, { timeout: 15_000 });
  await expect(toast).toHaveText(/routing service is not responding/i);
  // ROUTE_FAILED enverrait l'utilisateur corriger une adresse qui n'a jamais
  // été le problème.
  await expect(toast).not.toHaveText(/more precise addresses/i);
  const [ev] = await eventsOfType(page, 'search');
  expect(ev.data.code).toBe('ROUTING_UNAVAILABLE');
});

test.describe('géolocalisation', () => {
  // Playwright attend latitude/longitude, pas la forme lat/lng du reste du code.
  test.use({ geolocation: { latitude: LAUSANNE.lat, longitude: LAUSANNE.lng }, permissions: ['geolocation'] });

  test('un point non reconnu n\'est plus annoncé comme un délai dépassé', async ({ page }) => {
    await captureEvents(page);
    await mockUpstreams(page, { reverseEmpty: true });
    await page.goto('/en/');
    await waitForApp(page);

    await page.click('#geo-start');

    const toast = page.locator('#toast');
    await expect(toast).toHaveClass(/\bon\b/, { timeout: 15_000 });
    // La géolocalisation a parfaitement marché : c'est Nominatim qui n'a rien
    // au point demandé. L'ancien catch affichait "Location unavailable".
    await expect(toast).toHaveText(/Position not recognized/i);
    await expect(toast).not.toHaveText(/Location unavailable/i);

    const [ev] = await eventsOfType(page, 'geo_error');
    // Ces échecs n'étaient pas 'unknown' dans l'export : ils étaient absents,
    // l'event `search` ne couvrant que handleSearch.
    expect(ev.data).toMatchObject({ code: 'POSITION_UNKNOWN', source: 'field' });
  });
});
