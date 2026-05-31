export function routesBbox(routes) {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  routes.forEach(rt => rt.geometry.coordinates.forEach(([lng, lat]) => {
    if (lat < s) s = lat; if (lat > n) n = lat;
    if (lng < w) w = lng; if (lng > e) e = lng;
  }));
  const p = 0.0015; // ~150m padding
  return [s - p, w - p, n + p, e + p];
}

function parseBuildings(els) {
  const nodes = {};
  els.filter(e => e.type === 'node').forEach(nd => { nodes[nd.id] = { lat: nd.lat, lng: nd.lon }; });

  const out = [];
  els.filter(e => e.type === 'way' && e.tags && e.tags.building).forEach(way => {
    const pts = (way.nodes || []).map(id => nodes[id]).filter(Boolean);
    if (pts.length < 3) return;

    const centroid = {
      lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
      lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length,
    };

    let height = 10;
    if (way.tags.height)                   height = parseFloat(way.tags.height) || 10;
    else if (way.tags['building:levels'])  height = parseInt(way.tags['building:levels']) * 3.5;
    else if (['church', 'cathedral', 'tower'].includes(way.tags.building)) height = 22;

    // Max distance from centroid to any vertex — used as bounding radius for shadow pre-filter
    const cosLat = Math.cos(centroid.lat * Math.PI / 180);
    const radius = pts.reduce((max, p) => {
      const dlat = (p.lat - centroid.lat) * 111000;
      const dlng = (p.lng - centroid.lng) * 111000 * cosLat;
      return Math.max(max, Math.sqrt(dlat * dlat + dlng * dlng));
    }, 0);

    out.push({ centroid, height, verts: pts, radius });
  });
  return out;
}


export async function fetchBuildings(bbox) {
  const [s, w, n, e] = bbox;
  const q = `[out:json][timeout:25];(way["building"](${s},${w},${n},${e}););out body;>;out skel qt;`;
  try {
    const r = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(q)}`,
    });
    const d = await r.json();
    return parseBuildings(d.elements || []);
  } catch (err) {
    console.warn('Overpass buildings failed, shadows disabled for this query', err);
    return [];
  }
}
