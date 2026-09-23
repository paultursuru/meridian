// Where to pin the two route labels on the map (map.js).
//
// Split out of map.js so it's testable under vitest, same reason as mapFit.js.
// Works on screen pixels: map.js projects both routes at the current zoom.
//
// Each label goes on the vertex of its route farthest from the other route,
// so it sits where that line is visibly its own rather than on a street both
// routes share. Only the middle of each route is eligible, which keeps the
// labels off the start and end pins.

// A label's footprint, in pixels: two anchors closer than this on both axes
// would put one pill over the other.
export const LABEL_BOX = [84, 32];
const SPAN = [0.2, 0.8];
// Enough to find the widest gap on any walking route, and keeps the work per
// scrubber tick bounded however dense the ORS geometry is.
const MAX_CANDIDATES = 200;

function distToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distToLine(p, line) {
  if (line.length === 1) return Math.hypot(p[0] - line[0][0], p[1] - line[0][1]);
  let min = Infinity;
  for (let i = 0; i < line.length - 1; i++) min = Math.min(min, distToSegment(p, line[i], line[i + 1]));
  return min;
}

// Vertex indices in the middle span of the line, by length along it rather
// than by index: ORS packs vertices into bends and leaves straights bare.
// Each comes with how far it is from the middle, for tie-breaks.
function candidates(line) {
  const cum = [0];
  for (let i = 1; i < line.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  }
  const total = cum[cum.length - 1];
  const all = cum.map((c, i) => ({ i, f: total ? c / total : 0.5 }))
    .map(({ i, f }) => ({ i, f, offMid: Math.abs(f - 0.5) }));
  let out = all.filter(c => c.f >= SPAN[0] && c.f <= SPAN[1]);
  // A sparse line with no vertex in the span: the one nearest the middle.
  if (!out.length) out = [all.reduce((m, c) => (c.offMid < m.offMid ? c : m))];
  const stride = Math.ceil(out.length / MAX_CANDIDATES);
  return stride > 1 ? out.filter((_, k) => k % stride === 0) : out;
}

// Highest score wins; within a pixel, the one nearer the middle does, so two
// routes that never part still get their labels near the middle.
function best(list, score) {
  let top = null, topScore = -Infinity;
  for (const c of list) {
    const s = score(c);
    if (s > topScore + 1 || (Math.abs(s - topScore) <= 1 && c.offMid < top.offMid)) {
      top = c;
      topScore = s;
    }
  }
  return top;
}

const collide = (p, q, [w, h]) => Math.abs(p[0] - q[0]) < w && Math.abs(p[1] - q[1]) < h;

// a, b: [x, y] vertices of each route. `a` is placed first and gets its best
// spot; `b` gets its best spot that doesn't collide with a's, or failing
// that, the spot farthest from it. Returns a vertex index into each.
export function labelAnchors(a, b, box = LABEL_BOX) {
  const ia = best(candidates(a), c => distToLine(a[c.i], b)).i;
  const pa = a[ia];
  const candB = candidates(b);
  const clear = candB.filter(c => !collide(b[c.i], pa, box));
  const ib = clear.length
    ? best(clear, c => distToLine(b[c.i], a)).i
    : best(candB, c => Math.hypot(b[c.i][0] - pa[0], b[c.i][1] - pa[1])).i;
  return { a: ia, b: ib };
}
