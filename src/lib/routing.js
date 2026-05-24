import { haversine } from './helpers.js';

// routing.openstreetmap.de/routed-foot uses the OSM foot profile (sidewalks, stairs, footpaths).
// The API path says /driving/ but the subdomain selects the foot profile.
const OSRM_FOOT = 'https://routing.openstreetmap.de/routed-foot/route/v1/driving';
const WALK_MS   = 4.5 / 3.6; // 4.5 km/h in m/s — override OSRM duration (public server returns car speed)

async function osrmRoute(pts) {
  const str = pts.map(c => `${c.lng},${c.lat}`).join(';');
  const r = await fetch(`${OSRM_FOOT}/${str}?overview=full&geometries=geojson`);
  const d = await r.json();
  if (d.code !== 'Ok' || !d.routes[0]) return null;
  const rt = d.routes[0];
  return { geometry: rt.geometry, distance: rt.distance, duration: rt.distance / WALK_MS };
}

async function osrmAlts(start, end) {
  const r = await fetch(
    `${OSRM_FOOT}/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson&alternatives=true`
  );
  const d = await r.json();
  if (d.code !== 'Ok') return [];
  return d.routes.map(rt => ({
    geometry: rt.geometry,
    distance: rt.distance,
    duration: rt.distance / WALK_MS,
  }));
}

export async function buildRoutes(start, end, onStatus) {
  onStatus('🗺️ Génération des itinéraires…');
  const all = await osrmAlts(start, end);

  // Perpendicular offsets at pedestrian scale: adjacent streets ~100-200m apart
  const dx = end.lng - start.lng, dy = end.lat - start.lat;
  const len = Math.sqrt(dx * dx + dy * dy);
  const px = -dy / len, py = dx / len;

  const mLat = (start.lat + end.lat) / 2, mLng = (start.lng + end.lng) / 2;
  const p1Lat = start.lat + dy * 0.33,    p1Lng = start.lng + dx * 0.33;
  const p2Lat = start.lat + dy * 0.67,    p2Lng = start.lng + dx * 0.67;

  const vias = [
    { lat: mLat + py * 0.0007, lng: mLng + px * 0.0007 },
    { lat: mLat - py * 0.0007, lng: mLng - px * 0.0007 },
    { lat: mLat + py * 0.0013, lng: mLng + px * 0.0013 },
    { lat: mLat - py * 0.0013, lng: mLng - px * 0.0013 },
    { lat: mLat + py * 0.0018, lng: mLng + px * 0.0018 },
    { lat: mLat - py * 0.0018, lng: mLng - px * 0.0018 },
    { lat: p1Lat + py * 0.0010, lng: p1Lng + px * 0.0010 },
    { lat: p2Lat - py * 0.0010, lng: p2Lng - px * 0.0010 },
  ];

  const settled = await Promise.allSettled(vias.map(v => osrmRoute([start, v, end])));
  settled.forEach(r => { if (r.status === 'fulfilled' && r.value) all.push(r.value); });

  const directDist = haversine(start.lat, start.lng, end.lat, end.lng);

  // Remove routes with obvious backtracking (>2.5× direct haversine distance).
  // Threshold is generous because pedestrian routes in hilly cities like Lausanne
  // can legitimately reach 1.5–2× the crow-flies distance.
  const unique = [];
  for (const rt of all) {
    if (rt.distance > directDist * 2.5) continue;
    if (!unique.some(u => Math.abs(u.distance - rt.distance) / rt.distance < 0.03)) unique.push(rt);
  }

  return unique;
}
