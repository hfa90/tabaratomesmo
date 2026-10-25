// Avisos de preço dos favoritos.
// O aparelho guarda o menor preço que a pessoa já viu de cada favorito (tb.watch).
// Quando o catálogo carrega, ou chega um preço novo ao vivo, compara:
//   baixou → quadro "Baixou!" no topo das ofertas + notificação do celular (se a pessoa ativou);
//   subiu  → só atualiza a referência, para o próximo aviso ser justo.
// A notificação usa o service worker (funciona com o site aberto ou em segundo plano;
// avisar com o site fechado precisaria de um servidor de push).
import * as api from './api.js';
import { S, $, esc, brl, visiblePrices, hooks, logo } from './core.js';
import { ic } from './icons.js';

const MIN_DROP = 0.05; // ignora diferenças de centavos
const watch = () => api.store.get('tb.watch', {});
const drops = () => api.store.get('tb.drops', []);

const minOf = (p) => { const v = visiblePrices(p); return v.length ? { price: v[0].price, mid: v[0].market_id } : null; };

export const canNotify = () => 'Notification' in window && 'serviceWorker' in navigator;
export const notifyOn = () => canNotify() && Notification.permission === 'granted' && api.store.get('tb.notify', true) !== false;

// ---------------------------------------------------------------- produtos que a pessoa COMPROU
// Ranchos concluídos, a última compra do carrinho, notas fiscais e o que foi marcado "já peguei".
// Para cada um, guarda o preço em cada supermercado (tb.watchB) e avisa quando sobe ou desce.
const MIN_CHANGE = 0.10, MIN_PCT = 0.03;
const watchB = () => api.store.get('tb.watchB', {});
const changes = () => api.store.get('tb.changes', []);
export function boughtIds() {
  const ids = new Set();
  for (const h of Object.values(api.store.get('tb.history', {}))) for (const [pid] of h.items || []) ids.add(pid);
  for (const i of api.store.get('tb.lastCart', null)?.items || []) if (i.product_id) ids.add(i.product_id);
  for (const r of api.store.get('tb.receipts', [])) for (const i of r.items || []) if (i.pid) ids.add(i.pid);
  for (const pid of S.rancho?.checked || []) ids.add(pid);
  return [...ids].filter((id) => S.products.some((p) => p.id === id)).slice(0, 80);
}
function checkBought() {
  const ids = boughtIds(); if (!ids.length) return [];
  const w = watchB(); const list = changes(); const fresh = [];
  for (const pid of ids) {
    const p = S.products.find((x) => x.id === pid); if (!p) continue;
    for (const x of p.prices) {
      const k = `${pid}:${x.market_id}`; const ref = w[k];
      if (ref == null) { w[k] = x.price; continue; }
      const diff = x.price - ref;
      if (Math.abs(diff) >= MIN_CHANGE && Math.abs(diff) / ref >= MIN_PCT) {
        const c = { pid, mid: x.market_id, from: ref, to: x.price, at: Date.now() };
        fresh.push(c);
        const i = list.findIndex((y) => y.pid === pid && y.mid === x.market_id);
        if (i >= 0) list[i] = { ...c, from: list[i].from }; else list.unshift(c);
        w[k] = x.price;
      }
    }
  }
  const keep = list.filter((c) => Date.now() - c.at < 7 * 864e5 && Math.abs(c.to - c.from) >= 0.009).slice(0, 12);
  api.store.set('tb.watchB', w); api.store.set('tb.changes', keep);
  return fresh;
}
async function notifyChanges(list) {
  if (!notifyOn() || !list.length) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const up = list.filter((c) => c.to > c.from), down = list.filter((c) => c.to < c.from);
    const one = list[0]; const p = S.products.find((x) => x.id === one.pid); const m = S.markets.get(one.mid);
    const title = list.length > 1 ? `Preços do que você compra mudaram${down.length ? `: ${down.length} baixaram` : ''}${up.length ? `${down.length ? ',' : ':'} ${up.length} subiram` : ''}`
      : `${p?.name || 'Um produto'} ${one.to < one.from ? 'baixou' : 'subiu'} no ${m?.name || 'mercado'}`;
    const body = list.length > 1 ? list.slice(0, 3).map((c) => `${S.products.find((x) => x.id === c.pid)?.name} ${c.to < c.from ? '↓' : '↑'} ${brl(c.to)}`).join(' · ')
      : `De ${brl(one.from)} para ${brl(one.to)}.`;
    reg.showNotification(title, { body, icon: 'assets/icon-192.png', badge: 'assets/icon-192.png', tag: 'tb-change', renotify: true, data: { url: './#ofertas' } });
  } catch {}
}

/** confere favoritos e itens comprados (chame depois de carregar catálogo e favoritos) */
export function check() {
  if (S.products.length) notifyChanges(checkBought());
  if (!S.favs.size || !S.products.length) { render(); return; }
  const w = watch(); const list = drops(); const fresh = [];
  for (const pid of S.favs) {
    const p = S.products.find((x) => x.id === pid); if (!p) continue;
    const now = minOf(p); if (!now) continue;
    const ref = w[pid];
    if (ref == null) { w[pid] = now.price; continue; }
    if (now.price <= ref - MIN_DROP) {
      const d = { pid, from: ref, to: now.price, mid: now.mid, at: Date.now() };
      fresh.push(d);
      const i = list.findIndex((x) => x.pid === pid);
      if (i >= 0) list[i] = { ...d, from: Math.max(list[i].from, ref) }; else list.unshift(d);
      w[pid] = now.price;
    } else if (now.price > ref) w[pid] = now.price;
  }
  // tira avisos de produtos que deixaram de ser favoritos ou com mais de 7 dias
  const keep = list.filter((d) => S.favs.has(d.pid) && Date.now() - d.at < 7 * 864e5).slice(0, 8);
  api.store.set('tb.watch', w); api.store.set('tb.drops', keep);
  if (fresh.length) notify(fresh);
  render();
}

/** novo favorito: guarda o preço de hoje como referência */
export function watchProduct(pid, on) {
  const w = watch();
  if (on) { const p = S.products.find((x) => x.id === pid); const m = p && minOf(p); if (m) w[pid] = m.price; }
  else delete w[pid];
  api.store.set('tb.watch', w);
  if (on && canNotify() && Notification.permission === 'default' && !api.store.get('tb.notifyAsked')) askLater();
}

async function notify(list) {
  if (!notifyOn()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const one = list[0]; const p = S.products.find((x) => x.id === one.pid); const m = S.markets.get(one.mid);
    const title = list.length > 1 ? `${list.length} favoritos baixaram de preço` : `Baixou: ${p?.name || 'seu favorito'}`;
    const body = list.length > 1 ? list.map((d) => S.products.find((x) => x.id === d.pid)?.name).filter(Boolean).slice(0, 3).join(', ')
      : `De ${brl(one.from)} por ${brl(one.to)}${m ? ` no ${m.name}` : ''}.`;
    reg.showNotification(title, { body, icon: 'assets/icon-192.png', badge: 'assets/icon-192.png', tag: 'tb-drop', renotify: true, data: { url: './#ofertas' } });
  } catch {}
}

// ---------------------------------------------------------------- pedir permissão no momento certo
function askLater() {
  setTimeout(() => {
    const el = document.createElement('div');
    el.className = 'notify-ask';
    el.innerHTML = `<span class="notify-ask__i">${ic('bell')}</span><span><b>Quer saber quando baixar?</b><small>Avisamos no celular quando um favorito ficar mais barato.</small></span>
      <button class="btn btn--primary btn--sm" data-notify="yes">Avisar</button><button class="notify-ask__x" data-notify="no" aria-label="Agora não">${ic('close')}</button>`;
    document.body.append(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
  }, 600);
}
export async function enable() {
  api.store.set('tb.notifyAsked', true);
  if (!canNotify()) { hooks.toast?.('Este navegador não mostra avisos. Os preços que baixarem aparecem no topo das Ofertas.'); return false; }
  const r = await Notification.requestPermission();
  api.store.set('tb.notify', r === 'granted');
  hooks.toast?.(r === 'granted' ? 'Pronto! Avisamos quando um favorito baixar.' : 'Tudo bem. Os preços que baixarem aparecem no topo das Ofertas.');
  render();
  return r === 'granted';
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-notify], [data-drop-x]'); if (!b) return;
  if (b.dataset.dropX !== undefined) { api.store.set('tb.drops', []); api.store.set('tb.changes', []); render(); return; }
  const box = b.closest('.notify-ask');
  if (b.dataset.notify === 'yes') await enable(); else api.store.set('tb.notifyAsked', true);
  if (box) { box.classList.remove('is-in'); setTimeout(() => box.remove(), 300); }
});

// ---------------------------------------------------------------- quadro "Baixou!" nas ofertas
export function render() {
  const el = $('#dropBox'); if (!el) return;
  const list = drops().filter((d) => S.products.some((p) => p.id === d.pid));
  const ch = changes().filter((c) => S.products.some((p) => p.id === c.pid) && S.markets.has(c.mid) && !list.some((d) => d.pid === c.pid && d.mid === c.mid));
  if (!list.length && !ch.length) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const nDown = ch.filter((c) => c.to < c.from).length, nUp = ch.length - nDown;
  const row = (d) => { const p = S.products.find((x) => x.id === d.pid); const m = S.markets.get(d.mid); const down = d.to < d.from;
    return `<li><button data-open-product="${p.id}">
      <span class="drop-list__t"><b>${esc(p.name)}</b><small>${m ? `${logo(m, 'xs')} ${esc(m.name)}` : ''}</small></span>
      <span class="drop-list__v ${down ? '' : 'is-up'}"><s>${brl(d.from)}</s><b>${brl(d.to)}</b><em>${down ? '−' : '+'}${brl(Math.abs(d.from - d.to))}</em></span></button></li>`; };
  el.innerHTML = `<div class="drop-head"><span class="drop-head__i">${ic(list.length || nDown >= nUp ? 'down' : 'up')}</span>
      <b>${list.length ? `Baixou! ${list.length > 1 ? `${list.length} favoritos seus` : 'Um favorito seu'} ficou mais barato` : 'O preço do que você compra mudou'}</b>
      <button class="drop-head__x" data-drop-x aria-label="Dispensar">${ic('close')}</button></div>
    ${list.length ? `<ul class="drop-list">${list.map(row).join('')}</ul>` : ''}
    ${ch.length ? `${list.length ? `<p class="drop-sub">O que você compra: ${nDown ? `${nDown} ${nDown > 1 ? 'baixaram' : 'baixou'}` : ''}${nDown && nUp ? ', ' : ''}${nUp ? `${nUp} ${nUp > 1 ? 'subiram' : 'subiu'}` : ''}</p>` : ''}
      <ul class="drop-list">${ch.slice(0, 6).map(row).join('')}</ul>` : ''}
    ${canNotify() && Notification.permission === 'default' ? `<button class="btn btn--text drop-on" data-notify="yes">${ic('bell')} Avisar também no celular</button>` : ''}`;
}
