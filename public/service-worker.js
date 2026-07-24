// Minimal service worker: exists solely to satisfy Chrome's installability
// requirement for beforeinstallprompt (a registered fetch handler — review
// 6.1), not to add offline support or caching.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
