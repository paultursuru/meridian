import { fmtDist, fmtDur } from './helpers.js';

export function setStatus(msg) {
  const el = document.getElementById('status');
  el.textContent = msg || '';
  el.classList.toggle('on', !!msg);
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

export function renderTab(id, rt, isSunny) {
  const el = document.getElementById(id);
  if (!rt) {
    el.innerHTML = '<p style="padding:16px;color:#9ca3af">Aucun itinéraire</p>';
    return;
  }
  const pct = Math.round(rt.sunScore * 100);
  const cls = isSunny ? 'sunny' : 'shady';
  el.innerHTML = `
    <div class="stat">
      <div class="val">${fmtDist(rt.distance)}</div>
      <div class="lbl">Distance</div>
    </div>
    <div class="stat">
      <div class="val">${fmtDur(rt.duration)}</div>
      <div class="lbl">Durée</div>
    </div>
    <div class="bar-wrap">
      <div class="bar-labels"><span>🌑 Ombre</span><span>☀️ Soleil</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <div class="pct ${cls}">${pct}% ensoleillé</div>
    </div>`;
}
