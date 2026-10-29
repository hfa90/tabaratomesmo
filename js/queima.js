// Queima de perecíveis no site: produtos perto do vencimento com desconto, cadastrados pelos mercados
// (portal › Queima de perecíveis). Aparecem nas ofertas para quem está perto e nas boas-vindas da loja.
// O aviso no celular e no Telegram sai pelo servidor (push_collect / tg_clearance_collect).
import * as api from './api.js';
import { CONFIG } from './config.js';
import { S, $, esc, brl, logo, km } from './core.js';
import { ic } from './icons.js';
import { track } from './track.js';
import { homePos } from './rancho.js';

let list = [], seen = new Set(), claimed = new Set();
const where = () => { const h = homePos(); if (h && !(h.source === 'pos' && h.label === CONFIG.DEFAULT_POS?.label)) return h; return null; };
const dBR = (d) => new Date(String(d).length === 10 ? d + 'T12:00' : d).toLocaleDateString('pt-BR', { weekday: 'long' });

export async function load() {
  list = await api.clearanceLive(where()).catch(() => []);
  render();
  return list;
}
/** queimas desta rede (boas-vindas na loja) */
export const forMarket = (mid, storeId = null) => list.filter((c) => c.supermarket_id === mid && (!c.store_id || !storeId || c.store_id === storeId));

function item(c) {
  const m = S.markets.get(c.supermarket_id); if (!m) return '';
  const st = c.lat != null ? c : S.stores.find((x) => x.id === (c.sid || c.store_id)) || S.stores.find((x) => x.supermarket_id === c.supermarket_id);
  return `<article class="qm-item">
    <div class="qm-item__h">${logo(m, 'sm')}<span><b>${esc(c.title)}</b><small>${esc(m.name)}${c.store_name ? ` · ${esc(c.store_name)}` : ''}${c.km != null ? ` · ${km(Number(c.km))}` : ''}</small></span><span class="qm-off">−${c.pct}%</span></div>
    <div class="qm-item__p"><b>${brl(Number(c.price))}</b><s class="muted small">${brl(Number(c.regular_price))}</s></div>
    <small>Vence ${dBR(c.expires_on)} · ${c.qty} unidades${c.note ? ` · ${esc(c.note)}` : ''}</small>
    <div class="row-actions">${claimed.has(c.id) ? `<span class="pill pill--ok">Você vai buscar</span>` : `<button class="btn btn--primary btn--sm" data-qm-claim="${c.id}">Vou buscar</button>`}
      ${st?.lat != null ? `<a class="btn btn--ghost btn--sm" href="https://www.google.com/maps/dir/?api=1&destination=${st.lat},${st.lng}" target="_blank" rel="noopener" data-route="${m.id}">Rota</a>` : ''}</div>
  </article>`;
}

export function render() {
  const el = $('#queimaStrip'); if (!el) return;
  const items = list.filter((c) => S.markets.has(c.supermarket_id));
  if (!items.length) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = `<div class="qm-strip__h"><h2>${ic('flame')} Queima de estoque${where() ? ' perto de você' : ''}</h2><small class="muted">perto do vencimento, preço de liquidação</small></div>
    <div class="qm-list">${items.map(item).join('')}</div>`;
  for (const c of items) if (!seen.has(c.id)) { seen.add(c.id); track('clear_view', { market_id: c.supermarket_id, campaign_id: c.id }); }
}

/** HTML para as boas-vindas na loja */
export function welcomeHTML(mid, storeId) {
  const its = forMarket(mid, storeId); if (!its.length) return '';
  its.forEach((c) => { if (!seen.has(c.id)) { seen.add(c.id); track('clear_view', { market_id: mid, campaign_id: c.id }); } });
  return `<div><p class="pd__h">${ic('flame')} Queima de estoque aqui</p><div class="qm-list">${its.map(item).join('')}</div></div>`;
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-qm-claim]'); if (!b) return;
  const id = Number(b.dataset.qmClaim); b.disabled = true;
  try {
    await api.clearanceClaim(id); claimed.add(id);
    b.outerHTML = '<span class="pill pill--ok">Combinado! Corre que acaba.</span>';
  } catch (x) { b.disabled = false; (await import('./core.js')).hooks.toast?.(x.message, 'warn'); }
});
addEventListener('hashchange', () => { if (location.hash === '#queima') setTimeout(() => $('#queimaStrip')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300); });
