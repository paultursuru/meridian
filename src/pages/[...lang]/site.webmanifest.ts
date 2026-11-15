import type { APIRoute } from 'astro';
import { LANGS, langPath, translations, type Lang } from '../../lib/i18n';

// One manifest per language, so the app installed from /it/ opens on /it/.
// French stays at /site.webmanifest, where existing installs look for it.
export function getStaticPaths() {
  return LANGS.map(lang => ({
    params: { lang: lang === 'fr' ? undefined : lang },
    props: { lang },
  }));
}

export const GET: APIRoute = ({ props }) => {
  const { lang } = props as { lang: Lang };
  const start = langPath(lang);
  const manifest = {
    // Pinned to what it already defaults to, start_url: the French app keeps
    // the identity of existing installs even if start_url changes one day.
    id: start,
    name: 'MeridianWay',
    short_name: 'MeridianWay',
    description: translations[lang].meta_description,
    lang,
    start_url: start,
    // The default is start_url's folder: from /it/, the French content pages
    // and the other languages would open outside the app.
    scope: '/',
    display: 'standalone',
    background_color: '#0e120a',
    theme_color: '#0e120a',
    icons: [
      { src: '/web-app-manifest-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/web-app-manifest-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  return new Response(JSON.stringify(manifest, null, 2), {
    headers: { 'Content-Type': 'application/manifest+json' },
  });
};
