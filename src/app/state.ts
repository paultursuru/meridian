import { parseShareQuery } from '../lib/share.js';
import type { Place } from './dom';

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
