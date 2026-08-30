import { tr, getLang } from './i18n.js';

const NOM_BASE = 'https://nominatim.openstreetmap.org';
const PHOTON_BASE = 'https://photon.komoot.io/api';

// Photon only supports a few response languages; 'default' returns local
// (on-the-ground) names, which is the least-wrong fallback for the others.
const PHOTON_LANGS = new Set(['en', 'de', 'fr']);
const photonLang = () => {
  const lang = getLang();
  return PHOTON_LANGS.has(lang) ? lang : 'default';
};

// Swiss postal style writes the house number after the street and abbreviates
// the street type: "Av. Ruchonnet 12, Lausanne", not "12 Avenue Ruchonnet".
// rue and voie are already short and stay as-is.
const CH_STREET_ABBR = [
  [/^avenue\b/i, 'Av.'],
  [/^chemin\b/i, 'Chem.'],
  [/^boulevard\b/i, 'Bd.'],
  [/^esplanade\b/i, 'Espl.'],
];

function abbrevSwissStreet(road) {
  for (const [re, abbr] of CH_STREET_ABBR) {
    if (re.test(road)) return road.replace(re, abbr);
  }
  return road;
}

const CH_COUNTRY = /^(suisse|schweiz|svizzera|svizra|switzerland)$/i;
function isSwiss({ code, name }) {
  if (code) return code.toLowerCase() === 'ch';
  return CH_COUNTRY.test((name || '').trim());
}

// Parses Nominatim structured address fields into two display lines.
// line1: street number + street name (bold in dropdown)
// line2: city + country, or just the city for Swiss addresses
// short: single-line value written into the input field
function formatAddress(item) {
  const a = item.address || {};
  const road = a.road || a.pedestrian || a.footway || a.cycleway || a.path || a.street || '';
  const city = a.city || a.town || a.village || a.municipality || a.suburb || a.county || '';
  const fallbackName = () => item.display_name.split(',')[0].trim();

  if (isSwiss({ code: a.country_code, name: a.country })) {
    const street = road ? [abbrevSwissStreet(road), a.house_number].filter(Boolean).join(' ') : '';
    const line1 = street || fallbackName();
    return { line1, line2: city, short: city ? `${line1}, ${city}` : line1 };
  }

  const line1 = [a.house_number, road].filter(Boolean).join(' ') || fallbackName();
  const line2 = [city, a.country].filter(Boolean).join(', ');
  return { line1, line2, short: line2 ? `${line1}, ${line2}` : line1 };
}

// Parses a Photon GeoJSON feature into the same display shape as formatAddress.
function formatPhotonFeature(feature) {
  const p = feature.properties || {};
  const road = p.street || p.name || '';
  // p.name is the POI name (e.g. a museum) when distinct from the street — keep it
  // so results like "Musée Olympique" aren't reduced to their bare street address.
  const placeName = p.name && p.name !== road ? p.name : '';
  const city = p.city || p.town || p.village || p.state || '';
  const [lng, lat] = feature.geometry.coordinates;
  const countryCode = p.countrycode ? p.countrycode.toLowerCase() : undefined;

  let line1, line2;
  if (isSwiss({ code: countryCode, name: p.country })) {
    const streetLine = [abbrevSwissStreet(road), p.housenumber].filter(Boolean).join(' ');
    line1 = [placeName, streetLine].filter(Boolean).join(', ') || placeName || road || '';
    line2 = city;
  } else {
    const streetLine = [p.housenumber, road].filter(Boolean).join(' ');
    line1 = [placeName, streetLine].filter(Boolean).join(', ') || placeName || road || '';
    line2 = [city, p.country].filter(Boolean).join(', ');
  }

  const short = line2 ? `${line1}, ${line2}` : line1;
  const label = [line1, line2].filter(Boolean).join(', ');
  return { label, line1, line2, short, lat, lng, countryCode };
}

// Coded errors, same pattern as routing.js: the message is what the user
// reads, the code is what analytics groups by.
//
// role ('start' | 'end') rides on the error because handleSearch geocodes both
// endpoints in one Promise.all, so the rejection alone cannot say which field
// the user got wrong.
function addressNotFoundError(q, role) {
  const err = new Error(tr('error_address_not_found', { q }));
  err.code = 'ADDRESS_NOT_FOUND';
  err.role = role;
  return err;
}

function positionUnknownError() {
  const err = new Error(tr('error_position_unknown'));
  err.code = 'POSITION_UNKNOWN';
  return err;
}

// countryCode: lowercase ISO 3166-1 alpha-2 (e.g. 'ch'), or undefined when
// unknown — used to route Swiss searches to the swissBUILDINGS3D pipeline
// instead of Overpass (see buildings.js's fetchBuildings).
// role: optional 'start' | 'end', used only to tag a failure (see above).
export async function geocode(q, { role } = {}) {
  const url = `${NOM_BASE}/search?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=1&accept-language=${getLang()}`;
  const r = await fetch(url);
  const d = await r.json();
  if (!d.length) throw addressNotFoundError(q, role);
  const countryCode = d[0].address?.country_code;
  return { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon), countryCode };
}

export async function reverseGeocode(lat, lng) {
  const url = `${NOM_BASE}/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=${getLang()}&addressdetails=1`;
  const r = await fetch(url);
  const d = await r.json();
  if (!d.display_name) throw positionUnknownError();
  const { short } = formatAddress(d);
  return { short, countryCode: d.address?.country_code };
}

// Returns up to 5 suggestions for the autocomplete dropdown.
// Uses Photon (komoot.io) which is built for autocomplete — unlike Nominatim which forbids it.
// near: optional { lat, lng } to bias results by proximity (no hard filter).
export async function suggest(q, { near } = {}) {
  if (q.length < 3) return [];
  let url = `${PHOTON_BASE}/?q=${encodeURIComponent(q)}&limit=5&lang=${photonLang()}`;
  if (near) url += `&lat=${near.lat}&lon=${near.lng}`;
  try {
    const r = await fetch(url);
    const d = await r.json();
    return (d.features || []).map(formatPhotonFeature);
  } catch {
    return [];
  }
}
