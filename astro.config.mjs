// @ts-check
import { defineConfig } from 'astro/config';

import sitemap from '@astrojs/sitemap';

import sentry from '@sentry/astro';

// https://astro.build/config
export default defineConfig({
  site: 'https://meridian-way.ch',
  integrations: [sitemap({
    i18n: {
      defaultLocale: 'fr',
      locales: {
        fr: 'fr',
        de: 'de',
        it: 'it',
        en: 'en',
      },
    },
  }), sentry({
      project: "meridian-way",
      org: "meridian-way",
      authToken: process.env.SENTRY_AUTH_TOKEN,
    })
  ],
});