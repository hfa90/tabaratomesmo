// Gráfico de linhas em SVG puro, com tooltip ao tocar/passar o mouse.
const W = 640, H = 240, PAD = { l: 52, r: 14, t: 14, b: 28 };
let uid = 0;
const registry = new Map();

export function lineChart(series, { format = (v) => v.toFixed(2), label = null } = {}) {
  if (!series.length) return '<p class="muted">Sem histórico para este período.</p>';
  const all = series.flatMap((s) => s.points);
  const t0 = Math.min(...all.map((p) => p.t)), t1 = Math.max(...all.map((p) => p.t));
  let v0 = Math.min(...all.map((p) => p.v)), v1 = Math.max(...all.map((p) => p.v));
  const padV = (v1 - v0) * 0.12 || v1 * 0.05; const nonNeg = v0 >= 0; v0 -= padV; v1 += padV; if (nonNeg && v0 < 0) v0 = 0;
  const x = (t) => PAD.l + ((t - t0) / Math.max(t1 - t0, 1)) * (W - PAD.l - PAD.r);
  const y = (v) => PAD.t + (1 - (v - v0) / (v1 - v0)) * (H - PAD.t - PAD.b);

  const ticks = 4;
  const grid = Array.from({ length: ticks + 1 }, (_, i) => {
    const v = v0 + ((v1 - v0) * i) / ticks;
    return `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v)}" y2="${y(v)}" class="c-grid"/>
      <text x="${PAD.l - 8}" y="${y(v) + 4}" text-anchor="end" class="c-lbl">${format(v).replace('R$', '').trim()}</text>`;
  }).join('');
  const days = Math.round((t1 - t0) / 864e5);
  const xt = [t0, t0 + (t1 - t0) / 2, t1].map((t, i) =>
    `<text x="${x(t)}" y="${H - 8}" text-anchor="${['start', 'middle', 'end'][i]}" class="c-lbl">${i === 2 ? 'hoje' : new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</text>`).join('');

  const lines = series.map((s) => {
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
    const last = s.points[s.points.length - 1];
    return `<g class="c-s" data-s="${s.id}" style="--c:${s.color}">
      <path d="${d}" class="c-line"/>
      <circle cx="${x(last.t)}" cy="${y(last.v)}" r="4" class="c-dot"/>
    </g>`;
  }).join('');

  const id = 'ch' + ++uid;
  registry.set(id, { series, x, y, format, t0, t1 });
  const legend = series.map((s) => {
    const last = s.points[s.points.length - 1].v;
    return `<button class="c-leg" data-chart="${id}" data-toggle="${s.id}" aria-pressed="true" style="--c:${s.color}"><i></i>${s.name}<b>${format(last)}</b></button>`;
  }).join('');

  return `<div class="c-wrap" id="${id}">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label || `Histórico de preços dos últimos ${days} dias`}">
      ${grid}${xt}${lines}
      <line class="c-cursor" x1="0" x2="0" y1="${PAD.t}" y2="${H - PAD.b}" visibility="hidden"/>
      <rect class="c-hit" x="${PAD.l}" y="0" width="${W - PAD.l - PAD.r}" height="${H}" fill="transparent"/>
    </svg>
    <div class="c-tip" hidden></div>
  </div>
  <div class="c-legend">${legend}</div>`;
}

function onMove(e) {
  const hit = e.target.closest?.('.c-hit'); if (!hit) return;
  const wrap = hit.closest('.c-wrap'); const c = registry.get(wrap.id); if (!c) return;
  const svg = wrap.querySelector('svg'); const r = svg.getBoundingClientRect();
  const px = ((e.clientX - r.left) / r.width) * W;
  const t = c.t0 + ((px - PAD.l) / (W - PAD.l - PAD.r)) * (c.t1 - c.t0);
  const hidden = new Set([...wrap.parentElement.querySelectorAll('.c-leg[aria-pressed=false]')].map((b) => Number(b.dataset.toggle)));
  const rows = c.series.filter((s) => !hidden.has(s.id)).map((s) => {
    const p = s.points.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
    return { s, p };
  }).sort((a, b) => a.p.v - b.p.v);
  if (!rows.length) return;
  const tx = rows[0].p.t;
  const cur = svg.querySelector('.c-cursor');
  cur.setAttribute('x1', c.x(tx)); cur.setAttribute('x2', c.x(tx)); cur.setAttribute('visibility', 'visible');
  const tip = wrap.querySelector('.c-tip');
  tip.hidden = false;
  tip.innerHTML = `<b>${new Date(tx).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })}</b>` +
    rows.map(({ s, p }) => `<span style="--c:${s.color}"><i></i>${s.name}<em>${c.format(p.v)}</em></span>`).join('');
  const left = (c.x(tx) / W) * r.width;
  tip.style.left = Math.min(Math.max(left, 80), r.width - 80) + 'px';
}
function onLeave(e) {
  const wrap = e.target.closest?.('.c-wrap'); if (!wrap) return;
  wrap.querySelector('.c-tip').hidden = true;
  wrap.querySelector('.c-cursor').setAttribute('visibility', 'hidden');
}
document.addEventListener('pointermove', onMove);
document.addEventListener('pointerdown', onMove);
document.addEventListener('pointerout', (e) => { if (e.target.classList?.contains('c-hit')) onLeave(e); });
document.addEventListener('click', (e) => {
  const b = e.target.closest('.c-leg'); if (!b) return;
  const on = b.getAttribute('aria-pressed') !== 'true';
  b.setAttribute('aria-pressed', on);
  document.querySelector(`#${b.dataset.chart} .c-s[data-s="${b.dataset.toggle}"]`)?.classList.toggle('is-off', !on);
});
