import { tr } from './i18n.js';

const DISMISS_KEY = 'mw_install_dismissed';

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

// Exported (ua param) so the regex can be unit-tested without a real iOS UA string.
export function isIosDevice(ua = navigator.userAgent) {
  return /iPhone|iPad/.test(ua);
}

function showBanner(mode) {
  const banner = document.getElementById('install-banner');
  if (!banner) return;
  document.getElementById('install-banner-text').textContent =
    tr(mode === 'ios' ? 'install_banner_ios' : 'install_banner_android');
  document.getElementById('install-banner-btn').style.display = mode === 'ios' ? 'none' : '';
  banner.classList.add('on');
}

function dismissBanner() {
  document.getElementById('install-banner')?.classList.remove('on');
  localStorage.setItem(DISMISS_KEY, '1');
}

// Chrome only fires beforeinstallprompt once a service worker with a fetch
// handler is registered — service-worker.js is a pure passthrough, registered purely to
// satisfy that check, not for offline support.
export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  }
}

// Custom install banner (review 6.1): the app is installable but neither
// Android nor iOS tells the user on its own — Chrome only shows its native
// mini-infobar once per site, and Safari never fires beforeinstallprompt at
// all. We stash Chrome's prompt event to replay on our own button, and on
// iOS fall back to a "how to" message since there's nothing to trigger.
export function initInstallPrompt() {
  if (isStandalone() || localStorage.getItem(DISMISS_KEY)) return;

  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showBanner('android');
  });

  // navigator.standalone is iOS-only and false while running in Safari's
  // browser chrome (as opposed to undefined elsewhere, or true once installed).
  if (isIosDevice() && navigator.standalone === false) {
    showBanner('ios');
  }

  document.getElementById('install-banner-close')?.addEventListener('click', dismissBanner);
  document.getElementById('install-banner-btn')?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    dismissBanner();
  });
}
