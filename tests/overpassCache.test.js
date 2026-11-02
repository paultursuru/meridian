import { describe, it, expect, afterEach, vi } from 'vitest';
import worker from '../overpass-cache/src/index.js';

const SECRET_KEY = 'secret-key';
const KEYED_URL = `https://api.overpass.ch/v1/${SECRET_KEY}/interpreter`;
const OVERPASS_DE = 'https://overpass-api.de/api/interpreter';
const OVERPASS_OSM_CH = 'https://overpass.osm.ch/api/interpreter';
const ELEMENTS = '{"elements":[]}';
const MILAN = '[out:json];way(45.4,9.1,45.5,9.2);out;';
const LAUSANNE = '[out:json];way(46.5,6.6,46.6,6.7);out;';

function workerEnv({ keyedUrl = KEYED_URL, put = vi.fn(async () => {}) } = {}) {
  return { OVERPASS_KEYED_URL: keyedUrl, OVERPASS_CACHE: { get: async () => null, put } };
}

function search(query, env = workerEnv()) {
  const request = new Request('https://overpass-cache.test/', {
    method: 'POST',
    headers: { Origin: 'https://meridian-way.ch' },
    body: `data=${encodeURIComponent(query)}`,
  });
  return worker.fetch(request, env);
}

// Answers by upstream URL: { status, body } or an Error to throw. Returns the calls made.
function stubUpstreams(answers) {
  const calls = [];
  vi.stubGlobal('fetch', async (url, init) => {
    calls.push({ url, init });
    const answer = answers[url];
    if (answer instanceof Error) throw answer;
    return new Response(answer.body ?? ELEMENTS, { status: answer.status ?? 200 });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('overpass-cache upstream order', () => {
  it('asks the keyed instance first outside Switzerland', async () => {
    const calls = stubUpstreams({ [KEYED_URL]: {} });
    const res = await search(MILAN);
    expect(calls.map((call) => call.url)).toEqual([KEYED_URL]);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Upstream')).toBe('api.overpass.ch');
  });

  it('serves alone from overpass-api.de when the secret is not set', async () => {
    const calls = stubUpstreams({ [OVERPASS_DE]: {} });
    await search(MILAN, workerEnv({ keyedUrl: '' }));
    expect(calls.map((call) => call.url)).toEqual([OVERPASS_DE]);
  });

  it('keeps the Swiss extract first in Switzerland and never spends the key there', async () => {
    const calls = stubUpstreams({ [OVERPASS_OSM_CH]: { status: 503 }, [OVERPASS_DE]: {} });
    await search(LAUSANNE);
    expect(calls.map((call) => call.url)).toEqual([OVERPASS_OSM_CH, OVERPASS_DE]);
  });
});

describe('overpass-cache fallback', () => {
  it.each([401, 403, 429, 502, 503, 504])('moves on after a %i from the first instance', async (status) => {
    const calls = stubUpstreams({ [KEYED_URL]: { status }, [OVERPASS_DE]: {} });
    const res = await search(MILAN);
    expect(calls.map((call) => call.url)).toEqual([KEYED_URL, OVERPASS_DE]);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Upstream')).toBe('overpass-api.de');
  });

  it('does not try elsewhere for a malformed query', async () => {
    const calls = stubUpstreams({ [KEYED_URL]: { status: 400, body: 'parse error' } });
    const res = await search(MILAN);
    expect(calls).toHaveLength(1);
    expect(res.status).toBe(400);
  });

  it('bounds only the upstream that has a fallback behind it', async () => {
    const calls = stubUpstreams({ [KEYED_URL]: { status: 502 }, [OVERPASS_DE]: {} });
    await search(MILAN);
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(calls[1].init.signal).toBeUndefined();
  });

  it('moves on when the first instance hangs past its limit', async () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const calls = stubUpstreams({ [KEYED_URL]: timeout, [OVERPASS_DE]: {} });
    const res = await search(MILAN);
    expect(calls).toHaveLength(2);
    expect(res.status).toBe(200);
  });
});

describe('overpass-cache secrecy', () => {
  it('never lets the key out, even when every upstream fails', async () => {
    stubUpstreams({
      [KEYED_URL]: new TypeError(`fetch failed for ${KEYED_URL}`),
      [OVERPASS_DE]: new TypeError(`fetch failed for ${OVERPASS_DE}`),
    });
    const res = await search(MILAN);
    expect(res.status).toBe(502);
    const exposed = [await res.text(), res.headers.get('X-Upstream'), res.headers.get('X-Upstream-Trail')].join(' ');
    expect(exposed).not.toContain(SECRET_KEY);
    expect(exposed).toContain('api.overpass.ch');
  });
});

describe('overpass-cache storage', () => {
  it('still answers when KV refuses a value that is too large', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const put = vi.fn(async () => { throw new Error('Value length exceeds limit'); });
    stubUpstreams({ [KEYED_URL]: {} });
    const res = await search(MILAN, workerEnv({ put }));
    expect(put).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(ELEMENTS);
  });

  it('caches a good answer but never a failure', async () => {
    const put = vi.fn(async () => {});
    stubUpstreams({ [KEYED_URL]: { status: 502 }, [OVERPASS_DE]: { status: 502 } });
    const res = await search(MILAN, workerEnv({ put }));
    expect(res.status).toBe(502);
    expect(put).not.toHaveBeenCalled();
  });
});
