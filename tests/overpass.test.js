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

  it('bounds every attempt with what is left of the budget', async () => {
    // The defect this guards: the fetch carried no signal at all, so an
    // instance that never answered held the search open indefinitely.
    let seen;
    globalThis.fetch = async (_url, opts) => { seen = opts.signal; return response(ELEMENTS); };
    await overpassFetch('q', { deadlineMs: 5000 });
    expect(seen).toBeInstanceOf(AbortSignal);
  });

  it('stops retrying once the budget is spent instead of walking the whole ladder', async () => {
    // Four attempts and 10s of sleeps is how a single search reached 35s.
    // Each attempt here burns 5s, so the budget runs out mid-ladder.
    vi.useFakeTimers();
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      await new Promise(res => setTimeout(res, 5000));
      return response('', { 'X-Upstream': 'overpass.osm.ch' }, 504);
    };
    const p = overpassFetch('q', { backoffMs: [1000, 3000, 6000], deadlineMs: 12000 });
    const assertion = expect(p).rejects.toMatchObject({ upstream: 'overpass.osm.ch' });
    await vi.runAllTimersAsync();
    await assertion;
    // t=0 attempt, t=5000 sleep 1s, t=6000 attempt, t=11000 the 3s sleep would
    // land past the deadline, so it is not started.
    expect(calls).toBe(2);
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
