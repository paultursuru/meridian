import { getSun, getSunTimes, makeSunSampler, isGrazingSun, isEclipseWindow, ECLIPSE_2026 } from '../lib/sun.js';
import { heightNote, type fetchBuildings } from '../lib/buildings.js';
import type { fetchVegetation } from '../lib/trees.js';
import type { buildRoutes } from '../lib/routing.js';
import { scoreRoute, rankRoutes } from '../lib/shadow.js';
import { deciduousLeafFrac } from '../lib/season.js';
import { dateValueInZone, formatTimeInZone, minutesInZone } from '../lib/timezone.js';
import { weatherAt, type fetchWeather } from '../lib/weather.js';
import { preselectTab } from '../lib/preselect.js';
import { showResults, showQualityNote, showScrubber, hideScrubber, setScrubberLabel } from '../lib/ui.js';
import { buildShareQuery } from '../lib/share.js';
import { notifySearchSucceeded } from '../lib/pwa.js';
import { fmtHm } from '../lib/helpers.js';
import { tr } from '../lib/i18n.js';
import { track } from '../lib/analytics.js';
import { map, selectRoute, reselectActiveRoute } from './mapApi';
import { el } from './dom';
import { state, urlHasSearch } from './state';
import { updateSunInfo, updateMapWeather } from './sunInfo';
import { hideOnboardingButton } from './intro';

// Cloud cover (%) above which the sunny/shady distinction stops mattering
const OVERCAST_PCT = 60;

type BuildingsResult = Awaited<ReturnType<typeof fetchBuildings>>;
type VegetationResult = Awaited<ReturnType<typeof fetchVegetation>>;
type HourlyWeather = Awaited<ReturnType<typeof fetchWeather>>;

export type ShadeData = Pick<BuildingsResult, 'buildings' | 'status' | 'source'>;

export type SearchContext = {
  startC: { lat: number; lng: number; countryCode?: string };
  endC: { lat: number; lng: number; countryCode?: string };
  startQ: string;
  endQ: string;
  demo: boolean;
  searchStart: number;
  midLat: number;
  midLng: number;
  destTz: string;
  tDate: Date;
  sun: { azDeg: number; altDeg: number };
  night: boolean;
  switzerland: boolean;
  routes: Awaited<ReturnType<typeof buildRoutes>>;
  // Null at night, which fetches no buildings.
  shade: ShadeData | null;
};

// A search on screen, from its first render to its last refinement.
// Buildings are fixed for the search; weather and vegetation land later, and
// the scrubber moves the instant.
export function createSearchSession(ctx: SearchContext) {
  const { startC, endC, startQ, endQ, demo, searchStart, midLat, midLng, destTz, tDate, sun, night, switzerland, routes, shade } = ctx;

  const sunTimes = getSunTimes(tDate, midLat, midLng);
  // Fixed per search (the scrubber stays in the day). Gates the marker and
  // is the denominator for eclipse_jump.
  const eclipseDay = switzerland && dateValueInZone(tDate, destTz) === ECLIPSE_2026.date;
  const single = night || routes.length === 1;
  const buildings = shade?.buildings ?? [];
  const buildingsStatus = shade?.status ?? 'ok';
  const buildingsSource = shade?.source ?? (switzerland ? 'swisstopo' : 'osm');
  const leafFrac = night ? 1 : deciduousLeafFrac(tDate, midLat);
  let trees: VegetationResult['trees'] = [];
  let forests: VegetationResult['forests'] = [];
  let vegStatus: VegetationResult['status'] = 'ok';
  // The Overpass instance behind vegetation, which stands for buildings too
  // (same bbox). Null at night.
  let vegUpstream: string | null = null;
  let hourlyWeather: HourlyWeather = null;
  // renderAt dims the ratio bar on 'failed'; vegetation refines it.
  let heightState: ReturnType<typeof heightNote>['state'] = 'ok';
  // Sunny minus shady score, set by renderAt.
  let delta = 0;
  let currentInstant = tDate;
  let msToFirstRender = 0;

  // On the first call vegStatus is still an optimistic 'ok', so only
  // 'partial' can be wrong: applyVegetation re-runs this.
  function updateHeightNote() {
    if (night) { showQualityNote(null); return; }
    const note = heightNote({ buildingsStatus, buildings, vegStatus, source: buildingsSource });
    heightState = note.state;
    showQualityNote(note.text, note.level);
  }

  // At the rendered instant. Empty until the weather lands.
  function updateWeatherInfo(atDate: Date) {
    const w = weatherAt(hourlyWeather, atDate);
    const weatherEl = el('weather-note');
    if (w && w.cloudCover >= OVERCAST_PCT) {
      weatherEl.textContent = tr('weather_overcast', { pct: String(Math.round(w.cloudCover)) });
      weatherEl.classList.add('on');
    } else {
      weatherEl.classList.remove('on');
    }
    updateMapWeather(w);
  }

  const shareUrl = (atDate: Date) => location.pathname + '?' + buildShareQuery({
    start: { ...startC, label: startQ },
    end:   { ...endC,   label: endQ },
    date: dateValueInZone(atDate, destTz),
    time: formatTimeInZone(atDate, destTz),
    // Kept through scrubs, so a reload or a shared demo opens as the demo.
    onboarding: demo,
  });

  // Re-scores the fetched routes for one instant and redraws. Only the sun
  // moves, so this is cheap enough for every scrubber tick.
  function renderAt(atDate: Date) {
    const sunNow = getSun(atDate, midLat, midLng);
    updateSunInfo(sunNow, sunTimes, destTz, atDate);
    // Swiss routes only. Wins over the grazing-sun note: both say "trust
    // this less", the eclipse says why.
    const eclipse = switzerland && !night
      && isEclipseWindow(dateValueInZone(atDate, destTz), minutesInZone(atDate, destTz));
    el('eclipse-note').classList.toggle('on', eclipse);
    el('grazing-sun-note').classList.toggle('on', !night && !eclipse && isGrazingSun(sunNow.altDeg));
    updateWeatherInfo(atDate);

    // The sun moves ~11° over a 45-min walk: each segment is scored at its
    // estimated arrival time.
    const sunSampler = makeSunSampler(atDate, midLat, midLng);
    routes.forEach(rt => {
      const { score, segShade } = scoreRoute(rt, buildings, trees, sunSampler, leafFrac, forests);
      rt.sunScore = score;
      rt.segShade = segShade;
    });
    const ranked = rankRoutes(routes, night);
    delta = ranked.delta;

    map.displayRoutes(startC, endC, ranked.sunny, single ? null : ranked.shady);
    showResults(ranked.sunny, ranked.shady, single, night, heightState === 'failed');

    // The URL always holds the instant on screen, scrubbed or not.
    history.replaceState(null, '', shareUrl(atDate));
  }

  function showFirst() {
    updateHeightNote();
    // A search started from the empty app pushes its own entry so Back
    // undoes it, before renderAt's replaceState can touch the empty app's.
    // Later searches and scrubs replace it; a shared link pushes nothing.
    if (!urlHasSearch()) {
      history.pushState(null, '', shareUrl(tDate));
      state.searchEntryPushed = true;
    }
    state.searchShown = true;
    // The demo button is for the empty app only.
    hideOnboardingButton(true);
    renderAt(tDate);
    notifySearchSucceeded();
    // Here, not where the sunrise jump is built: buildRoutes can still throw
    // before the note is ever seen.
    if (night) track('sunrise_jump', { stage: 'shown' });
    // Captured now: the search event fires later, after vegetation.
    msToFirstRender = Math.round(performance.now() - searchStart);
  }

  function applyWeather(hourly: HourlyWeather) {
    hourlyWeather = hourly;
    // No renderAt: weather changes neither scores nor the map.
    updateWeatherInfo(currentInstant);
    selectRoute(single ? 'sunny' : preselectTab({
      altDeg: sun.altDeg,
      // The searched instant, not a scrubbed one.
      temperature: weatherAt(hourlyWeather, tDate)?.temperature ?? null,
      month: tDate.getUTCMonth(),
      lat: midLat,
    }));
  }

  // Sunrise to sunset. Minutes are offsets from the searched time, which
  // sidesteps DST parsing.
  function startScrubber() {
    if (night) {
      hideScrubber();
      return;
    }
    const initialMinutes = minutesInZone(tDate, destTz);
    // One 'scrub' per search, on the first move.
    let scrubbed = false;
    // Kept apart from 'scrub': dragging and the eclipse shortcut are two
    // separate questions.
    let jumped = false;
    showScrubber({
      min: minutesInZone(sunTimes.sunrise, destTz),
      max: minutesInZone(sunTimes.sunset, destTz),
      value: initialMinutes,
      label: fmtHm(initialMinutes),
      mark: eclipseDay
        ? { minutes: ECLIPSE_2026.maxMin, label: tr('eclipse_max_label', { time: fmtHm(ECLIPSE_2026.maxMin) }) }
        : null,
    }, (minutes: number, source?: string) => {
      if (source === 'mark') {
        if (!jumped) {
          jumped = true;
          track('eclipse_jump');
        }
      } else if (!scrubbed) {
        scrubbed = true;
        track('scrub');
      }
      // So the vegetation pass re-renders where the user scrubbed to.
      currentInstant = new Date(tDate.getTime() + (minutes - initialMinutes) * 60_000);
      renderAt(currentInstant);
      setScrubberLabel(fmtHm(minutes));
      reselectActiveRoute();
    });
  }

  function applyVegetation(vegRes: VegetationResult) {
    trees = vegRes.trees;
    forests = vegRes.forests;
    vegStatus = vegRes.status;
    vegUpstream = vegRes.upstream;
    updateHeightNote();
    renderAt(currentInstant);
    reselectActiveRoute();
  }

  // Once per search: right away at night, else once vegetation settles and
  // status and delta are final.
  function reportSearch() {
    track('search', {
      status: heightState,
      source: buildingsSource,
      country: startC.countryCode,
      buildings: buildings.length,
      ms: msToFirstRender,
      night, single,
      delta,
      eclipse: eclipseDay,
      ...(vegUpstream ? { upstream: vegUpstream } : {}),
      // The demo is the same search for everyone: kept apart from real ones.
      ...(demo ? { onboarding: true } : {}),
    });
  }

  return { showFirst, applyWeather, startScrubber, applyVegetation, reportSearch };
}
