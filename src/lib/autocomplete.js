import { suggest } from './geocode.js';

// Shorten Nominatim display_name: keep first 3 comma-separated parts
function shortLabel(displayName) {
  return displayName.split(',').slice(0, 3).join(',').trim();
}

// Creates and manages an autocomplete dropdown for a given input.
// Returns { getPlace() } — call getPlace() in handleSearch to skip re-geocoding
// when the user picked a suggestion.
export function initAutocomplete(inputEl) {
  let selectedPlace = null;
  let debounceTimer = null;

  // Dropdown element, appended to body so it escapes flex/overflow constraints
  const dropdown = document.createElement('ul');
  dropdown.className = 'ac-dropdown';
  dropdown.style.display = 'none';
  document.body.appendChild(dropdown);

  function reposition() {
    const r = inputEl.getBoundingClientRect();
    dropdown.style.left  = r.left + window.scrollX + 'px';
    dropdown.style.top   = r.bottom + window.scrollY + 4 + 'px';
    dropdown.style.width = r.width + 'px';
  }

  function hide() {
    dropdown.style.display = 'none';
  }

  function show(results) {
    dropdown.innerHTML = '';
    if (!results.length) { hide(); return; }

    results.forEach(place => {
      const li = document.createElement('li');
      li.className = 'ac-item';
      li.title = place.label; // full name on hover
      li.textContent = shortLabel(place.label);

      li.addEventListener('mousedown', e => {
        // mousedown fires before blur — prevent input losing focus before we fill it
        e.preventDefault();
        inputEl.value = shortLabel(place.label);
        selectedPlace = place;
        hide();
      });

      dropdown.appendChild(li);
    });

    reposition();
    dropdown.style.display = 'block';
  }

  inputEl.addEventListener('input', () => {
    selectedPlace = null; // user is typing manually → clear cached place
    clearTimeout(debounceTimer);
    const q = inputEl.value.trim();
    if (q.length < 3) { hide(); return; }
    debounceTimer = setTimeout(async () => {
      const results = await suggest(q);
      show(results);
    }, 300);
  });

  inputEl.addEventListener('blur', hide);

  // Reposition on scroll/resize in case the panel moved
  window.addEventListener('resize', () => { if (dropdown.style.display !== 'none') reposition(); });

  return {
    // Returns the pre-resolved {lat, lng} if the user picked a suggestion, null otherwise
    getPlace: () => selectedPlace,
  };
}
