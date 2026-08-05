import { test, expect } from '@playwright/test';

// Signalé par un utilisateur le 2026-08-05 ("impossible de trouver un trajet",
// sans message d'erreur) : les boutons de recherche étaient désactivés tant que
// syncInputState() n'avait pas vu les deux champs remplis, et syncInputState()
// n'était branché que sur l'événement `input`. Un champ rempli autrement —
// dictée vocale, autofill, extension, certaines saisies assistées — laissait
// donc deux adresses affichées et un bouton mort, sans aucune explication
// (le bouton n'avait ni title ni aria-describedby, et un élément disabled ne
// reçoit même pas le clic).
//
// Le correctif : ne plus désactiver les boutons selon le contenu des champs, et
// s'appuyer sur le garde-fou déjà présent dans handleSearch, qui affiche un
// message traduit et donne le focus au champ manquant.

const START_Q = 'EPFL, Ecublens';
const END_Q = 'Renens';

// Coordonnées cohérentes avec les libellés, pour que le trajet mocké ait un sens.
const START = { lat: 46.5186, lng: 6.5680 };
const END = { lat: 46.5373, lng: 6.5853 };

async function mockUpstreams(page) {
  await page.route('https://nominatim.openstreetmap.org/search**', route => {
    const q = new URL(route.request().url()).searchParams.get('q') || '';
    const hit = q.toLowerCase().includes('renens') ? END : START;
    return route.fulfill({
      json: [{ lat: String(hit.lat), lon: String(hit.lng), display_name: q, address: { country_code: 'ch' } }],
    });
  });
  await page.route('https://photon.komoot.io/**', route => route.fulfill({ json: { features: [] } }));
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({
    json: { hourly: { time: [], cloud_cover: [], temperature_2m: [] } },
  }));
  await page.route('https://ors-proxy.meridianway.workers.dev/**', route => route.fulfill({
    json: { features: [{
      geometry: { type: 'LineString', coordinates: [[START.lng, START.lat, 0], [6.575, 46.528, 0], [END.lng, END.lat, 0]] },
      properties: { summary: { distance: 2400, duration: 1900 } },
    }] },
  }));
  await page.route('https://swissbuildings-lookup.meridianway.workers.dev/**', route => route.fulfill({ json: { buildings: [] } }));
  await page.route('https://overpass-cache.meridianway.workers.dev/**', route => route.fulfill({ json: { elements: [] } }));
}

test.beforeEach(async ({ page }) => {
  await mockUpstreams(page);
});

test('un champ rempli sans événement input laisse quand même lancer la recherche', async ({ page }) => {
  await page.goto('/en/');
  await expect(page.locator('#inp-start')).toBeVisible();

  // Écriture directe de .value, sans dispatch : c'est ce que font une dictée,
  // un autofill ou une extension, et c'est le cœur du bug signalé.
  await page.evaluate(([s, e]) => {
    document.getElementById('inp-start').value = s;
    document.getElementById('inp-end').value = e;
  }, [START_Q, END_Q]);

  // Assertion sur la propriété DOM et pas via toBeEnabled() : le code fautif
  // posait `btn.disabled = true` en JS, sans attribut HTML, et toBeEnabled()
  // ne le voyait pas — le test passait alors sur le bug qu'il devait attraper.
  const disabled = await page.evaluate(() => document.getElementById('search-btn').disabled);
  expect(disabled).toBe(false);

  await page.click('#search-btn');

  // La recherche va au bout : c'est bien le garde-fou qui a été franchi, pas
  // seulement le bouton qui a changé d'apparence.
  await expect(page.locator('#sunny-sun-pct')).not.toBeEmpty({ timeout: 30_000 });
});

test('les deux champs vides : message visible, bulle d\'accueil masquée, focus sur le départ', async ({ page }) => {
  await page.goto('/en/');
  await expect(page.locator('#inp-start')).toBeVisible();

  await page.click('#search-btn');

  const toast = page.locator('#toast');
  await expect(toast).toHaveClass(/\bon\b/);
  await expect(toast).toHaveText('Please enter a start and end point.');
  // role=alert : le message doit être annoncé, pas seulement affiché.
  await expect(toast).toHaveAttribute('role', 'alert');

  // Sans ça, le message se superposait à la bulle d'accueil qui dit déjà de
  // remplir les champs, et passait inaperçu.
  await expect(page.locator('#app-description')).toHaveClass(/\bhidden\b/);

  await expect(page.locator('#inp-start')).toBeFocused();
});

test('un seul champ rempli : le focus va sur le champ manquant', async ({ page }) => {
  await page.goto('/en/');
  await expect(page.locator('#inp-start')).toBeVisible();

  await page.fill('#inp-start', START_Q);
  await page.keyboard.press('Escape');
  await page.click('#search-btn');

  await expect(page.locator('#toast')).toHaveClass(/\bon\b/);
  await expect(page.locator('#inp-end')).toBeFocused();
});

test('le parcours tapé normal reste inchangé, et le bouton se désactive pendant le calcul', async ({ page }) => {
  await page.goto('/en/');
  await expect(page.locator('#inp-start')).toBeVisible();

  await page.fill('#inp-start', START_Q);
  await page.keyboard.press('Escape');
  await page.fill('#inp-end', END_Q);
  await page.keyboard.press('Escape');
  await page.click('#search-btn');

  // Désactivation pendant la recherche en vol : c'est un autre besoin que le
  // grisage retiré, et il doit survivre au correctif.
  await expect(page.locator('#search-btn')).toBeDisabled();

  await expect(page.locator('#sunny-sun-pct')).not.toBeEmpty({ timeout: 30_000 });
  await expect(page.locator('#search-btn')).toBeEnabled({ timeout: 30_000 });
});
