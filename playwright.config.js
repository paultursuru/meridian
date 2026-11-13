import { defineConfig } from '@playwright/test';

// Review #1's 5.5 / review #2's §9.1: every existing test (vitest, tests/)
// covers pure maths — nothing exercises a real page against a failing
// upstream. This is the first (and, for now, only) e2e layer, kept separate
// from vitest since it needs a browser + a running dev server rather than
// jsdom.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4321',
    // The app registers a passthrough service worker (pwa.js) that re-fetches
    // from its own worker context, outside what page.route() can intercept —
    // block it so route mocks actually reach the app's real network calls.
    serviceWorkers: 'block',
    // The same browser on every machine: CI's UTC and a Mac's own timezone and
    // language opened the map on different cities, and only one of them made
    // the first fit an animated zoom. A French-speaking Swiss visitor, the
    // app's audience. Specs that need another set their own.
    timezoneId: 'Europe/Zurich',
    locale: 'fr-CH',
  },
  webServer: {
    command: 'npm run dev -- --port 4321',
    url: 'http://localhost:4321',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
