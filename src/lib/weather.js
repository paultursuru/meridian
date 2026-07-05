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

// Cloud cover (0-100 %) at the given point and instant, or null when the
// date is outside the forecast window or the request fails. Weather is
// best-effort decoration: every failure path returns null and the search
// continues without it.
export async function fetchCloudCover(lat, lng, date, now = new Date()) {
  if (!isForecastable(date, now)) return null;
  const day = date.toISOString().split('T')[0]; // UTC day containing `date`
  const url = `${OM_BASE}?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}`
    + `&hourly=cloud_cover&timeformat=unixtime&start_date=${day}&end_date=${day}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const d = await r.json();
    const times  = d?.hourly?.time;
    const covers = d?.hourly?.cloud_cover;
    if (!times?.length || !covers?.length) return null;
    const cloudCover = covers[closestHourIndex(times, date)];
    return Number.isFinite(cloudCover) ? { cloudCover } : null;
  } catch {
    return null;
  }
}
