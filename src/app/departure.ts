import { localDateValue } from '../lib/helpers.js';
import { el, input, button } from './dom';

const popover = () => el('depart-popover');
const toggle = () => button('depart-toggle');

// "Leave now" resets the date/time first, so a stale value is never reused.
// A later departure goes through the popover.
export function setDepartureNow() {
  const n = new Date();
  input('inp-date').value = localDateValue(n);
  input('inp-time').value = n.toTimeString().slice(0, 5);
}

// focus: false for the demo: on a phone, focusing the date opens the picker.
export function openDepartPopover({ focus = true }: { focus?: boolean } = {}) {
  popover().classList.add('open');
  toggle().setAttribute('aria-expanded', 'true');
  if (focus) input('inp-date').focus();
}

export function closeDepartPopover() {
  popover().classList.remove('open');
  toggle().setAttribute('aria-expanded', 'false');
}

function toggleDepartPopover() {
  if (popover().classList.contains('open')) closeDepartPopover();
  else openDepartPopover();
}

export function initDeparture({ onSearch }: { onSearch: () => void }) {
  button('search-btn').addEventListener('click', () => {
    setDepartureNow();
    onSearch();
  });
  toggle().addEventListener('click', (e: MouseEvent) => { e.stopPropagation(); toggleDepartPopover(); });
  button('depart-confirm').addEventListener('click', () => onSearch());
  document.addEventListener('click', (e: MouseEvent) => {
    if (!popover().classList.contains('open')) return;
    const target = e.target as Node;
    if (popover().contains(target) || toggle().contains(target)) return;
    closeDepartPopover();
  });
  document.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Escape') closeDepartPopover(); });
}
