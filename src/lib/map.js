import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@maplibre/maplibre-gl-leaflet';
import { collapseDrawer, bottomOverlayPx, leftOverlayPx } from './ui.js';
import { FIT_MAX_ZOOM, FIT_PADDING, clampFitPadding } from './mapFit.js';
import { tr } from './i18n.js';
import targetIcon from '../icons/target.svg?raw';

let _map = null;
let _glMap = null;
let sunnyLayers   = [];
let shadyLayers   = [];
let markerLayers  = [];
let previewMarkers = { start: null, end: null };
let hereMarker = null;

// Gradient endpoints: following brand light yellow (sun, #f0f2a0) → brand violet/lilac (shade, #e8c8f0) 
// but a little bit less pale for contrast purposes
const SUN_RGB   = [247, 245, 109];
const SHADE_RGB = [231, 135, 255];

function lerpColor(t) {
  const r = Math.round(SUN_RGB[0] + (SHADE_RGB[0] - SUN_RGB[0]) * t);
  const g = Math.round(SUN_RGB[1] + (SHADE_RGB[1] - SUN_RGB[1]) * t);
  const b = Math.round(SUN_RGB[2] + (SHADE_RGB[2] - SUN_RGB[2]) * t);
  return `rgb(${r},${g},${b})`;
}

// Draws a route as per-segment colored polylines using shade data.
// segShade covers every segment (i → i+1), so each entry maps directly to its two endpoints.
function drawGradientRoute(coords, segShade, weight, opacity, onClick) {
  const N = coords.length;

  // Build a shade value [0=sun … 1=shade] for every point by averaging adjacent segment values.
  const ptShade = new Array(N).fill(null);
  for (const { i, shade } of segShade) {
    const val = shade ? 1 : 0;
    for (let j = i; j <= Math.min(i + 1, N - 1); j++) {
      ptShade[j] = ptShade[j] === null ? val : (ptShade[j] + val) / 2;
    }
  }
  for (let j = 0; j < N; j++) {
    if (ptShade[j] === null) ptShade[j] = 0.5;
  }

  const layers = [];

  // Soft dark shadow under the gradient, drawn as a single full-length polyline
  // (not per-segment, to avoid seams at the joints) — needed since switching back
  // to a light basemap made the pale yellow/violet gradient hard to read in direct
  // sunlight. Blurred via the .route-casing CSS class (main.css) rather than a
  // crisp parallel outline, so it reads as a shadow, not a second line. Leaflet's
  // SVG renderer only ever writes known style props (stroke/opacity/width/...) to
  // the path, so `filter` has to go through a class, not an option here.
  // Non-interactive so it never steals clicks from the colored line on top of it
  // or from the map click below.
  const casing = L.polyline(coords.map(([lng, lat]) => [lat, lng]), {
    color: '#444444',
    weight: weight + 3,
    opacity,
    lineCap: 'round',
    lineJoin: 'round',
    interactive: false,
    className: 'route-casing',
  });
  casing._baseOpacity = opacity * 0.75;
  layers.push(casing.addTo(_map));

  // Draw each individual sub-segment with the average shade of its two endpoints.
  for (let j = 0; j < N - 1; j++) {
    const t = (ptShade[j] + ptShade[j + 1]) / 2;
    const [lng1, lat1] = coords[j];
    const [lng2, lat2] = coords[j + 1];
    const seg = L.polyline([[lat1, lng1], [lat2, lng2]], {
      color: lerpColor(t),
      weight,
      opacity,
      lineCap: 'round',
      lineJoin: 'round',
      bubblingMouseEvents: false, // keep route clicks from also closing the drawer via the map click below
    });
    seg._baseOpacity = opacity;
    // Stopped, not just handled: a click on a route means "show me this one",
    // and letting it through to the map would also collapse the drawer and
    // offer to drop an endpoint on top of the route the user just picked.
    if (onClick) seg.on('click', (ev) => { L.DomEvent.stopPropagation(ev); onClick(); });
    layers.push(seg.addTo(_map));
  }
  return layers;
}

// "Center on my location" control, Leaflet-native (stacks under the default
// zoom control, top-left) — deliberately separate from the start/end
// "ma position" input buttons: clicking it doesn't touch any address field,
// it only asks AppLayout.astro (via the 'locate-me' event, same pattern as
// 'route-select' below) to fetch precise geolocation and show it.
const LocateControl = L.Control.extend({
  options: { position: 'topleft' },
  onAdd() {
    const btn = L.DomUtil.create('button', 'leaflet-bar locate-control');
    btn.type = 'button';
    btn.title = tr('locate_btn_title');
    btn.setAttribute('aria-label', tr('locate_btn_title'));
    btn.innerHTML = targetIcon;
    L.DomEvent.disableClickPropagation(btn);
    L.DomEvent.on(btn, 'click', () => window.dispatchEvent(new CustomEvent('locate-me')));
    return btn;
  },
});

export function initMap() {
  _map = L.map('map').setView([46.5197, 6.6323], 14);
  // OSM Bright GL vector style (openmaptiles/alidade-smooth-gl-style), hosted by Stadia Maps.
  // Keyless on localhost; for production add a Stadia API key or domain auth.
  const glLayer = L.maplibreGL({
    style: 'https://tiles.stadiamaps.com/styles/alidade_smooth.json',
    attribution: '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(_map);

  _glMap = glLayer.getMaplibreMap();
  _glMap.once('load', () => {
    document.getElementById('map-splash')?.classList.add('hidden');
  });

  new LocateControl().addTo(_map);

  _map.on('click', collapseDrawer);
  _map.on('click', openPickPopup);

  // The intro bubble, the splash and the sun badge are plain HTML children of
  // #map, so a click on any of them reaches Leaflet's container underneath.
  // That was harmless while a map click only collapsed the drawer; now it
  // would drop a "use this point" menu behind the thing the user was actually
  // clicking. Leaflet's own controls already do this for themselves.
  for (const id of ['app-description', 'map-splash', 'map-sun-info']) {
    const el = document.getElementById(id);
    if (el) L.DomEvent.disableClickPropagation(el);
  }
}

// Click anywhere on the map to use that spot as an endpoint, so a walk can be
// planned without typing an address at all. A popup with the two roles in it
// rather than a mode armed beforehand: the map is a pan/zoom surface, and a
// bare click can't be allowed to move a pin on its own. Leaflet's own popup
// carries the parts that are tedious by hand — anchored to a latlng, so it
// tracks the map while panning, and closed by the next click or Escape.
function openPickPopup(e) {
  const box = L.DomUtil.create('div', 'pick-menu');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', tr('map_pick_label'));

  for (const role of ['start', 'end']) {
    const btn = L.DomUtil.create('button', 'pick-btn', box);
    btn.type = 'button';
    btn.dataset.role = role;
    btn.textContent = tr(role === 'start' ? 'map_pick_start' : 'map_pick_end');
    L.DomEvent.on(btn, 'click', () => {
      _map.closePopup();
      window.dispatchEvent(new CustomEvent('map-point-picked', {
        detail: { role, lat: e.latlng.lat, lng: e.latlng.lng },
      }));
    });
  }
  // Keeps a click inside the menu from reaching the map underneath, which
  // would immediately reopen the popup one pixel further along.
  L.DomEvent.disableClickPropagation(box);

  // With a close button, unlike most popups: dismissing this one by clicking
  // the map is impossible, because that click just opens another menu one
  // spot further along. Escape closes it too, but that is no help on a phone
  // and invisible everywhere else.
  const popup = L.popup({ className: 'pick-popup', closeButton: true, offset: [0, 4] })
    .setLatLng(e.latlng)
    .setContent(box)
    .openOn(_map);

  // Leaflet's own close button is labelled "Close popup", in English.
  popup.getElement()?.querySelector('.leaflet-popup-close-button')
    ?.setAttribute('aria-label', tr('aria_close'));
}

function pinIcon(color) {
  return L.divIcon({
    className: '',
    html: `<div style="width:13px;height:13px;background:${color};border:2.5px solid white;border-radius:50%;box-shadow:0 2px 5px rgba(0,0,0,.3)"></div>`,
    iconAnchor: [6, 6],
  });
}

export function clearMap() {
  [...sunnyLayers, ...shadyLayers, ...markerLayers].forEach(l => _map.removeLayer(l));
  sunnyLayers  = [];
  shadyLayers  = [];
  markerLayers = [];
  for (const role of ['start', 'end']) {
    if (previewMarkers[role]) { _map.removeLayer(previewMarkers[role]); previewMarkers[role] = null; }
  }
  clearApproxLocation();
}

// pan: fly to the pin, which is what an address or a geolocation fix wants —
// the point is somewhere else. A point picked on the map is already in view
// and under the user's finger, so moving the map there would only take the
// surroundings they aimed at away from them.
export function setPreviewPin(role, coords, { pan = true } = {}) {
  // A real pin supersedes the rough "my location" marker, if one is showing.
  clearApproxLocation();
  if (previewMarkers[role]) _map.removeLayer(previewMarkers[role]);
  const color = role === 'start' ? '#22c55e' : '#ef4444';
  previewMarkers[role] = L.marker([coords.lat, coords.lng], { icon: pinIcon(color), keyboard: false }).addTo(_map);
  if (pan) _map.flyTo([coords.lat, coords.lng], Math.max(_map.getZoom(), 16), { duration: 0.6 });
}

// Recenters only — no marker. Used for the passive, permission-free initial
// view (timezone guess, or a silently-already-granted precise position —
// see review 3.2/4.1): neither is the result of an explicit action in this
// session, so neither gets the "my location" dot (that's reserved for
// showMyLocation below, kept deliberately separate).
export function centerMap(lat, lng, zoom) {
  _map.setView([lat, lng], zoom);
}

// Recenters AND drops a translucent "my location" dot (deliberately not a
// solid pin like start/end) — used only as the direct result of an explicit
// geolocation action: the locate-me control above, or (in future) an
// already-known position surfaced from a user gesture.
export function showMyLocation(lat, lng, title) {
  clearApproxLocation();
  hereMarker = L.circleMarker([lat, lng], {
    radius: 8,
    color: '#3b82f6',
    weight: 2,
    fillColor: '#3b82f6',
    fillOpacity: 0.35,
  }).addTo(_map);
  if (title) hereMarker.bindTooltip(title, { direction: 'top' });
  _map.setView([lat, lng], 15);
}

export function clearApproxLocation() {
  if (hereMarker) { _map.removeLayer(hereMarker); hereMarker = null; }
}

// Removes a preview pin without adding a replacement (e.g. clearing an address field).
export function clearPreviewPin(role) {
  if (previewMarkers[role]) { _map.removeLayer(previewMarkers[role]); previewMarkers[role] = null; }
}

// Swap start/end preview pins: positions are unchanged, only the colors and
// role references switch. Tolerates either pin being absent.
export function swapPreviewPins() {
  const start = previewMarkers.start;
  const end   = previewMarkers.end;
  if (start) start.setIcon(pinIcon('#ef4444'));
  if (end)   end.setIcon(pinIcon('#22c55e'));
  previewMarkers.start = end;
  previewMarkers.end   = start;
}

// type: 'sunny' | 'shady' — full opacity for the active route, dimmed for the other.
// Scales each layer's own base opacity (colored segments vs. their dimmer casing)
// rather than a flat 1/0.5, so the casing stays proportionally subtler.
function scaleOpacity(layer, active) {
  layer.setStyle({ opacity: (layer._baseOpacity ?? 1) * (active ? 1 : 0.5) });
}
export function setActiveRoute(type) {
  sunnyLayers.forEach(l => scaleOpacity(l, type === 'sunny'));
  shadyLayers.forEach(l => scaleOpacity(l, type === 'shady'));
}

export function displayRoutes(startC, endC, sunny, shady) {
  clearMap();

  const dispatch = (type) => () =>
    window.dispatchEvent(new CustomEvent('route-select', { detail: { type } }));

  // Shady route — gradient, drawn below sunny
  if (shady) {
    drawGradientRoute(shady.geometry.coordinates, shady.segShade ?? [], 5.5, 1, dispatch('shady'))
      .forEach(l => shadyLayers.push(l));
  }

  // Sunny route — gradient, drawn on top
  if (sunny) {
    drawGradientRoute(sunny.geometry.coordinates, sunny.segShade ?? [], 5.5, 1, dispatch('sunny'))
      .forEach(l => sunnyLayers.push(l));
  }

  markerLayers.push(L.marker([startC.lat, startC.lng], { icon: pinIcon('#22c55e'), keyboard: false }).addTo(_map));
  markerLayers.push(L.marker([endC.lat,   endC.lng],   { icon: pinIcon('#ef4444'), keyboard: false }).addTo(_map));

  fitWithChrome(L.latLngBounds([startC.lat, startC.lng], [endC.lat, endC.lng]));
}

// Fits `bounds` into the strip of map the user can actually see.
//
// Padding measured rather than assumed, so the route doesn't land under the
// chrome. Which edge that is depends on the layout: the drawer and scrubber
// cover the bottom on mobile, the docked panel covers the left on desktop.
// Then clamped to whatever the container measures, and the zoom capped:
// asking for more padding than the map is tall (a small phone in portrait
// with the soft keyboard open measures ~204px here) makes Leaflet store an
// Infinity zoom without complaining, and the map then dies with "Invalid
// LatLng object: (NaN, NaN)" at the next resize. See mapFit.js.
function fitWithChrome(bounds, options = {}) {
  const padding = {
    topLeft: [FIT_PADDING.topLeft[0] + leftOverlayPx(), FIT_PADDING.topLeft[1]],
    bottomRight: [FIT_PADDING.bottomRight[0], bottomOverlayPx()],
  };
  _map.fitBounds(bounds, {
    ...clampFitPadding(_map.getSize(), padding),
    maxZoom: FIT_MAX_ZOOM,
    ...options,
  });
}

// --- Vector-tile building source --------------------------------------------
// The three map-side primitives tileBuildings.js needs, kept here so that
// module stays free of Leaflet/MapLibre and testable under vitest.

// The zoom fitToBbox() below would land on, without moving anything — so a
// route too long to fit at building-tile zoom can be handed to Overpass
// before the map has been dragged across Europe for nothing.
//
// Returned in MapLibre's units, like glZoom(), since MapLibre's zoom is what
// picks the tile the buildings come from. It runs one step below Leaflet's
// for the same scale (512px vector tiles against Leaflet's 256px grid); the
// offset is measured off the live map rather than hardcoded, so it holds
// whatever maplibre-gl-leaflet does internally.
export function bboxZoom(bbox, { chrome = true } = {}) {
  const [s, w, n, e] = bbox;
  const padding = chrome ? chromePaddingPoint() : L.point(0, 0);
  const fit = Math.min(_map.getBoundsZoom(L.latLngBounds([s, w], [n, e]), false, padding), FIT_MAX_ZOOM);
  return fit + (_glMap ? _glMap.getZoom() - _map.getZoom() : 0);
}

function chromePaddingPoint() {
  const { paddingTopLeft, paddingBottomRight } = clampFitPadding(_map.getSize(), {
    topLeft: [FIT_PADDING.topLeft[0] + leftOverlayPx(), FIT_PADDING.topLeft[1]],
    bottomRight: [FIT_PADDING.bottomRight[0], bottomOverlayPx()],
  });
  return L.point(paddingTopLeft).add(L.point(paddingBottomRight));
}

// [s, w, n, e] — same shape as routesBbox(). Moves the map there without an
// animation (the route is drawn right after anyway) and resolves once MapLibre
// has finished loading the tiles for the new view, since querySourceFeatures
// only ever sees tiles that are already in memory.
// `chrome: false` fits the bbox edge to edge, ignoring the padding that keeps
// a route clear of the drawer. Only for this pass: nothing is drawn yet, and
// displayRoutes re-fits with the real padding a moment later — but the padding
// costs close to a zoom level on a phone, which is the difference between
// reading the buildings from the tiles and waiting on Overpass.
export function fitToBbox(bbox, { timeoutMs = 6000, chrome = true } = {}) {
  const [s, w, n, e] = bbox;
  const bounds = L.latLngBounds([s, w], [n, e]);
  if (chrome) fitWithChrome(bounds, { animate: false });
  else _map.fitBounds(bounds, { maxZoom: FIT_MAX_ZOOM, animate: false });
  return new Promise((resolve) => {
    if (!_glMap) return resolve();
    // 'idle' rather than areTilesLoaded(): the layer has just been told to
    // move, so the tiles for the *previous* view can still read as loaded for
    // a frame. The timeout is the floor under a tile server that never
    // answers — the caller falls back to Overpass on an empty result.
    const done = () => { clearTimeout(timer); _glMap.off('idle', done); resolve(); };
    const timer = setTimeout(done, timeoutMs);
    _glMap.on('idle', done);
  });
}

export function glZoom() {
  return _glMap ? _glMap.getZoom() : 0;
}

// Every building feature in the currently loaded tiles, geometry already in
// lng/lat. Not filtered to the viewport: querySourceFeatures returns whole
// tiles, which is exactly what we want (the route bbox is the filter, and it
// is applied in tileBuildings.js).
export function queryBuildingFeatures() {
  if (!_glMap) return [];
  try {
    return _glMap.querySourceFeatures('openmaptiles', { sourceLayer: 'building' });
  } catch (err) {
    console.warn('querySourceFeatures(building) failed', err);
    return [];
  }
}
