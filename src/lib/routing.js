import { haversine } from './helpers.js';
import { tr } from './i18n.js';

// ORS is proxied through a Cloudflare Worker (ors-proxy/) so the API key
// never ships in the client bundle. Same pattern as overpass.js.
const ORS_PROXY = 'https://ors-proxy.meridianway.workers.dev';
const WALK_MS   = 4.5 / 3.6; // 4.5 km/h in m/s
const RETRYABLE  = new Set([429, 503, 504]);
const BACKOFF_MS = [1000, 3000];

// Thrown when ORS keeps returning 429 after retries — lets the UI show a
// friendly "too many requests" message instead of a raw "ORS 429".
function rateLimitError() {
  const err = new Error('ORS rate limit (429)');
  err.code = 'RATE_LIMIT';
  return err;
}

// Any other non-retryable ORS status. Without this the UI showed the raw
// "Erreur : ORS 400", which means nothing to anyone: a real user hit it on
// 2026-08-05 and could only report "it doesn't work". The technical detail
// stays on the error for the console and Sentry; the UI translates the code.
function routeFailedError(status) {
  const err = new Error(`ORS ${status}`);
  err.code = 'ROUTE_FAILED';
  return err;
}

// Retries exhausted on a retryable status (503/504): the service is down, the
// request was fine. Not ROUTE_FAILED, whose message tells the user to try more
// precise addresses — here the addresses were never the problem.
function routingUnavailableError(status) {
  const err = new Error(`ORS ${status} after retries`);
  err.code = 'ROUTING_UNAVAILABLE';
  return err;
}

// A pedestrian route stops making sense long before ORS's own ceiling (it
// refuses anything over 6000 km with error 2004). In practice, a distance
// this large means the geocoder matched something absurd rather than that the
// user really wants to walk: the 2026-08-05 report came from typing "ouchy",
// which Nominatim resolved to a farm in Queensland, Australia. Catching it
// here turns a raw upstream 400 into a message that names the actual problem.
const MAX_WALK_M = 300_000;

function tooFarError() {
  const err = new Error('walking distance beyond MAX_WALK_M');
  err.code = 'TOO_FAR';
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
    const r = await fetch(ORS_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (RETRYABLE.has(r.status)) { lastStatus = r.status; continue; }
    if (!r.ok) throw routeFailedError(r.status);
    const d = await r.json();
    return parseFeatures(d.features || []);
  }
  if (lastStatus === 429) throw rateLimitError();
  throw routingUnavailableError(lastStatus);
}

async function orsAlts(start, end) {
  return orsPost({
    coordinates: [[start.lng, start.lat], [end.lng, end.lat]],
    elevation: true,
    // target_count is capped at 3 by ORS; diversity comes from allowing longer
    // detours (weight_factor) and less overlap between alternatives (share_factor).
    alternative_routes: { target_count: 3, share_factor: 0.5, weight_factor: 1.8 },
  });
}

// ~35 m grid cells for geometry comparison. Coarser would merge parallel
// streets; finer would miss the same street sampled at offset points.
const CELL_DEG = 0.00035;

function routeCells(coords) {
  const cells = new Set();
  for (const [lon, lat] of coords) {
    cells.add(`${Math.round(lon / CELL_DEG)}:${Math.round(lat / CELL_DEG)}`);
  }
  return cells;
}

// Fraction of route A lying on route B, with one cell of tolerance.
export function routeOverlap(coordsA, coordsB) {
  const cellsA = routeCells(coordsA);
  const cellsB = routeCells(coordsB);
  let hits = 0;
  for (const key of cellsA) {
    const [x, y] = key.split(':').map(Number);
    let found = false;
    for (let dx = -1; dx <= 1 && !found; dx++)
      for (let dy = -1; dy <= 1 && !found; dy++)
        if (cellsB.has(`${x + dx}:${y + dy}`)) found = true;
    if (found) hits++;
  }
  return hits / cellsA.size;
}

// How much longer than the best route an alternative may be. 1.8 mirrors the
// weight_factor orsAlts asks for, so we never throw away a route we explicitly
// requested.
//
// This used to cap at 2.5× the *crow-flies* distance, which silently deleted
// every route whenever a barrier forced a detour: a user reported "no route
// found" between two streets in Ecublens VD 600 m apart, where the motorway and
// the railway push the real walk to 1.7 km, i.e. 2.9× direct. ORS returned two
// perfectly good routes and both were dropped, leaving zero. A ratio against
// the direct line only measures how obstructed the terrain is; measuring
// alternatives against the shortest route ORS found is what the filter actually
// meant, and it can never empty a non-empty result.
const ALT_MAX_FACTOR = 1.8;

// Dedup by geometry, not by distance: two same-length routes on different
// streets are exactly the pairs worth keeping for sun scoring.
export function dedupeRoutes(all) {
  const shortest = Math.min(...all.map(rt => rt.distance));
  const unique = [];
  for (const rt of all) {
    if (rt.distance > shortest * ALT_MAX_FACTOR) continue;
    const dup = unique.some(u => routeOverlap(rt.geometry.coordinates, u.geometry.coordinates) >= 0.9);
    if (!dup) unique.push(rt);
  }
  return unique;
}

export async function buildRoutes(start, end, onStatus) {
  onStatus(tr('status_routing'));
  const directDist = haversine(start.lat, start.lng, end.lat, end.lng);
  // Checked before the request: no point spending an ORS call (and one of the
  // 2000 daily quota) on a route the user cannot have meant.
  if (directDist > MAX_WALK_M) throw tooFarError();
  const all = await orsAlts(start, end);
  return dedupeRoutes(all);
}
