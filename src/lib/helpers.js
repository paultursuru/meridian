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

export function fmtDist(m) {
  return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1) + ' km';
}

export function fmtDur(s) {
  const m = Math.round(s / 60);
  return m < 60 ? m + ' min' : Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0');
}
