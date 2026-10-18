import { tr } from './i18n.js';

// Codes whose error carries only technical detail: translated here.
const TECHNICAL = {
  RATE_LIMIT: 'error_rate_limit',
  TOO_FAR: 'error_too_far',
  ROUTE_FAILED: 'error_route_failed',
  ROUTING_UNAVAILABLE: 'error_routing_unavailable',
  // Not answering at all reads the same to the user: the addresses were fine.
  ROUTING_TIMEOUT: 'error_routing_unavailable',
  NETWORK: 'error_network',
};

// fetch() rejects with a bare TypeError only when no response came back at
// all: offline, DNS, or a network filter refusing the host. An HTTP error
// still resolves. Coded so a blocked network reads apart from a bug, without
// the URL in the message: a geocoder URL carries the typed address.
export async function fetchOrNetworkError(url, init) {
  try {
    return await fetch(url, init);
  } catch (err) {
    // Our own deadlines, not the network's doing.
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') throw err;
    const coded = new Error('Network request failed', { cause: err });
    coded.code = 'NETWORK';
    throw coded;
  }
}

// Why a data fetch came back empty, for the search event.
export function failReason(err) {
  if (err?.code === 'NETWORK') return 'network';
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return 'timeout';
  if (typeof err?.status === 'number') return `http_${err.status}`;
  return 'error';
}

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
