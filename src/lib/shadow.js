import { haversine } from './helpers.js';

// Ray-casting point-in-polygon (Jordan curve theorem).
// verts: [{lat, lng}, ...] polygon vertices.
function pointInPolygon(lat, lng, verts) {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i].lng, yi = verts[i].lat;
    const xj = verts[j].lng, yj = verts[j].lat;
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// Returns true if 2D segments AB and CD intersect.
function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1x = bx - ax, d1y = by - ay;
  const d2x = dx - cx, d2y = dy - cy;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-12) return false;
  const t = ((cx - ax) * d2y - (cy - ay) * d2x) / denom;
  const u = ((cx - ax) * d1y - (cy - ay) * d1x) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

// True if the sun-ray segment from (lat1,lng1) to (lat2,lng2) crosses the building polygon.
// This correctly handles buildings that lie anywhere between the ground point and the sLen endpoint,
// not just buildings at exactly sLen distance (which the old point-only check missed at low sun angles).
function sunRayHitsBuilding(lat1, lng1, lat2, lng2, verts) {
  if (pointInPolygon(lat2, lng2, verts)) return true;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    if (segmentsIntersect(lat1, lng1, lat2, lng2, verts[i].lat, verts[i].lng, verts[j].lat, verts[j].lng)) return true;
  }
  return false;
}

// Returns 1.0 if the point is inside a building's shadow, 0 otherwise.
function buildingShadeAt(lat, lng, buildings, shadowDirRad, altRad) {
  const cosLat = Math.cos(lat * Math.PI / 180);
  for (const b of buildings) {
    if (!b.verts || b.verts.length < 3) continue;
    const sLen = b.height / Math.tan(altRad);
    const dLatC = (lat - b.centroid.lat) * 111000;
    const dLngC = (lng - b.centroid.lng) * 111000 * cosLat;
    if (dLatC * dLatC + dLngC * dLngC > (sLen + b.radius) * (sLen + b.radius)) continue;
    const dLat = Math.cos(shadowDirRad) * sLen / 111000;
    const dLng = Math.sin(shadowDirRad) * sLen / (111000 * cosLat);
    if (sunRayHitsBuilding(lat, lng, lat - dLat, lng - dLng, b.verts)) return 1.0;
  }
  return 0;
}

// Returns a shade coefficient [0, 1] from tree shadows.
// deciduousLeafFrac: seasonal leaf fraction for deciduous trees (0.05 winter → 1.0 summer).
function treeShadeAt(lat, lng, trees, shadowDirRad, altRad, deciduousLeafFrac) {
  if (!trees.length) return 0;
  const cosLat = Math.cos(lat * Math.PI / 180);
  for (const tree of trees) {
    const coeff = tree.isDeciduous ? deciduousLeafFrac : 1.0;
    if (coeff <= 0) continue;
    const sLen = tree.height / Math.tan(altRad);
    // Pre-filter: point can only be in shadow if within sLen + crownRadius of the tree base
    const dLatC = (lat - tree.lat) * 111000;
    const dLngC = (lng - tree.lng) * 111000 * cosLat;
    if (dLatC * dLatC + dLngC * dLngC > (sLen + tree.crownRadius) * (sLen + tree.crownRadius)) continue;
    // Reverse-project point toward the sun; if it lands within the crown, point is in shadow
    const dLat = Math.cos(shadowDirRad) * sLen / 111000;
    const dLng = Math.sin(shadowDirRad) * sLen / (111000 * cosLat);
    const dpLat = (lat - dLat - tree.lat) * 111000;
    const dpLng = (lng - dLng - tree.lng) * 111000 * cosLat;
    if (dpLat * dpLat + dpLng * dpLng < tree.crownRadius * tree.crownRadius) return coeff;
  }
  return 0;
}

// A dense canopy still lets some light through the leaves.
const FOREST_CANOPY_DENSITY = 0.85;

// Returns a shade coefficient [0, 1] from forest/wood canopy polygons.
// Same reverse-projection as trees: the point is shaded if, moved toward the
// sun by the canopy shadow length, it lands under the canopy. This keeps the
// sun-side edge of a forest sunny and the inside/shadow-side edge shaded.
function forestShadeAt(lat, lng, forests, shadowDirRad, altRad, deciduousLeafFrac) {
  if (!forests.length) return 0;
  const cosLat = Math.cos(lat * Math.PI / 180);
  for (const f of forests) {
    const coeff = FOREST_CANOPY_DENSITY * (f.isDeciduous ? deciduousLeafFrac : 1.0);
    if (coeff <= 0) continue;
    const sLen = f.height / Math.tan(altRad);
    const pLat = lat - Math.cos(shadowDirRad) * sLen / 111000;
    const pLng = lng - Math.sin(shadowDirRad) * sLen / (111000 * cosLat);
    // Forest polygons can be huge, so pre-filter on their bounding box instead
    // of a centroid radius.
    if (pLat < f.bbox.s || pLat > f.bbox.n || pLng < f.bbox.w || pLng > f.bbox.e) continue;
    if (pointInPolygon(pLat, pLng, f.verts)) {
      // Inner rings of multipolygon forests are clearings — no canopy there.
      if (f.holes?.some(h => pointInPolygon(pLat, pLng, h))) continue;
      return coeff;
    }
  }
  return 0;
}

// Fractions along each segment where shade is sampled (25%, 50%, 75%).
const TEST_FRACTIONS = [0.25, 0.5, 0.75];

// Fallback walking speed when the route carries no distance/duration.
const DEFAULT_WALK_MS = 4.5 / 3.6; // 4.5 km/h in m/s

// Returns { score: [0,1], segShade: [{i, shade}] }
// score = fraction of distance in sun (1 = fully sunny, 0 = fully shaded).
// Every segment is tested at 3 points; score is fractional, shade boolean uses majority vote.
// trees, deciduousLeafFrac and forests are optional (defaults to no vegetation).
// sun is either a static { azDeg, altDeg } or a sampler (elapsedS) => { azDeg, altDeg }
// (see makeSunSampler in sun.js) — with a sampler, each segment is scored with
// the sun where it will actually be at that point of the walk.
export function scoreRoute(rt, buildings, trees = [], sun, deciduousLeafFrac = 1.0, forests = []) {
  const coords = rt.geometry.coordinates;
  const segShade = [];

  const sunAt = typeof sun === 'function' ? sun : () => sun;
  const speed = rt.duration > 0 ? rt.distance / rt.duration : DEFAULT_WALK_MS;

  let sunLen = 0, totalLen = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[i + 1];
    const segLen = haversine(lat1, lng1, lat2, lng2);

    const { azDeg, altDeg } = sunAt((totalLen + segLen / 2) / speed);
    totalLen += segLen;

    if (altDeg <= 0) {
      segShade.push({ i, shade: true });
      continue;
    }

    const altRad       = altDeg * Math.PI / 180;
    const shadowDirRad = ((azDeg + 180) % 360) * Math.PI / 180;

    let shadeSum = 0;
    for (const f of TEST_FRACTIONS) {
      const lat = lat1 + (lat2 - lat1) * f;
      const lng = lng1 + (lng2 - lng1) * f;
      // Buildings take priority (full shade); vegetation adds fractional shade if no building covers the point
      const bShade = buildingShadeAt(lat, lng, buildings, shadowDirRad, altRad);
      shadeSum += bShade || Math.max(
        treeShadeAt(lat, lng, trees, shadowDirRad, altRad, deciduousLeafFrac),
        forestShadeAt(lat, lng, forests, shadowDirRad, altRad, deciduousLeafFrac),
      );
    }

    const shadeRatio = shadeSum / TEST_FRACTIONS.length;
    sunLen += segLen * (1 - shadeRatio);
    segShade.push({ i, shade: shadeRatio >= 0.5 });
  }

  return { score: totalLen > 0 ? sunLen / totalLen : 0.5, segShade };
}
