import { fmtDist, fmtDur } from './helpers.js';

export function setStatus(msg) {
  const el = document.getElementById('status');
  el.textContent = msg || '';
  el.classList.toggle('on', !!msg);
}

let toastTimer = null;

// Transient, non-blocking notification (replaces alert()). Auto-dismisses.
// type: 'error' (default) — styled via .toast-<type> in main.css.
export function showToast(msg, type = 'error') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `toast toast-${type} on`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 4500);
}

// Extra walking time from climbing: ~4 min per 100 m of ascent (Naismith-style,
// conservative — strong walkers feel little of it). Only the uphill counts.
function climbSeconds(rt) {
  if (!rt.elevation || !rt.elevation.up) return 0;
  return (rt.elevation.up / 100) * 4 * 60;
}

// Flat-walking time plus the ascent supplement, folded into a single total.
export function fmtDurWithClimb(rt) {
  return fmtDur(rt.duration + climbSeconds(rt));
}

export function initTabs(onTabChange) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      onTabChange?.(btn.dataset.tab);
    });
  });
}

export function setActiveTab(type) {
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === type)
  );
  document.querySelectorAll('.tab-pane').forEach(p =>
    p.classList.toggle('active', p.id === 'tab-' + type)
  );
}

export function renderTab(id, rt) {
  const prefix = id.replace('tab-', '');
  const g = (suffix) => document.getElementById(`${prefix}-${suffix}`);

  const sunPct   = Math.round(rt.sunScore * 100);
  const shadePct = 100 - sunPct;
  const shadedM  = Math.round((1 - rt.sunScore) * rt.distance);
  const sunnyM   = Math.round(rt.sunScore * rt.distance);

  g('shade-pct').textContent   = shadePct + '%';
  g('sun-pct').textContent     = sunPct + '%';
  g('ratio-fill').style.width  = sunPct + '%';
  g('dist').textContent        = fmtDist(rt.distance);
  g('dur').textContent         = fmtDurWithClimb(rt);
  g('shaded-dist').textContent = fmtDist(shadedM);
  g('sun-dist').textContent    = fmtDist(sunnyM);

  const elevEl   = g('elev');
  const elevStat = g('elev-stat');
  elevStat.style.display = '';
  if (rt.elevation) {
    elevEl.textContent = '↑' + rt.elevation.up + 'm  ↓' + rt.elevation.down + 'm';
    elevEl.classList.remove('elev-loading');
  } else {
    elevEl.textContent = '…';
    elevEl.classList.add('elev-loading');
  }
}

let drawerInited = false;

function initDrawer() {
  if (drawerInited) return;
  drawerInited = true;

  const drawer = document.getElementById('results');
  const handle = document.getElementById('drawer-handle');

  let startY = 0, isDragging = false, moved = false;

  function dragStart(y) { startY = y; isDragging = true; moved = false; }
  function dragMove(y)  { if (isDragging && Math.abs(y - startY) > 8) moved = true; }
  function dragEnd(y) {
    if (!isDragging) return;
    isDragging = false;
    const dy = startY - y;
    if (!moved) {
      drawer.classList.toggle('expanded');
    } else if (dy > 40) {
      drawer.classList.add('expanded');
    } else if (dy < -40) {
      drawer.classList.remove('expanded');
    }
    updateScrubberPosition();
  }

  handle.addEventListener('touchstart', e => dragStart(e.touches[0].clientY), { passive: true });
  handle.addEventListener('touchmove',  e => dragMove(e.touches[0].clientY),  { passive: true });
  handle.addEventListener('touchend',   e => dragEnd(e.changedTouches[0].clientY));
  handle.addEventListener('mousedown',  e => { dragStart(e.clientY); e.preventDefault(); });
  document.addEventListener('mousemove', e => dragMove(e.clientY));
  document.addEventListener('mouseup',   e => dragEnd(e.clientY));

  handle.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      drawer.classList.toggle('expanded');
      updateScrubberPosition();
    }
  });
}

export function collapseDrawer() {
  document.getElementById('results')?.classList.remove('expanded');
}

// single = only one unique route survived dedup: hide the sunny/shady tabs
// (they would show the same route twice), show an honest note instead, and
// render the route's stats — sun/shade split included — in the sunny pane.
// night = sun below the horizon: also single (shortest route), but with a
// night note and without the meaningless sun/shade ratio rows (via CSS on
// the .night class).
export function showResults(sunny, shady, single = false, night = false) {
  document.getElementById('tabs').style.display = single ? 'none' : '';
  document.getElementById('single-route-note').classList.toggle('on', single && !night);
  document.getElementById('night-note').classList.toggle('on', night);
  renderTab('tab-sunny', sunny);
  if (!single) renderTab('tab-shady', shady);
  const drawer = document.getElementById('results');
  drawer.classList.toggle('night', night);
  drawer.classList.add('on');
  initDrawer();
}

// ── Time scrubber ──
// A floating bar docked just above the results drawer (never inside it, so
// it stays put even though the drawer's own content scrolls when expanded).
// It has no notion of routes/sun/shade itself — AppLayout.astro supplies the
// bounds and re-scoring callback; this module only owns its DOM/positioning.
const SCRUBBER_GAP = 8; // px between the drawer's visible top edge and the scrubber

function drawerPeekPx(drawer) {
  return parseFloat(getComputedStyle(drawer).getPropertyValue('--drawer-peek')) || 144;
}

// Keeps the scrubber docked to the drawer's actual visible top edge. The
// collapsed height is the fixed CSS peek; the expanded height is content-driven
// (offsetHeight), which the transform-based expand/collapse doesn't change.
function updateScrubberPosition() {
  const scrubber = document.getElementById('time-scrubber');
  if (!scrubber.classList.contains('on')) return;
  const drawer = document.getElementById('results');
  const visibleH = drawer.classList.contains('expanded') ? drawer.offsetHeight : drawerPeekPx(drawer);
  scrubber.style.bottom = `${visibleH + SCRUBBER_GAP}px`;
}

let scrubberInited = false;
let scrubOnChange = () => {};

function initScrubber() {
  if (scrubberInited) return;
  scrubberInited = true;
  const range = document.getElementById('scrubber-range');
  range.addEventListener('input', () => scrubOnChange(Number(range.value)));
  window.addEventListener('resize', updateScrubberPosition);
}

// bounds: { min, max, value, label } in minutes-since-local-midnight (see
// timezone.js#minutesInZone / helpers.js#fmtHm). onScrub(minutes) fires on every drag tick.
export function showScrubber(bounds, onScrub) {
  initScrubber();
  scrubOnChange = onScrub;
  const range = document.getElementById('scrubber-range');
  range.min   = String(bounds.min);
  range.max   = String(bounds.max);
  range.value = String(bounds.value);
  setScrubberLabel(bounds.label);
  document.getElementById('time-scrubber').classList.add('on');
  updateScrubberPosition();
}

export function setScrubberLabel(label) {
  document.getElementById('scrubber-time').textContent = label;
}

export function hideScrubber() {
  document.getElementById('time-scrubber').classList.remove('on');
}
