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
