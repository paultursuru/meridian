import { reverseGeocode } from '../lib/geocode.js';
import { geoError } from '../lib/errors.js';
import { getPosition } from '../lib/geolocation.js';
import { saveLastPosition, getLastPosition } from '../lib/lastPosition.js';
import { TZ_CENTERS } from '../lib/tzCenters.js';
import { setStatus, showToast } from '../lib/ui.js';
import { tr } from '../lib/i18n.js';
import { track } from '../lib/analytics.js';
import { map } from './mapApi';
import { button, type Role } from './dom';
import { applyPlace } from './fields';

function handleGeoError(err: unknown, source: 'field' | 'locate') {
  const { toast, code } = geoError(err);
  showToast(toast);
  console.error(err);
  track('geo_error', { code, source });
}

async function fillFromGeo(role: Role) {
  const btn = button(`geo-${role}`);
  btn.disabled = true;
  btn.classList.add('loading');
  setStatus(tr('geo_loading'));
  try {
    const pos = await getPosition(10000);
    const { short: label, countryCode } = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
    const lat = pos.coords.latitude, lng = pos.coords.longitude;
    applyPlace(role, { lat, lng, label, countryCode });
    saveLastPosition(lat, lng);
    setStatus(null);
  } catch (err: unknown) {
    setStatus(null);
    handleGeoError(err, 'field');
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

export function initGeoButtons() {
  button('geo-start').addEventListener('click', () => fillFromGeo('start'));
  button('geo-end').addEventListener('click',   () => fillFromGeo('end'));
}

// Standalone only, so a permission prompt is expected. Silent on failure:
// nothing was asked for this session.
export async function prefillFromRelaunch(): Promise<boolean> {
  try {
    const pos = await getPosition(8000);
    const lat = pos.coords.latitude, lng = pos.coords.longitude;
    const { short: label, countryCode } = await reverseGeocode(lat, lng);
    applyPlace('start', { lat, lng, label, countryCode });
    saveLastPosition(lat, lng);
    return true;
  } catch {
    // Denied, timed out or reverse geocode failed: try the last known fix.
    const cached = getLastPosition();
    if (!cached) return false;
    try {
      const { short: label, countryCode } = await reverseGeocode(cached.lat, cached.lng);
      applyPlace('start', { lat: cached.lat, lng: cached.lng, label, countryCode });
      return true;
    } catch {
      return false;
    }
  }
}

// A better first view than the Lausanne default, without prompting or
// showing the location dot: the position if permission is already granted,
// else the browser's timezone (see tzCenters.js).
export async function initInitialMapCenter() {
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    if (status?.state === 'granted') {
      const pos = await getPosition(5000);
      map.centerMap(pos.coords.latitude, pos.coords.longitude, 14);
      return;
    }
  } catch {
    // No Permissions API (older Safari), or the fix failed: use the timezone.
  }
  const tzCenter = TZ_CENTERS[Intl.DateTimeFormat().resolvedOptions().timeZone];
  if (tzCenter) map.centerMap(tzCenter[0], tzCenter[1], 10);
}

// The map's locate control: never fills a field, and the only place the
// location dot appears.
export function initLocateMe() {
  window.addEventListener('locate-me', async () => {
    setStatus(tr('geo_loading'));
    try {
      const pos = await getPosition(10000);
      map.showMyLocation(pos.coords.latitude, pos.coords.longitude, tr('my_location_title'));
      saveLastPosition(pos.coords.latitude, pos.coords.longitude);
      setStatus(null);
    } catch (err: unknown) {
      setStatus(null);
      handleGeoError(err, 'locate');
    }
  });
}
