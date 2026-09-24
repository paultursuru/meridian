import { compassDir } from '../lib/sun.js';
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

export function updateSunInfo(sun: { azDeg: number; altDeg: number }, times: { sunrise: Date; sunset: Date }, timeZone: string, atDate: Date) {
  const badge = el('map-sun-info');
  badge.classList.toggle('day',   sun.altDeg > 0);
  badge.classList.toggle('night', sun.altDeg <= 0);
  badge.classList.add('on');

  const human = sun.altDeg <= 0
    ? tr('night_position', { time: formatTimeInZone(times.sunrise, timeZone) })
    : tr('sun_position', { dir: tr(('dir_' + compassDir(sun.azDeg)) as TranslationKey), time: formatTimeInZone(times.sunset, timeZone) });
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

export function updateMapWeather(weather: { cloudCover: number; temperature: number | null } | null) {
  el('map-sun-info-weather').textContent = weather && weather.temperature != null
    ? tr('map_weather', { temp: String(Math.round(weather.temperature)), cloud: String(Math.round(weather.cloudCover)) })
    : '';
}

export function resetSunInfo() {
  const badge = button('map-sun-info');
  badge.classList.remove('on', 'day', 'night', 'expanded');
  badge.setAttribute('aria-expanded', 'false');
  el('map-sun-info-weather').textContent = '';
}
