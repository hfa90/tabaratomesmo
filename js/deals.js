// Dias e formas de pagamento com desconto ("Terça do Hortifrúti", "10% pagando com Pix").
// Os supermercados cadastram no portal (tabela market_deals); aqui o site mostra o que vale hoje,
// avisa no detalhe do produto e calcula o melhor dia para fazer o rancho.
import * as api from './api.js';
import { ic } from './icons.js';
import { S, $, esc, brl, logo, isOn, DOW, DOW_SHORT } from './core.js';

export const PAYMENTS = {
  pix: { label: 'Pix', icon: ic('flash') },
  debito: { label: 'cartão de débito', icon: ic('card') },
  credito: { label: 'cartão de crédito', icon: ic('card') },
  cartao_loja: { label: 'cartão da loja', icon: ic('id') },
  dinheiro: { label: 'dinheiro', icon: ic('cash') },
  vale: { label: 'vale-alimentação', icon: ic('ticket') },
  app_loja: { label: 'app da loja', icon: ic('phone') },
};

let list = [];
export async function load() {
  try { list = await api.loadDeals(); } catch { list = []; }
  return list;
}
export const all = () => list.filter((d) => S.markets.has(d.supermarket_id) && isOn(d.supermarket_id));

const todayISO = () => new Date().toISOString().slice(0, 10);
const live = (d, date = new Date()) => {
  const iso = date.toISOString().slice(0, 10);
  return d.active !== false && (!d.starts_on || d.starts_on <= iso) && (!d.ends_on || d.ends_on >= iso);
};
const onDay = (d, dow) => !d.weekdays?.length || d.weekdays.includes(dow);

/** descontos de um dia da semana (0 = domingo) */
export function forDay(dow) {
  const base = new Date(); base.setDate(base.getDate() + ((dow - base.getDay() + 7) % 7));
  return all().filter((d) => live(d, base) && onDay(d, dow));
}

const catName = (slug) => S.categories.find((c) => c.slug === slug)?.name || slug;
export const whatText = (d) => (d.category_slug ? `em ${catName(d.category_slug)}` : 'na loja toda');
export const payText = (d) => (d.payment ? `pagando com ${PAYMENTS[d.payment]?.label || d.payment}` : '');
export const daysText = (d) => (!d.weekdays?.length ? 'todos os dias'
  : d.weekdays.length === 1 ? (d.weekdays[0] === 0 || d.weekdays[0] === 6 ? `todo ${DOW[d.weekdays[0]]}` : `toda ${DOW[d.weekdays[0]]}-feira`)
  : d.weekdays.slice().sort().map((x) => DOW_SHORT[x]).join(', '));

/** desconto que vale para um produto num mercado num dia (o maior; separa os que pedem forma de pagamento) */
export function forProduct(p, marketId, dow) {
  const ds = forDay(dow).filter((d) => d.supermarket_id === marketId && (!d.category_slug || d.category_slug === p.category_slug));
  const free = ds.filter((d) => !d.payment).sort((a, b) => b.discount_pct - a.discount_pct)[0] || null;
  const pay = ds.filter((d) => d.payment).sort((a, b) => b.discount_pct - a.discount_pct)[0] || null;
  return { free, pay };
}

/** card de um desconto */
export function card(d, { today = false } = {}) {
  const m = S.markets.get(d.supermarket_id); if (!m) return '';
  const pay = d.payment ? PAYMENTS[d.payment] : null;
  return `<li class="deal2 ${today ? 'is-today' : ''}">
    <span class="deal2__pct"><b>${fmtPct(d.discount_pct)}</b><small>off</small></span>
    <span class="deal2__txt"><b>${esc(d.title || `${fmtPct(d.discount_pct)} ${whatText(d)}`)}</b>
      <small>${logo(m, 'xs')} ${esc(m.name)} · ${esc(whatText(d))}</small>
      ${pay ? `<small class="deal2__pay">${pay.icon} só ${esc(payText(d))}</small>` : ''}
      ${d.note ? `<small class="muted">${esc(d.note)}</small>` : ''}</span>
    ${today ? '<span class="deal2__tag">Hoje!</span>' : `<span class="deal2__when">${esc(daysText(d))}</span>`}
  </li>`;
}
export const fmtPct = (v) => `${String(Math.round(Number(v) * 10) / 10).replace('.', ',')}%`;

// ---------------------------------------------------------------- página inicial: "Dias de desconto"
let dayPick = new Date().getDay();
let dwOpen = false;
export function renderHome() {
  const el = $('#dealsWeek'); if (!el) return;
  if (!all().length) { el.innerHTML = ''; return; }
  const today = new Date().getDay();
  const ds = forDay(dayPick).sort((a, b) => b.discount_pct - a.discount_pct);
  const nToday = forDay(today).length;
  const top = forDay(today).sort((x, y) => y.discount_pct - x.discount_pct)[0];
  const topM = top && S.markets.get(top.supermarket_id);
  el.innerHTML = `<details class="dw" ${dwOpen ? 'open' : ''}>
    <summary class="dw__sum"><span class="dw__i" aria-hidden="true">${ic('calendar')}</span>
      <span class="dw__t"><b>Dias de desconto</b><small>${nToday ? `Hoje: ${nToday} ${nToday > 1 ? 'descontos' : 'desconto'}${topM ? ` · até ${fmtPct(top.discount_pct)} no ${esc(topM.name)}` : ''}` : 'Veja os descontos de cada dia da semana'}</small></span>
      <span class="dw__go" aria-hidden="true">${ic('down')}</span></summary>
    <div class="week" role="tablist" aria-label="Dia da semana">${[0, 1, 2, 3, 4, 5, 6].map((i) => {
      const d = (today + i) % 7; const n = forDay(d).length;
      return `<button role="tab" aria-selected="${d === dayPick}" data-dday="${d}" class="${n ? 'has' : ''}"><small>${i === 0 ? 'Hoje' : DOW_SHORT[d]}</small><b>${n || '–'}</b></button>`;
    }).join('')}</div>
    ${ds.length ? `<ul class="deals2">${ds.map((d) => card(d, { today: dayPick === today })).join('')}</ul>`
      : `<p class="muted small center" style="padding:10px 0">Nenhum desconto ${dayPick === today ? 'hoje' : `na ${DOW[dayPick]}`} nos mercados ligados.</p>`}
  </details>`;
  el.querySelector('details').addEventListener('toggle', (e) => { dwOpen = e.target.open; });
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-dday]'); if (!b) return;
  dayPick = Number(b.dataset.dday); renderHome();
});

// ---------------------------------------------------------------- detalhe do produto
export function productNote(p) {
  const today = new Date().getDay();
  const rows = [];
  for (let i = 0; i < 7; i++) {
    const dow = (today + i) % 7;
    for (const m of S.markets.values()) {
      if (!isOn(m.id) || !p.prices.some((x) => x.market_id === m.id)) continue;
      const { free, pay } = forProduct(p, m.id, dow);
      for (const d of [free, pay].filter(Boolean)) if (!rows.some((r) => r.d.id === d.id)) rows.push({ d, dow, i, m });
    }
  }
  if (!rows.length) return '';
  rows.sort((a, b) => a.i - b.i || b.d.discount_pct - a.d.discount_pct);
  return `<div class="pd-deals"><h3 class="pd__h">${ic('card')} Dias de desconto para este produto</h3><ul>${rows.slice(0, 4).map(({ d, i, dow, m }) => {
    const x = p.prices.find((y) => y.market_id === m.id);
    const v = x ? x.price * (1 - d.discount_pct / 100) : null;
    return `<li>${logo(m, 'xs')}<span><b>${i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : DOW[dow]}</b> no ${esc(m.name)}: ${fmtPct(d.discount_pct)} off${d.payment ? ` ${esc(payText(d))}` : ''}</span>${v ? `<em>${brl(v)}</em>` : ''}</li>`;
  }).join('')}</ul></div>`;
}

// ---------------------------------------------------------------- rancho: melhor dia para ir
/** its: [{p, qty}], priceIn(p, mid). Devolve { best, today, byMarket } só com descontos que não pedem forma de pagamento */
export function bestDay(its, priceIn) {
  if (!all().length || !its.length) return null;
  const rows = [];
  for (const m of S.markets.values()) {
    if (!isOn(m.id)) continue;
    let base = 0; let have = 0;
    for (const { p, qty } of its) { const pr = priceIn(p, m.id); if (pr != null) { base += pr * qty; have++; } }
    if (have < its.length * 0.7) continue; // mercado sem a maior parte da lista
    for (let dow = 0; dow < 7; dow++) {
      let off = 0; let payOff = 0; const used = new Set(); const payUsed = new Set();
      for (const { p, qty } of its) {
        const pr = priceIn(p, m.id); if (pr == null) continue;
        const { free, pay } = forProduct(p, m.id, dow);
        if (free) { off += pr * qty * free.discount_pct / 100; used.add(free); }
        if (pay && (!free || pay.discount_pct > free.discount_pct)) { payOff += pr * qty * (pay.discount_pct - (free?.discount_pct || 0)) / 100; payUsed.add(pay); }
      }
      rows.push({ m, dow, base, off, payOff, total: base - off, have, used: [...used], payUsed: [...payUsed] });
    }
  }
  const withOff = rows.filter((r) => r.off > 0.5 || r.payOff > 0.5);
  if (!withOff.length) return null;
  const best = withOff.slice().sort((a, b) => b.off - a.off || b.payOff - a.payOff)[0];
  return { best, rows, missing: its.length - best.have };
}

export function bestDayHTML(bd) {
  if (!bd) return '<p class="muted small">Nenhum mercado tem dia de desconto para os itens da sua lista.</p>';
  const b = bd.best; const today = new Date().getDay();
  const pays = b.payUsed.filter((d) => d.payment);
  return `<div class="bday">
      <span class="bday__d"><small>${b.dow === today ? 'Hoje' : 'Toda'}</small><b>${DOW_SHORT[b.dow]}</b></span>
      <span><b>${DOW[b.dow][0].toUpperCase() + DOW[b.dow].slice(1)} no ${esc(b.m.name)}</b>
      ${b.off > 0.5 ? `<span class="bday__save">economiza <b>${brl(b.off)}</b> nos itens com desconto</span>` : ''}
      ${pays.length ? `<small>${PAYMENTS[pays[0].payment]?.icon || ic('card')} pagando com ${esc(PAYMENTS[pays[0].payment]?.label || pays[0].payment)}: mais ${brl(b.payOff)}</small>` : ''}</span>
    </div>
    <ul class="bday__list">${[...b.used, ...pays].map((d) => `<li>${fmtPct(d.discount_pct)} ${esc(whatText(d))}${d.payment ? ` (${esc(payText(d))})` : ''}${d.title ? ` · <span class="muted">${esc(d.title)}</span>` : ''}</li>`).join('')}</ul>`;
}

export { todayISO };
