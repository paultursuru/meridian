// Caches the most recent precise geolocation fix in localStorage, so a later
// attempt that fails or is denied (e.g. reopening the installed PWA with the
// OS location toggle off) still has something to prefill from — see review 6.2.
const KEY = 'mw_last_position';

export function saveLastPosition(lat, lng) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ lat, lng }));
  } catch {
    // Storage unavailable (private browsing, full quota) — nothing to cache.
  }
}

export function getLastPosition() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const { lat, lng } = JSON.parse(raw);
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;
    return { lat, lng };
  } catch {
    return null;
  }
}
