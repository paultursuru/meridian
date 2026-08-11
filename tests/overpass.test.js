import { describe, it, expect, afterEach, vi } from 'vitest';
import { overpassFetch } from '../src/lib/overpass.js';

// overpass-cache reports which instance served through X-Upstream (on a miss
// only) and X-Cache. The 'search' event carries it so the question "is the
// Swiss mirror actually serving production?" is answered by real traffic
// instead of by sampling bboxes by hand.

function response(body, headers = {}, status = 200) {
  return {
    status,
    headers: { get: name => headers[name] ?? null },
    text: async () => body,
  };
}

const ELEMENTS = JSON.stringify({ elements: [{ type: 'node', id: 1 }] });

afterEach(() => {
  delete globalThis.fetch;
  vi.useRealTimers();
});

describe('overpassFetch upstream reporting', () => {
  it('reports the instance that served', async () => {
    globalThis.fetch = async () => response(ELEMENTS, { 'X-Upstream': 'overpass.osm.ch' });
    const { data, upstream } = await overpassFetch('q');
    expect(upstream).toBe('overpass.osm.ch');
    expect(data.elements).toHaveLength(1);
  });

  it('reports a KV hit as cache rather than as a missing upstream', async () => {
    // A hit carries no X-Upstream: what share of production never reaches an
    // upstream at all is half of what the header was added to measure.
    globalThis.fetch = async () => response(ELEMENTS, { 'X-Cache': 'HIT' });
    const { upstream } = await overpassFetch('q');
    expect(upstream).toBe('cache');
  });

  it('falls back to unknown when the header is absent', async () => {
    globalThis.fetch = async () => response(ELEMENTS);
    const { upstream } = await overpassFetch('q');
    expect(upstream).toBe('unknown');
  });

  it('keeps the upstream of the attempt that actually succeeded', async () => {
    vi.useFakeTimers();
    let call = 0;
    globalThis.fetch = async () => (++call === 1
      ? response('', { 'X-Upstream': 'overpass.osm.ch' }, 504)
      : response(ELEMENTS, { 'X-Upstream': 'overpass-api.de' }));
    const p = overpassFetch('q');
    await vi.runAllTimersAsync();
    expect((await p).upstream).toBe('overpass-api.de');
  });

  it('carries the failing upstream on the thrown error', async () => {
    // The more interesting half: a search that goes `partial` should be able
    // to say which instance lost it its trees.
    vi.useFakeTimers();
    globalThis.fetch = async () => response('', { 'X-Upstream': 'overpass.osm.ch' }, 504);
    const p = overpassFetch('q');
    const assertion = expect(p).rejects.toMatchObject({ upstream: 'overpass.osm.ch' });
    await vi.runAllTimersAsync();
    await assertion;
  });

  it('reports an HTML error page served with a 200 as a failure of its instance', async () => {
    vi.useFakeTimers();
    globalThis.fetch = async () => response('<html>Dispatcher timeout</html>', { 'X-Upstream': 'overpass-api.de' });
    const p = overpassFetch('q');
    const assertion = expect(p).rejects.toMatchObject({ upstream: 'overpass-api.de' });
    await vi.runAllTimersAsync();
    await assertion;
  });
});
