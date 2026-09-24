import { setActiveTab } from '../lib/ui.js';

// main.ts loads map.js with a dynamic import so Leaflet + MapLibre keep their
// own chunk. Everything else reaches it through this binding: a static import
// of map.js anywhere would pull it back into the entry chunk.
export type MapApi = typeof import('../lib/map.js');
export let map: MapApi;

export function setMap(api: MapApi) {
  map = api;
}

export function selectRoute(type: string) {
  setActiveTab(type);
  map.setActiveRoute(type);
}

// displayRoutes redraws both routes at full opacity: re-apply the active tab
// after each render.
export function reselectActiveRoute() {
  selectRoute(document.querySelector<HTMLButtonElement>('.tab-btn.active')?.dataset.tab ?? 'sunny');
}
