import { initTabs, initLayout } from '../lib/ui.js';
import { registerServiceWorker, initInstallPrompt, isStandalone } from '../lib/pwa.js';
import { trackPageview, track } from '../lib/analytics.js';
import { setMap, map, selectRoute } from './mapApi';
import { urlHasSearch } from './state';
import { initIntro, hideOnboardingButton } from './intro';
import { initSunInfo } from './sunInfo';
import { initFields } from './fields';
import { initDeparture, setDepartureNow } from './departure';
import { initGeoButtons, initLocateMe, prefillFromRelaunch, initInitialMapCenter } from './geo';
import { initShareButton } from './shareButton';
import { initAboutDrawer } from './aboutDrawer';
import { initSearch, handleSearch } from './search';
import { initNavigation, restoreFromUrl, startOnboarding, leaveOnboarding } from './navigation';

// Auto page views are off on the tag (see analytics.js): this one is ours.
trackPageview();

// Leaflet + MapLibre (~330 KB) get their own chunk: nothing needs them
// before the map renders, and the splash covers it until then.
setMap(await import('../lib/map.js'));

map.initMap();
// After initMap: the desktop side panel docks to #map's laid-out offset.
initLayout();
// Fires only on a user click that changes the route (setActiveTab is also
// called by code): where to measure whether the preselect sticks.
initTabs((type: string) => {
  track('tab_switch', { to: type });
  map.setActiveRoute(type);
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

// A link with a search is about to show results: no demo button over them.
hideOnboardingButton(urlHasSearch());

if (!(await restoreFromUrl())) {
  if (isStandalone()) {
    // Installed app: prefill "start" from the phone's position, else
    // center like a browser tab.
    prefillFromRelaunch().then((filled) => { if (!filled) initInitialMapCenter(); });
  } else {
    initInitialMapCenter();
  }
}

initLocateMe();
initAboutDrawer();
initNavigation();
