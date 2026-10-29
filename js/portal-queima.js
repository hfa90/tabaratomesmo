// Portal › Queima de perecíveis: "iogurte vence sexta, 40% off, 60 unidades".
// O site avisa só quem está perto da loja (raio) e acompanha aquele tipo de produto: aviso no celular,
// Telegram e boas-vindas na loja; e mostra a oferta nas ofertas para quem estiver por perto.
// O resultado é fácil de medir: unidades vendidas (comprovadas por nota) × preço = dinheiro que ia para o lixo.
import * as P from './portal-api.js';
import { $, esc, brl } from './core.js';
import { fmtN } from './viz.js';
import { ic } from './icons.js';

let C = null, list = [];
const num = (v) => Number(String(v ?? '').replace(/\s|R\$/g, '').replace(',', '.'));
const dBR = (d) => new Date(String(d).length === 10 ? d + 'T12:00' : d).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '');
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const recovered = (c) => Math.min(c.qty, Number(c.proven_units || 0)) * Number(c.price);

export async function render(ctx) {
  C = ctx;
  const m = ctx.market();
  ctx.main.innerHTML = `${ctx.banner}
    <header class="pt-head"><div><h1>Queima de perecíveis</h1>
      <p class="muted">Produto perto do vencimento vira venda em vez de perda. Avisamos só quem está perto de uma loja do ${esc(m.name)} e acompanha aquele tipo de produto.</p></div>
      <button class="btn btn--primary" data-qm="new">${ic('plus')} Nova queima</button></header>
    <div id="qmBody"><div class="skeleton" style="height:300px"></div></div>`;
  try { list = await P.clearanceList(ctx.mid); }
  catch (e) { $('#qmBody').innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
  paint();
}

function paint() {
  const live = list.filter((c) => c.live);
  const rec = list.reduce((s, c) => s + recovered(c), 0);
  const units = list.reduce((s, c) => s + Math.min(c.qty, Number(c.proven_units || 0)), 0);
  $('#qmBody').innerHTML = `
    <div class="kpis">
      <div class="kpi"><span class="kpi__l">No ar agora</span><span class="kpi__v">${fmtN(live.length)}</span><span class="kpi__h">${fmtN(live.reduce((s, c) => s + c.qty, 0))} unidades</span></div>
      <div class="kpi"><span class="kpi__l">Pessoas avisadas</span><span class="kpi__v">${fmtN(list.reduce((s, c) => s + Number(c.notified || 0), 0))}</span><span class="kpi__h">celular e Telegram, nos últimos 120 dias</span></div>
      <div class="kpi"><span class="kpi__l">“Vou buscar”</span><span class="kpi__v">${fmtN(list.reduce((s, c) => s + Number(c.claims || 0), 0))}</span><span class="kpi__h">reservas feitas no site</span></div>
      <div class="kpi kpi--accent"><span class="kpi__l">Recuperado (comprovado)</span><span class="kpi__v">${brl(rec)}</span><span class="kpi__h">${fmtN(Math.round(units))} unidades em notas fiscais</span></div>
    </div>
    ${list.length ? `<div class="camp-cards">${list.map(card).join('')}</div>` : `<section class="panel camp-empty"><span>${ic('flame')}</span><b>Nenhuma queima ainda</b>
      <p class="muted small">A quebra de perecíveis come de 2% a 3% do faturamento de um supermercado. Cadastre o que vence nos próximos dias: o aviso chega a quem está a até 2 km e costuma comprar aquilo.</p>
      <button class="btn btn--primary" data-qm="new">Cadastrar a primeira</button></section>`}
    <section class="panel"><div class="panel__head"><h2>${ic('lock')} Quem recebe o aviso</h2></div>
      <ul class="small" style="margin:0;padding-left:18px;display:grid;gap:6px">
        <li>Quem está dentro do raio da loja (pela posição aproximada do celular ou pela casa cadastrada) <b>e</b> acompanha o produto ou a categoria dele: favoritos, lista do mês ou aviso de preço.</li>
        <li>No máximo <b>1 aviso de queima por dia</b> por pessoa, entre 8h e 21h, e nunca a mesma queima duas vezes.</li>
        <li>Quem chega numa loja sua com o site aberto vê as queimas daquela loja nas boas-vindas.</li>
        <li>As vendas são comprovadas quando a nota da sua loja traz o produto pelo preço da queima.</li>
      </ul></section>`;
}

function card(c) {
  const st = c.live ? ['ok', 'No ar'] : c.status === 'esgotada' ? ['soft', 'Esgotou'] : c.status === 'bloqueada' ? ['warn', 'Bloqueada pela equipe'] : ['soft', 'Encerrada'];
  const potential = c.qty * Number(c.price);
  return `<article class="panel qm-card ${c.live ? '' : 'is-off'}">
    <div class="qm-card__h"><div><h3>${esc(c.title)}</h3><p class="small muted">${c.store_name ? esc(c.store_name) : 'Todas as lojas'} · vence ${dBR(c.expires_on)} · raio de ${String(c.radius_km).replace('.', ',')} km</p></div>
      <span class="qm-pct">−${c.pct}%</span></div>
    <p><b>${brl(Number(c.price))}</b> <s class="muted small">${brl(Number(c.regular_price))}</s> · ${fmtN(c.qty)} unidades <span class="pill pill--${st[0]}">${st[1]}</span></p>
    ${c.note ? `<p class="small muted">${esc(c.note)}</p>` : ''}
    <div class="qm-stats"><span><b>${fmtN(c.notified || 0)}</b><small>avisados</small></span><span><b>${fmtN(c.views || 0)}</b><small>viram</small></span>
      <span><b>${fmtN(c.claims || 0)}</b><small>vou buscar</small></span><span><b>${fmtN(Math.round(Math.min(c.qty, c.proven_units || 0)))}</b><small>em notas</small></span></div>
    <p class="small">Recuperado: <b>${brl(recovered(c))}</b> de ${brl(potential)} possíveis</p>
    <div class="row-actions">
      ${c.status !== 'bloqueada' ? `<button class="btn btn--ghost btn--sm" data-qm-edit="${c.id}">Editar</button>` : ''}
      ${c.live ? `<button class="btn btn--ghost btn--sm" data-qm-st="${c.id}:esgotada">Esgotou</button><button class="btn btn--text btn--sm" data-qm-st="${c.id}:encerrada">Encerrar</button>` : ''}
      ${!c.live && c.status !== 'bloqueada' && new Date(c.expires_on + 'T23:59') > new Date() ? `<button class="btn btn--text btn--sm" data-qm-st="${c.id}:ativa">Reativar</button>` : ''}
    </div></article>`;
}

async function form(c = null) {
  const cats = C.categories() || [];
  const stores = C.stores();
  const catalog = await C.catalog().catch(() => []);
  const x = c || { title: '', regular_price: '', price: '', qty: 20, expires_on: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10), radius_km: 2, store_id: null, category_slug: '', product_id: null, note: '' };
  C.openSheet(`<h2 class="sheet__title" id="ptSheetTitle">${c ? 'Editar queima' : 'Nova queima'}</h2>
    <form class="form" id="qmForm"><input type="hidden" name="id" value="${c?.id || ''}" />
      <label>Produto do seu catálogo (opcional, ajuda a comprovar pela nota)
        <input name="product" list="qmProducts" placeholder="Comece a digitar…" value="${esc(catalog.find((p) => p.product_id === x.product_id)?.name || '')}" autocomplete="off" />
        <datalist id="qmProducts">${catalog.filter((p) => p.active).map((p) => `<option value="${esc(p.name)}">${esc([p.brand, p.unit].filter(Boolean).join(' · '))}</option>`).join('')}</datalist></label>
      <label>Título que aparece no aviso<input name="title" required minlength="3" maxlength="60" value="${esc(x.title)}" placeholder="Iogurte natural 170 g" /></label>
      <div class="form__row">
        <label>Categoria<select name="category_slug" class="input sel"><option value="">Pelo produto</option>${cats.map((k) => `<option value="${esc(k.slug)}" ${k.slug === x.category_slug ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select></label>
        <label>Loja<select name="store_id" class="input sel"><option value="">Todas as lojas</option>${stores.map((s) => `<option value="${s.id}" ${s.id === x.store_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      </div>
      <div class="form__row">
        <label>Preço normal (R$)<input name="regular_price" inputmode="decimal" required value="${x.regular_price === '' ? '' : Number(x.regular_price).toFixed(2).replace('.', ',')}" /></label>
        <label>Preço da queima (R$)<input name="price" inputmode="decimal" required value="${x.price === '' ? '' : Number(x.price).toFixed(2).replace('.', ',')}" /></label>
        <label>Unidades<input name="qty" type="number" min="1" max="100000" value="${x.qty}" style="max-width:110px" /></label>
      </div>
      <p class="small muted" id="qmPct"></p>
      <div class="form__row">
        <label>Vence em<input name="expires_on" type="date" min="${today()}" required value="${esc(String(x.expires_on).slice(0, 10))}" /></label>
        <label>Avisar quem está a até (km)<input name="radius_km" inputmode="decimal" value="${String(x.radius_km).replace('.', ',')}" /></label>
      </div>
      <label>Recado (opcional)<input name="note" maxlength="120" value="${esc(x.note || '')}" placeholder="Gôndola de refrigerados, perto do caixa 3" /></label>
      <p class="form__err" role="alert"></p>
      <button class="btn btn--primary btn--block">${c ? 'Salvar' : 'Colocar no ar'}</button>
    </form>`);
  const f = $('#qmForm');
  const upd = () => { const a = num(f.regular_price.value), b = num(f.price.value); $('#qmPct').textContent = a > 0 && b > 0 && b < a ? `Desconto de ${Math.round((1 - b / a) * 100)}%. Fica no ar até as 21h do dia do vencimento.` : ''; };
  f.addEventListener('input', (e) => {
    if (e.target.name === 'product') { const p = catalog.find((r) => r.name === e.target.value); if (p) { if (!f.title.value) f.title.value = p.name.slice(0, 60); if (!f.regular_price.value) f.regular_price.value = Number(p.price).toFixed(2).replace('.', ','); } }
    upd();
  });
  upd();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = f.querySelector('.form__err'); err.textContent = '';
    const prod = catalog.find((r) => r.name === f.product.value.trim());
    const p = { id: f.id.value ? Number(f.id.value) : null, supermarket_id: C.mid, product_id: prod?.product_id ?? null, title: f.title.value.trim(),
      category_slug: f.category_slug.value || null, store_id: f.store_id.value ? Number(f.store_id.value) : null,
      regular_price: num(f.regular_price.value), price: num(f.price.value), qty: Number(f.qty.value) || 1, expires_on: f.expires_on.value,
      radius_km: Math.min(10, Math.max(0.5, num(f.radius_km.value) || 2)), note: f.note.value.trim() || null };
    if (!(p.regular_price > 0) || !(p.price > 0)) { err.textContent = 'Informe os dois preços.'; return; }
    if (p.price >= p.regular_price) { err.textContent = 'O preço da queima tem que ser menor que o normal.'; return; }
    if (!p.product_id && !p.category_slug) { err.textContent = 'Escolha o produto ou a categoria: é assim que achamos quem acompanha esse tipo de produto.'; return; }
    try { await P.clearanceSave(p); C.closeSheet(); C.toast(p.id ? 'Queima atualizada.' : 'Queima no ar. Os avisos saem para quem está perto e acompanha esse tipo de produto.'); render(C); }
    catch (x) { err.textContent = x.message; }
  });
}

document.addEventListener('click', async (e) => {
  if (!C) return;
  if (e.target.closest('[data-qm="new"]')) { form(); return; }
  const ed = e.target.closest('[data-qm-edit]'); if (ed) { form(list.find((c) => c.id === Number(ed.dataset.qmEdit))); return; }
  const s = e.target.closest('[data-qm-st]'); if (s) {
    const [id, st] = s.dataset.qmSt.split(':');
    try { await P.clearanceStatus(Number(id), st); C.toast(st === 'ativa' ? 'Queima reativada.' : st === 'esgotada' ? 'Marcada como esgotada.' : 'Queima encerrada.'); render(C); }
    catch (x) { C.toast(x.message, 'warn'); }
  }
});
