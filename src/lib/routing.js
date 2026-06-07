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

  const directDist = haversine(start.lat, start.lng, end.lat, end.lng);

  const unique = [];
  for (const rt of all) {
    if (rt.distance > directDist * 2.5) continue;
    if (!unique.some(u => Math.abs(u.distance - rt.distance) / rt.distance < 0.03)) unique.push(rt);
  }

  // If OSRM only returned one route, try a single perpendicular waypoint as fallback.
  if (unique.length < 2) {
    const dx = end.lng - start.lng, dy = end.lat - start.lat;
    const len = Math.sqrt(dx * dx + dy * dy);
    const px = -dy / len, py = dx / len;
    const mLat = (start.lat + end.lat) / 2, mLng = (start.lng + end.lng) / 2;

    for (const offset of [0.0010, -0.0010]) {
      const via = { lat: mLat + py * offset, lng: mLng + px * offset };
      const rt = await osrmRoute([start, via, end]);
      if (!rt || rt.distance > directDist * 2.5) continue;
      if (!unique.some(u => Math.abs(u.distance - rt.distance) / rt.distance < 0.03)) {
        unique.push(rt);
        break;
      }
    }
  }

  return unique;
}
