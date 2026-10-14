// Pequenos componentes de gráfico em HTML/SVG usados no portal e no admin.
import { esc } from './core.js';

export const fmtN = (n) => Number(n || 0).toLocaleString('pt-BR');
export const pctTxt = (a, b) => (b ? `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}%` : '');
export const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function hbars(rows, { label, value, fmt = fmtN, note = null, max = null, color = 'var(--brand)' }) {
  if (!rows?.length) return '<p class="muted small">Ainda sem dados neste período.</p>';
  const mx = max ?? Math.max(...rows.map(value), 1);
  return `<ol class="hb">${rows.map((r) => `<li title="${esc(label(r, true) || '')}">
    <span class="hb__l">${label(r)}</span><span class="hb__v">${fmt(value(r))}</span>
    <span class="hb__t"><span style="--w:${Math.max(2, (value(r) / mx) * 100)}%;--c:${typeof color === 'function' ? color(r) : color}"></span></span>
    ${note ? `<small class="hb__n">${note(r)}</small>` : ''}</li>`).join('')}</ol>`;
}

export function kpi(label, v, { prev = null, hint = '', fmt = fmtN, accent = false } = {}) {
  const d = prev != null && prev > 0 ? pctTxt(v, prev) : '';
  return `<div class="kpi ${accent ? 'kpi--accent' : ''}"><span class="kpi__l">${label}</span><b class="kpi__v">${fmt(v)}</b>
    <span class="kpi__h">${d ? `<em class="${v >= prev ? 'down' : 'up'}">${d}</em> vs período anterior` : hint}</span></div>`;
}

export function heatmap(hours) {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const r of hours || []) grid[r.dow][r.h] += r.n;
  const mx = Math.max(1, ...grid.flat());
  const hrs = [...Array(18).keys()].map((i) => i + 6);
  let best = { d: 0, h: 0, n: -1 };
  grid.forEach((row, d) => row.forEach((n, h) => { if (n > best.n) best = { d, h, n }; }));
  return `<p class="small" style="margin-bottom:10px">Pico: <b>${DOW[best.d].toLowerCase()} às ${best.h}h</b>. Bom horário para publicar promoções e reforçar equipe e reposição.</p>
    <div class="hm" role="table" aria-label="Uso do site por dia da semana e hora">
      <div class="hm__row" role="row"><span></span>${hrs.map((h) => `<span class="hm__h" role="columnheader">${h % 3 === 0 ? h : ''}</span>`).join('')}</div>
      ${grid.map((row, d) => `<div class="hm__row" role="row"><span class="hm__d" role="rowheader">${DOW[d]}</span>${hrs.map((h) =>
        `<span class="hm__c" role="cell" style="--a:${(row[h] / mx).toFixed(2)}" title="${DOW[d]} ${h}h: ${fmtN(row[h])} ações"></span>`).join('')}</div>`).join('')}
    </div>`;
}


/** CSV com ; (abre direto no Excel em português) */
export function downloadCSV(name, rows, cols) {
  const head = cols.map((c) => c[1]);
  const cell = (v) => { const s = v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = '\ufeff' + [head, ...rows.map((r) => cols.map((c) => (typeof c[0] === 'function' ? c[0](r) : r[c[0]])))].map((r) => r.map(cell).join(';')).join('\r\n');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: name });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
