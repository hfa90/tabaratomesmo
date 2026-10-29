// Portal › Previsão de demanda: o que as pessoas VÃO comprar nos próximos dias (listas do mês abertas,
// listas da família e favoritos com aviso de preço) e em quantas dessas listas o mercado é o mais barato.
// Cada lista compara só os mercados que aquela pessoa ligou; daí sai o "preço a bater" de cada uma, e o
// simulador mostra quantas listas o mercado passa a ganhar baixando o preço. Dá para aplicar o preço aqui mesmo.
import * as P from './portal-api.js';
import { $, $$, esc, brl } from './core.js';
import { fmtN } from './viz.js';
import { ic } from './icons.js';

let C = null, D = null, filter = 'perdendo';
const drops = new Map(); // product_id → quanto baixar (R$)

/** quantas listas o mercado ganha com este preço */
function winsAt(p, price) {
  let w = p.free || 0;
  for (const [b, c] of p.beats || []) if (price <= Number(b) + 1e-9) w += Number(c);
  return w;
}
const share = (p, price) => (p.n_considered ? Math.round((winsAt(p, price) / p.n_considered) * 100) : 0);
/** menor redução que leva a ganhar em pelo menos `goal`% (ou o próximo salto, se já passou) */
function suggestion(p) {
  const now = share(p, p.my_price);
  const goal = now < 80 ? 80 : Math.min(100, now + 10);
  const cands = [...(p.beats || [])].map(([b]) => Number(b)).filter((b) => b < p.my_price && b > p.my_price * 0.7).sort((a, b) => b - a);
  for (const b of cands) if (share(p, b) >= goal) return { price: b, drop: Math.round((p.my_price - b) * 100) / 100, to: share(p, b) };
  const best = cands.map((b) => ({ price: b, to: share(p, b) })).sort((a, b) => b.to - a.to || b.price - a.price)[0];
  return best && best.to > now ? { ...best, drop: Math.round((p.my_price - best.price) * 100) / 100 } : null;
}

export async function render(ctx) {
  C = ctx;
  const m = ctx.market();
  ctx.main.innerHTML = `${ctx.banner}
    <header class="pt-head"><div><h1>Previsão de demanda</h1>
      <p class="muted">O que o público vai comprar nos próximos dias, pelas listas do mês que estão abertas, as listas da família e os favoritos com aviso de preço. E em quantas dessas listas o ${esc(m.name)} sai mais barato.</p></div>
      <div class="seg" role="radiogroup" aria-label="Filtro">${[['perdendo', 'Onde você perde'], ['todos', 'Todos']].map(([k, l]) => `<button role="radio" aria-checked="${filter === k}" data-dm-f="${k}">${l}</button>`).join('')}</div></header>
    <div id="dmBody"><div class="skeleton" style="height:420px"></div></div>`;
  try { D = await P.demand(ctx.mid); }
  catch (e) { $('#dmBody').innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
  paint();
}

function paint() {
  const m = C.market();
  const all = D.products || [];
  const rows = filter === 'perdendo' ? all.filter((p) => share(p, p.my_price) < 60) : all;
  const top = all[0];
  const totalUnits = all.reduce((s, p) => s + Number(p.units || 0), 0);
  const winAvg = all.length ? Math.round(all.reduce((s, p) => s + share(p, p.my_price), 0) / all.length) : 0;
  $('#dmBody').innerHTML = `
    <div class="kpis">
      <div class="kpi"><span class="kpi__l">Listas abertas agora</span><span class="kpi__v">${fmtN(D.lists)}</span><span class="kpi__h">mexidas nos últimos 21 dias, ainda não concluídas</span></div>
      <div class="kpi"><span class="kpi__l">Unidades nas listas</span><span class="kpi__v">${fmtN(Math.round(totalUnits))}</span><span class="kpi__h">dos ${all.length} produtos mais pedidos</span></div>
      <div class="kpi kpi--accent"><span class="kpi__l">Você é o mais barato</span><span class="kpi__v">${winAvg}%</span><span class="kpi__h">das listas, em média, nesses produtos</span></div>
      <div class="kpi"><span class="kpi__l">Produtos onde perde</span><span class="kpi__v">${fmtN(all.filter((p) => share(p, p.my_price) < 60).length)}</span><span class="kpi__h">ganha em menos de 60% das listas</span></div>
    </div>
    ${top ? `<p class="note">Nos próximos 10 dias, <b>${fmtN(top.n_lists)} listas</b> têm ${esc(top.name)}; você é o mais barato em <b>${share(top, top.my_price)}%</b> delas.${(() => { const s = suggestion(top); return s ? ` Se baixar <b>${brl(s.drop)}</b>, passa a ganhar em <b>${s.to}%</b>.` : ''; })()}</p>` : ''}
    <section class="panel"><div class="panel__head"><h2>${ic('chart')} Produtos mais pedidos ${filter === 'perdendo' ? 'onde você perde' : ''}</h2></div>
      ${rows.length ? `<div>${rows.map(row).join('')}</div>` : `<p class="muted small">${all.length ? 'Você já é o mais barato na maioria das listas destes produtos. 👏 Veja “Todos”.' : 'Ainda não há listas suficientes (cada produto precisa estar em 3 listas ou mais).'}</p>`}
    </section>
    ${(D.missing || []).length ? `<section class="panel"><div class="panel__head"><h2>${ic('box')} Muito pedidos, mas você não vende (no site)</h2></div>
      <ul class="hb">${D.missing.map((x) => `<li><span class="hb__l">${esc(x.name)} <small class="muted">${esc([x.brand, x.unit].filter(Boolean).join(' · '))}</small></span><span class="hb__v">${fmtN(x.n_lists)} listas</span></li>`).join('')}</ul>
      <p class="small muted">Se vende na loja, cadastre o preço em <a class="linkish" href="#produtos">Produtos</a>: ele passa a contar nas listas.</p></section>` : ''}
    <details class="panel"><summary><b>De onde vêm os números</b></summary>
      <ul class="small" style="margin:10px 0 0;padding-left:18px;display:grid;gap:6px">
        <li><b>Listas</b>: listas do mês das contas (mexidas nos últimos 21 dias e ainda não concluídas), listas antigas guardadas na conta e listas da família. Cada lista conta uma vez por produto.</li>
        <li><b>Mais barato</b>: cada pessoa escolhe com quais mercados compara. Uma lista conta para você quando o ${esc(m.name)} está entre eles e tem o menor preço (empate conta como ganho).</li>
        <li><b>Simulador</b>: usa o menor preço dos outros mercados que cada pessoa compara (“preço a bater”). Os preços dos concorrentes podem mudar; confira de novo depois de alguns dias.</li>
        <li>Só aparecem produtos em 3 listas ou mais. Nenhuma pessoa é identificada. Veja também, no <a class="linkish" href="#painel">Painel</a>, os produtos em que você está perdendo clientes.</li>
      </ul></details>`;
}

function row(p) {
  const d = drops.get(p.product_id) ?? 0;
  const now = share(p, p.my_price), at = share(p, p.my_price - d);
  const sug = suggestion(p);
  const maxDrop = Math.max(0.05, Math.round(p.my_price * 0.25 * 20) / 20);
  const media = p.image_url ? `<img src="${esc(p.image_url)}" alt="" loading="lazy" />` : `<span>${esc(p.emoji || '🛒')}</span>`;
  return `<article class="dm-row" data-dm="${p.product_id}"><span class="thumb">${media}</span><div>
    <div class="dm-row__h"><b>${esc(p.name)} <small class="muted">${esc([p.brand, p.unit].filter(Boolean).join(' · '))}</small></b>
      <span class="small"><b>${brl(Number(p.my_price))}</b> aqui${p.min_other != null ? ` · ${brl(Number(p.min_other))} no ${esc(p.min_other_name || 'concorrente')}` : ''}</span></div>
    <p class="dm-row__s"><em>${fmtN(p.n_lists)} listas</em>${p.n_watch ? ` e ${fmtN(p.n_watch)} pessoas acompanhando o preço` : ''} · ~${fmtN(Math.round(p.units))} unidades · você é o mais barato em <em>${now}%</em> das listas que te comparam${sug ? `. Baixando <b>${brl(sug.drop)}</b>, passa a <b>${sug.to}%</b>` : ''}.</p>
    <div class="dm-sim">
      <label class="small">Baixar <input type="range" min="0" max="${maxDrop}" step="0.05" value="${d}" data-dm-range="${p.product_id}" aria-label="Quanto baixar o preço de ${esc(p.name)}" /></label>
      <output data-dm-out="${p.product_id}">− ${brl(d)}</output>
      <span class="dm-sim__bar"><span style="--w:${at}%"></span><i style="--w0:${now}%"></i></span>
      <span class="dm-sim__txt" data-dm-txt="${p.product_id}">${simTxt(p, d)}</span>
    </div></div></article>`;
}
function simTxt(p, d) {
  const price = Math.round((p.my_price - d) * 100) / 100;
  const at = share(p, price), now = share(p, p.my_price);
  const gain = winsAt(p, price) - winsAt(p, p.my_price);
  if (!d) return `Arraste para simular. Hoje: ${now}% (${fmtN(winsAt(p, p.my_price))} de ${fmtN(p.n_considered)} listas).`;
  return `A <b>${brl(price)}</b>: mais barato em <b>${at}%</b> das listas (${gain > 0 ? `+${fmtN(gain)}` : 'nenhuma a mais'}). <button class="linkish small" data-dm-apply="${p.product_id}" data-price="${price}">Aplicar ${brl(price)}</button>`;
}

document.addEventListener('input', (e) => {
  const id = Number(e.target.dataset?.dmRange); if (!id || !D) return;
  const p = D.products.find((x) => x.product_id === id); if (!p) return;
  const d = Math.round(Number(e.target.value) * 100) / 100; drops.set(id, d);
  const box = e.target.closest('.dm-row');
  box.querySelector(`[data-dm-out="${id}"]`).textContent = `− ${brl(d)}`;
  box.querySelector('.dm-sim__bar span').style.setProperty('--w', `${share(p, p.my_price - d)}%`);
  box.querySelector(`[data-dm-txt="${id}"]`).innerHTML = simTxt(p, d);
});
document.addEventListener('click', async (e) => {
  const f = e.target.closest('[data-dm-f]'); if (f && C) { filter = f.dataset.dmF; paint(); $$('[data-dm-f]').forEach((b) => b.setAttribute('aria-checked', String(b === f))); return; }
  const a = e.target.closest('[data-dm-apply]'); if (!a || !C) return;
  const id = Number(a.dataset.dmApply), price = Number(a.dataset.price);
  const cat = await C.catalog().catch(() => null);
  const r = cat?.find((x) => x.product_id === id);
  if (!r) { C.toast('Não encontrei este produto no seu catálogo. Ajuste em Produtos.', 'warn'); return; }
  if (!confirm(`Mudar o preço de ${r.name} para ${brl(price)} no ${C.market().name}?`)) return;
  try {
    await P.saveProduct(C.mid, { product_id: id, name: r.name, brand: r.brand, unit: r.unit, category: r.category, ean: r.ean, emoji: r.emoji, sku: r.sku, price });
    C.invalidateCatalog();
    const p = D.products.find((x) => x.product_id === id); if (p) p.my_price = price; drops.delete(id);
    C.toast(`Preço atualizado: ${r.name} a ${brl(price)}.`); paint();
  } catch (x) { C.toast(x.message, 'warn'); }
});
