const NOM_BASE = 'https://nominatim.openstreetmap.org';

export async function geocode(q) {
  const url = `${NOM_BASE}/search?q=${encodeURIComponent(q)}&format=json&limit=1&accept-language=fr`;
  const r = await fetch(url);
  const d = await r.json();
  if (!d.length) throw new Error(`Adresse introuvable : "${q}"`);
  return { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon) };
}

export async function reverseGeocode(lat, lng) {
  const url = `${NOM_BASE}/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=fr`;
  const r = await fetch(url);
  const d = await r.json();
  if (!d.display_name) throw new Error('Position non reconnue');
  return d.display_name.split(',').slice(0, 3).join(',').trim();
}

// Returns up to 5 suggestions for the autocomplete dropdown.
export async function suggest(q) {
  if (q.length < 3) return [];
  const url = `${NOM_BASE}/search?q=${encodeURIComponent(q)}&format=json&limit=5&accept-language=fr`;
  try {
    const r = await fetch(url);
    const d = await r.json();
    return d.map(item => ({
      label: item.display_name,
      lat:   parseFloat(item.lat),
      lng:   parseFloat(item.lon),
    }));
  } catch {
    return [];
  }
}
