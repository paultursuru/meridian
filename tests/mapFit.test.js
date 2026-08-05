import { describe, it, expect } from 'vitest';
import { FIT_PADDING, FIT_MAX_ZOOM, MIN_FIT_VIEWPORT, clampFitPadding } from '../src/lib/mapFit.js';

// Sentry JAVASCRIPT-ASTRO-E (352 events): fitBounds' padding is bigger than
// the map container on a short viewport, so Leaflet's getBoundsZoom computes
// Math.log of a negative scale, and getScaleZoom turns that NaN into
// Infinity instead of throwing. setView(center, Infinity) then stores an
// Infinity _pixelOrigin silently; the map only blows up at the *next*
// resize, when getCenter does Infinity/Infinity and hands (NaN, NaN) to the
// LatLng constructor. These cover the padding arithmetic that keeps
// `size - padding` positive; the end-to-end behaviour is in
// tests/e2e/map-small-viewport.spec.js.

const total = (p) => ({
  x: p.paddingTopLeft[0] + p.paddingBottomRight[0],
  y: p.paddingTopLeft[1] + p.paddingBottomRight[1],
});

describe('clampFitPadding', () => {
  it('leaves the requested padding untouched on a roomy map', () => {
    expect(clampFitPadding({ x: 900, y: 700 })).toEqual({
      paddingTopLeft: FIT_PADDING.topLeft,
      paddingBottomRight: FIT_PADDING.bottomRight,
    });
  });

  it('keeps a usable viewport when the container is shorter than the padding', () => {
    // 204px is what #map actually measures at 360x420 (a small phone in
    // portrait with the soft keyboard open) — the configuration the Sentry
    // event came from. Requested vertical padding is 230px.
    const clamped = clampFitPadding({ x: 360, y: 204 });
    expect(total(clamped).y).toBeLessThanOrEqual(204 - MIN_FIT_VIEWPORT);
  });

  it('scales top and bottom padding proportionally, keeping the drawer bias', () => {
    // The 30/200 split exists so the route clears the results drawer at the
    // bottom; shrinking must preserve that ratio, not centre the route.
    const { paddingTopLeft, paddingBottomRight } = clampFitPadding({ x: 360, y: 204 });
    const requested = FIT_PADDING.bottomRight[1] / FIT_PADDING.topLeft[1];
    const ratio = paddingBottomRight[1] / paddingTopLeft[1];
    expect(ratio).toBeGreaterThan(requested * 0.8);
    expect(ratio).toBeLessThan(requested * 1.2);
  });

  it('clamps each axis independently', () => {
    // A container narrow enough to break horizontally but tall enough
    // vertically must only lose its horizontal padding.
    const clamped = clampFitPadding({ x: 90, y: 700 });
    expect(total(clamped).x).toBeLessThanOrEqual(90 - MIN_FIT_VIEWPORT);
    expect(clamped.paddingTopLeft[1]).toBe(FIT_PADDING.topLeft[1]);
    expect(clamped.paddingBottomRight[1]).toBe(FIT_PADDING.bottomRight[1]);
  });

  it('never returns negative padding, however small the container', () => {
    for (const size of [{ x: 50, y: 40 }, { x: 0, y: 0 }, { x: 10, y: 5 }]) {
      const { paddingTopLeft, paddingBottomRight } = clampFitPadding(size);
      for (const v of [...paddingTopLeft, ...paddingBottomRight]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('never leaves a negative fitting area, which is what stops the NaN', () => {
    // The one invariant that matters: whatever the container, Leaflet's
    // `size.subtract(padding)` must not go negative on either axis, so
    // getBoundsZoom never takes Math.log of a negative scale. Zero is safe
    // (scale 0 -> Math.log(0) is -Infinity, which Leaflet clamps up to
    // minZoom); only a negative makes getScaleZoom hand back Infinity.
    for (let y = 0; y <= 600; y += 7) {
      for (const x of [0, 60, 90, 200, 360, 900]) {
        const c = clampFitPadding({ x, y });
        expect(x - total(c).x).toBeGreaterThanOrEqual(0);
        expect(y - total(c).y).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('caps the zoom, the second guard against a zero-size bounds', () => {
    // Identical start/end coordinates give boundsSize 0 -> scale Infinity ->
    // zoom Infinity, on a container of any size. Leaflet's
    // _getBoundsCenterZoom applies Math.min(options.maxZoom, zoom) *before*
    // its `zoom === Infinity` early return, so a finite cap defuses that
    // path too. Guard the constant so it can't be dropped back to undefined.
    expect(Number.isFinite(FIT_MAX_ZOOM)).toBe(true);
  });
});
