import { tr } from '../lib/i18n.js';
import { el, button } from './dom';

// Round badges over the scrubber, one per drawer note that changes how to
// read this hour (overcast sky, very low sun). A badge shows while its note
// is on, and a tap opens the note's sentence in a bubble above it. The note
// itself stays in the drawer, which is what screen readers hear: the badges
// are a visual shortcut to it, hidden by CSS on the desktop side panel.

const badges = () => [...document.querySelectorAll<HTMLButtonElement>('.hour-badge')];
const noteOf = (badge: HTMLButtonElement) => el(badge.dataset.note!);
const noteText = (badge: HTMLButtonElement) => noteOf(badge).textContent!.trim();

let openBadge: HTMLButtonElement | null = null;
let inited = false;

function close() {
  if (!openBadge) return;
  openBadge.setAttribute('aria-expanded', 'false');
  openBadge = null;
  el('hour-bubble').hidden = true;
}

function open(badge: HTMLButtonElement) {
  close();
  openBadge = badge;
  badge.setAttribute('aria-expanded', 'true');
  const bubble = el('hour-bubble');
  bubble.textContent = noteText(badge);
  bubble.hidden = false;
}

function init() {
  if (inited) return;
  inited = true;
  for (const badge of badges()) {
    badge.addEventListener('click', () => (openBadge === badge ? close() : open(badge)));
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openBadge) close();
  });
  // A tap anywhere else, the map or the scrubber included, puts it away.
  document.addEventListener('pointerdown', (e) => {
    if (openBadge && !el('hour-badges').contains(e.target as Node)) close();
  });
}

// After any note above may have changed: a new instant on the scrubber, the
// forecast landing.
export function syncHourBadges(cloudCover: number | null) {
  init();
  for (const badge of badges()) {
    const on = noteOf(badge).classList.contains('on');
    badge.hidden = !on;
    if (!on && openBadge === badge) close();
  }
  const weather = button('badge-weather');
  if (cloudCover != null) weather.setAttribute('aria-label', tr('badge_overcast', { pct: String(Math.round(cloudCover)) }));
  // Scrubbing changes the forecast hour under an open bubble.
  if (openBadge) el('hour-bubble').textContent = noteText(openBadge);
}

export function resetHourBadges() {
  close();
  for (const badge of badges()) badge.hidden = true;
}
