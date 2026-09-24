import SunCalc from 'suncalc';

// Returns { azDeg, altDeg } in compass degrees (N=0 clockwise)
export function getSun(date, lat, lng) {
  const pos = SunCalc.getPosition(date, lat, lng);
  // SunCalc azimuth: from south, clockwise → add 180° for from-north-clockwise
  const azDeg  = (pos.azimuth * 180 / Math.PI + 180 + 360) % 360;
  const altDeg = pos.altitude * 180 / Math.PI;
  return { azDeg, altDeg };
}

// Sunrise/sunset for the day of `date` at (lat, lng).
export function getSunTimes(date, lat, lng) {
  const { sunrise, sunset } = SunCalc.getTimes(date, lat, lng);
  return { sunrise, sunset };
}

// The next sunrise after `date`, on a whole minute with the sun above the
// horizon: where the night note's button jumps to.
export function nextSunriseAfter(date, lat, lng) {
  // SunCalc anchors to the nearest solar transit: a 23:00 search gets that
  // morning's sunrise back, so roll to the next day.
  const { sunrise } = getSunTimes(date, lat, lng);
  let next = sunrise > date
    ? sunrise
    : getSunTimes(new Date(date.getTime() + 86_400_000), lat, lng).sunrise;
  // SunCalc's sunrise is the upper limb at -0.833°, still night by our
  // altitude check: step a minute at a time (capped for polar cases).
  for (let i = 0; i < 60 && getSun(next, lat, lng).altDeg <= 0; i++) {
    next = new Date(next.getTime() + 60_000);
  }
  // The time input holds whole minutes and formatTimeInZone floors: round up,
  // later is still daylight.
  return new Date(Math.ceil(next.getTime() / 60_000) * 60_000);
}

// Below this altitude the sun is grazing and the shade model stops being
// trustworthy, for two reasons that both bite at once:
//
//   1. Shadow length is height / tan(alt), so at 5° a 10 m building throws
//      114 m and a 30 m block throws 343 m. The buildings we fetch come from
//      a bbox padded by only ~150 m (buildings.js), so the casters that
//      matter are increasingly not in the dataset at all.
//   2. Below a few degrees the horizon is *terrain*, not buildings, and this
//      app has no elevation model. A ridge or a distant hillside decides the
//      answer and we cannot see it.
//
// So we keep computing (a route score with a caveat beats no answer), but the
// UI says out loud that the estimate is weak here. 5° matches the threshold
// "Bien à l'ombre" independently settled on, where the equivalent comment
// reads "beyond this the terrain blocks it anyway".
// See miscs/bienalombre-teardown-onepager.md and the review's section 7.3.
export const GRAZING_SUN_DEG = 5;

// True while the sun is up but too low for the buildings-only model to be
// relied on. False at night (altDeg <= 0), which already has its own note and
// its own explanation.
export function isGrazingSun(altDeg) {
  return altDeg > 0 && altDeg < GRAZING_SUN_DEG;
}

// Partial solar eclipse of 2026-08-12, seen from Switzerland in the last hour
// before sunset: first contact ~19:25, maximum ~20:15 with just over 90% of
// the disc covered.
//
// The shade model is pure geometry and is blind to it. SunCalc keeps returning
// a sun at its usual altitude and azimuth, so the shadows, the scores and the
// sunny/shady split all stay exactly as they would on any other evening, while
// in reality nine tenths of the light is gone. Nothing to correct in the
// numbers (the geometry is right), only something to say out loud, so the
// sunny route doesn't promise a sun that won't be there.
//
// Bounds are wall-clock minutes in the route's own zone, deliberately wider
// than the real contact times: someone searching at 19:00 walks into it, and
// an advisory note is cheap on either side. Gated on Switzerland by the caller,
// which also makes these Europe/Zurich times by construction.
export const ECLIPSE_2026 = {
  date: '2026-08-12',
  startMin: 18 * 60 + 30,
  endMin: 21 * 60,
  // Where the scrubber marker sits. One national figure for a marker a few
  // pixels wide: the real maximum runs from ~20:14 in Geneva to ~20:19 in the
  // Engadine, which is finer than the track can resolve anyway.
  maxMin: 20 * 60 + 15,
};

// True when `dateInZone` ("YYYY-MM-DD") and `minutesOfDay` (0-1439), both
// already read in the route's own time zone, fall inside the eclipse window.
export function isEclipseWindow(dateInZone, minutesOfDay) {
  return dateInZone === ECLIPSE_2026.date
    && minutesOfDay >= ECLIPSE_2026.startMin
    && minutesOfDay <= ECLIPSE_2026.endMin;
}

const COMPASS_DIRS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

// 8-point compass direction key ('n'…'nw') for an azimuth (N=0, clockwise).
export function compassDir(azDeg) {
  return COMPASS_DIRS[Math.round(azDeg / 45) % 8];
}

// Returns (elapsedS) => { azDeg, altDeg }: the sun's position `elapsedS`
// seconds after `date`, quantized to `stepS` buckets and memoized — the sun
// moves ~0.25°/min, so finer resolution changes nothing while a bucket keeps
// per-segment scoring effectively free.
export function makeSunSampler(date, lat, lng, stepS = 60) {
  const cache = new Map();
  const t0 = date.getTime();
  return (elapsedS) => {
    const bucket = Math.round(elapsedS / stepS);
    let sun = cache.get(bucket);
    if (!sun) {
      sun = getSun(new Date(t0 + bucket * stepS * 1000), lat, lng);
      cache.set(bucket, sun);
    }
    return sun;
  };
}
