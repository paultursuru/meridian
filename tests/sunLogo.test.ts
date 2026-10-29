import { describe, it, expect } from 'vitest';
import { GLYPH, LOGO, targetAngle, shadowMatrix, sunTransform, viewBox, swingMs } from '../src/lib/sunLogo';

// Applies an SVG "matrix(a b c d e f)" string to a point.
function apply(m: string, x: number, y: number): [number, number] {
  const [a, b, c, d, e, f] = m.slice(7, -1).split(' ').map(Number);
  return [a * x + c * y + e, b * x + d * y + f];
}

const y0 = GLYPH.baseline;
const top = y0 - GLYPH.capHeight;

describe('shadowMatrix', () => {
  it('keeps the baseline where it is, whatever the sun', () => {
    for (const t of [targetAngle('shade'), 0, targetAngle('sun')]) {
      const [x, y] = apply(shadowMatrix(t), 150, y0);
      expect(x).toBeCloseTo(150, 2);
      expect(y).toBeCloseTo(y0, 2);
    }
  });

  it('throws the top of the M down and to the left on the shade side, like the icon', () => {
    const [x, y] = apply(shadowMatrix(targetAngle('shade')), 200, top);
    expect(y).toBeGreaterThan(y0);
    expect(x).toBeLessThan(200);
  });

  it('throws it to the right, and flatter, on the sun side', () => {
    const shade = apply(shadowMatrix(targetAngle('shade')), 200, top);
    const sun = apply(shadowMatrix(targetAngle('sun')), 200, top);
    expect(sun[0]).toBeGreaterThan(200);
    expect(sun[0] - 200).toBeGreaterThan(200 - shade[0]);
    expect(sun[1]).toBeLessThan(shade[1]);
  });

  it('is straight down and shorter with the sun overhead', () => {
    const [x, y] = apply(shadowMatrix(0), 200, top);
    expect(x).toBeCloseTo(200, 2);
    expect(y - y0).toBeCloseTo(GLYPH.capHeight * LOGO.shadowLength * (1 - LOGO.middayDip), 1);
  });
});

describe('sunTransform', () => {
  it('puts the sun on the side opposite the shadow', () => {
    const x = (t: number) => Number(sunTransform(t).match(/translate\(([-\d.]+)/)![1]);
    expect(x(targetAngle('shade'))).toBeGreaterThan(GLYPH.inkCentre);
    expect(x(targetAngle('sun'))).toBeLessThan(GLYPH.inkCentre);
  });
});

describe('viewBox', () => {
  it('stays centred on the M', () => {
    const [minX, , width] = viewBox().split(' ').map(Number);
    expect(minX + width / 2).toBeCloseTo(GLYPH.inkCentre, 2);
  });
});

describe('swingMs', () => {
  it('takes the full duration from one side to the other, and half from the middle', () => {
    const shade = targetAngle('shade'), sun = targetAngle('sun');
    expect(swingMs(shade, sun)).toBeCloseTo(LOGO.durationMs, 6);
    expect(swingMs((shade + sun) / 2, sun)).toBeCloseTo(LOGO.durationMs / 2, 6);
  });
});
