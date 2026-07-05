// Returns [0, 1] leaf coverage fraction for deciduous trees based on month.
// 1.0 = full summer canopy, 0.05 = bare winter branches.
// lat flips the seasons for the southern hemisphere (January = peak summer in Sydney).
// Evergreen trees always return 1.0 regardless of date.
export function leafFraction(date, isDeciduous, lat = 0) {
  if (!isDeciduous) return 1.0;
  let m = date.getMonth() + 1; // 1–12
  if (lat < 0) m = ((m + 5) % 12) + 1; // shift 6 months south of the equator
  if (m >= 5 && m <= 9) return 1.00;  // May–Sep: full canopy
  if (m === 4 || m === 10) return 0.70; // Apr, Oct: leafing / falling
  if (m === 3 || m === 11) return 0.40; // Mar, Nov: budding / bare
  return 0.05;                          // Dec–Feb: bare
}

// Convenience: single fraction for the "deciduous" case given a date and latitude.
// Pass this to scoreRoute as deciduousLeafFrac.
export function deciduousLeafFrac(date, lat = 0) {
  return leafFraction(date, true, lat);
}
