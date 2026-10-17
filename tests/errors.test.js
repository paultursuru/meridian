import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { searchErrorToast, geoError, fetchOrNetworkError, failReason } from '../src/lib/errors.js';
import { tr } from '../src/lib/i18n.ts';

// tr() reads document.documentElement.lang; the vitest environment is 'node'.
beforeAll(() => {
  globalThis.document = { documentElement: { lang: 'fr' } };
});

const coded = (code, message) => Object.assign(new Error(message), { code });

describe('searchErrorToast', () => {
  it.each([
    ['RATE_LIMIT', 'error_rate_limit'],
    ['TOO_FAR', 'error_too_far'],
    ['ROUTE_FAILED', 'error_route_failed'],
    ['ROUTING_UNAVAILABLE', 'error_routing_unavailable'],
    ['NETWORK', 'error_network'],
  ])('translates %s instead of showing its technical message', (code, key) => {
    expect(searchErrorToast(coded(code, 'ORS 400'))).toBe(tr(key));
  });

  it.each(['ADDRESS_NOT_FOUND', 'POSITION_UNKNOWN', 'NO_ROUTE'])('shows the %s message as-is', (code) => {
    expect(searchErrorToast(coded(code, 'Adresse introuvable : ouchy'))).toBe('Adresse introuvable : ouchy');
  });

  it('prefixes an uncoded error', () => {
    expect(searchErrorToast(new Error('boom'))).toBe(tr('error_prefix') + 'boom');
  });

  it('prefixes a thrown value that is not an Error', () => {
    expect(searchErrorToast('boom')).toBe(tr('error_prefix') + 'boom');
    expect(searchErrorToast(undefined)).toBe(tr('error_prefix') + 'undefined');
  });
});

describe('fetchOrNetworkError', () => {
  afterEach(() => {
    delete globalThis.fetch;
  });

  it('passes any response through, HTTP errors included', async () => {
    const res = { ok: false, status: 503 };
    globalThis.fetch = async () => res;
    await expect(fetchOrNetworkError('/api/route')).resolves.toBe(res);
  });

  it('codes a request that got no response at all as NETWORK', async () => {
    const cause = new TypeError('Failed to fetch');
    globalThis.fetch = async () => { throw cause; };
    const err = await fetchOrNetworkError('https://geo.example/search?q=rue%20du%20Bourg').catch(e => e);
    expect(err.code).toBe('NETWORK');
    expect(err.cause).toBe(cause);
    // A geocoder URL carries the typed address.
    expect(err.message).not.toContain('Bourg');
  });

  it('leaves our own deadline alone', async () => {
    const timeout = new DOMException('signal timed out', 'TimeoutError');
    globalThis.fetch = async () => { throw timeout; };
    await expect(fetchOrNetworkError('/api/overpass')).rejects.toBe(timeout);
  });
});

describe('failReason', () => {
  it.each([
    ['a blocked network', Object.assign(new Error('x'), { code: 'NETWORK' }), 'network'],
    ['our deadline', new DOMException('t', 'TimeoutError'), 'timeout'],
    ['an HTTP status', Object.assign(new Error('x'), { status: 400 }), 'http_400'],
    ['anything else', new SyntaxError('bad json'), 'error'],
    ['no error at all', undefined, 'error'],
  ])('names %s', (_, err, reason) => {
    expect(failReason(err)).toBe(reason);
  });
});

describe('geoError', () => {
  // A GeolocationPositionError carries a numeric code and is not an Error.
  const browserError = (code) => ({ code, message: 'browser detail' });

  it('says the permission was denied for code 1', () => {
    expect(geoError(browserError(1))).toEqual({ toast: tr('error_geo_denied'), code: 'GEO_DENIED' });
  });

  it('shows the timeout message for codes 2 and 3, reported apart', () => {
    expect(geoError(browserError(2))).toEqual({ toast: tr('error_geo_timeout'), code: 'GEO_UNAVAILABLE' });
    expect(geoError(browserError(3))).toEqual({ toast: tr('error_geo_timeout'), code: 'GEO_TIMEOUT' });
  });

  it('shows the message of a failed reverse geocode as-is', () => {
    expect(geoError(coded('POSITION_UNKNOWN', 'Position inconnue')))
      .toEqual({ toast: 'Position inconnue', code: 'POSITION_UNKNOWN' });
  });

  it('falls back to the timeout message and an unknown code', () => {
    expect(geoError(browserError(7))).toEqual({ toast: tr('error_geo_timeout'), code: 'unknown' });
    expect(geoError(new Error('?'))).toEqual({ toast: tr('error_geo_timeout'), code: 'unknown' });
  });
});
