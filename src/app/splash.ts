import { LOGO, targetAngle, shadowMatrix, sunTransform, easeInOutCubic } from '../lib/sunLogo';

// The intro over the map: the M swings from sun to shade, the same logo the
// city pages animate, while Leaflet and MapLibre load behind it. The splash
// lifts once the swing is over and the basemap has drawn, never on one alone:
// cut short it looks like a glitch, lifted early it shows a blank map.

// How long the intro holds at the least. The swing fits inside it.
const INTRO_MS = 2000;
// A still frame on the sun side before the shadow starts moving.
const BEAT_MS = 250;

export function initSplash(): void {
  const splash = document.getElementById('map-splash');
  const shadow = document.getElementById('sun-logo-shadow');
  const sun = document.getElementById('sun-logo-sun');
  if (!splash || !shadow || !sun) return;

  const draw = (t: number) => {
    shadow.setAttribute('transform', shadowMatrix(t));
    sun.setAttribute('transform', sunTransform(t));
  };
  const lift = () => splash.classList.add('hidden');
  // map.js fires this when the basemap has drawn, whichever style it ended on.
  const drawn = new Promise<void>((resolve) => {
    window.addEventListener('basemap-drawn', () => resolve(), { once: true });
  });

  // The markup is rendered on the sun side: with motion off, land on the
  // shade side at once and let the map through as soon as it is there.
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    splash.classList.remove('sun');
    draw(targetAngle('shade'));
    drawn.then(lift);
    return;
  }

  const from = targetAngle('sun');
  const to = targetAngle('shade');
  const start = performance.now() + BEAT_MS;
  const swung = new Promise<void>((resolve) => {
    const step = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - start) / LOGO.durationMs));
      draw(from + (to - from) * easeInOutCubic(p));
      if (p < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
  // The colours follow the shadow: the CSS transition is the swing's length.
  setTimeout(() => splash.classList.remove('sun'), BEAT_MS);

  const held = new Promise<void>((resolve) => setTimeout(resolve, INTRO_MS));
  Promise.all([swung, held, drawn]).then(lift);
}
