import { describe, it, expect, beforeEach } from 'vitest';
import { saveLastPosition, getLastPosition } from '../src/lib/lastPosition.js';

// vitest.config.js runs tests in the plain "node" environment (no DOM), so
// there's no real localStorage — a minimal in-memory stand-in is enough to
// exercise the try/catch-wrapped Storage API surface lastPosition.js uses.
function memoryStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
}

beforeEach(() => { globalThis.localStorage = memoryStorage(); });

describe('lastPosition', () => {
  it('returns null when nothing has been saved', () => {
    expect(getLastPosition()).toBeNull();
  });

  it('round-trips a saved position', () => {
    saveLastPosition(46.5218, 6.6327);
    expect(getLastPosition()).toEqual({ lat: 46.5218, lng: 6.6327 });
  });

  it('ignores corrupted stored data instead of throwing', () => {
    globalThis.localStorage.setItem('mw_last_position', 'not json');
    expect(getLastPosition()).toBeNull();
  });

  it('stays silent when localStorage throws (e.g. private browsing quota)', () => {
    globalThis.localStorage = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
    };
    expect(() => saveLastPosition(1, 2)).not.toThrow();
    expect(getLastPosition()).toBeNull();
  });
});
