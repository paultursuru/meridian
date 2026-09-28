import { setActiveTab } from '../lib/ui.js';
import { withRoute } from '../lib/share.js';
import { urlHasSearch } from './state';

// main.ts loads map.js with a dynamic import so Leaflet + MapLibre keep their
// own chunk. Everything else reaches it through this binding: a static import
// of map.js anywhere would pull it back into the entry chunk.
export type MapApi = typeof import('../lib/map.js');
export let map: MapApi;

export function setMap(api: MapApi) {
  map = api;
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
