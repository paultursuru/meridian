const ENDPOINT = 'https://overpass-cache.meridianway.workers.dev';
const RETRYABLE = new Set([429, 503, 504]);
// Vegetation no longer blocks the first render (AppLayout.astro's two-pass
// search), so stalling here just delays the background refinement, not the
// result — one retry is plenty for a decorative layer instead of the ~10s a
// 1s+3s+6s ladder cost while it still sat on the critical path. Buildings
// (buildings.js, non-Switzerland/OSM path) still block the first render, so
// they opt back into the full ladder via the backoffMs param below — a
// transient 429/503/504 there shouldn't cost a user their shadow data after
// just one short retry.
const BACKOFF_MS = [1000];

// Fetches an Overpass query, retrying on HTTP 429/503/504 and on HTML error
// pages returned with status 200 (e.g. Overpass "Dispatcher timeout"
// responses). backoffMs controls the retry ladder (defaults to the
// decorative/vegetation one retry; pass a longer ladder for callers on the
// critical path).
export async function overpassFetch(query, { backoffMs = BACKOFF_MS } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= backoffMs.length; attempt++) {
    if (attempt > 0) await new Promise(res => setTimeout(res, backoffMs[attempt - 1]));
    try {
      const r = await fetch(ENDPOINT, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
      });
      if (RETRYABLE.has(r.status)) {
        lastErr = new Error(`Overpass HTTP ${r.status}`);
        continue;
      }
      const text = await r.text();
      // Overpass returns an HTML/XML error page (status 200) on server overload
      if (text.trimStart().startsWith('<')) {
        lastErr = new Error('Overpass returned an error page');
        continue;
      }
      return JSON.parse(text);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}
