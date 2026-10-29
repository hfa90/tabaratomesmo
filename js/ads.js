// Publicidade em formato de "card de curiosidade": mostra uma pergunta e a imagem desfocada;
// a oferta só aparece quando a pessoa toca para descobrir. Um anúncio por espaço, sem pop-up,
// sem som e com "Ocultar" sempre à mão.
import * as api from './api.js';
import { S, $, esc, hooks } from './core.js';
import { track } from './track.js';

let ADS = [];
const shown = new Map();     // id → vezes exibido nesta visita (rodízio)
const seen = new Set();      // impressões já registradas nesta visita
const hidden = () => { const h = api.store.get('tb.adHide', {}); const now = Date.now(); return new Set(Object.entries(h).filter(([, t]) => t > now).map(([k]) => Number(k))); };

export async function load() {
  if (S.settings?.ads_enabled === false) { ADS = []; return; }
  ADS = await api.adsLive().catch(() => []);
}

function pick(slot) {
  const off = hidden();
  const list = ADS.filter((a) => a.slot === slot && !off.has(a.id) && new Date(a.ends_at) > Date.now());
  if (!list.length) return null;
  list.sort((a, b) => (shown.get(a.id) || 0) - (shown.get(b.id) || 0));
  const a = list[0]; shown.set(a.id, (shown.get(a.id) || 0) + 1);
  return a;
}

export function html(a, { preview = false } = {}) {
  return `<aside class="ad" data-ad="${a.id}" aria-label="Publicidade de ${esc(a.market || '')}">
    <span class="ad__tag">Patrocinado${a.market ? ` · ${esc(a.market)}` : ''}</span>
    ${preview ? '' : `<button class="ad__hide" data-ad-hide="${a.id}" aria-label="Ocultar este anúncio" title="Não mostrar por 7 dias">×</button>`}
    <div class="ad__media"><img src="${esc(a.image_url)}" alt="" loading="lazy" decoding="async" /></div>
    <div class="ad__txt">
      <b class="ad__title">${esc(a.title)}</b>
      <span class="ad__teaser">${esc(a.teaser || 'Toque para descobrir.')}</span>
      <span class="ad__body">${esc(a.body || '')}</span>
      <span class="ad__btns">
        <button class="btn btn--sm btn--ink ad__reveal" data-ad-reveal="${a.id}">Descobrir</button>
        <button class="btn btn--sm btn--primary ad__cta" data-ad-cta="${a.id}">${esc(a.cta || 'Ver oferta')}</button>
      </span>
    </div>
  </aside>`;
}

/** coloca um anúncio do espaço `slot` dentro de `el` (ou devolve o HTML se el for null) */
export function render(slot, el) {
  if (!el) return '';
  const a = pick(slot);
  el.innerHTML = a ? html(a) : '';
  if (a) observe(el.querySelector('.ad'));
  return el.innerHTML;
}
export function htmlFor(slot) { const a = pick(slot); return a ? html(a) : ''; }

// impressão = anúncio pelo menos metade visível por 1 segundo
const io = 'IntersectionObserver' in window ? new IntersectionObserver((ents) => {
  for (const en of ents) {
    const id = Number(en.target.dataset.ad);
    clearTimeout(en.target._t);
    if (en.isIntersecting && !seen.has(id)) en.target._t = setTimeout(() => { seen.add(id); if (id > 0) track('ad_view', { ad_id: id }); }, 1000);
  }
}, { threshold: 0.5 }) : null;
export function observe(node) { if (node && io) io.observe(node); }
export function observeAll(root = document) { root.querySelectorAll('.ad').forEach(observe); }

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-ad-reveal], [data-ad-cta], [data-ad-hide]'); if (!t) return;
  e.stopPropagation();
  const id = Number(t.dataset.adReveal || t.dataset.adCta || t.dataset.adHide);
  const card = t.closest('.ad');
  if (t.dataset.adHide) {
    const h = api.store.get('tb.adHide', {}); h[id] = Date.now() + 7 * 864e5; api.store.set('tb.adHide', h);
    card?.remove(); return;
  }
  if (t.dataset.adReveal) { card?.classList.add('is-open'); if (id > 0) track('ad_reveal', { ad_id: id }); return; }
  const a = ADS.find((x) => x.id === id); if (!a) return;
  if (id > 0) track('ad_click', { ad_id: id, market_id: a.supermarket_id });
  if (a.target_type === 'product' && a.target_value) hooks.openProduct?.(Number(a.target_value));
  else if (a.target_type === 'store') {
    const s = [...S.stores].filter((x) => x.supermarket_id === a.supermarket_id).sort((x, y) => (S.nearest.get(x.supermarket_id)?.store?.id === x.id ? -1 : 0) - (S.nearest.get(y.supermarket_id)?.store?.id === y.id ? -1 : 0))[0];
    if (s) window.open(`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`, '_blank', 'noopener');
  } else if (a.target_type === 'url' && /^https:\/\//.test(a.target_value || '')) window.open(a.target_value, '_blank', 'noopener');
}, true);

// ======================================================================
//  Publicidade inteligente: sempre de UM produto do mercado, só quando faz sentido
//   busca    — no topo da busca quando a pessoa procura o produto, a marca, a categoria ou as palavras do mercado
//   troca    — quem põe na lista um produto do mesmo tipo recebe a sugestão de trocar pelo do mercado
//   recompra — "hora de repor": calculado NESTE celular com as compras guardadas nele (nada sai do aparelho)
// ======================================================================
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
const STOP = new Set(['de', 'da', 'do', 'em', 'com', 'para', 'tipo', 'e', 'o', 'a']);
/** tipo do produto: a primeira palavra que importa do nome ("Arroz tipo 1" → "arroz") */
const kind = (p) => norm(p?.name).split(/[^a-z0-9]+/).find((w) => w.length > 2 && !STOP.has(w)) || '';
const prodOf = (a) => a.product || S.products.find((p) => p.id === Number(a.product_id ?? a.target_value));
const priceOf = (a, p) => (a.price != null ? Number(a.price) : p?.prices?.find((x) => x.market_id === a.supermarket_id)?.price);
const live = (slot) => { const off = hidden(); return ADS.filter((a) => a.slot === slot && !off.has(a.id) && new Date(a.ends_at) > Date.now()); };
const usable = (a) => { const p = prodOf(a); return p && priceOf(a, p) != null && S.markets.has(a.supermarket_id) ? p : null; };
const rot = (list) => { list.sort((a, b) => (shown.get(a.id) || 0) - (shown.get(b.id) || 0)); const a = list[0]; if (a) shown.set(a.id, (shown.get(a.id) || 0) + 1); return a; };
const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** card de produto patrocinado (os três formatos usam o mesmo, com uma chamada diferente) */
export function productHTML(a, { kick = '', preview = false } = {}) {
  const p = prodOf(a) || { name: a.title, emoji: '🛒' };
  const price = priceOf(a, p);
  const others = (p.prices || []).filter((x) => x.market_id !== a.supermarket_id).map((x) => x.price);
  const avg = others.length ? others.reduce((s, v) => s + v, 0) / others.length : null;
  const img = a.image_url || p.photo || p.image_url;
  return `<aside class="ad ad--prod" data-ad="${a.id}" aria-label="Produto patrocinado pelo ${esc(a.market || '')}">
    <span class="ad__tag">Patrocinado${a.market ? ` · ${esc(a.market)}` : ''}</span>
    ${preview ? '' : `<button class="ad__hide" data-ad-hide="${a.id}" aria-label="Ocultar este anúncio" title="Não mostrar por 7 dias">×</button>`}
    <div class="adp">
      <span class="adp__media">${img ? `<img src="${esc(img)}" alt="" loading="lazy" decoding="async" />` : `<span aria-hidden="true">${esc(p.emoji || '🛒')}</span>`}</span>
      <div class="adp__txt">
        ${kick ? `<span class="adp__kick">${kick}</span>` : ''}
        <b class="adp__name">${esc(p.name)} <small>${esc([p.brand, p.unit].filter(Boolean).join(' · '))}</small></b>
        ${price != null ? `<span class="adp__price"><b>${brl(price)}</b> no ${esc(a.market || '')}${avg && avg - price >= 0.1 ? ` <em>${brl(avg - price)} abaixo da média</em>` : ''}</span>` : ''}
        ${a.body ? `<span class="adp__msg">${esc(a.body)}</span>` : ''}
        <span class="ad__btns">${a.kickBtn || ''}<button class="btn btn--sm btn--primary" data-ad-add="${a.id}">Pôr na lista</button>
          <button class="btn btn--sm btn--ghost" data-ad-cta="${a.id}">Ver produto</button></span>
      </div>
    </div>
  </aside>`;
}

/** Busca patrocinada: o anúncio que combina com o que a pessoa digitou (ou nada) */
export function searchHTML(q) {
  const words = norm(q).split(/\s+/).filter((w) => w.length >= 3);
  if (!words.length) return '';
  const hits = live('busca').filter((a) => {
    const p = usable(a); if (!p) return false;
    const hay = norm([p.name, p.brand, p.category_name, ...(a.keywords || [])].join(' '));
    return words.some((w) => hay.includes(w)) || (a.keywords || []).some((k) => norm(q).includes(norm(k)));
  });
  const a = rot(hits); if (!a) return '';
  return productHTML(a, { kick: `Para quem procura “${esc(q.trim())}”` });
}

/** Sugestão na lista: chamado quando a pessoa põe um produto novo na lista */
const dayKey = () => new Date().toDateString();
export function swapAfterAdd(pid) {
  const added = S.products.find((p) => p.id === pid); if (!added) return;
  const k = kind(added);
  const seenSwap = api.store.get('tb.adSwap', {});
  const hits = live('troca').filter((a) => {
    const p = usable(a); if (!p || p.id === pid || S.list.has(p.id)) return false;
    if (seenSwap[a.id] === dayKey()) return false; // uma vez por dia por anúncio
    const same = p.category_slug === added.category_slug && kind(p) === k;
    const byWord = (a.keywords || []).some((w) => norm(added.name).includes(norm(w)));
    return same || byWord;
  });
  const a = rot(hits); if (!a) return;
  seenSwap[a.id] = dayKey(); api.store.set('tb.adSwap', seenSwap);
  const p = prodOf(a); const mine = added.prices[0]?.price; const theirs = priceOf(a, p);
  const sameSize = norm(p.unit) && norm(p.unit) === norm(added.unit); // só promete economia comparando a mesma embalagem
  const kick = `Você pôs ${esc(added.name)}${added.brand ? ` ${esc(added.brand)}` : ''} na lista. Que tal este?`;
  nudge(productHTML({ ...a, kickBtn: `<button class="btn btn--sm btn--primary" data-ad-swap="${a.id}" data-from="${pid}">Trocar${sameSize && mine != null && theirs != null && mine - theirs >= 0.1 ? ` e economizar ${brl(mine - theirs)}` : ''}</button>` }, { kick })
    .replace(/<button class="btn btn--sm btn--primary" data-ad-add="[^"]+">Pôr na lista<\/button>/, ''));
}

/** Hora de repor: só com o histórico guardado no próprio aparelho */
function boughtDates() {
  const by = new Map(); // product_id → [datas]
  const push = (pid, d) => { if (!pid || !d || Number.isNaN(+d)) return; (by.get(pid) || by.set(pid, []).get(pid)).push(+d); };
  for (const r of api.store.get('tb.receipts', []) || []) for (const it of r.items || []) push(it.pid, new Date(r.at || r.savedAt || 0));
  for (const h of Object.values(api.store.get('tb.history', {}) || {})) {
    if (!h?.bought && !h?.completedAt) continue;
    const d = new Date(h.completedAt || `${h.month}-15T12:00`);
    for (const [pid] of h.items || []) push(pid, d);
  }
  return by;
}
export function restockHTML() {
  const ads = live('recompra'); if (!ads.length) return '';
  const by = boughtDates(); if (!by.size) return '';
  const now = Date.now(), DAY = 864e5;
  const fits = [];
  for (const a of ads) {
    const p = usable(a); if (!p || S.list.has(p.id)) continue;
    // o mesmo produto ou um do mesmo tipo e categoria
    const sims = S.products.filter((x) => x.id === p.id || (x.category_slug === p.category_slug && kind(x) === kind(p))).map((x) => x.id);
    const dates = sims.flatMap((id) => by.get(id) || []).sort((x, y) => x - y);
    if (!dates.length) continue;
    const gaps = dates.slice(1).map((d, i) => (d - dates[i]) / DAY).filter((g) => g >= 5);
    const every = gaps.length ? gaps.sort((x, y) => x - y)[Math.floor(gaps.length / 2)] : 28; // de quantos em quantos dias costuma comprar
    const since = (now - dates[dates.length - 1]) / DAY;
    if (since >= every * 0.85 && since <= 120) fits.push({ a, since, every });
  }
  const pickA = rot(fits.map((f) => f.a)); if (!pickA) return '';
  const f = fits.find((x) => x.a === pickA); const p = prodOf(pickA);
  return productHTML(pickA, { kick: `Hora de repor? Sua última compra de ${esc(kind(p) || 'este produto')} foi há ${Math.round(f.since)} dias` });
}
export function renderRestock(el) {
  if (!el) return;
  el.innerHTML = restockHTML();
  observeAll(el);
}

// cartão que sobe por cima da tela por alguns segundos (sugestão na lista)
function nudge(html) {
  document.querySelector('.ad-nudge')?.remove();
  const box = document.createElement('div');
  box.className = 'ad-nudge'; box.innerHTML = html;
  document.body.append(box);
  requestAnimationFrame(() => box.classList.add('is-in'));
  observeAll(box);
  box._t = setTimeout(() => closeNudge(box), 12000);
  box.addEventListener('pointerenter', () => clearTimeout(box._t));
}
function closeNudge(box = document.querySelector('.ad-nudge')) { if (!box) return; box.classList.remove('is-in'); setTimeout(() => box.remove(), 300); }

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-ad-add], [data-ad-swap]'); if (!t) return;
  e.stopPropagation();
  const id = Number(t.dataset.adAdd || t.dataset.adSwap);
  const a = ADS.find((x) => x.id === id); const p = a && prodOf(a); if (!p) return;
  if (t.dataset.adSwap) {
    const from = Number(t.dataset.from); const q = S.list.get(from) || 1;
    hooks.setQty?.(from, 0, { silent: true });
    hooks.setQty?.(p.id, q, { ad: a });
    hooks.toast?.(`Trocado: ${p.name} do ${a.market} na sua lista.`);
  } else {
    hooks.setQty?.(p.id, (S.list.get(p.id) || 0) + 1, { ad: a });
    hooks.toast?.(`${p.name} foi para a lista.`);
  }
  if (id > 0) track('ad_click', { ad_id: id, market_id: a.supermarket_id, product_id: p.id });
  closeNudge();
  t.closest('.ad:not(.ad-nudge .ad)')?.classList.add('is-done');
}, true);
document.addEventListener('click', (e) => { if (e.target.closest('.ad-nudge [data-ad-hide], .ad-nudge [data-ad-cta]')) closeNudge(); }, true);
