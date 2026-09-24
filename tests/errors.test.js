import { describe, it, expect, beforeAll } from 'vitest';
import { searchErrorToast, geoError } from '../src/lib/errors.js';
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
