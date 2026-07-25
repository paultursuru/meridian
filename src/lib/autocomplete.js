import { suggest } from './geocode.js';

let acInstanceCount = 0;

// Creates and manages an autocomplete dropdown for a given input.
// Returns { getPlace() } — call getPlace() in handleSearch to skip re-geocoding
// when the user picked a suggestion.
export function initAutocomplete(inputEl, { onSelect, getAnchor } = {}) {
  let selectedPlace = null;
  let debounceTimer = null;
  let results = [];
  let activeIndex = -1;
  let requestId = 0; // bumped on every hide()/new query — invalidates in-flight suggest() fetches

  const dropdownId = `ac-dropdown-${++acInstanceCount}`;

  // Dropdown element, appended to body so it escapes flex/overflow constraints
  const dropdown = document.createElement('ul');
  dropdown.className = 'ac-dropdown';
  dropdown.id = dropdownId;
  dropdown.setAttribute('role', 'listbox');
  dropdown.style.display = 'none';
  document.body.appendChild(dropdown);

  inputEl.setAttribute('role', 'combobox');
  inputEl.setAttribute('aria-autocomplete', 'list');
  inputEl.setAttribute('aria-haspopup', 'listbox');
  inputEl.setAttribute('aria-expanded', 'false');
  inputEl.setAttribute('aria-controls', dropdownId);

  function reposition() {
    const r = inputEl.getBoundingClientRect();
    dropdown.style.left  = r.left + window.scrollX + 'px';
    dropdown.style.top   = r.bottom + window.scrollY + 4 + 'px';
    dropdown.style.width = r.width + 'px';
  }

  function isOpen() {
    return dropdown.style.display !== 'none';
  }

  function hide() {
    clearTimeout(debounceTimer);
    requestId++; // any suggest() fetch still in flight is now stale — its result must not reopen the dropdown
    dropdown.style.display = 'none';
    results = [];
    activeIndex = -1;
    inputEl.setAttribute('aria-expanded', 'false');
    inputEl.removeAttribute('aria-activedescendant');
  }

  // Moves the highlighted item to `index`, updating classes + ARIA state.
  function setActive(index) {
    const items = dropdown.children;
    if (activeIndex >= 0 && items[activeIndex]) {
      items[activeIndex].classList.remove('active');
      items[activeIndex].setAttribute('aria-selected', 'false');
    }
    activeIndex = index;
    const item = items[activeIndex];
    if (item) {
      item.classList.add('active');
      item.setAttribute('aria-selected', 'true');
      item.scrollIntoView({ block: 'nearest' });
      inputEl.setAttribute('aria-activedescendant', item.id);
    } else {
      inputEl.removeAttribute('aria-activedescendant');
    }
  }

  function selectResult(index) {
    const place = results[index];
    if (!place) return;
    inputEl.value = place.short;
    selectedPlace = place;
    onSelect?.(place);
    hide();
  }

  function show(newResults) {
    results = newResults;
    dropdown.innerHTML = '';
    activeIndex = -1;
    if (!results.length) { hide(); return; }

    results.forEach((place, index) => {
      const li = document.createElement('li');
      li.className = 'ac-item';
      li.id = `${dropdownId}-opt-${index}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.title = place.label; // full name on hover

      const strong = document.createElement('strong');
      strong.className = 'ac-line1';
      strong.textContent = place.line1;
      li.appendChild(strong);

      if (place.line2) {
        const span = document.createElement('span');
        span.className = 'ac-line2';
        span.textContent = place.line2;
        li.appendChild(span);
      }

      li.addEventListener('mousedown', e => {
        // mousedown fires before blur — prevent input losing focus before we fill it
        e.preventDefault();
        selectResult(index);
      });

      dropdown.appendChild(li);
    });

    reposition();
    dropdown.style.display = 'block';
    inputEl.setAttribute('aria-expanded', 'true');
  }

  inputEl.addEventListener('input', () => {
    selectedPlace = null; // user is typing manually → clear cached place
    clearTimeout(debounceTimer);
    const q = inputEl.value.trim();
    if (q.length < 3) { hide(); return; }
    const myId = ++requestId;
    debounceTimer = setTimeout(async () => {
      const anchor = getAnchor?.();
      const found = await suggest(q, anchor ? { near: anchor } : {});
      if (myId !== requestId) return; // field was cleared/changed/closed since this fetch started
      show(found);
    }, 300);
  });

  inputEl.addEventListener('keydown', e => {
    if (!isOpen()) return; // no suggestions on screen — let other handlers (e.g. search-on-Enter) run

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive(activeIndex < results.length - 1 ? activeIndex + 1 : 0);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive(activeIndex > 0 ? activeIndex - 1 : results.length - 1);
        break;
      case 'Enter':
        if (activeIndex >= 0) {
          // A suggestion is highlighted — Enter picks it. stopImmediatePropagation
          // keeps the search-on-Enter handler in AppLayout.astro (bound on the
          // same input) from also firing and searching the raw typed string.
          e.preventDefault();
          e.stopImmediatePropagation();
          selectResult(activeIndex);
        } else {
          // Nothing highlighted — close the dropdown and let Enter search the
          // raw typed text as before.
          hide();
        }
        break;
      case 'Escape':
        e.preventDefault();
        hide();
        break;
    }
  });

  inputEl.addEventListener('blur', hide);

  // Reposition on scroll/resize in case the panel moved
  window.addEventListener('resize', () => { if (isOpen()) reposition(); });

  return {
    // Returns the pre-resolved {lat, lng} if the user picked a suggestion, null otherwise
    getPlace: () => selectedPlace,
    // Inject a pre-resolved place (e.g. from geolocation) without re-geocoding
    setPlace: ({ lat, lng, label }) => {
      selectedPlace = { lat, lng, label, line1: label, line2: '', short: label };
      inputEl.value = label;
    },
    // Snapshot of the field (text + cached place) — used to swap start/end
    getState: () => ({ value: inputEl.value, place: selectedPlace }),
    setState: ({ value, place }) => {
      inputEl.value = value;
      selectedPlace = place;
    },
    // Resets the field to empty (e.g. the ✕ clear button)
    clear: () => {
      selectedPlace = null;
      inputEl.value = '';
      hide();
    },
  };
}
