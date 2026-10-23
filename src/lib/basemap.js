// Which basemap the map loads, and when it gives up on Stadia for OpenFreeMap.
//
// Split out of map.js so it's testable: map.js imports leaflet, its CSS and an
// SVG via `?raw`, none of which resolve under vitest's node environment.
//
// Once the monthly quota is spent, Stadia answers 429 to everything until the
// 1st: the map goes blank, and outside Switzerland the buildings go with it,
// since tileBuildings.js reads them out of the basemap. OpenFreeMap serves the
// same OpenMapTiles schema (source `openmaptiles`, layer `building` with
// `render_height`), so the switch keeps that path working unchanged. It is
// only the fallback: a volunteer project, no key, no service commitment.

// OSM Bright GL vector style (openmaptiles/alidade-smooth-gl-style).
// Keyless on localhost; for production add a Stadia API key or domain auth.
export const STADIA_STYLE = 'https://tiles.stadiamaps.com/styles/alidade_smooth.json';

// Light like alidade_smooth, and the closest of OpenFreeMap's styles to it.
export const FALLBACK_STYLE = 'https://tiles.openfreemap.org/styles/positron';

const STADIA = /^https:\/\/tiles\.stadiamaps\.com\//;

// Refusals that last the session: the quota (429), or the key or domain check
// (401, 403). A 5xx or a dropped tile is a hiccup, and must not swap the
// basemap from under someone reading it.
const REFUSED = new Set([401, 403, 429]);

// Positron fills its buildings almost the colour of the ground, which leaves a
// shade app looking empty. Stadia's fill, so both basemaps read alike.
const BUILDING_FILL = 'hsl(95, 5%, 84%)';

// What a Stadia URL was for, as the basemap_fallback event reports it.
export function resourceOf(url) {
  const path = new URL(url).pathname;
  if (path.includes('/sprite')) return 'sprite';
  if (path.startsWith('/styles/')) return 'style';
  if (path.startsWith('/fonts/')) return 'fonts';
  if (path.startsWith('/data/')) return 'tiles';
  return 'other';
}

// The `error` of a MapLibre error event, when it is Stadia refusing us:
// { status, resource }. Null for anything else, including OpenFreeMap's own
// failures and network errors, which carry no status.
export function refusal(err) {
  if (!err || !REFUSED.has(err.status) || typeof err.url !== 'string' || !STADIA.test(err.url)) return null;
  return { status: err.status, resource: resourceOf(err.url) };
}

// Once the fallback style has loaded. Not through setStyle's transformStyle:
// that one waits for the previous style to finish loading, and a style Stadia
// refused never does.
export function tuneFallback(glMap) {
  if (glMap.getLayer('building')) glMap.setPaintProperty('building', 'fill-color', BUILDING_FILL);
}
