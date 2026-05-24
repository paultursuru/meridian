import SunCalc from 'suncalc';

// Returns { azDeg, altDeg } in compass degrees (N=0 clockwise)
export function getSun(date, lat, lng) {
  const pos = SunCalc.getPosition(date, lat, lng);
  // SunCalc azimuth: from south, clockwise → add 180° for from-north-clockwise
  const azDeg  = (pos.azimuth * 180 / Math.PI + 180 + 360) % 360;
  const altDeg = pos.altitude * 180 / Math.PI;
  return { azDeg, altDeg };
}
