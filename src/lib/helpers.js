export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = Math.PI / 180;
  const phi1 = lat1 * r, phi2 = lat2 * r;
  const dphi = (lat2 - lat1) * r, dlam = (lng2 - lng1) * r;
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlam / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Compass bearing from A to B (degrees, N=0 clockwise)
export function bearing(lat1, lng1, lat2, lng2) {
  const dLat = lat2 - lat1;
  const dLng = (lng2 - lng1) * Math.cos(lat1 * Math.PI / 180);
  return (Math.atan2(dLng, dLat) * 180 / Math.PI + 360) % 360;
}

export function angleDiff(a, b) {
  const d = Math.abs((a - b + 360) % 360);
  return d > 180 ? 360 - d : d;
}

// Local-calendar "YYYY-MM-DD" for <input type="date"> values.
// Built from local date parts: toISOString() would give the UTC date, which
// is still yesterday for a UTC+ user between midnight and the UTC offset.
export function localDateValue(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Decimal separator by page language: comma in French and Italian, point in
// Swiss German, English and Romansh. A no-break space keeps the unit with its number.
const NUMBER_LOCALE = { fr: 'fr', it: 'it', de: 'de-CH', en: 'en', rm: 'de-CH' };

export function fmtDist(m, lang = 'fr') {
  if (m < 1000) return Math.round(m) + '\u00a0m';
  const km = new Intl.NumberFormat(NUMBER_LOCALE[lang] ?? 'fr', {
    minimumFractionDigits: 1, maximumFractionDigits: 1,
  }).format(m / 1000);
  return km + '\u00a0km';
}

export function fmtDur(s) {
  const m = Math.round(s / 60);
  return m < 60
    ? m + '\u00a0min'
    : Math.floor(m / 60) + '\u00a0h\u00a0' + String(m % 60).padStart(2, '0');
}

// "HH:mm" for a minutes-since-midnight value (0-1439) — the time scrubber's own unit.
export function fmtHm(minutes) {
  return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
}

// The trade-off sentence for one tab. `gain` is the minutes of sun this route
// gains on its own goal (more sun for the sunny tab, less for the shady one),
// `minutes` and `otherMin` the two durations. A gain reads "X shorter / same /
// longer for Y min", the same sun reads "X shorter / same / longer for the
// same sun", a loss keeps the signed-time form.
export function deltaPhrase(axis, gain, minutes, otherMin, tr) {
  const diff = minutes - otherMin;
  const kind = diff < 0 ? 'faster' : diff > 0 ? 'slower' : 'same';
  const min = String(Math.abs(diff));
  const sun = String(Math.abs(gain));
  if (gain > 0) return tr(`delta_${axis}_${kind}`, { min, sun });
  if (gain === 0) return tr(`delta_even_${kind}`, { min });
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '±';
  return tr(`delta_${axis}_less`, { time: `${sign}${min} min`, sun });
}

// Minutes in the sun on a route. The score is a share of the distance, and
// the scorer walks the route at one average pace, so it is also a share of
// the duration.
const sunMinutes = (rt) => rt.sunScore * rt.duration / 60;

// Both tabs' sentences, in minutes of sun rather than percentage points: the
// two routes rarely take the same time, and a share of a longer walk is more
// sun. Shade minutes would mislead on the shady tab: the shorter route has
// fewer of them even when it is the shadier one. So both tabs count sun, and
// the sunny route's extra sun is the shady route's sun avoided: one gap.
export function deltaPhrases(sunny, shady, tr) {
  const gap = Math.round(sunMinutes(sunny) - sunMinutes(shady));
  const sunnyMin = Math.round(sunny.duration / 60);
  const shadyMin = Math.round(shady.duration / 60);
  return {
    sunny: deltaPhrase('sunny', gap, sunnyMin, shadyMin, tr),
    shady: deltaPhrase('shady', gap, shadyMin, sunnyMin, tr),
  };
}

// A place's name for the folded form's one-line summary: what comes before
// the first comma. A point picked on the map keeps both coordinates until its
// address lands.
const COORDS = /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/;

export function placeShortName(value) {
  const v = value.trim();
  return COORDS.test(v) ? v : v.split(',')[0].trim();
}

// Romansh falls back to Swiss German where the browser has no Romansh data.
const DATE_LOCALES = { fr: ['fr'], de: ['de-CH'], it: ['it'], en: ['en'], rm: ['rm', 'de-CH'] };

// The departure in that summary: the time alone today, with the day otherwise
// (a shared link, a later departure).
export function summaryWhen(dateValue, timeValue, todayValue, lang = 'fr') {
  if (!dateValue || dateValue === todayValue) return timeValue;
  const [y, mo, d] = dateValue.split('-').map(Number);
  const [h, mi] = (timeValue || '12:00').split(':').map(Number);
  return new Intl.DateTimeFormat(DATE_LOCALES[lang] ?? ['fr'], {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, mo - 1, d, h, mi)));
}
