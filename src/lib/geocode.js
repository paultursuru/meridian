const NOM_BASE = 'https://nominatim.openstreetmap.org';

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
export async function suggest(q) {
  if (q.length < 3) return [];
  const url = `${NOM_BASE}/search?q=${encodeURIComponent(q)}&format=json&limit=5&accept-language=fr&addressdetails=1`;
  try {
    const r = await fetch(url);
    const d = await r.json();
    return d.map(item => {
      const { line1, line2, short } = formatAddress(item);
      return {
        label: item.display_name,
        line1,
        line2,
        short,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
      };
    });
  } catch {
    return [];
  }
}
