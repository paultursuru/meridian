// Geometry of the animated logo on the city pages. The M stands on its
// baseline; its shadow (the W of the icon) is the same glyph flipped below the
// baseline, then scaled and sheared by a sun that swings over the letter when
// the "À l'ombre / Au soleil" toggle flips.

// Bricolage Grotesque Medium "M" at font-size 230, text-anchor middle on
// x = 200, baseline y = 200. Ink metrics measured once in Chromium: SVG getBBox
// on text returns the em box, not the glyph.
export const GLYPH = { size: 230, x: 200, baseline: 200, capHeight: 151.8, inkWidth: 171.4, inkCentre: 200.1 };

// Tuned on the prototype. Angles are the sun's, from vertical.
export const LOGO = {
  angleShade: 32,
  angleSun: 46,
  sunDistance: 1.2, // orbit radius, in cap heights
  shadowLength: 1, // in cap heights
  middayDip: 0.2, // the shadow is this much shorter with the sun overhead
  durationMs: 1400, // a full swing, shade side to sun side
};

export const SUN_GLOW_R = 46;
export const SUN_CORE_R = 15;

export type LogoMode = 'shade' | 'sun';

const rad = (deg: number) => (deg * Math.PI) / 180;
// Stable SSR markup: no 15-digit floats in the HTML.
const r3 = (v: number) => Math.round(v * 1000) / 1000;

// Positive = sun on the right, shadow falling to the left, as on the icon.
export function targetAngle(mode: LogoMode): number {
  return mode === 'sun' ? -rad(LOGO.angleSun) : rad(LOGO.angleShade);
}

// Flip below the baseline, scale by k, shear by s:
// x' = x + s (y0 - y), y' = y0 + k (y0 - y).
export function shadowMatrix(t: number): string {
  const y0 = GLYPH.baseline;
  const side = rad(t >= 0 ? LOGO.angleShade : LOGO.angleSun);
  const dip = LOGO.middayDip * Math.cos((Math.PI / 2) * Math.min(1, Math.abs(t) / side));
  const len = LOGO.shadowLength * (1 - dip);
  const c = r3(len * Math.sin(t)); // -s
  const d = r3(-len * Math.cos(t)); // -k
  // e and f from the rounded terms, so the baseline maps exactly onto itself
  return `matrix(1 0 ${c} ${d} ${r3(-c * y0)} ${r3(y0 - d * y0)})`;
}

// The sun orbits the middle of the M, on the side opposite the shadow.
export function sunTransform(t: number): string {
  const h = GLYPH.capHeight;
  const radius = h * LOGO.sunDistance;
  const cx = GLYPH.inkCentre + radius * Math.sin(t);
  const cy = GLYPH.baseline - h / 2 - radius * Math.cos(t);
  return `translate(${r3(cx)} ${r3(cy)})`;
}

// Symmetric around the M so it stays centred whichever side is wider, with
// room above for the sun passing overhead.
export function viewBox(): string {
  const h = GLYPH.capHeight;
  const radius = h * LOGO.sunDistance;
  const a = rad(Math.max(LOGO.angleShade, LOGO.angleSun));
  const pad = 12;
  const half = Math.max(GLYPH.inkWidth / 2 + LOGO.shadowLength * Math.sin(a) * h, radius * Math.sin(a) + SUN_GLOW_R) + pad;
  const top = GLYPH.baseline - h / 2 - radius - SUN_GLOW_R - pad;
  const bottom = GLYPH.baseline + LOGO.shadowLength * h + pad;
  return `${r3(GLYPH.inkCentre - half)} ${r3(top)} ${r3(2 * half)} ${r3(bottom - top)}`;
}

// A swing interrupted halfway takes half the time to finish.
export function swingMs(from: number, to: number): number {
  return (LOGO.durationMs * Math.abs(to - from)) / rad(LOGO.angleShade + LOGO.angleSun);
}

export function easeInOutCubic(p: number): number {
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}
