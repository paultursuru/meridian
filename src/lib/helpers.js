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

// The trade-off sentence for one tab. `gain` is the points this route gains on
// its own axis (sun for the sunny tab, shade for the shady one), `minutes` and
// `otherMin` the two durations. A gain reads "X shorter / same / longer for Y
// more"; a loss or a tie keeps the signed-time form.
export function deltaPhrase(axis, gain, minutes, otherMin, tr) {
  const diff = minutes - otherMin;
  const pct = String(Math.abs(gain));
  if (gain > 0) {
    const kind = diff < 0 ? 'faster' : diff > 0 ? 'slower' : 'same';
    return tr(`delta_${axis}_${kind}`, { min: String(Math.abs(diff)), pct });
  }
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '±';
  return tr(`delta_${axis}_less`, { time: `${sign}${Math.abs(diff)} min`, pct });
}
