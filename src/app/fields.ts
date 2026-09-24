import { initAutocomplete } from '../lib/autocomplete.js';
import { reverseGeocode } from '../lib/geocode.js';
import { track } from '../lib/analytics.js';
import { map } from './mapApi';
import { el, input, button, type Role, type Autocomplete, type Place } from './dom';

const ac = {} as Record<Role, Autocomplete>;

export const field = (role: Role) => ac[role];

// Only drives the ✕ buttons. Search buttons stay enabled on empty fields:
// one filled without an `input` event (autofill, dictation) must still
// search, and handleSearch says what's missing.
export function syncInputState() {
  const sVal = input('inp-start').value.trim();
  const eVal = input('inp-end').value.trim();
  input('inp-start').closest('.input-wrap')!.classList.toggle('has-value', !!sVal);
  input('inp-end').closest('.input-wrap')!.classList.toggle('has-value', !!eVal);
}

// Bias a lookup towards the other endpoint once resolved, else the map.
export const searchAnchor = (other: Role) => ac[other].getPlace() ?? map.mapCenter();

// Fills a field with a resolved place and pins it on the map.
export function applyPlace(role: Role, place: Place, pinOptions?: { pan?: boolean }) {
  ac[role].setPlace(place);
  map.setPreviewPin(role, place, pinOptions);
  syncInputState();
}

// A point picked on the map (openPickPopup in map.js). The coordinates fill
// the field at once so the point is usable, then the address replaces them.
// A failed lookup keeps them, with no country: a Swiss route uses Overpass.
const pickToken = { start: 0, end: 0 };

async function fillFromMap(role: Role, lat: number, lng: number) {
  const token = ++pickToken[role];
  applyPlace(role, { lat, lng, label: `${lat.toFixed(5)}, ${lng.toFixed(5)}` }, { pan: false });
  track('point_picked', { role, method: 'map' });
  try {
    const { short, countryCode } = await reverseGeocode(lat, lng);
    // Dropped if a newer pick on this field has started.
    if (token !== pickToken[role]) return;
    ac[role].setPlace({ lat, lng, label: short, countryCode });
    syncInputState();
  } catch { /* the coordinates stay in the field */ }
}

function clearField(role: Role) {
  ac[role].clear();
  map.clearPreviewPin(role);
  syncInputState();
  input(`inp-${role}`).focus();
}

let swapAngle = 0;
function swapEndpoints() {
  const a = ac.start.getState();
  const b = ac.end.getState();
  ac.start.setState(b);
  ac.end.setState(a);
  map.swapPreviewPins();
  syncInputState();
  // Accumulate the angle so the transition replays in full on every click.
  swapAngle += 180;
  el('swap-btn').querySelector<HTMLElement>('.swap-ico')!
    .style.transform = `rotate(${swapAngle}deg)`;
}

export function resetFields() {
  ac.start.clear();
  ac.end.clear();
  // A reverse geocode still running for a map pick must not refill a field.
  pickToken.start++;
  pickToken.end++;
  syncInputState();
}

export function initFields({ onSubmit, onFocus }: { onSubmit: () => void; onFocus: () => void }) {
  ac.start = initAutocomplete(input('inp-start'), { onSelect: (p: { lat: number; lng: number }) => { map.setPreviewPin('start', p); syncInputState(); }, getAnchor: () => searchAnchor('end') });
  ac.end   = initAutocomplete(input('inp-end'),   { onSelect: (p: { lat: number; lng: number }) => { map.setPreviewPin('end',   p); syncInputState(); }, getAnchor: () => searchAnchor('start') });
  const roles: Role[] = ['start', 'end'];
  roles.forEach(role => input(`inp-${role}`).addEventListener('input', syncInputState));
  syncInputState();

  window.addEventListener('map-point-picked', (e: Event) => {
    const { role, lat, lng } = (e as CustomEvent<{ role: Role; lat: number; lng: number }>).detail;
    fillFromMap(role, lat, lng);
  });
  roles.forEach(role => button(`clear-${role}`).addEventListener('click', () => clearField(role)));
  button('swap-btn').addEventListener('click', swapEndpoints);
  // After initAutocomplete: its own Enter handler, bound first, stops this one
  // when Enter picks a highlighted suggestion.
  roles.forEach(role => input(`inp-${role}`).addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter') onSubmit(); }));
  roles.forEach(role => input(`inp-${role}`).addEventListener('focus', onFocus));
}
