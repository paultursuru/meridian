import { overpassFetch } from './overpass.js';

function deciduous(tags) {
  const cycle = tags?.leaf_cycle || '';
  if (cycle === 'evergreen' || cycle === 'semi_evergreen') return false;
  if (cycle === 'deciduous' || cycle === 'semi_deciduous') return true;
  // Fallback: needleleaved trees are typically evergreen
  return (tags?.leaf_type || 'broadleaved') !== 'needleleaved';
}

function crownRadius(tags) {
  if (tags?.diameter_crown) return parseFloat(tags.diameter_crown) / 2;
  return 4; // default: 4m radius (8m diameter, typical street tree)
}

function treeHeight(tags) {
  if (tags?.height) return parseFloat(tags.height) || 8;
  if (tags?.circumference) {
    // Rough approximation: height ≈ 15× trunk circumference in meters
    return Math.max(4, Math.min(25, parseFloat(tags.circumference) * 15));
  }
  return 8; // default: 8m
}

// Default canopy height for forest polygons without a height tag.
const FOREST_CANOPY_HEIGHT = 15;

function isForest(tags) {
  return tags?.landuse === 'forest' || tags?.natural === 'wood';
}

// Stitch multipolygon member ways (arrays of node ids) into closed rings by
// matching endpoints. Unclosed leftovers (broken data) are dropped.
function stitchRings(memberWays) {
  const segs = memberWays.filter(w => w.length >= 2).map(w => [...w]);
  const rings = [];
  while (segs.length) {
    const ring = segs.pop();
    let extended = true;
    while (ring[0] !== ring[ring.length - 1] && extended) {
      extended = false;
      const end = ring[ring.length - 1];
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (s[0] === end)          { ring.push(...s.slice(1)); segs.splice(i, 1); extended = true; break; }
        if (s[s.length - 1] === end) { ring.push(...s.slice(0, -1).reverse()); segs.splice(i, 1); extended = true; break; }
      }
    }
    if (ring[0] === ring[ring.length - 1] && ring.length >= 4) rings.push(ring);
  }
  return rings;
}

function makeForest(verts, tags, holes = []) {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (const p of verts) {
    if (p.lat < s) s = p.lat; if (p.lat > n) n = p.lat;
    if (p.lng < w) w = p.lng; if (p.lng > e) e = p.lng;
  }
  return {
    verts,
    holes,
    bbox: { s, w, n, e },
    height: parseFloat(tags?.height) || FOREST_CANOPY_HEIGHT,
    isDeciduous: deciduous(tags),
  };
}

function parseVegetation(elements) {
  const nodes = {};
  const waysById = {};
  for (const el of elements) {
    if (el.type === 'node') nodes[el.id] = { lat: el.lat, lng: el.lon };
    else if (el.type === 'way') waysById[el.id] = el;
  }

  const trees = [];
  const forests = [];

  for (const el of elements) {
    if (el.type === 'node' && el.tags?.natural === 'tree') {
      trees.push({
        lat: el.lat,
        lng: el.lon,
        height: treeHeight(el.tags),
        crownRadius: crownRadius(el.tags),
        isDeciduous: deciduous(el.tags),
      });
    } else if (el.type === 'way' && el.tags?.natural === 'tree_row') {
      const h = treeHeight(el.tags);
      const r = crownRadius(el.tags);
      const dec = deciduous(el.tags);
      for (const id of (el.nodes || [])) {
        const pt = nodes[id];
        if (pt) trees.push({ lat: pt.lat, lng: pt.lng, height: h, crownRadius: r, isDeciduous: dec });
      }
    } else if (el.type === 'way' && isForest(el.tags)) {
      const verts = (el.nodes || []).map(id => nodes[id]).filter(Boolean);
      if (verts.length >= 3) forests.push(makeForest(verts, el.tags));
    } else if (el.type === 'relation' && isForest(el.tags)) {
      // Large forests are usually multipolygon relations: stitch outer member
      // ways into rings; inner rings are clearings (holes in the canopy).
      const outers = [], inners = [];
      for (const m of el.members || []) {
        if (m.type !== 'way') continue;
        const way = waysById[m.ref];
        if (way) (m.role === 'inner' ? inners : outers).push(way.nodes || []);
      }
      const idsToVerts = ring => ring.map(id => nodes[id]).filter(Boolean);
      const holes = stitchRings(inners).map(idsToVerts).filter(v => v.length >= 3);
      for (const ring of stitchRings(outers)) {
        const verts = idsToVerts(ring);
        if (verts.length >= 3) forests.push(makeForest(verts, el.tags, holes));
      }
    }
  }

  return { trees, forests };
}

export async function fetchVegetation(bbox) {
  const [s, w, n, e] = bbox;
  const bb = `(${s},${w},${n},${e})`;
  const q = `[out:json][timeout:25];(node["natural"="tree"]${bb};way["natural"="tree_row"]${bb};way["landuse"="forest"]${bb};way["natural"="wood"]${bb};relation["landuse"="forest"]${bb};relation["natural"="wood"]${bb};);out body;>;out skel qt;`;
  try {
    const d = await overpassFetch(q);
    return parseVegetation(d.elements || []);
  } catch (err) {
    console.warn('Overpass vegetation failed', err);
    return { trees: [], forests: [] };
  }
}
