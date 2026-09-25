import { describe, it, expect, beforeEach } from 'vitest';
import { isOptedOut, setOptedOut } from '../src/lib/analyticsOptOut.js';

// No DOM in the "node" environment: an in-memory stand-in for localStorage.
function memoryStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

function throwingStorage() {
  const fail = () => { throw new Error('SecurityError'); };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

beforeEach(() => { globalThis.localStorage = memoryStorage(); });

describe('analytics opt-out', () => {
  it('counts the visitor by default', () => {
    expect(isOptedOut()).toBe(false);
  });

  it('writes the key the Umami tracker checks before each send', () => {
    setOptedOut(true);
    expect(globalThis.localStorage.getItem('umami.disabled')).toBe('1');
    expect(isOptedOut()).toBe(true);
  });

  it('removes the key to opt back in, since any stored value disables', () => {
    setOptedOut(true);
    setOptedOut(false);
    expect(globalThis.localStorage.getItem('umami.disabled')).toBeNull();
    expect(isOptedOut()).toBe(false);
  });

  it('treats a value set by hand as opted out', () => {
    globalThis.localStorage.setItem('umami.disabled', '0');
    expect(isOptedOut()).toBe(true);
  });

  it('reports a refused write instead of throwing', () => {
    globalThis.localStorage = throwingStorage();
    expect(setOptedOut(true)).toBe(false);
    expect(isOptedOut()).toBe(false);
  });
});
