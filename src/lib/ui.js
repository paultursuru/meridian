import { fmtDist, fmtDur } from './helpers.js';
import { tr } from './i18n.js';

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
    el.setAttribute('role', 'alert');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `toast toast-${type} on`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 4500);
}

// OSM building-height confidence hint (review 3.5), and — since review #2
// §1.1 — the data-failure warning: honest disclosure of how much of the
// shade computation rests on real data vs. type/default guesses (or nothing
// at all), so sparse-coverage or failed-fetch searches read as "data gap"
// rather than "broken app". msg falsy (e.g. night search) hides the note.
// level: 'info' (default, today's neutral coverage/empty/partial notes) or
// 'warn' (a fetch outright failed — invalidates the ratio above it).
export function showQualityNote(msg, level = 'info') {
  const el = document.getElementById('quality-note');
  el.textContent = msg || '';
  el.classList.toggle('on', !!msg);
  el.classList.toggle('warn', !!msg && level === 'warn');
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
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      onTabChange?.(btn.dataset.tab);
    });
  });
}

export function setActiveTab(type) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    const active = b.dataset.tab === type;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', String(active));
  });
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
  g('shade-fill').style.width  = shadePct + '%';
  g('sun-fill').style.width    = sunPct + '%';
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

// Review #2 §4.1: state the trade-off instead of making the user switch tabs
// and do the subtraction themselves. Sun and shade are complementary, so the
// two routes' sun-percentage gap is *the* delta for both axes — no separate
// shade math needed. Each tab states what choosing it costs/saves in time
// against what it gains on its own axis (shade for the shady tab, sun for
// the sunny one).
function fmtTimeDelta(deltaMin) {
  const sign = deltaMin > 0 ? '+' : deltaMin < 0 ? '−' : '±';
  return `${sign}${Math.abs(deltaMin)} min`;
}

function renderDeltas(sunny, shady) {
  const sunnySunPct = Math.round(sunny.sunScore * 100);
  const shadySunPct = Math.round(shady.sunScore * 100);
  const pctDelta = sunnySunPct - shadySunPct; // shared by both axes (shade = 100 - sun)
  const sunnyMin = Math.round((sunny.duration + climbSeconds(sunny)) / 60);
  const shadyMin = Math.round((shady.duration + climbSeconds(shady)) / 60);

  document.getElementById('shady-delta').textContent = tr(
    pctDelta >= 0 ? 'delta_shady_more' : 'delta_shady_less',
    { time: fmtTimeDelta(shadyMin - sunnyMin), pct: String(Math.abs(pctDelta)) }
  );
  document.getElementById('sunny-delta').textContent = tr(
    pctDelta >= 0 ? 'delta_sunny_more' : 'delta_sunny_less',
    { time: fmtTimeDelta(sunnyMin - shadyMin), pct: String(Math.abs(pctDelta)) }
  );
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
// heightFailed = the buildings fetch threw (review #2 §1.1): dims the ratio
// bar via CSS on the .data-failed class, next to the warning quality-note —
// a greyed-out number reads as "don't trust this" faster than any sentence.
export function showResults(sunny, shady, single = false, night = false, heightFailed = false) {
  document.getElementById('tabs').style.display = single ? 'none' : '';
  document.getElementById('single-route-note').classList.toggle('on', single && !night);
  document.getElementById('night-note').classList.toggle('on', night);
  renderTab('tab-sunny', sunny);
  if (!single) renderTab('tab-shady', shady);
  document.getElementById('sunny-delta').textContent = '';
  document.getElementById('shady-delta').textContent = '';
  if (!single) renderDeltas(sunny, shady);
  const drawer = document.getElementById('results');
  drawer.classList.toggle('night', night);
  drawer.classList.toggle('data-failed', heightFailed);
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
  return parseFloat(getComputedStyle(drawer).getPropertyValue('--drawer-peek')) || 168;
}

// The scrubber's own height. Hardcoded rather than measured because the one
// caller that needs it (bottomOverlayPx, for map.js) runs on the first render,
// before showScrubber has taken it out of display:none — offsetHeight is 0
// there. Kept in sync with #time-scrubber's padding + content in main.css.
const SCRUBBER_HEIGHT = 34;

// How much of the map's bottom edge is covered by chrome: the drawer's peek
// plus the scrubber floating above it. map.js keeps the fitted route clear of
// this strip (see mapFit.js), and reading it from the same CSS var the
// scrubber positions itself from means a media query that shrinks the drawer
// re-frames the route to match, with no second copy of the number to update.
export function bottomOverlayPx() {
  const drawer = document.getElementById('results');
  return (drawer ? drawerPeekPx(drawer) : 168) + SCRUBBER_GAP + SCRUBBER_HEIGHT;
}

// Keeps the scrubber docked to the drawer's actual visible top edge. The
// collapsed height is the fixed CSS peek; the expanded height is content-driven
// (offsetHeight), which the transform-based expand/collapse doesn't change.
//
// Because the expanded case reads offsetHeight, anything that changes the
// drawer's *content* moves its top edge and must re-run this. Firing it only
// on expand/collapse and window resize was not enough: a note appearing while
// the drawer was already open grew it under a scrubber that stayed put, and
// the drawer covered it (reported 2026-08-06 with the grazing-sun note, but
// the vegetation-failed line and the weather note can do the same thing when
// their background fetches resolve). A ResizeObserver on the drawer catches
// every one of those without each caller having to remember.
function updateScrubberPosition() {
  const scrubber = document.getElementById('time-scrubber');
  if (!scrubber.classList.contains('on')) return;
  const drawer = document.getElementById('results');
  const visibleH = drawer.classList.contains('expanded') ? drawer.offsetHeight : drawerPeekPx(drawer);
  scrubber.style.bottom = `${visibleH + SCRUBBER_GAP}px`;
}

let scrubberInited = false;
let scrubOnChange = () => {};
// Minute the eclipse marker currently points at, or null when it's hidden —
// read by the click handler below, which is bound once and outlives any one
// search's bounds.
let scrubMarkMinutes = null;
let markTravelRaf = 0;

// How long the thumb takes to travel to the eclipse marker when it's clicked.
// Roughly the spin's own duration, so the two read as one gesture.
const MARK_TRAVEL_MS = 600;

// Moves the range to `target` and drives the render at each step. The range
// doesn't fire `input` when its value is set programmatically, so the callback
// is invoked by hand — the same path a drag tick takes, so the drawer, map,
// label and share URL all update exactly as if the user had dragged there.
function stepScrubberTo(range, minutes) {
  range.value = String(minutes);
  // 'mark' tells the caller this move came from the marker, not from a drag:
  // the two are counted separately, and one click produces a whole run of
  // these frames.
  scrubOnChange(Number(range.value), 'mark');
}

// Slides rather than jumps: the thumb crossing the afternoon is what makes it
// obvious *that* the time changed and by how much, which a teleport hides. The
// per-frame cost is the cost of a drag tick, which this already is. Eased out,
// so it settles on the marker rather than slamming into it.
function travelScrubberTo(range, target) {
  cancelAnimationFrame(markTravelRaf);
  const from = Number(range.value);
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (from === target || reduced) {
    stepScrubberTo(range, target);
    return;
  }
  const t0 = performance.now();
  const frame = (now) => {
    const p = Math.min(1, (now - t0) / MARK_TRAVEL_MS);
    const eased = 1 - Math.pow(1 - p, 3);
    // Rounded: the range's step is 1 minute, so fractional values would be
    // snapped by the input anyway and the label would jitter between them.
    stepScrubberTo(range, p === 1 ? target : Math.round(from + (target - from) * eased));
    if (p < 1) markTravelRaf = requestAnimationFrame(frame);
  };
  markTravelRaf = requestAnimationFrame(frame);
}

function initScrubber() {
  if (scrubberInited) return;
  scrubberInited = true;
  const range = document.getElementById('scrubber-range');
  // A real drag also cancels a marker travel in flight: the user has taken the
  // thumb back and should win. Safe to key off `input` because setting `value`
  // from JS doesn't fire it, so this only ever sees genuine interaction.
  range.addEventListener('input', () => {
    cancelAnimationFrame(markTravelRaf);
    scrubOnChange(Number(range.value));
  });

  // Clicking the marker travels to the minute it marks.
  const mark = document.getElementById('scrubber-mark');
  mark?.addEventListener('click', () => {
    if (scrubMarkMinutes === null) return;
    travelScrubberTo(range, scrubMarkMinutes);
    // Restart rather than stack: a rapid second click should spin again, not
    // be swallowed because the class is still there from the first.
    mark.classList.remove('spin');
    void mark.offsetWidth; // reflow, so re-adding the class restarts the animation
    mark.classList.add('spin');
  });
  mark?.addEventListener('animationend', () => mark.classList.remove('spin'));
  // Still needed alongside the observer below: a media query that changes
  // --drawer-peek moves the *collapsed* dock point without changing the
  // drawer's own box, so the observer would never fire for it.
  window.addEventListener('resize', updateScrubberPosition);
  // Setting the scrubber's `bottom` never resizes the drawer, so this cannot
  // feed back into itself.
  const drawer = document.getElementById('results');
  if (drawer && typeof ResizeObserver === 'function') {
    new ResizeObserver(updateScrubberPosition).observe(drawer);
  }
}

// Half the range thumb's width. A native thumb's centre travels from
// min + half a thumb to max - half a thumb, not edge to edge, so a marker
// placed at a raw percentage of the track sits a few pixels off from the
// time the thumb reads there. Kept in sync with #scrubber-range in main.css.
const SCRUBBER_THUMB_HALF_PX = 8;

// Pins the eclipse marker over the minute it marks, or hides it when there's
// nothing to mark — including the case where the marked minute falls outside
// the day's sunrise..sunset bounds, where it would otherwise clamp to an end
// of the track and point at the wrong time.
function setScrubberMark(bounds) {
  const el = document.getElementById('scrubber-mark');
  const mark = bounds.mark;
  const inRange = mark && mark.minutes >= bounds.min && mark.minutes <= bounds.max && bounds.max > bounds.min;
  el.classList.toggle('on', !!inRange);
  scrubMarkMinutes = inRange ? mark.minutes : null;
  if (!inRange) return;
  const frac = (mark.minutes - bounds.min) / (bounds.max - bounds.min);
  el.style.left = `calc(${SCRUBBER_THUMB_HALF_PX}px + (100% - ${SCRUBBER_THUMB_HALF_PX * 2}px) * ${frac})`;
  el.title = mark.label;
  el.setAttribute('aria-label', mark.label);
}

// bounds: { min, max, value, label } in minutes-since-local-midnight (see
// timezone.js#minutesInZone / helpers.js#fmtHm), plus an optional
// mark: { minutes, label } drawn above the track at that minute.
// onScrub(minutes, source) fires on every drag tick, and on every frame of a
// marker travel — where source is 'mark' and is otherwise undefined.
export function showScrubber(bounds, onScrub) {
  initScrubber();
  scrubOnChange = onScrub;
  const range = document.getElementById('scrubber-range');
  range.min   = String(bounds.min);
  range.max   = String(bounds.max);
  range.value = String(bounds.value);
  setScrubberLabel(bounds.label);
  setScrubberMark(bounds);
  document.getElementById('time-scrubber').classList.add('on');
  updateScrubberPosition();
}

export function setScrubberLabel(label) {
  document.getElementById('scrubber-time').textContent = label;
  document.getElementById('scrubber-range').setAttribute('aria-valuetext', label);
}

export function hideScrubber() {
  document.getElementById('time-scrubber').classList.remove('on');
}
