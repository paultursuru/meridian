const NOM_BASE = 'https://nominatim.openstreetmap.org';
const PHOTON_BASE = 'https://photon.komoot.io/api';

// Parses Nominatim structured address fields into two display lines.
// line1: street number + street name (bold in dropdown)
// line2: city + country
// short: single-line value written into the input field
function formatAddress(item) {
  const a = item.address || {};
  const road = a.road || a.pedestrian || a.footway || a.cycleway || a.path || a.street || '';
  const line1 = [a.house_number, road].filter(Boolean).join(' ')
    || item.display_name.split(',')[0].trim();
  const city = a.city || a.town || a.village || a.municipality || a.suburb || a.county || '';
  const line2 = [city, a.country].filter(Boolean).join(', ');
  return { line1, line2, short: line2 ? `${line1}, ${line2}` : line1 };
}

// Parses a Photon GeoJSON feature into the same display shape as formatAddress.
function formatPhotonFeature(feature) {
  const p = feature.properties || {};
  const road = p.street || p.name || '';
  const streetLine = [p.housenumber, road].filter(Boolean).join(' ');
  // p.name is the POI name (e.g. a museum) when distinct from the street — keep it
  // so results like "Musée Olympique" aren't reduced to their bare street address.
  const placeName = p.name && p.name !== road ? p.name : '';
  const line1 = [placeName, streetLine].filter(Boolean).join(', ') || placeName || road || '';
  const city = p.city || p.town || p.village || p.state || '';
  const line2 = [city, p.country].filter(Boolean).join(', ');
  const short = line2 ? `${line1}, ${line2}` : line1;
  const label = [line1, line2].filter(Boolean).join(', ');
  const [lng, lat] = feature.geometry.coordinates;
  return { label, line1, line2, short, lat, lng };
}

export async function geocode(q) {
  const url = `${NOM_BASE}/search?q=${encodeURIComponent(q)}&format=json&limit=1&accept-language=fr`;
  const r = await fetch(url);
  const d = await r.json();
  if (!d.length) throw new Error(`Adresse introuvable : "${q}"`);
  return { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon) };
}

export async function reverseGeocode(lat, lng) {
  const url = `${NOM_BASE}/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=fr&addressdetails=1`;
  const r = await fetch(url);
  const d = await r.json();
  if (!d.display_name) throw new Error('Position non reconnue');
  const { short } = formatAddress(d);
  return short;
}

// Returns up to 5 suggestions for the autocomplete dropdown.
// Uses Photon (komoot.io) which is built for autocomplete — unlike Nominatim which forbids it.
// near: optional { lat, lng } to bias results by proximity (no hard filter).
export async function suggest(q, { near } = {}) {
  if (q.length < 3) return [];
  let url = `${PHOTON_BASE}/?q=${encodeURIComponent(q)}&limit=5&lang=fr`;
  if (near) url += `&lat=${near.lat}&lon=${near.lng}`;
  try {
    const r = await fetch(url);
    const d = await r.json();
    return (d.features || []).map(formatPhotonFeature);
  } catch {
    return [];
  }
}
