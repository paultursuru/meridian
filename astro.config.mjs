// @ts-check
import { defineConfig } from 'astro/config';

import sitemap from '@astrojs/sitemap';

import sentry from '@sentry/astro';

// https://astro.build/config
export default defineConfig({
  site: 'https://meridian-way.ch',
  vite: {
    server: {
      // The same relays nginx.conf runs in production. `astro preview`
      // inherits them too.
      proxy: {
        '/api/route': {
          target: 'https://ors-proxy.meridianway.workers.dev',
          changeOrigin: true,
          rewrite: () => '/',
        },
        '/api/overpass': {
          target: 'https://overpass-cache.meridianway.workers.dev',
          changeOrigin: true,
          rewrite: () => '/',
        },
        '/api/buildings': {
          target: 'https://swissbuildings-lookup.meridianway.workers.dev',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/buildings/, ''),
        },
      },
    },
  },
  integrations: [
    sitemap({
      i18n: {
        defaultLocale: 'fr',
        locales: {
          fr: 'fr',
          de: 'de',
          it: 'it',
          en: 'en',
          rm: 'rm',
        },
      },
    }),
    sentry({
      project: "meridian-way",
      org: "meridian-way",
      authToken: process.env.SENTRY_AUTH_TOKEN,
      // Sourcemaps are needed to upload to Sentry, but must never be
      // publicly served (review #2 §2.3) — the Dockerfile also strips them
      // unconditionally as the real backstop, since this build currently
      // runs with no auth token (see Dockerfile) and this hook wouldn't fire.
      sourcemaps: {
        filesToDeleteAfterUpload: ['**/*.map'],
      },
    })
  ],
});