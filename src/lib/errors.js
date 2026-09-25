import { tr } from './i18n.js';

// Codes whose error carries only technical detail: translated here.
const TECHNICAL = {
  RATE_LIMIT: 'error_rate_limit',
  TOO_FAR: 'error_too_far',
  ROUTE_FAILED: 'error_route_failed',
  ROUTING_UNAVAILABLE: 'error_routing_unavailable',
};

// Codes whose message is already the sentence: shown as-is.
export const READY = new Set(['ADDRESS_NOT_FOUND', 'POSITION_UNKNOWN', 'NO_ROUTE']);

// The toast for a failed search. The technical detail stays on the error for
// the console and Sentry.
export function searchErrorToast(err) {
  const code = err?.code;
  const key = code ? TECHNICAL[code] : undefined;
  if (key) return tr(key);
  if (code && READY.has(code) && err instanceof Error) return err.message;
  return tr('error_prefix') + (err instanceof Error ? err.message : String(err));
}

const GEO_CODES = { 1: 'GEO_DENIED', 2: 'GEO_UNAVAILABLE', 3: 'GEO_TIMEOUT' };

// The toast and the reported code for a failed position lookup. Geolocation
// error codes are numeric, ours (reverseGeocode) are strings.
export function geoError(err) {
  const code = err?.code;
  let toast;
  if (code === 1) toast = tr('error_geo_denied');
  else if (code === 'POSITION_UNKNOWN' && err instanceof Error) toast = err.message;
  else toast = tr('error_geo_timeout');
  return {
    toast,
    code: typeof code === 'number' ? (GEO_CODES[code] ?? 'unknown') : (code ?? 'unknown'),
  };
}
