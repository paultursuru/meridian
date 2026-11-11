import { TZ_CENTERS } from './tzCenters.js';

const SWISS_ZOOM = 12;

// Inside Switzerland's timezone, the browser's language picks the city, so a
// French speaker doesn't open on Zurich. No IP lookup: nothing leaves the
// device, and nobody is placed more precisely than by their timezone.
const SWISS_CITIES = {
  de: [47.3769, 8.5417], // Zurich
  fr: [46.5197, 6.6323], // Lausanne
  it: [46.1683, 8.7944], // Locarno
  rm: [46.8508, 9.5320], // Chur
  en: [46.2044, 6.1432], // Geneva
};

// Where the map opens before any address, as { center: [lat, lng], zoom }, or
// null for a timezone the table doesn't know. `language` is a BCP 47 tag; only
// its prefix counts, and any other language gets Zurich.
export function initialView(timeZone, language) {
  if (timeZone === 'Europe/Zurich') {
    const lang = String(language ?? '').toLowerCase().split('-')[0];
    return { center: SWISS_CITIES[lang] ?? SWISS_CITIES.de, zoom: SWISS_ZOOM };
  }
  const tz = TZ_CENTERS[timeZone];
  return tz ? { center: [tz[0], tz[1]], zoom: 10 } : null;
}

// The browser's language, not the page's: a de-CH visitor on the French home
// page still opens on Zurich.
export function browserInitialView() {
  return initialView(Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.language);
}
