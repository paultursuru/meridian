const OM_BASE = 'https://api.open-meteo.com/v1/forecast';

// Open-Meteo's forecast covers today + 15 days. Beyond that there is no
// weather to show, so the app runs without it (sun geometry only).
// The small negative margin tolerates a "just past" datetime across midnight.
export const FORECAST_MIN_DAYS = -1;
export const FORECAST_MAX_DAYS = 15;

// True when Open-Meteo can forecast the target instant.
export function isForecastable(target, now = new Date()) {
  const diffDays = (target.getTime() - now.getTime()) / 86_400_000;
  return diffDays >= FORECAST_MIN_DAYS && diffDays <= FORECAST_MAX_DAYS;
}

// Index of the hourly slot closest to the target instant.
// times are unix seconds (timeformat=unixtime), assumed sorted.
export function closestHourIndex(unixTimes, targetDate) {
  const t = targetDate.getTime() / 1000;
  let best = 0;
  for (let i = 1; i < unixTimes.length; i++) {
    if (Math.abs(unixTimes[i] - t) < Math.abs(unixTimes[best] - t)) best = i;
  }
  return best;
}

// Weather is pure decoration (a badge + a tie-breaker for the default tab) —
// never worth making the user wait on. Bounded so a slow/hung Open-Meteo
// response can't stall the rest of the search past this.
const FETCH_TIMEOUT_MS = 4000;

// The full day's hourly cloud cover (0-100 %) and air temperature (°C) at
// the given point, or null when the date is outside the forecast window or
// the request fails (including a timeout). Weather is best-effort
// decoration: every failure path returns null and the search continues
// without it. Returns the whole day (not just the searched instant) so a
// caller re-scoring at a different instant — the time scrubber — can
// re-sample via weatherAt() below without a second network call.
export async function fetchWeather(lat, lng, date, now = new Date()) {
  if (!isForecastable(date, now)) return null;
  const day = date.toISOString().split('T')[0]; // UTC day containing `date`
  const url = `${OM_BASE}?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}`
    + `&hourly=cloud_cover,temperature_2m&timeformat=unixtime&start_date=${day}&end_date=${day}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!r.ok) return null;
    const d = await r.json();
    const times  = d?.hourly?.time;
    const covers = d?.hourly?.cloud_cover;
    if (!times?.length || !covers?.length) return null;
    return { times, cloudCover: covers, temperature: d?.hourly?.temperature_2m ?? [] };
  } catch {
    return null;
  }
}

// Cloud cover/temperature at a specific instant, sampled from a fetchWeather()
// result — e.g. re-called on every scrub tick with the same `hourly` object
// and a different `date`, no extra request. null in (no weather fetched, or
// the sampled hour's cloud cover is missing) → null out.
export function weatherAt(hourly, date) {
  if (!hourly) return null;
  const i = closestHourIndex(hourly.times, date);
  const cloudCover  = hourly.cloudCover[i];
  const temperature = hourly.temperature[i];
  if (!Number.isFinite(cloudCover)) return null;
  return { cloudCover, temperature: Number.isFinite(temperature) ? temperature : null };
}
