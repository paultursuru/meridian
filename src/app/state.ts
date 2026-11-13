import { parseShareQuery } from '../lib/share.js';
import type { Place } from './dom';

// The search whose routes are on screen, as the next one sees it.
export type ShownSearch = { restore(): void };

// Flags shared by the search, the demo and the history handling.
export const state = {
  // Bumped by each search and by resetSearch, so a stale search's
  // continuations (vegetation lands after the buttons re-enable) skip the DOM.
  searchGeneration: 0,
  // Routes are on screen. Stays set while a newer search loads over them,
  // and puts their drawer back if that search fails.
  shown: null as ShownSearch | null,
  // The search on screen, or loading, is the demo.
  onboarding: false,
  // The search entry under the app is ours, not a landed-on link: Back from
  // it stays in the app. Later searches replace it, so it holds until the URL
  // loses its search.
  searchEntryPushed: false,
  // A history.back() of ours, whose popstate must not be taken for the user's.
  skipNextPop: false,
  // A link is being restored: a popstate meanwhile must not start another.
  restoring: false,
  // The two ends of the search on screen, as the search resolved them: a
  // typed address was geocoded, and its field holds only the text.
  searchEnds: null as { start: Place; end: Place } | null,
};

// A complete search in the URL marks a search's history entry.
export function urlHasSearch() {
  const q = parseShareQuery(location.search);
  return !!(q.start && q.end);
}
