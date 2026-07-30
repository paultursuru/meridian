// IANA zone name (e.g. "America/New_York") for a given point. tz-lookup embeds
// a ~150 KB coordinate table only needed once a search actually runs, so it's
// loaded on demand instead of bundled into the first-load script (review #2 §2.3).
export async function resolveTimeZone(lat, lng) {
  const { default: tzlookup } = await import('tz-lookup');
  return tzlookup(lat, lng);
}

// Offset (ms) to add to a UTC instant to get that zone's wall-clock reading,
// i.e. wallClock = date.getTime() + offset.
function tzOffsetMs(timeZone, date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUTC - date.getTime();
}

// Interprets "YYYY-MM-DDTHH:mm(:ss)?" as a wall-clock time *in timeZone*
// (not the browser's local time) and returns the matching absolute Date.
export function zonedTimeToUtc(wallTime, timeZone) {
  const naive = new Date(`${wallTime}Z`); // wall-clock read as if it were UTC
  const offset = tzOffsetMs(timeZone, naive);
  return new Date(naive.getTime() - offset);
}

// "HH:mm" wall-clock reading of `date` in `timeZone` (always 24h, locale-independent).
export function formatTimeInZone(date, timeZone) {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

// "YYYY-MM-DD" wall-clock reading of `date` in `timeZone` — same formatToParts
// approach as tzOffsetMs above, to avoid relying on a locale's date-format
// separator/order (e.g. en-CA) staying stable across ICU versions.
export function dateValueInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Minutes since local midnight (0-1439) for `date`'s wall-clock reading in `timeZone`.
export function minutesInZone(date, timeZone) {
  const [h, m] = formatTimeInZone(date, timeZone).split(':').map(Number);
  return h * 60 + m;
}
