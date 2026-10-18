import { initTabs, initLayout } from '../lib/ui.js';
import { registerServiceWorker, initInstallPrompt, isStandalone } from '../lib/pwa.js';
import { trackPageview, track } from '../lib/analytics.js';
import { setMap, mapFailed, mapReady, selectRoute } from './mapApi';
import { urlHasSearch } from './state';
import { initIntro, hideOnboardingButton, hideAppDescription } from './intro';
import { initSunInfo } from './sunInfo';
import { initFields, pinFilledFields, anyFieldFilled } from './fields';
import { initDeparture, setDepartureNow } from './departure';
import { initGeoButtons, initLocateMe, prefillFromRelaunch, initInitialMapCenter } from './geo';
import { initShareButton } from './shareButton';
import { initAboutDrawer } from './aboutDrawer';
import { initSearch, handleSearch } from './search';
import { initNavigation, restoreFromUrl, startOnboarding, leaveOnboarding } from './navigation';

// Auto page views are off on the tag (see analytics.js): this one is ours.
trackPageview();

// Leaflet + MapLibre (~330 KB) get their own chunk, and nothing here waits on
// it: on a mid-range phone it lands seconds after the form shows, and the form
// answers meanwhile. What needs the map waits on mapReady; the splash covers
// the map until it renders.
import('../lib/map.js').then((api) => {
  api.initMap();
  setMap(api);
  // After initMap: the desktop side panel docks to #map's laid-out offset.
  initLayout();
  // Whatever the fields got before the map was there.
  pinFilledFields();
}).catch(mapFailed);

// Fires only on a user click that changes the route (setActiveTab is also
// called by code): where to measure whether the preselect sticks.
initTabs((type: string) => {
  track('tab_switch', { to: type });
  selectRoute(type);
});
registerServiceWorker();
initInstallPrompt();

window.addEventListener('route-select', (e: Event) => {
  selectRoute((e as CustomEvent<{ type: string }>).detail.type);
});

initSearch();
initSunInfo();
initIntro({ onStartDemo: startOnboarding });
setDepartureNow();
initFields({ onSubmit: () => handleSearch(), onFocus: leaveOnboarding });
initGeoButtons();
initDeparture({ onSearch: () => handleSearch() });
initShareButton();
// Before the restore: a shared link waits on two reverse geocodes, and these
// must answer meanwhile.
initLocateMe();
initAboutDrawer();
initNavigation();

// A link with a search is about to show results: no demo button over them,
// and no intro bubble over the map controls while the link restores.
hideOnboardingButton(urlHasSearch());
if (urlHasSearch()) hideAppDescription();

// Someone who filled a field before the map loaded is already looking where
// they meant to: no recentring under them.
if (!(await restoreFromUrl())) {
  await mapReady;
  if (!anyFieldFilled()) {
    if (isStandalone()) {
      // Installed app: prefill "start" from the phone's position, else
      // center like a browser tab.
      prefillFromRelaunch().then((filled) => { if (!filled) initInitialMapCenter(); });
    } else {
      initInitialMapCenter();
    }
  }
}
