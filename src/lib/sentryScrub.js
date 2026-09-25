import { READY } from './errors.js';

// Keeps the route and the typed addresses out of error reports. Search URLs
// carry them as from/to and fromq/toq, geocoder requests as q=.

export function stripQuery(url) {
  return typeof url === 'string' ? url.replace(/[?#].*$/, '') : url;
}

// A READY error's message is the toast, which can quote the user's input
// (ADDRESS_NOT_FOUND). Its code says the same without it.
function redacted(value) {
  return value instanceof Error && READY.has(value.code) ? `${value.name}: ${value.code}` : null;
}

export function scrubEvent(event, hint) {
  if (event.request) {
    event.request.url = stripQuery(event.request.url);
    const headers = event.request.headers;
    if (headers?.Referer) headers.Referer = stripQuery(headers.Referer);
  }
  const err = hint?.originalException;
  if (redacted(err)) {
    for (const ex of event.exception?.values ?? []) {
      if (ex.value === err.message) ex.value = err.code;
    }
  }
  return event;
}

export function scrubBreadcrumb(crumb, hint) {
  const { category, data } = crumb;
  if ((category === 'fetch' || category === 'xhr') && data) {
    data.url = stripQuery(data.url);
  }
  if (category === 'navigation' && data) {
    data.from = stripQuery(data.from);
    data.to = stripQuery(data.to);
  }
  if (category === 'console') {
    const args = hint?.input ?? [];
    if (args.some(redacted)) {
      const safe = args.map((a) => redacted(a) ?? a);
      crumb.message = safe.map(String).join(' ');
      crumb.data = { ...data, arguments: safe };
    }
  }
  // Autocomplete suggestions carry the place name as their title.
  if (category?.startsWith('ui.') && crumb.message) {
    crumb.message = crumb.message.replace(/\[title=".*?"\]/g, '');
  }
  return crumb;
}
