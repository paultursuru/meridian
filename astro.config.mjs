// @ts-check
import { readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';

import sitemap from '@astrojs/sitemap';

import sentry from '@sentry/astro';

import markDon from 'astro-mark-don';

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
    build: {
      // Astro inlines a page script under 4 kB into the HTML, which the CSP
      // (script-src 'self') blocks in production only: dev always serves
      // scripts as files. Keep every script a file; other assets keep the
      // default limit.
      assetsInlineLimit: (file) => (file.endsWith('.js') ? false : undefined),
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
    }),
    // A .md copy of each page, and /llms.txt with the rule for linking
    // straight to a route.
    markDon({
      // The app pages keep their intro, demo link and about text.
      remove: [
        'button', '#header', '#search-panel', '#map-splash', '#map-sun-info-row',
        '#map-sun-info-details', '#status', '#about-header', '#about-optout',
        '#time-scrubber', '#results', '.city-logo',
      ],
      // Same output for the same pages, so a deploy doesn't rewrite every .md.
      timestamp: false,
      cleanupFn: (markdown) => markdown.replace(/\n{3,}/g, '\n\n').trim() + '\n',
      llmsTxt: {
        title: 'MeridianWay',
        description: 'Walking directions with two routes between the same points: one in the sun, one in the shade, at a chosen date and time. Building heights are measured ones in Switzerland (swisstopo swissBUILDINGS3D), from OpenStreetMap elsewhere. Free web app, no account.',
        content: readFileSync(new URL('./src/llms.md', import.meta.url), 'utf-8'),
        pages: /(^|\/)(about|comment-ca-marche|lausanne)\/$/,
      },
    }),
  ],
});