// "Não achei na loja": o cliente avisa e o gerente daquela unidade fica sabendo (portal › Não achei na loja
// e Telegram @corp_tabaratomesmo_bot). Funciona com ou sem conta (o aparelho conta como uma pessoa).
import * as api from './api.js';
import { S, $, esc, km, logo, haversine, hooks } from './core.js';
import { openTool } from './ajudantes.js';
import { homePos } from './rancho.js';
import { track } from './track.js';

/** lojas que vendem o produto, da mais perto para a mais longe (a loja onde a pessoa está vem primeiro) */
function storesFor(p) {
  const here = S.cart?.market ?? null;
  const from = S.pos?.gps ? S.pos : homePos();
  const mids = new Set(p.prices.map((x) => x.market_id));
  return S.stores.filter((s) => mids.has(s.supermarket_id) && S.markets.has(s.supermarket_id))
    .map((s) => ({ s, d: from ? haversine(from, s) : null }))
    .sort((a, b) => (b.s.supermarket_id === here) - (a.s.supermarket_id === here) || (a.d ?? 99) - (b.d ?? 99))
    .slice(0, 8);
}

export function open(pid) {
  const p = S.products.find((x) => x.id === pid); if (!p) return;
  const list = storesFor(p);
  openTool('falta', `<div class="tool">
    <h2 class="sheet__title" id="toolTitle">Não achou na loja?</h2>
    <p class="muted small"><b>${esc(p.name)}</b> ${esc([p.brand, p.unit].filter(Boolean).join(' · '))}. Diga em qual loja: avisamos o gerente para repor. Leva 2 segundos.</p>
    ${list.length ? `<div class="radios falta-list" role="radiogroup">${list.map(({ s, d }, i) => { const m = S.markets.get(s.supermarket_id);
      return `<label><input type="radio" name="faltaStore" value="${s.id}" ${i === 0 ? 'checked' : ''} /> ${logo(m, 'xs')} <span><b>${esc(s.name || m.name)}</b><small class="muted">${esc(s.neighborhood || '')}${d != null ? ` · ${km(d)}` : ''}</small></span></label>`; }).join('')}</div>
      <div class="tool__actions"><button class="btn btn--primary btn--xl" data-falta-send="${p.id}">Avisar a loja</button></div>`
      : '<p class="note">Nenhuma loja cadastrada vende este produto no site.</p>'}
  </div>`);
}

document.addEventListener('click', async (e) => {
  const o = e.target.closest('[data-missing]');
  if (o) { e.preventDefault(); hooks.closeSheet?.('#productSheet'); setTimeout(() => open(Number(o.dataset.missing)), 260); return; }
  const b = e.target.closest('[data-falta-send]'); if (!b) return;
  const pid = Number(b.dataset.faltaSend);
  const store = Number($('input[name=faltaStore]:checked')?.value); if (!store) return;
  const st = S.stores.find((s) => s.id === store); const m = S.markets.get(st?.supermarket_id);
  b.disabled = true; b.textContent = 'Avisando…';
  try {
    const n = await api.reportMissing(pid, store);
    track('tool', { query: 'nao_achei', market_id: m?.id, product_id: pid, store_id: store });
    hooks.closeSheet?.('#toolSheet');
    hooks.toast?.(`Obrigado! Avisamos o ${m?.name || 'mercado'}${n > 1 ? `: ${n} pessoas avisaram hoje` : ''}.`);
  } catch (x) { b.disabled = false; b.textContent = 'Avisar a loja'; hooks.toast?.(x.message, 'warn'); }
});
