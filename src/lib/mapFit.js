// Padding and zoom guards for the fitBounds call in map.js.
//
// Split out of map.js purely so it's testable: map.js imports leaflet, its
// CSS and an SVG via `?raw`, none of which resolve under vitest's node
// environment.
//
// Why any of this exists (Sentry JAVASCRIPT-ASTRO-E, 352 events, "Invalid
// LatLng object: (NaN, NaN)"): Leaflet's getBoundsZoom computes
// `this.getSize().subtract(padding)` and divides by the bounds size. Ask for
// more padding than the container has and that goes negative, so the scale is
// negative and `crs.zoom()` takes Math.log of it — NaN. getScaleZoom then
// turns that NaN into Infinity instead of throwing, _getBoundsCenterZoom has
// an early return for Infinity, and setView(center, Infinity) *succeeds*,
// leaving _zoom and _pixelOrigin at Infinity. The map looks fine until the
// next resize, when getCenter() divides Infinity by Infinity and hands
// (NaN, NaN) to the LatLng constructor — from inside Leaflet's own
// requestAnimationFrame, which is why the production stack had no app frame
// in it at all.

// Requested breathing room around a fitted route, in pixels.
//
// The vertical numbers are there to keep the route out from under the chrome
// that floats on top of the map, not for looks: 60 at the top clears the
// sun-position badge (#map-sun-info, 8px from the edge and about 40 tall), and
// the bottom is a fallback for the drawer + scrubber strip, which map.js
// measures for real via ui.js's bottomOverlayPx(). A too-small top padding is
// what put the start marker behind the badge on a 320x640 screen.
export const FIT_PADDING = { topLeft: [40, 60], bottomRight: [40, 200] };

// Map pixels that must survive the padding on each axis. Small enough to never
// kick in on a normal phone in portrait, big enough that the fitted route is
// still visible when it does.
export const MIN_FIT_VIEWPORT = 60;

// Second guard, for a case the padding clamp cannot catch: coincident
// endpoints give a zero-size bounds, so the scale is Infinity and the zoom
// goes Infinity on a container of any size. _getBoundsCenterZoom applies
// `Math.min(options.maxZoom, zoom)` *before* its `zoom === Infinity` early
// return, so a finite cap defuses that path. 17 is roughly street level: past
// that the basemap has nothing more to show anyway.
export const FIT_MAX_ZOOM = 17;

// Scales the requested padding down, per axis and proportionally, so it always
// leaves at least MIN_FIT_VIEWPORT of map to fit the route into. Returns the
// shape fitBounds wants. `size` is a Leaflet Point ({x, y}) from map.getSize().
export function clampFitPadding(size, padding = FIT_PADDING) {
  // Per axis rather than uniformly: a container can be short without being
  // narrow (a phone in landscape, or portrait with the soft keyboard open),
  // and there's no reason to throw away horizontal padding for that.
  const axis = (i, available) => {
    const near = padding.topLeft[i];
    const far = padding.bottomRight[i];
    const total = near + far;
    const budget = Math.max(available - MIN_FIT_VIEWPORT, 0);
    if (total <= budget) return [near, far];
    if (total === 0) return [0, 0];
    // Proportional, not centred: the 30/200 vertical split is what keeps the
    // route clear of the results drawer, and that bias has to survive being
    // shrunk. Floored so the result can never round back over the budget.
    const scale = budget / total;
    return [Math.floor(near * scale), Math.floor(far * scale)];
  };

  const [left, right] = axis(0, size.x);
  const [top, bottom] = axis(1, size.y);
  return { paddingTopLeft: [left, top], paddingBottomRight: [right, bottom] };
}
