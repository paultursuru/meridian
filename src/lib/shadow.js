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

// Returns { score: [0,1], segShade: [{i, shade}] }
// A segment midpoint q is in shadow if the reverse-projection of q toward the sun
// (i.e., q shifted by -shadow_vec) falls inside a building's ground footprint.
export function scoreRoute(rt, buildings, sun) {
  const { azDeg, altDeg } = sun;
  const coords = rt.geometry.coordinates;
  const segShade = [];

  if (altDeg <= 0) {
    for (let i = 0; i < coords.length - 1; i += 2) segShade.push({ i, shade: true });
    return { score: 0, segShade };
  }

  const altRad       = altDeg * Math.PI / 180;
  const shadowDir    = (azDeg + 180) % 360;
  const shadowDirRad = shadowDir * Math.PI / 180;
  let sunLen = 0, totalLen = 0;

  for (let i = 0; i < coords.length - 1; i += 2) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[Math.min(i + 2, coords.length - 1)];
    const mLat = (lat1 + lat2) / 2;
    const mLng = (lng1 + lng2) / 2;
    const segLen = haversine(lat1, lng1, lat2, lng2);
    totalLen += segLen;

    const cosLat = Math.cos(mLat * Math.PI / 180);
    let shade = false;

    for (const b of buildings) {
      if (!b.verts || b.verts.length < 3) continue;

      const sLen = b.height / Math.tan(altRad);

      // Conservative pre-filter: if the route point is farther than (sLen + building radius)
      // from the building centroid, the reverse-projection can't be inside the footprint.
      const dLatC = (mLat - b.centroid.lat) * 111000;
      const dLngC = (mLng - b.centroid.lng) * 111000 * cosLat;
      if (dLatC * dLatC + dLngC * dLngC > (sLen + b.radius) * (sLen + b.radius)) continue;

      // Shadow vector: how far and in what direction the shadow of this building extends.
      const dLat = Math.cos(shadowDirRad) * sLen / 111000;
      const dLng = Math.sin(shadowDirRad) * sLen / (111000 * cosLat);

      // Reverse-projection: shift q toward the sun by sLen.
      // If this lands inside the building footprint, q is in shadow.
      if (pointInPolygon(mLat - dLat, mLng - dLng, b.verts)) {
        shade = true;
        break;
      }
    }

    if (!shade) sunLen += segLen;
    segShade.push({ i, shade });
  }

  return { score: totalLen > 0 ? sunLen / totalLen : 0.5, segShade };
}
