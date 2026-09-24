import { parseShareQuery } from '../lib/share.js';

// Flags shared by the search, the demo and the history handling.
export const state = {
  // Bumped by each search and by resetSearch, so a stale search's
  // continuations (vegetation lands after the buttons re-enable) skip the DOM.
  searchGeneration: 0,
  // Routes are on screen. Stays true while a newer search loads over them.
  searchShown: false,
  // The search on screen, or loading, is the demo.
  onboarding: false,
  // The current search pushed its own history entry (not landed on as a link).
  searchEntryPushed: false,
  // A history.back() of ours, whose popstate must not be taken for the user's.
  skipNextPop: false,
};

// A complete search in the URL marks a search's history entry.
export function urlHasSearch() {
  const q = parseShareQuery(location.search);
  return !!(q.start && q.end);
}
