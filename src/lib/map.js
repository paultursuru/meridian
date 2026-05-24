import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

let _map = null;
let ghostLayers  = [];
let sunnyLayers  = [];
let shadyLayers  = [];
let markerLayers = [];

// Gradient endpoints: orange (sun) → dark blue (shade)
const SUN_RGB   = [249, 115,  22];
const SHADE_RGB = [ 26,  58, 107];

function lerpColor(t) {
  const r = Math.round(SUN_RGB[0] + (SHADE_RGB[0] - SUN_RGB[0]) * t);
  const g = Math.round(SUN_RGB[1] + (SHADE_RGB[1] - SUN_RGB[1]) * t);
  const b = Math.round(SUN_RGB[2] + (SHADE_RGB[2] - SUN_RGB[2]) * t);
  return `rgb(${r},${g},${b})`;
}

// Draws a route as per-segment colored polylines using shade data.
// Since shadow.js samples every other segment (i += 2), unsampled intermediate
// points get an interpolated shade value from their sampled neighbours.
function drawGradientRoute(coords, segShade, weight, opacity) {
  const N = coords.length;

  // Build a shade value [0=sun … 1=shade] for every point.
  // Each sampled segment (i → i+2) spreads its value to all three points it spans.
  const ptShade = new Array(N).fill(null);
  for (const { i, shade } of segShade) {
    const val = shade ? 1 : 0;
    for (let j = i; j <= Math.min(i + 2, N - 1); j++) {
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
    layers.push(L.polyline([[lat1, lng1], [lat2, lng2]], {
      color: lerpColor(t),
      weight,
      opacity,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(_map));
  }
  return layers;
}

export function initMap() {
  _map = L.map('map').setView([46.5197, 6.6323], 14);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org">OSM</a> &copy; <a href="https://carto.com">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(_map);
}

function pinIcon(color) {
  return L.divIcon({
    className: '',
    html: `<div style="width:13px;height:13px;background:${color};border:2.5px solid white;border-radius:50%;box-shadow:0 2px 5px rgba(0,0,0,.3)"></div>`,
    iconAnchor: [6, 6],
  });
}

export function clearMap() {
  [...ghostLayers, ...sunnyLayers, ...shadyLayers, ...markerLayers].forEach(l => _map.removeLayer(l));
  ghostLayers  = [];
  sunnyLayers  = [];
  shadyLayers  = [];
  markerLayers = [];
}

// type: 'sunny' | 'shady' — full opacity for the active route, dimmed for the other.
export function setActiveRoute(type) {
  sunnyLayers.forEach(l => l.setStyle({ opacity: type === 'sunny' ? 0.9 : 0.25 }));
  shadyLayers.forEach(l => l.setStyle({ opacity: type === 'shady' ? 0.85 : 0.25 }));
}

export function displayRoutes(startC, endC, sunny, shady, all) {
  clearMap();

  // Ghost routes (all except the two highlighted ones)
  all.forEach(rt => {
    if (rt === sunny || rt === shady) return;
    ghostLayers.push(L.geoJSON(rt.geometry, { style: { color: '#d1d5db', weight: 3, opacity: 0.45 } }).addTo(_map));
  });

  // Shady route — gradient, drawn below sunny
  if (shady) {
    drawGradientRoute(shady.geometry.coordinates, shady.segShade ?? [], 5.5, 0.85)
      .forEach(l => shadyLayers.push(l));
  }

  // Sunny route — gradient, drawn on top
  if (sunny) {
    drawGradientRoute(sunny.geometry.coordinates, sunny.segShade ?? [], 5.5, 0.9)
      .forEach(l => sunnyLayers.push(l));
  }

  markerLayers.push(L.marker([startC.lat, startC.lng], { icon: pinIcon('#22c55e') }).addTo(_map));
  markerLayers.push(L.marker([endC.lat,   endC.lng],   { icon: pinIcon('#ef4444') }).addTo(_map));

  _map.fitBounds(
    L.latLngBounds([startC.lat, startC.lng], [endC.lat, endC.lng]),
    { padding: [50, 50] }
  );
}
