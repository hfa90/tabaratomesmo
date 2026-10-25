// Chegou numa loja? Com a localização liberada e o site aberto, comparamos o GPS do celular com as
// coordenadas das lojas. Para não confundir com quem só passa em frente:
//   - a precisão do GPS tem que ser boa (até 100 m);
//   - quem está a mais de 15 km/h (de carro na avenida) é ignorado;
//   - são precisas 2 leituras seguidas dentro do raio da mesma loja, ou 1 leitura muito precisa (até 35 m).
// As boas-vindas aparecem uma vez por loja por dia.
import * as api from './api.js';
import { S, $, esc, brl, logo, logoFull, haversine, hooks, isOn, media } from './core.js';
import { track } from './track.js';
import * as interrupt from './interrupt.js';

let watchId = null, streak = { id: null, n: 0 }, lastPosSent = null;
const radiusKm = () => Math.max(50, Number(S.settings?.welcome_radius) || 150) / 1000;
const todayKey = (id) => `${new Date().toDateString()}:${id}`;

export function start() {
  if (watchId != null || !('geolocation' in navigator) || S.settings?.welcome_enabled === false || api.store.get('tb.welcomeOff', false)) return;
  watchId = navigator.geolocation.watchPosition(onPos, () => {}, { enableHighAccuracy: true, maximumAge: 20000, timeout: 30000 });
}
export function stop() { if (watchId != null) navigator.geolocation.clearWatch(watchId); watchId = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') stop(); else if (S.pos?.gps) start(); });

function nearestStore(p) {
  let best = null;
  for (const s of S.stores) { const d = haversine(p, s); if (!best || d < best.km) best = { store: s, km: d }; }
  return best;
}

function onPos(g) {
  const p = { lat: g.coords.latitude, lng: g.coords.longitude };
  const acc = g.coords.accuracy || 999;
  // mantém a posição do site atualizada quando a pessoa anda bastante
  if (!lastPosSent || haversine(lastPosSent, p) > 0.3) { lastPosSent = p; hooks.onGps?.(p); }
  if (acc > 100 || (g.coords.speed != null && g.coords.speed > 4.2)) { streak = { id: null, n: 0 }; return; }
  const hit = nearestStore(p);
  if (!hit || hit.km > radiusKm() + Math.min(acc, 60) / 1000) { streak = { id: null, n: 0 }; return; }
  streak = streak.id === hit.store.id ? { id: hit.store.id, n: streak.n + 1 } : { id: hit.store.id, n: 1 };
  if (streak.n >= 2 || acc <= 35) arrived(hit.store);
}

/** também dá para chamar à mão (teste ou "Estou nesta loja") */
export function arrived(store, { force = false } = {}) {
  const seen = api.store.get('tb.welcomed', {});
  if (!force && seen[store.id] === todayKey(store.id)) return;
  seen[store.id] = todayKey(store.id); api.store.set('tb.welcomed', seen);
  const m = S.markets.get(store.supermarket_id); if (!m) return;
  track('store_visit', { market_id: m.id, store_id: store.id });
  // o carrinho passa a usar esta loja
  const cart = S.cart || api.store.get('tb.cart', null) || { items: [], budget: null };
  cart.market = m.id; S.cart = cart; api.store.set('tb.cart', cart);
  if ($$open()) return setTimeout(() => arrived(store, { force: true }), 4000); // espera fechar o que estiver aberto
  render(store, m);
}
const $$open = () => !!document.querySelector('.sheet.is-open');

function render(store, m) {
  // ofertas desta loja: promoções primeiro, depois onde ela é a mais barata
  const promos = S.products.flatMap((p) => p.prices.filter((x) => x.market_id === m.id && x.promo).map((x) => ({ p, x, save: (x.regular || x.price) - x.price })));
  const cheapest = S.products.map((p) => {
    const v = p.prices.filter((x) => isOn(x.market_id));
    if (!v.length || v[0].market_id !== m.id || v[0].promo) return null;
    return { p, x: v[0], save: v.length > 1 ? v[1].price - v[0].price : 0 };
  }).filter(Boolean).sort((a, b) => b.save - a.save);
  const offers = [...promos, ...cheapest].slice(0, 4);
  // o rancho do mês aqui
  let ranchoTxt = '';
  if (S.list.size) {
    let here = 0, best = 0, missing = 0;
    for (const [pid, q] of S.list) {
      const p = S.products.find((x) => x.id === pid); if (!p) continue;
      const x = p.prices.find((y) => y.market_id === m.id);
      const v = p.prices.filter((y) => isOn(y.market_id));
      best += (v[0]?.price || 0) * q;
      if (x) here += x.price * q; else missing++;
    }
    ranchoTxt = `Seu rancho (${S.list.size} itens) sai por <b>${brl(here)}</b> aqui${missing ? `, sem ${missing} ${missing > 1 ? 'itens' : 'item'}` : ''}.`;
  }
  const hour = new Date().getHours();
  const hi = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const name = (S.profile?.full_name || S.user?.user_metadata?.full_name || '').split(' ')[0];
  $('#welcomeBody').innerHTML = `
    <div class="wl">
      <div class="wl-top" style="--c:${esc(m.color || '#0F5A3E')}">
        <span class="wl-logo">${logoFull(m)}</span>
        <p class="wl-hi">${hi}${name ? `, ${esc(name)}` : ''}!</p>
        <h2 class="sheet__title" id="welcomeTitle">Bem-vindo ao ${esc(store.name)}</h2>
        <p class="wl-sub">${esc(store.neighborhood || '')}${store.address ? ` · ${esc(store.address)}` : ''}</p>
      </div>
      ${offers.length ? `<div><p class="pd__h">Hoje vale a pena aqui</p><ul class="wl-offers">${offers.map(({ p, x, save }) => `<li><button data-wl-product="${p.id}">${media(p, 'rx-media')}
        <span class="rx-txt"><span class="rx-name">${esc(p.name)}</span><span class="rx-meta"><span>${esc([p.brand, p.unit].filter(Boolean).join(' · '))}</span></span></span>
        <span class="wl-price"><b>${brl(x.price)}</b>${x.promo ? `<small class="pill ${x.promo.kind === 'exclusiva' ? 'pill--excl' : 'pill--promo'}">${x.promo.kind === 'exclusiva' ? 'Só pelo app' : 'Oferta'}</small>` : save > 0.01 ? `<small class="down">${brl(save)} a menos</small>` : ''}</span></button></li>`).join('')}</ul></div>` : ''}
      ${ranchoTxt ? `<p class="wl-rancho">${ranchoTxt} <a class="linkish" href="#lista" data-close>Ver o rancho</a></p>` : ''}
      <div class="wl-actions">
        <a class="btn btn--primary btn--block" href="#carrinho" data-close data-autofocus>Começar meu carrinho aqui</a>
        <button class="btn btn--ghost btn--block" data-fiscal-market="${m.id}" data-close>Conferir 3 preços e ganhar pontos</button>
        <button class="btn btn--text btn--block" data-close>Agora não</button>
      </div>
      <p class="muted small center">Você está aqui porque o GPS do seu celular indicou esta loja. <button class="linkish small" data-wl-off>Não mostrar mais</button></p>
    </div>`;
  // uma interrupção por visita: se já houve outra, só um aviso discreto
  if (!force && !interrupt.claim('boas-vindas')) { hooks.toast?.(`Você está no ${m.name}. O carrinho já usa os preços desta loja.`); return; }
  hooks.openSheet('#welcomeSheet');
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-wl-product], [data-wl-off]'); if (!t) return;
  if (t.dataset.wlOff !== undefined) { api.store.set('tb.welcomeOff', true); stop(); hooks.closeSheet('#welcomeSheet'); hooks.toast?.('Tudo bem, não mostramos mais as boas-vindas.'); return; }
  hooks.closeSheet('#welcomeSheet');
  setTimeout(() => hooks.openProduct?.(Number(t.dataset.wlProduct)), 280);
});

export const disabledByUser = () => !!api.store.get('tb.welcomeOff', false);
