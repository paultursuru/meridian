import { describe, it, expect } from 'vitest';
import { labelAnchors, LABEL_BOX } from '../src/lib/routeLabels.js';

// Two routes from (0, 0) to (400, 0), in screen pixels: straight along y = 0
// on either end, parting in the middle by `bulge` pixels up (a) or down (b).
function route(bulge) {
  const pts = [];
  for (let x = 0; x <= 400; x += 10) {
    const inMiddle = x >= 100 && x <= 300;
    pts.push([x, inMiddle ? bulge : 0]);
  }
  return pts;
}

const collide = (p, q) => Math.abs(p[0] - q[0]) < LABEL_BOX[0] && Math.abs(p[1] - q[1]) < LABEL_BOX[1];

describe('labelAnchors', () => {
  it('puts each label where its route is away from the other', () => {
    const a = route(-80);
    const b = route(80);
    const { a: ia, b: ib } = labelAnchors(a, b);
    expect(a[ia][1]).toBe(-80);
    expect(b[ib][1]).toBe(80);
  });

  it('keeps the labels off the start and end of the route', () => {
    const a = route(-80);
    const b = route(80);
    const { a: ia, b: ib } = labelAnchors(a, b);
    for (const i of [ia, ib]) {
      expect(i).toBeGreaterThan(0);
      expect(i).toBeLessThan(a.length - 1);
    }
  });

  it('never stacks the two labels when the routes barely part', () => {
    const a = route(-4);
    const b = route(4);
    const { a: ia, b: ib } = labelAnchors(a, b);
    expect(collide(a[ia], b[ib])).toBe(false);
  });

  it('never stacks the two labels on identical routes', () => {
    const a = route(0);
    const { a: ia, b: ib } = labelAnchors(a, a.slice());
    expect(collide(a[ia], a[ib])).toBe(false);
    // Near the middle rather than pushed to one end.
    expect(Math.abs(a[ia][0] - 200)).toBeLessThanOrEqual(10);
  });

  it('falls back to the farthest spot when no spot is clear', () => {
    // Too short for two labels side by side anywhere.
    const a = [[0, 0], [20, 0], [40, 0]];
    const b = [[0, 0], [20, 2], [40, 0]];
    const { a: ia, b: ib } = labelAnchors(a, b);
    expect(a[ia]).toBeDefined();
    expect(b[ib]).toBeDefined();
  });

  it('handles a two-vertex route', () => {
    const { a: ia, b: ib } = labelAnchors([[0, 0], [300, 0]], [[0, 0], [150, 120], [300, 0]]);
    expect([0, 1]).toContain(ia);
    expect(ib).toBe(1);
  });
});
