// Which tab to open by default: guess whether the user wants sun or shade.
//
// Temperature is the honest signal — 24°C means "shade please" whether it's
// March or July, where sun altitude alone can't tell a cold spring noon from
// a summer scorcher. When no forecast exists (date beyond the horizon), fall
// back to a season-aware guess: high summer sun → shade, anything else → sun.

// Above this air temperature, assume the walker prefers shade.
export const SHADE_TEMP_C = 24;

// month is 0-based (Date#getMonth); lat picks the hemisphere so that
// warm season means May–Sep in the north but Nov–Mar in the south.
export function isWarmSeason(month, lat) {
  return lat < 0 ? (month >= 10 || month <= 2) : (month >= 4 && month <= 8);
}

export function preselectTab({ altDeg, temperature = null, month, lat }) {
  if (Number.isFinite(temperature)) {
    return temperature >= SHADE_TEMP_C ? 'shady' : 'sunny';
  }
  return isWarmSeason(month, lat) && altDeg > 40 ? 'shady' : 'sunny';
}
