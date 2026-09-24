import { el } from './dom';

const drawer = () => el('about-drawer');

export const isAboutOpen = () => drawer().classList.contains('open');

function openAbout() {
  drawer().classList.add('open');
  el('about-overlay').classList.add('on');
  el('app').setAttribute('inert', '');
  el('about-close').focus();
  // Its own entry, so Back and swipe-back close the panel. No URL argument:
  // the share query stays.
  history.pushState({ nav: 'about' }, '');
}

// The DOM half of the close: idempotent, and reused straight from popstate.
export function closeAbout() {
  if (!isAboutOpen()) return;
  drawer().classList.remove('open');
  el('about-overlay').classList.remove('on');
  el('app').removeAttribute('inert');
  el('about-btn').focus();
}

// Manual dismiss goes through history, so the pushed entry is reclaimed.
function dismissAbout() {
  if (isAboutOpen()) history.back();
}

// role="dialog" alone doesn't trap focus.
function trapAboutFocus(e: KeyboardEvent) {
  if (e.key !== 'Tab' || !isAboutOpen()) return;
  const focusable = Array.from(drawer().querySelectorAll<HTMLElement>('a[href], button:not([disabled])'));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

export function initAboutDrawer() {
  el('about-btn').addEventListener('click', openAbout);
  el('about-close').addEventListener('click', dismissAbout);
  el('about-overlay').addEventListener('click', dismissAbout);
  document.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Escape') dismissAbout(); });
  document.addEventListener('keydown', trapAboutFocus);
}
