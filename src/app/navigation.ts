import { reverseGeocode } from '../lib/geocode.js';
import { parseShareQuery } from '../lib/share.js';
import { ONBOARDING } from '../lib/onboarding.js';
import { hideResults, hideScrubber, showQualityNote, setStatus } from '../lib/ui.js';
import { tr } from '../lib/i18n.js';
import { track } from '../lib/analytics.js';
import { map } from './mapApi';
import { el, input, button } from './dom';
import { state, urlHasSearch } from './state';
import { field, applyPlace, resetFields } from './fields';
import { setDepartureNow, closeDepartPopover } from './departure';
import { hideAppDescription, showOnboardingNote, hideOnboardingButton } from './intro';
import { resetSunInfo } from './sunInfo';
import { isAboutOpen, closeAbout } from './aboutDrawer';
import { handleSearch, setSearchBusy } from './search';

// Shared link, or Forward onto a search entry. False without a complete
// search in the URL; a partial one still fills what it has.
export async function restoreFromUrl(): Promise<boolean> {
  const search = location.search;
  const shared = parseShareQuery(search);
  if (shared.date) input('inp-date').value = shared.date;
  if (shared.time) input('inp-time').value = shared.time;
  if (shared.start) applyPlace('start', shared.start);
  if (shared.end)   applyPlace('end', shared.end);
  if (!shared.start || !shared.end) return false;
  // Links carry no country: resolve it so a Swiss link uses swisstopo.
  const [startCC, endCC] = await Promise.all([
    reverseGeocode(shared.start.lat, shared.start.lng).then(r => r.countryCode).catch(() => undefined),
    reverseGeocode(shared.end.lat, shared.end.lng).then(r => r.countryCode).catch(() => undefined),
  ]);
  // Back again meanwhile: running it now would push an unwanted entry.
  if (location.search !== search) return true;
  field('start').setPlace({ ...shared.start, countryCode: startCC });
  field('end').setPlace({ ...shared.end, countryCode: endCC });
  if (shared.onboarding) track('onboarding', { via: 'link' });
  handleSearch({ onboarding: shared.onboarding });
  return true;
}

// Run like a typed search, so Back returns to the empty app. Already Swiss:
// no reverse geocode.
export function startOnboarding() {
  track('onboarding', { via: 'button' });
  input('inp-date').value = ONBOARDING.date;
  input('inp-time').value = ONBOARDING.time;
  applyPlace('start', { ...ONBOARDING.start, label: tr('onboarding_from') }, { pan: false });
  applyPlace('end', { ...ONBOARDING.end, label: tr('onboarding_to') }, { pan: false });
  handleSearch({ onboarding: true });
}

// Back from a search, without a reload. The map view stays, and focus
// stays out of the fields so no keyboard pops up.
export function resetSearch() {
  // A search still in flight, and any vegetation pass, is now stale.
  state.searchGeneration++;
  state.searchShown = false;
  // Out of the demo too: its note and date go, the button comes back.
  state.onboarding = false;
  hideAppDescription();
  showOnboardingNote(false);
  closeDepartPopover();
  hideOnboardingButton(false);
  map.clearMap();
  resetFields();
  setDepartureNow();
  hideResults();
  hideScrubber();
  showQualityNote(null);
  setStatus(null);
  // Rather than waiting on the upstreams of a search that no longer counts.
  setSearchBusy(false);
  resetSunInfo();
}

// Typing leaves the demo for the empty app. Landed on as a link, there is
// none underneath: the entry becomes one.
export function leaveOnboarding() {
  if (!state.onboarding) return;
  resetSearch();
  if (state.searchEntryPushed) {
    state.skipNextPop = true;
    history.back();
  } else {
    history.replaceState(null, '', location.pathname);
  }
}

// Back peels one layer per press: the about panel, then the search. The
// results drawer has no entry, it has its own gesture.
// The URL tells where Back landed, never event.state: renderAt's
// replaceState(null) wipes it on every scrub. A search entry with nothing
// on screen means Forward.
export function initNavigation() {
  window.addEventListener('popstate', () => {
    // leaveOnboarding's own step back: the app is already reset.
    if (state.skipNextPop) {
      state.skipNextPop = false;
      return;
    }
    // No entry of its own, but a Back shouldn't leave it hanging open.
    closeDepartPopover();
    if (isAboutOpen()) {
      closeAbout();
      return;
    }
    const inUrl = urlHasSearch();
    if (!inUrl && state.searchShown) {
      // loading: a search runs (read before the reset frees the button) and
      // nothing is drawn yet.
      const loading = button('search-btn').disabled && !el('results').classList.contains('on');
      track('back_reset', { loading });
      resetSearch();
    } else if (inUrl && !state.searchShown) {
      restoreFromUrl();
    }
  });
}
