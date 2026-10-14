// Colaboração: usuários informam preços. Curiosidade (preço misterioso, "?" nos cards),
// reciprocidade (seu preço ajuda N vizinhos, +2 comparações por preço), status (níveis e ranking do bairro)
// e conveniência (detecta quando a pessoa está numa loja).
import * as api from './api.js';
import { S, $, $$, esc, brl, km, haversine, logo, hooks, ago } from './core.js';

export const LEVELS = [
  [0, 'Novato do rancho'], [50, 'Olheiro de preço'], [150, 'Fiscal do bairro'],
  [400, 'Fiscal-chefe'], [1000, 'Lenda do encarte'],
];
export function level(points = 0) {
  let i = 0; while (i < LEVELS.length - 1 && points >= LEVELS[i + 1][0]) i++;
  const [min, name] = LEVELS[i]; const next = LEVELS[i + 1];
  return { name, min, next: next ? { pts: next[0], name: next[1] } : null, progress: next ? (points - min) / (next[0] - min) : 1 };
}

const POINTS_HINT = (last) => (!last ? 25 : (Date.now() - new Date(last.at).getTime()) / 864e5 > 3 ? 15 : 10);
let session = { pts: 0, sent: 0 };
let fiscalPos = null;

// ---------------------------------------------------------------- localização na loja
function storeAt(pos, maxKm = 0.35) {
  if (!pos) return null;
  let best = null;
  for (const s of S.stores) { const d = haversine(pos, s); if (d <= maxKm && (!best || d < best.km)) best = { store: s, km: d }; }
  return best;
}

export function checkAtStore() {
  const el = $('#storeBanner'); if (!el) return;
  const hit = S.pos?.gps ? storeAt(S.pos) : null;
  const key = hit ? `${new Date().toDateString()}:${hit.store.id}` : '';
  if (!hit || api.store.get('tb.bannerOff') === key) { el.hidden = true; return; }
  const m = S.markets.get(hit.store.supermarket_id);
  el.hidden = false;
  el.innerHTML = `<div class="sb">${logo(m, 'md')}
    <p><b>Você está no ${esc(hit.store.name)}?</b><span>Confira 6 preços em 1 minuto. Quem está na loja ganha pontos extras.</span></p>
    <button class="btn btn--sm btn--ink" data-fiscal-market="${m.id}">Conferir</button>
    <button class="icon-btn icon-btn--sm" data-banner-off="${key}" aria-label="Agora não">✕</button></div>`;
}

function freshPos() {
  return new Promise((res) => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition((g) => res({ lat: g.coords.latitude, lng: g.coords.longitude }), () => res(null),
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 });
  });
}

// ---------------------------------------------------------------- preço misterioso da semana
export function mystery() {
  const week = Math.floor(Date.now() / (7 * 864e5));
  const pairs = [];
  for (const p of S.products) for (const m of S.markets.values()) {
    const x = p.prices.find((y) => y.market_id === m.id);
    if (!x) pairs.push({ p, m, last: null });
  }
  if (!pairs.length) {
    for (const p of S.products) for (const x of p.prices) pairs.push({ p, m: S.markets.get(x.market_id), last: x });
    pairs.sort((a, b) => new Date(a.last.at) - new Date(b.last.at));
    return pairs[week % Math.min(5, pairs.length)];
  }
  return pairs[week % pairs.length];
}

// ---------------------------------------------------------------- bloco da página inicial
export async function renderHome() {
  const el = $('#crowd'); if (!el || !S.products.length) return;
  const my = mystery();
  if (!my) { el.innerHTML = ''; return; }
  el.innerHTML = `<article class="mystery">
      <span class="mystery__q" aria-hidden="true">?</span>
      <p class="mystery__body"><span class="mystery__k">Preço misterioso da semana</span>
        Quanto custa ${esc(my.p.name.toLowerCase())}${my.p.brand && my.p.brand !== 'Granel' ? ' ' + esc(my.p.brand) : ''} (${esc(my.p.unit)}) no ${esc(my.m.name)}?
        <small>${my.last ? `Último preço ${ago(my.last.at)}.` : 'Ninguém informou ainda.'} Vale ${my.last ? 15 : 25} pontos.</small></p>
      <button class="btn btn--sm btn--tag" data-fiscal-one="${my.p.id}" data-fiscal-m="${my.m.id}">Eu sei</button>
    </article>`;
}

// ---------------------------------------------------------------- sheet do fiscal
function lastIn(p, mid) { return p.prices.find((x) => x.market_id === mid) || null; }

/** open({ market }) confere vários produtos num mercado; open({ product, market? }) um produto em todos os mercados */
export async function open({ market = null, product = null } = {}) {
  if (!S.user) return hooks.openAuth('signup', 'Crie sua conta para informar preços, somar pontos e aparecer no ranking do seu bairro.');
  session = { pts: 0, sent: 0 };
  const body = $('#fiscalBody');
  const here = S.pos?.gps ? storeAt(S.pos) : null;
  if (!market && !product) market = here?.store.supermarket_id || [...S.nearest.entries()].sort((a, b) => a[1].km - b[1].km)[0]?.[0] || [...S.markets.keys()][0];
  hooks.openSheet('#fiscalSheet');
  freshPos().then((p) => { fiscalPos = p; });

  if (product) {
    const p = S.products.find((x) => x.id === product);
    const ms = [...S.markets.values()].sort((a, b) => (a.id === market ? -1 : b.id === market ? 1 : 0));
    body.innerHTML = `
      <h2 class="sheet__title" id="fiscalTitle">Viu esse preço?</h2>
      <div class="fx-prod"><span class="card__emoji">${p.emoji || '🛒'}</span><div><b>${esc(p.name)}</b><small class="muted">${esc([p.brand, p.unit].filter(Boolean).join(', '))}</small></div></div>
      <p class="muted small">Informe o preço da prateleira em um ou mais mercados. Quando outra pessoa confirmar o mesmo valor, ele entra no site para todo mundo.</p>
      <ul class="fx">${ms.map((m) => row(p, m, lastIn(p, m.id))).join('')}</ul>
      ${footer()}`;
  } else {
    const m = S.markets.get(market);
    body.innerHTML = `
      <h2 class="sheet__title" id="fiscalTitle">Conferir preços</h2>
      <div class="fx-markets" role="radiogroup" aria-label="Mercado">${[...S.markets.values()].map((x) => `<button role="radio" aria-checked="${x.id === market}" class="chip ${x.id === market ? 'is-on' : ''}" data-fiscal-market="${x.id}">${logo(x, 'xs')}${esc(x.name)}${here?.store.supermarket_id === x.id ? ' <small>você está aqui</small>' : ''}</button>`).join('')}</div>
      <p class="muted small">Estes são os produtos com preço mais antigo ou que mais gente tem no rancho. Digite o que está na etiqueta, ou toque em “Está igual”.</p>
      <ul class="fx" id="fxList"><li><div class="skeleton" style="height:180px"></div></li></ul>
      ${footer(market)}`;
    try {
      const targets = await api.reportTargets(market, 6);
      $('#fxList').innerHTML = targets.map((t) => {
        const p = S.products.find((x) => x.id === t.product_id); if (!p) return '';
        return row(p, m, t.last_price != null ? { price: t.last_price, at: t.last_at } : null, t.demand);
      }).join('');
    } catch (e) { $('#fxList').innerHTML = `<li class="muted">Não foi possível carregar os produtos. ${esc(e.message || '')}</li>`; }
  }
}

function row(p, m, last, demand = 0) {
  const pts = POINTS_HINT(last);
  return `<li class="fx__row" data-fx="${p.id}:${m.id}">
    <div class="fx__info">${logo(m, 'sm')}
      <span><b>${esc(p.name)} <small>${esc([p.brand, p.unit].filter(Boolean).join(', '))}</small></b>
      <small>${last ? `Último: ${brl(last.price)}, ${ago(last.at)}` : 'Ninguém informou ainda'}${demand ? `, está no rancho de ${demand} ${demand > 1 ? 'pessoas' : 'pessoa'}` : ''}</small></span>
      <em class="fx__pts">+${pts}</em></div>
    <form class="fx__form" data-fx-form="${p.id}:${m.id}">
      <label class="fx__in"><span>R$</span><input name="price" inputmode="decimal" placeholder="${last ? last.price.toFixed(2).replace('.', ',') : '0,00'}" aria-label="Preço de ${esc(p.name)} no ${esc(m.name)}" autocomplete="off" /></label>
      <button class="btn btn--sm btn--primary" type="submit">Enviar</button>
      ${last ? `<button class="btn btn--sm btn--ghost" type="button" data-fx-same="${last.price}">Está igual</button>` : ''}
    </form>
  </li>`;
}

function footer(market = null) {
  return `<div class="fx__foot" id="fxFoot">
    <span id="fxScore">Nenhum preço enviado ainda</span>
    ${market ? `<button class="btn btn--text btn--sm" data-fiscal-more="${market}">Outros produtos</button>` : ''}
    <button class="btn btn--sm btn--ink" data-fiscal-done>Concluir</button>
  </div>`;
}

async function submit(key, price) {
  const [pid, mid] = key.split(':').map(Number);
  const li = $(`[data-fx="${key}"]`);
  const btns = $$('button', li); btns.forEach((b) => (b.disabled = true));
  try {
    const pos = fiscalPos || (S.pos?.gps ? S.pos : null);
    const r = await api.reportPrice({ product_id: pid, supermarket_id: mid, price, lat: pos?.lat, lng: pos?.lng });
    session.pts += r.points; session.sent++;
    li.classList.add('is-done');
    li.querySelector('.fx__form').outerHTML = `<p class="fx__ok">✓ ${brl(price)} enviado <b>+${r.points} pts</b>${r.at_store ? ' <small>(inclui bônus por estar na loja)</small>' : ''}${r.status === 'aprovado' ? ' <small>Confirmado: já está no site.</small>' : ''}</p>`;
    $('#fxScore').innerHTML = `<b>${session.sent}</b> ${session.sent > 1 ? 'preços' : 'preço'}, <b>+${session.pts} pts</b> nesta conferida`;
    if (r.status === 'aprovado') hooks.refreshCatalog?.();
  } catch (e) {
    btns.forEach((b) => (b.disabled = false));
    hooks.toast?.(e.message || 'Não foi possível enviar.', 'warn');
  }
}

async function done() {
  const body = $('#fiscalBody');
  if (!session.sent) return hooks.closeSheet('#fiscalSheet');
  body.innerHTML = `<div class="fx-done"><div class="skeleton" style="height:200px"></div></div>`;
  let imp = { points: session.pts, helped: 0, rank: null, reports: session.sent, month_points: session.pts };
  try { imp = await api.myImpact(); } catch {}
  const lv = level(imp.points);
  body.innerHTML = `
    <div class="fx-done">
      <p class="fx-done__pts">+${session.pts}</p>
      <h2 class="sheet__title">Obrigado, ${esc((S.profile?.full_name || S.user?.user_metadata?.full_name || '').split(' ')[0] || 'fiscal')}!</h2>
      <p>${imp.helped ? `Os preços que você já informou ajudam <b>${imp.helped} ${imp.helped > 1 ? 'pessoas' : 'pessoa'}</b> que têm esses produtos no rancho.` : 'Assim que alguém colocar esses produtos no rancho, seus preços entram na conta dessa pessoa.'}</p>
      <div class="lvl">
        <div class="lvl__top"><b>${lv.name}</b><span>${imp.points} pts</span></div>
        <div class="lvl__bar"><span style="--w:${Math.round(lv.progress * 100)}%"></span></div>
        <small class="muted">${lv.next ? `Faltam ${lv.next.pts - imp.points} pts para ${lv.next.name}` : 'Nível máximo'}${imp.rank ? `. Você está em ${imp.rank}º no ranking do mês.` : ''}</small>
      </div>
      ${S.profile && !S.profile.completed_at ? `<p class="note">Cada preço informado também libera +2 comparações no seu cadastro rápido.</p>` : ''}
      <button class="btn btn--primary btn--block" data-close>Voltar às ofertas</button>
    </div>`;
  hooks.afterContribution?.();
}

// ---------------------------------------------------------------- seção na conta
export async function renderAccount(el) {
  if (!el) return;
  try {
    const [imp, rank] = await Promise.all([api.myImpact(), api.leaderboard(S.profile?.neighborhood || null)]);
    const lv = level(imp.points);
    el.innerHTML = `
      <div class="lvl lvl--card">
        <div class="lvl__top"><b>${lv.name}</b><span>${imp.points} pts</span></div>
        <div class="lvl__bar"><span style="--w:${Math.round(lv.progress * 100)}%"></span></div>
        <small class="muted">${lv.next ? `Faltam ${lv.next.pts - imp.points} pts para ${lv.next.name}.` : 'Nível máximo.'} ${imp.reports} ${imp.reports === 1 ? 'preço informado' : 'preços informados'}, ${imp.approved} ${imp.approved === 1 ? 'confirmado' : 'confirmados'}${imp.helped ? `, ajudando ${imp.helped} ${imp.helped > 1 ? 'pessoas' : 'pessoa'}` : ''}.</small>
        <button class="btn btn--primary btn--sm" data-fiscal-market="">Conferir preços agora</button>
      </div>
      ${rank.length ? `<h3 class="pd__h">Ranking do mês${S.profile?.neighborhood ? ` em ${esc(S.profile.neighborhood)}` : ''}</h3>
        <ol class="rank">${rank.map((r, i) => `<li class="${r.is_me ? 'is-me' : ''}"><span class="rank__pos">${i + 1}º</span><b>${esc(r.name)}</b><small>${esc(r.neighborhood || '')}</small><em>${r.points} pts</em></li>`).join('')}</ol>` : ''}`;
  } catch { el.innerHTML = ''; }
}

// ---------------------------------------------------------------- eventos
document.addEventListener('submit', (e) => {
  const f = e.target.closest('[data-fx-form]'); if (!f) return;
  e.preventDefault();
  const v = parseFloat(f.price.value.replace(/\s|R\$/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.'));
  if (!(v > 0)) { f.price.focus(); return hooks.toast?.('Digite o preço da etiqueta.', 'warn'); }
  submit(f.dataset.fxForm, Math.round(v * 100) / 100);
});
document.addEventListener('click', (e) => {
  const t = e.target.closest('button'); if (!t) return;
  const d = t.dataset;
  if (d.fxSame) { submit(t.closest('[data-fx]').dataset.fx, Number(d.fxSame)); return; }
  if (d.fiscalMarket !== undefined) { e.stopPropagation(); open({ market: d.fiscalMarket ? Number(d.fiscalMarket) : null }); return; }
  if (d.fiscalOne) { e.stopPropagation(); open({ product: Number(d.fiscalOne), market: d.fiscalM ? Number(d.fiscalM) : null }); return; }
  if (d.fiscalMore) { open({ market: Number(d.fiscalMore) }); return; }
  if (d.fiscalDone !== undefined) { done(); return; }
  if (d.bannerOff) { api.store.set('tb.bannerOff', d.bannerOff); $('#storeBanner').hidden = true; }
}, true);
