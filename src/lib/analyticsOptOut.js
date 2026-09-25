// Umami's tracker reads this key before every send: any non-empty value stops
// page views and custom events alike, with no reload. Removing it resumes.
const KEY = 'umami.disabled';

export function isOptedOut() {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

// False when storage refuses the write (private browsing, full quota).
export function setOptedOut(out) {
  try {
    if (out) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}

// Checked means "counted". Every switch is redrawn from storage after a change,
// so one that couldn't be saved snaps back instead of lying.
// No analytics event here: measuring who opts out would break the promise.
export function initAnalyticsOptOut() {
  const switches = document.querySelectorAll('.optout-switch');
  const sync = () => switches.forEach((s) => { s.checked = !isOptedOut(); });
  sync();
  switches.forEach((s) => s.addEventListener('change', () => {
    setOptedOut(!s.checked);
    sync();
  }));
}
