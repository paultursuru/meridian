import { getSun, nextSunriseAfter } from '../lib/sun.js';
import { geocode } from '../lib/geocode.js';
import { buildRoutes } from '../lib/routing.js';
import { routesBbox, fetchBuildings } from '../lib/buildings.js';
import { fetchTileBuildings } from '../lib/tileBuildings.js';
import { fetchVegetation } from '../lib/trees.js';
import { searchErrorToast } from '../lib/errors.js';
import { resolveTimeZone, zonedTimeToUtc, formatTimeInZone, dateValueInZone } from '../lib/timezone.js';
import { fetchWeather } from '../lib/weather.js';
import { setStatus, showToast, hideScrubber } from '../lib/ui.js';
import { tr } from '../lib/i18n.js';
import { track } from '../lib/analytics.js';
import { map } from './mapApi';
import { el, input, button } from './dom';
import { state } from './state';
import { field, searchAnchor } from './fields';
import { openDepartPopover, closeDepartPopover } from './departure';
import { hideAppDescription, showOnboardingNote } from './intro';
import { createSearchSession, type ShadeData } from './searchSession';

// Coded like the ones routing.js and geocode.js raise: translated message
// for the toast, code for the `search` event.
type CodedError = Error & { code?: string; role?: string };
function noRouteError(): CodedError {
  const err: CodedError = new Error(tr('error_no_route'));
  err.code = 'NO_ROUTE';
  return err;
}

export function setSearchBusy(busy: boolean) {
  button('search-btn').disabled = busy;
  button('depart-toggle').disabled = busy;
  button('depart-confirm').disabled = busy;
}

// One listener; each night search rebuilds its target.
let goToSunrise: () => void = () => {};

export function initSearch() {
  button('night-sunrise-btn').addEventListener('click', () => goToSunrise());
}

function prepareSunriseJump(tDate: Date, lat: number, lng: number, timeZone: string) {
  const nextSunrise = nextSunriseAfter(tDate, lat, lng);
  const sunriseDateV = dateValueInZone(nextSunrise, timeZone);
  const sunriseTimeV = formatTimeInZone(nextSunrise, timeZone);
  button('night-sunrise-btn').textContent = tr('night_sunrise_btn', { time: sunriseTimeV });
  // One per search: a double tap is one intent, not two.
  let sunriseJumped = false;
  goToSunrise = () => {
    if (!sunriseJumped) {
      sunriseJumped = true;
      track('sunrise_jump', { stage: 'clicked' });
    }
    input('inp-date').value = sunriseDateV;
    input('inp-time').value = sunriseTimeV;
    handleSearch();
  };
}

// Outside Switzerland, the basemap's building layer answers in ms where
// Overpass takes ~11s. Read cell by cell along the routes; anything short of a
// usable answer falls through to Overpass.
async function loadBuildings(
  routes: Awaited<ReturnType<typeof buildRoutes>>,
  bbox: ReturnType<typeof routesBbox>,
  switzerland: boolean,
  searchStatus: (msg: string | null) => void,
): Promise<ShadeData> {
  searchStatus(tr('status_buildings'));
  if (!switzerland) {
    const { bboxZoom, fitToBbox, glZoom, queryBuildingFeatures, viewportBbox, viewAt } = map;
    const tileRes = await fetchTileBuildings(
      routes,
      { bboxZoom, fitToBbox, glZoom, queryBuildingFeatures, viewportBbox, viewAt },
      (i: number, n: number) => searchStatus(tr('status_buildings_segment', { i: String(i), n: String(n) })),
    );
    if (tileRes.status === 'ok') return tileRes;
    // Back to the generic message after the per-segment ones.
    searchStatus(tr('status_buildings'));
  }
  return fetchBuildings(bbox, { switzerland });
}

export async function handleSearch({ onboarding: demo = false }: { onboarding?: boolean } = {}) {
  const searchStart = performance.now();
  const startQ = input('inp-start').value.trim();
  const endQ   = input('inp-end').value.trim();
  const dateV  = input('inp-date').value;
  const timeV  = input('inp-time').value;

  // Point at the missing field, not just name it.
  if (!startQ || !endQ) {
    // Otherwise the toast stacks on the intro bubble, which already says
    // to fill the fields.
    hideAppDescription();
    showToast(tr('alert_empty'));
    input(startQ ? 'inp-end' : 'inp-start').focus();
    return;
  }

  // Past the check: a refused search must not make the running one stale.
  const mySearchGen = ++state.searchGeneration;
  state.onboarding = demo;
  state.searchEntryPushed = false;
  // Superseded, or undone by Back: checked after each long await.
  const stale = () => mySearchGen !== state.searchGeneration;
  // Also silences the status writes from inside buildRoutes and the tile pass.
  const searchStatus = (msg: string | null) => { if (!stale()) setStatus(msg); };

  setSearchBusy(true);
  closeDepartPopover();
  hideAppDescription();
  showOnboardingNote(demo);
  // The demo is at a set date: its note points up at the popover showing it.
  if (demo) openDepartPopover({ focus: false });
  el('results').classList.remove('on');
  hideScrubber();

  try {
    searchStatus(tr('status_geocoding'));
    // Same anchor as the autocomplete: typed + Enter resolves where the
    // suggestions would.
    const [startC, endC] = await Promise.all([
      field('start').getPlace() ?? geocode(startQ, { role: 'start', near: searchAnchor('end') }),
      field('end').getPlace()   ?? geocode(endQ, { role: 'end', near: searchAnchor('start') }),
    ]);
    const midLat = (startC.lat + endC.lat) / 2;
    const midLng = (startC.lng + endC.lng) / 2;
    // Both ends Swiss, since a route could cross the border. A missing
    // countryCode counts as not Swiss.
    const switzerland = startC.countryCode === 'ch' && endC.countryCode === 'ch';

    // The date/time fields are wall-clock time at the route, not the browser.
    const destTz = await resolveTimeZone(midLat, midLng);
    const tDate = dateV ? zonedTimeToUtc(`${dateV}T${timeV || '12:00'}`, destTz) : new Date();

    const sun = getSun(tDate, midLat, midLng);
    // Night: no weather, no shadows, just the shortest route.
    const night = sun.altDeg <= 0;
    // Started now, awaited late. The whole day, hourly, so the scrubber can
    // re-sample it. Null beyond the forecast horizon or on error.
    const weatherP = night ? Promise.resolve(null) : fetchWeather(midLat, midLng, tDate);
    if (night) prepareSunriseJump(tDate, midLat, midLng, destTz);

    const routes = await buildRoutes(startC, endC, searchStatus);
    if (stale()) return;
    if (!routes.length) throw noRouteError();

    const bbox = routesBbox(routes);
    let shade: ShadeData | null = null;
    let vegP: ReturnType<typeof fetchVegetation> | null = null;
    if (!night) {
      shade = await loadBuildings(routes, bbox, switzerland, searchStatus);
      // Before the vegetation fetch: no Overpass call for a search nobody
      // will see.
      if (stale()) return;
      searchStatus(tr('status_shadows', { n: String(shade.buildings.length), r: String(routes.length) }));
      // Never blocks the first render: vegetation always hits Overpass, up to
      // ~13s with retries, where buildings land in ~1s.
      vegP = fetchVegetation(bbox);
    }

    const session = createSearchSession({
      startC, endC, startQ, endQ, demo, searchStart,
      midLat, midLng, destTz, tDate, sun, night, switzerland,
      routes, shade,
    });
    session.showFirst();

    const hourlyWeather = await weatherP;
    if (stale()) return;
    session.applyWeather(hourlyWeather);
    searchStatus(null);
    session.startScrubber();

    if (vegP) {
      vegP.then(vegRes => {
        // Dropped if a newer search started meanwhile.
        if (stale()) return;
        session.applyVegetation(vegRes);
        session.reportSearch();
      });
    } else {
      session.reportSearch();
    }
  } catch (err) {
    // Undone or superseded: its failure is nobody's news.
    if (stale()) return;
    setStatus(null);
    const { code, role } = (err ?? {}) as CodedError;
    showToast(searchErrorToast(err));
    console.error(err);
    // Never send err.message: it can embed the address the user typed.
    track('search', {
      status: 'error',
      code: code ?? 'unknown',
      ...(role ? { field: role } : {}),
      ms: Math.round(performance.now() - searchStart),
    });
  } finally {
    // A stale search leaves the buttons to whoever made it stale.
    if (!stale()) setSearchBusy(false);
  }
}
