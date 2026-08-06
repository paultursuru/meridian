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
