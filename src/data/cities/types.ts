import type { LogoMode } from '../../lib/sunLogo';

export type Season = 'hiver' | 'ete';

export interface GlanceItem {
  label: string;
  value: string;
  bar?: number; // percentage drawn as a bar under the value
}

export interface RoutePoint {
  label: string;
  lat: number;
  lng: number;
}

export interface CityRoute {
  from: RoutePoint;
  to: RoutePoint;
  // The link opens the app on the next such day, so it never points to the past.
  when: { monthDay: string; time: string; label: string };
  summary: string;
  sunny: { label: string; minutes: number; km: string };
  other: { label: string; minutes: number; km: string };
}

export interface SeasonContent {
  title: string;
  metaTitle: string;
  metaDescription: string;
  lede: { text: string; strong?: boolean }[];
  defaultMode: LogoMode;
  glance: {
    heading: string;
    shade: { title: string; items: GlanceItem[] };
    sun: { title: string; items: GlanceItem[] };
  };
  routes: { heading: string; items: CityRoute[] };
  spots: { heading: string; intro: string; items: { name: string; where: string; hours: string }[] };
  faq: { q: string; a: string }[];
  method: string;
}

export interface CityPage {
  slug: string;
  name: string;
  lang: 'fr' | 'de' | 'it' | 'rm' | 'en';
  computedOn: string;
  season: Season;
  seasons: Partial<Record<Season, SeasonContent>>;
}
