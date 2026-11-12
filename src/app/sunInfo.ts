import { compassDir, getSunTimes, isNight, nextSunriseAfter } from '../lib/sun.js';
import { formatTimeInZone } from '../lib/timezone.js';
import { tr, type TranslationKey } from '../lib/i18n.js';
import { el, button } from './dom';

// The sun badge on the map, not in the header: it follows the scrubber like
// the shadows.

export function initSunInfo() {
  const badge = button('map-sun-info');
  badge.addEventListener('click', () => {
    const expanded = badge.classList.toggle('expanded');
    badge.setAttribute('aria-expanded', String(expanded));
  });
}

export function updateSunInfo(
  sun: { azDeg: number; altDeg: number },
  where: { lat: number; lng: number },
  timeZone: string,
  atDate: Date,
) {
  const night = isNight(atDate, where.lat, where.lng);
  const badge = el('map-sun-info');
  badge.classList.toggle('day',   !night);
  badge.classList.toggle('night', night);
  badge.classList.add('on');

  // At night, the sunrise the night note's button jumps to: by evening the
  // searched day's own sunrise is already past.
  const human = night
    ? tr('night_position', { time: formatTimeInZone(nextSunriseAfter(atDate, where.lat, where.lng), timeZone) })
    : tr('sun_position', {
      dir: tr(('dir_' + compassDir(sun.azDeg)) as TranslationKey),
      time: formatTimeInZone(getSunTimes(atDate, where.lat, where.lng).sunset, timeZone),
    });
  const technical = tr('status_sun', { alt: sun.altDeg.toFixed(1), az: sun.azDeg.toFixed(0) });
  // Built per call: the destination's zone can only go in the constructor.
  // No year: every date shown is within the searched day.
  const dateTimeFmt = new Intl.DateTimeFormat(document.documentElement.lang, {
    timeZone, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const datetime = tr('map_datetime', { date: dateTimeFmt.format(atDate) });
  el('map-sun-info-human').textContent = human;
  el('map-sun-info-technical').textContent = technical;
  el('map-sun-info-datetime').textContent = datetime;
}

// Written twice: the sun badge's details on the side panel, the drawer's
// notes on mobile, where the badge stays short. CSS shows one of the two.
export function updateMapWeather(weather: { cloudCover: number; temperature: number | null } | null) {
  const text = weather && weather.temperature != null
    ? tr('map_weather', { temp: String(Math.round(weather.temperature)), cloud: String(Math.round(weather.cloudCover)) })
    : '';
  el('map-sun-info-weather').textContent = text;
  el('hour-weather').textContent = text;
  el('hour-weather').classList.toggle('on', !!text);
}

export function resetSunInfo() {
  const badge = button('map-sun-info');
  badge.classList.remove('on', 'day', 'night', 'expanded');
  badge.setAttribute('aria-expanded', 'false');
  el('map-sun-info-weather').textContent = '';
  el('hour-weather').textContent = '';
  el('hour-weather').classList.remove('on');
}
