export function drawCompass(azDeg, altDeg) {
  const cv  = document.getElementById('compass-cv');
  const ctx = cv.getContext('2d');
  const cx = 30, cy = 30, R = 26;

  ctx.clearRect(0, 0, 60, 60);

  // Background circle
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI);
  ctx.fillStyle = '#fff8f0'; ctx.fill();
  ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1.5; ctx.stroke();

  // Cardinal labels
  ctx.font = '7.5px system-ui'; ctx.fillStyle = '#9ca3af';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('N', cx, cy - R + 8);
  ctx.fillText('S', cx, cy + R - 8);
  ctx.fillText('E', cx + R - 8, cy);
  ctx.fillText('O', cx - R + 8, cy);

  // Sun arrow — canvas 0°=east, compass 0°=north → subtract 90°
  const rad = (azDeg - 90) * Math.PI / 180;
  const ar  = R - 8;
  const ex  = cx + Math.cos(rad) * ar;
  const ey  = cy + Math.sin(rad) * ar;
  const op  = Math.max(0.35, Math.min(1, altDeg / 40));

  ctx.strokeStyle = `rgba(249,115,22,${op})`;
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();

  // Arrowhead
  const hl = 7, ha = 0.4;
  ctx.fillStyle = `rgba(249,115,22,${op})`;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - hl * Math.cos(rad - ha), ey - hl * Math.sin(rad - ha));
  ctx.lineTo(ex - hl * Math.cos(rad + ha), ey - hl * Math.sin(rad + ha));
  ctx.closePath(); ctx.fill();

  // Center dot
  ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, 2 * Math.PI);
  ctx.fillStyle = '#f97316'; ctx.fill();
}
