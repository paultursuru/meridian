import { el } from './dom';

// The language menu in the header: a disclosure that a second click, Escape,
// a click elsewhere or Tab out of it closes.
export function initLangMenu() {
  const picker = el('lang-picker');
  const btn = el('lang-btn');
  const menu = el('lang-menu');
  const setOpen = (open: boolean) => {
    btn.setAttribute('aria-expanded', String(open));
    menu.hidden = !open;
  };
  btn.addEventListener('click', () => setOpen(btn.getAttribute('aria-expanded') !== 'true'));
  picker.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || menu.hidden) return;
    setOpen(false);
    btn.focus();
  });
  document.addEventListener('click', (e) => {
    if (!picker.contains(e.target as Node)) setOpen(false);
  });
  // Only when focus lands somewhere: Safari doesn't focus a clicked link,
  // and closing on that blur would swallow the click.
  picker.addEventListener('focusout', (e: FocusEvent) => {
    if (e.relatedTarget && !picker.contains(e.relatedTarget as Node)) setOpen(false);
  });
}
