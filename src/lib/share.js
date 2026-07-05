// Shareable-URL helpers: serialize a search (start/end coords + labels + the
// wall-clock datetime at destination) into query params, and parse them back.
// Params: from=lat,lng · to=lat,lng · fromq/toq=display labels · dt=YYYY-MM-DDTHH:MM

const fmt = (n) => n.toFixed(5); // ~1 m precision

function parseCoord(s) {
  if (!s) return null;
  const parts = s.split(',');
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]), lng = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

const coordLabel = ({ lat, lng }) => `${fmt(lat)}, ${fmt(lng)}`;

export function buildShareQuery({ start, end, date, time }) {
  const p = new URLSearchParams();
  p.set('from', `${fmt(start.lat)},${fmt(start.lng)}`);
  if (start.label) p.set('fromq', start.label);
  p.set('to', `${fmt(end.lat)},${fmt(end.lng)}`);
  if (end.label) p.set('toq', end.label);
  if (date) p.set('dt', time ? `${date}T${time}` : date);
  return p.toString();
}

// Returns { start, end, date, time } — start/end are {lat, lng, label} or null
// when absent/invalid; a missing label falls back to "lat, lng" so the input
// still shows something meaningful.
export function parseShareQuery(search) {
  const p = new URLSearchParams(search);
  const from = parseCoord(p.get('from'));
  const to   = parseCoord(p.get('to'));
  const start = from ? { ...from, label: p.get('fromq') || coordLabel(from) } : null;
  const end   = to   ? { ...to,   label: p.get('toq')   || coordLabel(to) }   : null;
  const m = (p.get('dt') || '').match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?$/);
  return { start, end, date: m ? m[1] : null, time: m?.[2] ?? null };
}
