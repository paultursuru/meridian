const OPENTOPODATA   = 'https://api.opentopodata.org/v1/srtm30m';
const OPEN_ELEVATION = 'https://api.open-elevation.com/api/v1/lookup';
const PTS_PER_ROUTE  = 25;
const RETRYABLE      = new Set([429, 503, 504]);
const BACKOFF_MS     = [1500, 4000];

function sample(arr, max) {
  if (arr.length <= max) return arr;
  const step = (arr.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => arr[Math.round(i * step)]);
}

function calcElev(elevations) {
  let up = 0, down = 0;
  for (let i = 1; i < elevations.length; i++) {
    const d = elevations[i] - elevations[i - 1];
    if (d > 1) up += d;
    else if (d < -1) down -= d;
  }
  return { up: Math.round(up), down: Math.round(down) };
}

async function withRetry(fn) {
  let lastErr;
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, BACKOFF_MS[attempt - 1]));
    try {
      const result = await fn();
      if (result.retryable) { lastErr = result.err; continue; }
      return result.value;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function queryOpenTopoData(locations) {
  return withRetry(async () => {
    const qs = locations.map(([lng, lat]) => `${lat},${lng}`).join('|');
    const res = await fetch(`${OPENTOPODATA}?locations=${qs}`, { signal: AbortSignal.timeout(8000) });
    if (RETRYABLE.has(res.status)) return { retryable: true, err: new Error(`opentopodata ${res.status}`) };
    if (!res.ok) throw new Error(`opentopodata ${res.status}`);
    const { status, results } = await res.json();
    if (status !== 'OK') throw new Error(`opentopodata status: ${status}`);
    return { value: results.map(r => r.elevation) };
  });
}

async function queryOpenElevation(locations) {
  return withRetry(async () => {
    const res = await fetch(OPEN_ELEVATION, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ locations: locations.map(([lng, lat]) => ({ latitude: lat, longitude: lng })) }),
      signal: AbortSignal.timeout(8000),
    });
    if (RETRYABLE.has(res.status)) return { retryable: true, err: new Error(`open-elevation ${res.status}`) };
    if (!res.ok) throw new Error(`open-elevation ${res.status}`);
    const { results } = await res.json();
    return { value: results.map(r => r.elevation) };
  });
}

// Fetches elevation for two routes in a single API call.
// Returns [{ up, down }, { up, down }] or throws.
export async function fetchRoutesElevation(coordsA, coordsB) {
  const ptsA = sample(coordsA, PTS_PER_ROUTE);
  const ptsB = sample(coordsB, PTS_PER_ROUTE);
  const all  = [...ptsA, ...ptsB];

  let elevations;
  try {
    elevations = await queryOpenTopoData(all);
  } catch {
    elevations = await queryOpenElevation(all);
  }

  return [
    calcElev(elevations.slice(0, ptsA.length)),
    calcElev(elevations.slice(ptsA.length)),
  ];
}
