import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@maplibre/maplibre-gl-leaflet';
import { collapseDrawer } from './ui.js';

let _map = null;
let sunnyLayers   = [];
let shadyLayers   = [];
let markerLayers  = [];
let previewMarkers = { start: null, end: null };

// Gradient endpoints: dark red (sun) → dark blue (shade) — readable on a light map in daylight
const SUN_RGB   = [183, 28, 28];
const SHADE_RGB = [13, 71, 161];

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

  // Draw each individual sub-segment with the average shade of its two endpoints.
  const layers = [];
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
    if (onClick) seg.on('click', onClick);
    layers.push(seg.addTo(_map));
  }
  return layers;
}

export function initMap() {
  _map = L.map('map').setView([46.5197, 6.6323], 14);
  // OSM Bright GL vector style (openmaptiles/osm-bright-gl-style), hosted by Stadia Maps.
  // Keyless on localhost; for production add a Stadia API key or domain auth.
  const glLayer = L.maplibreGL({
    style: 'https://tiles.stadiamaps.com/styles/osm_bright.json',
    attribution: '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(_map);

  glLayer.getMaplibreMap().once('load', () => {
    document.getElementById('map-splash')?.classList.add('hidden');
  });

  _map.on('click', collapseDrawer);
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
}

export function setPreviewPin(role, coords) {
  if (previewMarkers[role]) _map.removeLayer(previewMarkers[role]);
  const color = role === 'start' ? '#22c55e' : '#ef4444';
  previewMarkers[role] = L.marker([coords.lat, coords.lng], { icon: pinIcon(color) }).addTo(_map);
  _map.flyTo([coords.lat, coords.lng], Math.max(_map.getZoom(), 16), { duration: 0.6 });
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
export function setActiveRoute(type) {
  sunnyLayers.forEach(l => l.setStyle({ opacity: type === 'sunny' ? 0.9 : 0.25 }));
  shadyLayers.forEach(l => l.setStyle({ opacity: type === 'shady' ? 0.85 : 0.25 }));
}

export function displayRoutes(startC, endC, sunny, shady) {
  clearMap();

  const dispatch = (type) => () =>
    window.dispatchEvent(new CustomEvent('route-select', { detail: { type } }));

  // Shady route — gradient, drawn below sunny
  if (shady) {
    drawGradientRoute(shady.geometry.coordinates, shady.segShade ?? [], 5.5, 0.85, dispatch('shady'))
      .forEach(l => shadyLayers.push(l));
  }

  // Sunny route — gradient, drawn on top
  if (sunny) {
    drawGradientRoute(sunny.geometry.coordinates, sunny.segShade ?? [], 5.5, 0.9, dispatch('sunny'))
      .forEach(l => sunnyLayers.push(l));
  }

  markerLayers.push(L.marker([startC.lat, startC.lng], { icon: pinIcon('#22c55e') }).addTo(_map));
  markerLayers.push(L.marker([endC.lat,   endC.lng],   { icon: pinIcon('#ef4444') }).addTo(_map));

  _map.fitBounds(
    L.latLngBounds([startC.lat, startC.lng], [endC.lat, endC.lng]),
    { paddingTopLeft: [40, 30], paddingBottomRight: [40, 200] }
  );
}
