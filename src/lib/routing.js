import { haversine } from './helpers.js';

const ORS_BASE = 'https://api.openrouteservice.org/v2/directions/foot-walking';
const ORS_KEY  = import.meta.env.PUBLIC_ORS_KEY;
const WALK_MS  = 4.5 / 3.6; // 4.5 km/h in m/s
const RETRYABLE  = new Set([429, 503, 504]);
const BACKOFF_MS = [1000, 3000];

// Thrown when ORS keeps returning 429 after retries — lets the UI show a
// friendly "too many requests" message instead of a raw "ORS 429".
function rateLimitError() {
  const err = new Error('ORS rate limit (429)');
  err.code = 'RATE_LIMIT';
  return err;
}

// Coords from ORS with elevation=true are [lon, lat, ele].
function calcElevFromCoords(coords) {
  let up = 0, down = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = (coords[i][2] ?? 0) - (coords[i - 1][2] ?? 0);
    if (d > 1) up += d;
    else if (d < -1) down -= d;
  }
  return { up: Math.round(up), down: Math.round(down) };
}

function parseFeatures(features) {
  return features.map(f => ({
    geometry: f.geometry,
    distance: f.properties.summary.distance,
    duration: f.properties.summary.distance / WALK_MS,
    elevation: calcElevFromCoords(f.geometry.coordinates),
  }));
}

async function orsPost(body) {
  let lastStatus;
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    if (attempt > 0) await new Promise(res => setTimeout(res, BACKOFF_MS[attempt - 1]));
    const r = await fetch(`${ORS_BASE}/geojson`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': ORS_KEY },
      body: JSON.stringify(body),
    });
    if (RETRYABLE.has(r.status)) { lastStatus = r.status; continue; }
    if (!r.ok) throw new Error(`ORS ${r.status}`);
    const d = await r.json();
    return parseFeatures(d.features || []);
  }
  if (lastStatus === 429) throw rateLimitError();
  throw new Error(`ORS ${lastStatus}`);
}

async function orsAlts(start, end) {
  return orsPost({
    coordinates: [[start.lng, start.lat], [end.lng, end.lat]],
    elevation: true,
    alternative_routes: { target_count: 3, share_factor: 0.6, weight_factor: 1.4 },
  });
}

export async function buildRoutes(start, end, onStatus) {
  onStatus('🗺️ Génération des itinéraires…');
  const all = await orsAlts(start, end);

  const directDist = haversine(start.lat, start.lng, end.lat, end.lng);

  const unique = [];
  for (const rt of all) {
    if (rt.distance > directDist * 2.5) continue;
    if (!unique.some(u => Math.abs(u.distance - rt.distance) / rt.distance < 0.03)) unique.push(rt);
  }

  return unique;
}
