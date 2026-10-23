import { describe, it, expect, vi } from 'vitest';
import { STADIA_STYLE, FALLBACK_STYLE, refusal, resourceOf, tuneFallback } from '../src/lib/basemap.js';

// The end-to-end switch (splash, attribution, event) is in
// tests/e2e/basemap-fallback.spec.js.

const ajax = (status, url) => Object.assign(new Error('AJAXError'), { status, url });

describe('resourceOf', () => {
  it('names each kind of Stadia request', () => {
    expect(resourceOf(STADIA_STYLE)).toBe('style');
    expect(resourceOf('https://tiles.stadiamaps.com/styles/alidade-smooth/sprite@2x.png')).toBe('sprite');
    expect(resourceOf('https://tiles.stadiamaps.com/fonts/Stadia%20Regular/0-255.pbf')).toBe('fonts');
    expect(resourceOf('https://tiles.stadiamaps.com/data/openmaptiles.json')).toBe('tiles');
    expect(resourceOf('https://tiles.stadiamaps.com/data/openmaptiles/14/8508/5798.pbf')).toBe('tiles');
  });
});

describe('refusal', () => {
  it('takes a 429 from Stadia, on any resource', () => {
    expect(refusal(ajax(429, STADIA_STYLE))).toEqual({ status: 429, resource: 'style' });
    expect(refusal(ajax(429, 'https://tiles.stadiamaps.com/data/openmaptiles/14/8508/5798.pbf')))
      .toEqual({ status: 429, resource: 'tiles' });
  });

  it('takes a key or domain refusal', () => {
    expect(refusal(ajax(401, STADIA_STYLE))?.status).toBe(401);
    expect(refusal(ajax(403, STADIA_STYLE))?.status).toBe(403);
  });

  it('leaves a hiccup alone', () => {
    expect(refusal(ajax(503, STADIA_STYLE))).toBeNull();
    expect(refusal(ajax(404, 'https://tiles.stadiamaps.com/data/openmaptiles/14/1/1.pbf'))).toBeNull();
  });

  it('leaves a network error alone: it has no status', () => {
    expect(refusal(new TypeError('Failed to fetch'))).toBeNull();
    expect(refusal(undefined)).toBeNull();
  });

  it('never fires on the fallback itself', () => {
    expect(refusal(ajax(429, FALLBACK_STYLE))).toBeNull();
  });
});

describe('tuneFallback', () => {
  const glMap = (layers) => ({
    getLayer: (id) => (layers.includes(id) ? { id } : undefined),
    setPaintProperty: vi.fn(),
  });

  it("fills the buildings with Stadia's colour", () => {
    const map = glMap(['background', 'building']);
    tuneFallback(map);
    expect(map.setPaintProperty).toHaveBeenCalledExactlyOnceWith('building', 'fill-color', 'hsl(95, 5%, 84%)');
  });

  it('leaves a style without buildings alone', () => {
    const map = glMap(['background']);
    tuneFallback(map);
    expect(map.setPaintProperty).not.toHaveBeenCalled();
  });
});
