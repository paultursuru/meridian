import { getLang } from '../lib/i18n.js';
import { placeShortName, summaryWhen } from '../lib/helpers.js';
import { map, mapLoaded } from './mapApi';
import { el, button } from './dom';

// On a phone, once a result is on screen, the form folds into a two-line
// summary (start and end, the time, "Modifier") and the map takes the room. A
// tap on it opens the form in its place, and the arrow under the form folds it
// back. CSS shows both under 601px only; on a wider screen these classes
// change nothing.

const panel = () => el('search-panel');
const summary = () => button('form-summary');
const foldBtn = () => button('form-fold');
const shown = (b: HTMLElement) => b.offsetParent !== null;

// Where focus last landed. The search disables the button that started it,
// and the date popover closes: focus drops to <body> before the fold.
let focusLastInPanel = false;

// The map's top edge moves with the form. Leaflet only watches the window:
// it is told here, and keeps what was on screen where it was.
function relayout(change: () => void) {
  const before = el('map').getBoundingClientRect().top;
  change();
  if (mapLoaded()) map.mapTopMoved(before);
}

// Each state hides the button that leads to it, and whatever had focus in
// the form: focus goes to the button that leads back, which also puts the
// phone's keyboard away when the form folds.
function setFolded(folded: boolean) {
  const active = document.activeElement;
  const fromPanel = panel().contains(active) || ((!active || active === document.body) && focusLastInPanel);
  relayout(() => panel().classList.toggle('folded', folded));
  const next = folded ? summary() : foldBtn();
  if (fromPanel && shown(next)) next.focus();
}

// The search on screen, rewritten at each scrubbed instant.
export function updateFormSummary(
  { start, end, date, time, today }: { start: string; end: string; date: string; time: string; today: string },
) {
  el('summary-start').textContent = placeShortName(start);
  el('summary-end').textContent = placeShortName(end);
  el('summary-when').textContent = summaryWhen(date, time, today, getLang());
}

// A search's first frame, before it is fitted to the map.
export function showFormSummary() {
  panel().classList.add('has-summary');
  setFolded(true);
}

// Back to the empty app: the form open, no summary. Focus on either button
// goes with it: it lands on the form itself, not on a field, which would
// bring the phone's keyboard up.
export function hideFormSummary() {
  const active = document.activeElement;
  const lost = active === summary() || active === foldBtn();
  relayout(() => panel().classList.remove('has-summary', 'folded'));
  if (lost) panel().focus({ preventScroll: true });
}

export function initFormSummary() {
  document.addEventListener('focusin', (e) => { focusLastInPanel = panel().contains(e.target as Node); });
  summary().addEventListener('click', () => setFolded(false));
  foldBtn().addEventListener('click', () => setFolded(true));
  // Escape folds the reopened form, once nothing in it is open. A suggestion
  // list marks the key as used; the date popover closes on the document's
  // listener, which runs after this one.
  panel().addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const p = panel().classList;
    if (!p.contains('has-summary') || p.contains('folded')) return;
    if (el('depart-popover').classList.contains('open')) return;
    setFolded(true);
  });
}
