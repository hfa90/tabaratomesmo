// Campanhas dos supermercados no site (criadas no portal › Campanhas).
//  • Vitrine: faixa de produtos do mercado no topo das ofertas (uma por vez, troca a cada dia).
//  • Janela: aparece no máximo 1 vez por dia (de todos os mercados), nunca na primeira visita,
//    só depois de 7 s parado nas ofertas ou na lista, e nunca por cima de outra janela.
//  • Aviso: com o site em segundo plano vira notificação do celular (se a pessoa ativou os avisos);
//    com o site aberto, um cartão discreto no topo. 1 por dia, só das 8h às 21h.
// Público: todos · quem tem o mercado como preferido · quem está a até X km de uma loja (GPS).
// Fechou? Não volta por 3 dias. "Não mostrar deste mercado" esconde por 7 dias.
import * as api from './api.js';
import { S, $, $$, esc, brl, hooks, haversine, logo, visiblePrices } from './core.js';
import { ic } from './icons.js';
import { track } from './track.js';
import { notifyOn } from './alerts.js';

let list = [];
let shownThisSession = new Set();
let popupTimer = null;
const DAY = 864e5;
const today = () => new Date().toISOString().slice(0, 10);
const hide = () => api.store.get('tb.campHide', {});
const log = () => { const l = api.store.get('tb.campLog', null); return l?.day === today() ? l : { day: today(), popups: 0, notifs: 0 }; };
const bump = (k) => { const l = log(); l[k]++; api.store.set('tb.campLog', l); };
const sessions = (() => { let n = api.store.get('tb.sessions', 0); try { if (!sessionStorage.getItem('tb.sessCounted')) { n++; api.store.set('tb.sessions', n); sessionStorage.setItem('tb.sessCounted', '1'); } } catch {} return n; })();

function hidden(c) {
  const h = hide(); const now = Date.now();
  return (h[`c${c.id}`] || 0) > now || (h[`m${c.supermarket_id}`] || 0) > now;
}
function setHide(key, days) { const h = hide(); h[key] = Date.now() + days * DAY; for (const k of Object.keys(h)) if (h[k] < Date.now()) delete h[k]; api.store.set('tb.campHide', h); }

/** mercados preferidos da pessoa: cadastro, mercados ligados (se escolheu alguns) e onde mais comprou */
function preferred() {
  const set = new Set(S.profile?.preferred_markets || []);
  if (S.enabled.size && S.enabled.size < S.markets.size) S.enabled.forEach((id) => set.add(id));
  const buys = new Map();
  for (const p of api.store.get('tb.purchases', [])) if (p.market) buys.set(p.market, (buys.get(p.market) || 0) + 1);
  const top = [...buys].sort((a, b) => b[1] - a[1])[0]; if (top) set.add(top[0]);
  return set;
}
function nearestStore(mid) {
  const ss = S.stores.filter((s) => s.supermarket_id === mid && s.lat != null);
  if (!S.pos) return ss[0] ? { store: ss[0], km: null } : null;
  return ss.map((s) => ({ store: s, km: haversine(S.pos, s) })).sort((a, b) => a.km - b.km)[0] || null;
}
function eligible(c) {
  if (!S.markets.has(c.supermarket_id) || hidden(c)) return false;
  if (c.audience === 'preferem') return preferred().has(c.supermarket_id);
  if (c.audience === 'perto') { const n = nearestStore(c.supermarket_id); return !!(S.pos && n?.km != null && n.km <= Number(c.radius_km || 2)); }
  return true;
}
const rank = (c) => ({ perto: 3, preferem: 2, todos: 1 }[c.audience] || 0);
const pick = (kind) => list.filter((c) => c.kind === kind && eligible(c)).sort((a, b) => rank(b) - rank(a) || b.id - a.id);

function productsOf(c) {
  let ps = (c.product_ids || []).map((id) => S.products.find((p) => p.id === id)).filter(Boolean);
  if (!ps.length) { // sem produtos escolhidos: as promoções do próprio mercado
    ps = S.products.filter((p) => p.prices.some((x) => x.market_id === c.supermarket_id && (x.promo || (x.prev && x.price < x.prev)))).slice(0, 6);
    if (!ps.length) ps = S.products.filter((p) => visiblePrices(p)[0]?.market_id === c.supermarket_id).slice(0, 6);
  }
  return ps.map((p) => ({ p, x: p.prices.find((y) => y.market_id === c.supermarket_id) })).filter((r) => r.x);
}
function seen(c) { if (shownThisSession.has(c.id)) return; shownThisSession.add(c.id); track('camp_view', { market_id: c.supermarket_id, campaign_id: c.id }); }

function act(c) {
  track('camp_click', { market_id: c.supermarket_id, campaign_id: c.id });
  closePopup();
  if (c.cta === 'rota') { const n = nearestStore(c.supermarket_id); if (n) window.open(`https://www.google.com/maps/dir/?api=1&destination=${n.store.lat},${n.store.lng}`, '_blank', 'noopener'); return; }
  const ps = productsOf(c);
  if (c.cta === 'produtos' && ps[0]) return hooks.openProduct?.(ps[0].p.id);
  location.hash = '#ofertas';
  setTimeout(() => $('#campVitrine')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
}

// ---------------------------------------------------------------- vitrine (nas ofertas)
export function renderVitrine() {
  const el = $('#campVitrine'); if (!el) return;
  const cands = pick('vitrine');
  if (!cands.length) { el.hidden = true; el.innerHTML = ''; return; }
  const c = cands[new Date().getDate() % cands.length];
  const m = S.markets.get(c.supermarket_id); const ps = productsOf(c);
  if (!ps.length) { el.hidden = true; return; }
  el.hidden = false; el.dataset.camp = c.id;
  el.innerHTML = `<div class="vit-head">${logo(m, 'sm')}<span><small>Vitrine · ${esc(m.name)}</small><b>${esc(c.title)}</b></span>
      <button class="vit-x" data-camp-x="${c.id}" aria-label="Esconder esta vitrine">${ic('close')}</button></div>
    ${c.body ? `<p class="vit-body">${esc(c.body)}</p>` : ''}
    <div class="vit-row">${ps.map(({ p, x }) => `<button class="vit-card" data-camp-prod="${c.id}:${p.id}">
      <span class="vit-card__m">${p.image_url ? `<img src="${esc(p.image_url)}" alt="" loading="lazy" />` : esc(p.emoji || '')}</span>
      <b>${esc(p.name)}</b><small>${esc([p.brand, p.unit].filter(Boolean).join(' · '))}</small>
      <span class="vit-card__p">${brl(x.price)}${x.promo && x.regular ? `<s>${brl(x.regular)}</s>` : x.prev && x.prev > x.price ? `<s>${brl(x.prev)}</s>` : ''}</span></button>`).join('')}</div>`;
  // conta como vista quando aparece na tela
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { seen(c); io.disconnect(); } }, { threshold: 0.5 });
    io.observe(el);
  } else seen(c);
}

// ---------------------------------------------------------------- janela (popup inteligente)
function canPopup() {
  if (sessions < 2 || log().popups >= 1) return false;          // nunca na primeira visita; 1 por dia
  if (!['ofertas', 'lista'].includes((location.hash || '#ofertas').slice(1).split('?')[0])) return false;
  if ($$('.sheet.is-open').length || $('#calcFull') || $('.notify-ask') || $('#splash')) return false;
  if (document.activeElement?.matches?.('input, textarea, select')) return false;
  return !document.hidden;
}
function schedulePopup() {
  clearTimeout(popupTimer);
  popupTimer = setTimeout(() => {
    if (!canPopup()) return;
    const c = pick('janela')[0]; if (!c) return;
    showPopup(c);
  }, 7000);
}
function showPopup(c) {
  const m = S.markets.get(c.supermarket_id); const ps = productsOf(c).slice(0, 3);
  const el = document.createElement('div');
  el.className = 'camp-pop'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'campPopT');
  el.innerHTML = `<div class="camp-pop__bg" data-camp-close="${c.id}"></div>
    <div class="camp-pop__card">
      ${c.image_url ? `<img class="camp-pop__img" src="${esc(c.image_url)}" alt="" />` : ''}
      <div class="camp-pop__mk">${logo(m, 'sm')}<span>${esc(m.name)}</span>${c.audience === 'perto' ? `<em>${ic('pin')} perto de você</em>` : ''}</div>
      <h2 id="campPopT">${esc(c.title)}</h2>${c.body ? `<p>${esc(c.body)}</p>` : ''}
      ${ps.length ? `<ul class="camp-pop__ps">${ps.map(({ p, x }) => `<li><span>${esc(p.name)}</span><b>${brl(x.price)}</b></li>`).join('')}</ul>` : ''}
      <button class="btn btn--primary btn--xl btn--block" data-camp-go="${c.id}">${{ rota: 'Como chegar', produtos: 'Ver os produtos' }[c.cta] || 'Ver as ofertas'}</button>
      <div class="camp-pop__foot"><button class="btn btn--text" data-camp-close="${c.id}">Agora não</button>
        <button class="btn btn--text" data-camp-mute="${c.supermarket_id}:${c.id}">Não mostrar do ${esc(m.name)}</button></div>
    </div>`;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  bump('popups'); seen(c);
}
function closePopup() { const el = $('.camp-pop'); if (!el) return; el.classList.remove('is-in'); setTimeout(() => el.remove(), 250); }

// ---------------------------------------------------------------- aviso (como notificação de app)
async function notify(c) {
  const h = new Date().getHours();
  if (h < 8 || h >= 21 || log().notifs >= 1 || shownThisSession.has(c.id)) return;
  const m = S.markets.get(c.supermarket_id); const n = nearestStore(c.supermarket_id);
  const body = c.body || (n?.km != null ? `${m.name} a ${n.km < 1 ? Math.round(n.km * 1000) + ' m' : n.km.toFixed(1).replace('.', ',') + ' km'} de você.` : `Ofertas no ${m.name}.`);
  if (document.hidden && notifyOn()) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(c.title, { body, icon: m.logo_url || 'assets/icon-192.png', badge: 'assets/icon-192.png', tag: `camp-${c.id}`, data: { url: `./#ofertas?camp=${c.id}` } });
    } catch { return; }
  } else if (!document.hidden && sessions >= 2) {
    const el = document.createElement('button');
    el.className = 'camp-toast'; el.dataset.campGo = c.id;
    el.innerHTML = `<span class="camp-toast__i">${logo(m, 'sm')}</span><span><small>${esc(m.name)} · agora</small><b>${esc(c.title)}</b><em>${esc(body)}</em></span>`;
    document.body.append(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    setTimeout(() => { el.classList.remove('is-in'); setTimeout(() => el.remove(), 400); }, 9000);
  } else return;
  bump('notifs'); shownThisSession.add(c.id);
  track('camp_notify', { market_id: c.supermarket_id, campaign_id: c.id });
}
function checkNotify() { const c = pick('aviso')[0]; if (c) notify(c); }

// ---------------------------------------------------------------- ligações
export async function init() {
  list = await api.loadCampaigns().catch(() => []);
  if (!list.length) return;
  renderVitrine();
  schedulePopup();
  setTimeout(checkNotify, 12000);
  // veio do toque numa notificação
  const q = new URLSearchParams(location.hash.split('?')[1] || ''); const id = Number(q.get('camp'));
  if (id) { const c = list.find((x) => x.id === id); if (c) { track('camp_click', { market_id: c.supermarket_id, campaign_id: c.id }); history.replaceState(null, '', '#ofertas'); } }
}
/** a localização mudou (GPS): campanhas "perto da loja" podem passar a valer */
export function onPosition() { if (!list.length) return; renderVitrine(); checkNotify(); }
/** trocou de página */
export function onRoute() { if (list.length) { renderVitrine(); schedulePopup(); } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && list.length && S.pos) setTimeout(checkNotify, 60000); });

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-camp-go], [data-camp-close], [data-camp-mute], [data-camp-x], [data-camp-prod]'); if (!t) return;
  const d = t.dataset; const find = (id) => list.find((c) => c.id === Number(id));
  if (d.campGo) { const c = find(d.campGo); t.classList?.contains('camp-toast') && t.remove(); if (c) act(c); return; }
  if (d.campClose) { const c = find(d.campClose); if (c) { setHide(`c${c.id}`, 3); track('camp_close', { market_id: c.supermarket_id, campaign_id: c.id }); } closePopup(); return; }
  if (d.campMute) { const [mid, cid] = d.campMute.split(':'); setHide(`m${mid}`, 7); track('camp_close', { market_id: Number(mid), campaign_id: Number(cid) }); closePopup(); hooks.toast?.('Tudo bem: não mostramos campanhas deste mercado por 7 dias.'); renderVitrine(); return; }
  if (d.campX) { const c = find(d.campX); if (c) { setHide(`c${c.id}`, 3); track('camp_close', { market_id: c.supermarket_id, campaign_id: c.id }); } renderVitrine(); return; }
  if (d.campProd) { const [cid, pid] = d.campProd.split(':').map(Number); const c = find(cid); if (c) track('camp_click', { market_id: c.supermarket_id, campaign_id: c.id, product_id: pid }); hooks.openProduct?.(pid); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('.camp-pop')) closePopup(); });
