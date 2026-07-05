import tzlookup from 'tz-lookup';

// IANA zone name (e.g. "America/New_York") for a given point.
export function resolveTimeZone(lat, lng) {
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
