import { tr } from './i18n.js';

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

export function renderTab(id, rt) {
  const el = document.getElementById(id);
  if (!rt) {
    el.innerHTML = `<p style="padding:16px;color:#9ca3af">${tr('no_route')}</p>`;
    return;
  }
  const sunPct   = Math.round(rt.sunScore * 100);
  const shadePct = 100 - sunPct;
  el.innerHTML = `
    <div class="ratio-wrap">
      <div class="ratio-nums">
        <span class="ratio-shade-num">${tr('label_shade')} <strong>${shadePct}%</strong></span>
        <span class="ratio-sun-num"><strong>${sunPct}%</strong> ${tr('label_sun')}</span>
      </div>
      <div class="ratio-track">
        <div class="ratio-fill" style="width:${sunPct}%"></div>
      </div>
    </div>`;
}

export function showResults(sunny, shady) {
  renderTab('tab-sunny', sunny);
  renderTab('tab-shady', shady);
  document.getElementById('results').classList.add('on');
}
