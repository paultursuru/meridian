// The example route on /comment-ca-marche/: Lausanne station to the Olympic
// Museum, next Saturday at 15:00, in the shade from April to September and in
// the sun the rest of the year. Rendered at build time, then refreshed on load
// so an old build never links to a past Saturday.
import { buildShareQuery } from './share.js';

const HOUR = 15;
const ROUTE_WORDS = { sunny: 'au soleil', shady: "à l'ombre" };

const pad = (n) => String(n).padStart(2, '0');

// Today when it is Saturday before 15:00, otherwise the coming Saturday.
export function nextSaturday(now) {
  let days = (6 - now.getDay() + 7) % 7;
  if (days === 0 && now.getHours() >= HOUR) days = 7;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
}

export function shareExample(now = new Date()) {
  const sat = nextSaturday(now);
  const month = sat.getMonth() + 1;
  const route = month >= 4 && month <= 9 ? 'shady' : 'sunny';
  const href = '/?' + buildShareQuery({
    start: { lat: 46.5167, lng: 6.6291, label: 'Gare de Lausanne' },
    end: { lat: 46.5086, lng: 6.6339, label: 'Musée olympique, Lausanne' },
    date: `${sat.getFullYear()}-${pad(month)}-${pad(sat.getDate())}`,
    time: `${HOUR}:00`,
    route,
  });
  return { href, route, words: ROUTE_WORDS[route] };
}
