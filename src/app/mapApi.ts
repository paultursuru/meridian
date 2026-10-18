import { setActiveTab } from '../lib/ui.js';
import { withRoute } from '../lib/share.js';
import { TZ_CENTERS } from '../lib/tzCenters.js';
import { urlHasSearch } from './state';

// main.ts loads map.js with a dynamic import so Leaflet + MapLibre keep their
// own chunk. Everything else reaches it through this binding: a static import
// of map.js anywhere would pull it back into the entry chunk.
export type MapApi = typeof import('../lib/map.js');
export let map: MapApi;

let settle!: { resolve: (api: MapApi) => void; reject: (reason: unknown) => void };
// Settles once map.js has loaded and initMap has run. The form is wired
// before that, so whatever it needs from the map waits on this.
export const mapReady = new Promise<MapApi>((resolve, reject) => { settle = { resolve, reject }; });
// A failed load is reported where the map is awaited, not as a stray rejection.
mapReady.catch(() => {});

// Undefined until then: callers that can run first check this.
export const mapLoaded = () => map !== undefined;

export function setMap(api: MapApi) {
  map = api;
  settle.resolve(api);
}

export function mapFailed(reason: unknown) {
  settle.reject(reason);
}

// Where a lookup is anchored when the other field is empty: the map's
// centre, or, before the map has loaded, the timezone guess it opens on
// (see initInitialMapCenter).
export function viewCenter(): { lat: number; lng: number } | null {
  if (mapLoaded()) return map.mapCenter();
  const guess = TZ_CENTERS[Intl.DateTimeFormat().resolvedOptions().timeZone];
  return guess ? { lat: guess[0], lng: guess[1] } : null;
}

// Every change of route goes through here, so the link always opens on the
// route on screen. history.state is kept: the about panel's entry has one.
export function selectRoute(type: string) {
  setActiveTab(type);
  map.setActiveRoute(type);
  if (!urlHasSearch()) return;
  const search = '?' + withRoute(location.search, type);
  if (search !== location.search) history.replaceState(history.state, '', location.pathname + search);
}

export function activeRoute(): string {
  return document.querySelector<HTMLButtonElement>('.tab-btn.active')?.dataset.tab ?? 'sunny';
}

// displayRoutes redraws both routes at full opacity: re-apply the active tab
// after each render.
export function reselectActiveRoute() {
  selectRoute(activeRoute());
}
