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

function parseTrees(elements) {
  const nodes = {};
  elements
    .filter(e => e.type === 'node')
    .forEach(nd => { nodes[nd.id] = { lat: nd.lat, lng: nd.lon }; });

  const trees = [];

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
    }
  }

  return trees;
}

export async function fetchTrees(bbox) {
  const [s, w, n, e] = bbox;
  const q = `[out:json][timeout:25];(node["natural"="tree"](${s},${w},${n},${e});way["natural"="tree_row"](${s},${w},${n},${e}););out body;>;out skel qt;`;
  try {
    const d = await overpassFetch(q);
    return parseTrees(d.elements || []);
  } catch (err) {
    console.warn('Overpass trees failed', err);
    return [];
  }
}
