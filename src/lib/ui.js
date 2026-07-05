
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

function fmtDist(m) {
  return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m';
}

function fmtDur(sec) {
  const min = Math.round(sec / 60);
  return min + ' min';
}

// Extra walking time from climbing: ~4 min per 100 m of ascent (Naismith-style,
// conservative — strong walkers feel little of it). Only the uphill counts.
function climbSeconds(rt) {
  if (!rt.elevation || !rt.elevation.up) return 0;
  return (rt.elevation.up / 100) * 4 * 60;
}

// Flat-walking time plus the ascent supplement, folded into a single total.
function fmtDurWithClimb(rt) {
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
  }

  handle.addEventListener('touchstart', e => dragStart(e.touches[0].clientY), { passive: true });
  handle.addEventListener('touchmove',  e => dragMove(e.touches[0].clientY),  { passive: true });
  handle.addEventListener('touchend',   e => dragEnd(e.changedTouches[0].clientY));
  handle.addEventListener('mousedown',  e => { dragStart(e.clientY); e.preventDefault(); });
  document.addEventListener('mousemove', e => dragMove(e.clientY));
  document.addEventListener('mouseup',   e => dragEnd(e.clientY));

  handle.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); drawer.classList.toggle('expanded'); }
  });
}

export function collapseDrawer() {
  document.getElementById('results')?.classList.remove('expanded');
}

export function showResults(sunny, shady) {
  renderTab('tab-sunny', sunny);
  renderTab('tab-shady', shady);
  const drawer = document.getElementById('results');
  drawer.classList.add('on');
  initDrawer();
}
