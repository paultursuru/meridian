const ENDPOINT = 'https://overpass-cache.meridianway.workers.dev';
const RETRYABLE = new Set([429, 503, 504]);
// Vegetation no longer blocks the first render (AppLayout.astro's two-pass
// search), so stalling here just delays the background refinement, not the
// result — one retry is plenty for a decorative layer instead of the ~10s a
// 1s+3s+6s ladder cost while it still sat on the critical path.
const BACKOFF_MS = [1000];

// Fetches an Overpass query with one retry. Retries on HTTP 429/503/504 and
// on HTML error pages returned with status 200 (e.g. Overpass "Dispatcher
// timeout" responses).
export async function overpassFetch(query) {
  let lastErr;
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    if (attempt > 0) await new Promise(res => setTimeout(res, BACKOFF_MS[attempt - 1]));
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
