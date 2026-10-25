// Portal › Datas especiais: a administração liga a data (Black Friday, Natal…); aqui o supermercado
// escolhe os produtos que aparecem na página temática e, se quiser, um preço especial.
import * as P from './portal-api.js';
import { $, $$, esc, brl } from './core.js';
import { ic } from './icons.js';
import { THEMES } from './temas.js';

let C = null; let sel = new Map(); let cur = null;

export async function render(ctx) {
  C = ctx;
  ctx.main.innerHTML = `${ctx.banner}<header class="pt-head"><div><h1>Datas especiais</h1>
    <p class="muted">Quando a equipe do Tá Barato Mesmo? liga uma data (Black Friday, Natal, Dia das Mães…), o site ganha uma página temática em 3D e um banner na página inicial. Escolha aqui os produtos do ${esc(ctx.market().name)} que vão aparecer nela.</p></div></header>
    <div id="evList"><div class="skeleton" style="height:200px"></div></div>`;
  let list;
  try { list = await P.marketEvents(ctx.mid); } catch (e) { $('#evList').innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
  if (!list.length) { $('#evList').innerHTML = `<section class="panel camp-empty"><span>${ic('calendar')}</span><b>Nenhuma data especial ligada agora</b><p class="muted small">A equipe avisa quando ligar a próxima. Assim que ligar, ela aparece aqui para você escolher os produtos.</p></section>`; return; }
  const now = Date.now();
  $('#evList').innerHTML = `<div class="ev-list">${list.map((e) => { const t = THEMES[e.theme] || THEMES.blackfriday; const live = new Date(e.starts_at) <= now;
    return `<article class="panel ev-card" style="--t-bg1:${t.c.bg1};--t-bg2:${t.c.bg2};--t-acc:${t.c.acc};--t-acc2:${t.c.acc2}">
      <div class="ev-card__top"><span class="esp-emb esp-emb--${t.object} ev-emb"><span></span></span><div><small>${t.name}</small><b>${esc(e.title)}</b></div>
        <span class="pill ${live ? 'pill--ok' : 'pill--promo'}">${live ? 'No ar' : 'Começa ' + new Date(e.starts_at).toLocaleDateString('pt-BR')}</span></div>
      <p class="muted small">Até ${new Date(e.ends_at).toLocaleDateString('pt-BR')} · <b>${e.items.length}</b> ${e.items.length === 1 ? 'produto seu escolhido' : 'produtos seus escolhidos'} (até 24)</p>
      <div class="row-actions"><button class="btn btn--primary btn--sm" data-evp="${esc(e.slug)}">${e.items.length ? 'Mudar produtos' : 'Escolher produtos'}</button>
        <a class="btn btn--ghost btn--sm" href="index.html#especial?tema=${e.theme}&previa=1" target="_blank" rel="noopener">Ver como fica</a></div></article>`; }).join('')}</div>`;
  C.events = list;
}

async function picker(slug) {
  cur = C.events.find((e) => e.slug === slug); if (!cur) return;
  sel = new Map(cur.items.map((x) => [x.product_id, x.special_price]));
  const cat = ((await C.catalog()) || []).filter((r) => r.active).sort((a, b) => (sel.has(b.product_id) ? 1 : 0) - (sel.has(a.product_id) ? 1 : 0) || (b.promo_price ? 1 : 0) - (a.promo_price ? 1 : 0) || a.name.localeCompare(b.name));
  const t = THEMES[cur.theme] || THEMES.blackfriday;
  C.openSheet(`<form class="form" id="evpForm"><h2 class="sheet__title" id="ptSheetTitle">${esc(t.name)}: seus produtos</h2>
    <p class="muted small">Marque até 24 produtos. O preço especial é opcional: sem ele, a página mostra o seu preço atual.</p>
    <input type="search" class="camp-q" id="evpQ" placeholder="Buscar produto" />
    <p class="small"><b id="evpN">${sel.size}</b> de 24 escolhidos</p>
    <div class="evp-list">${cat.map((r) => `<label class="evp-row" data-name="${esc((r.name + ' ' + (r.brand || '')).toLowerCase())}">
      <input type="checkbox" value="${r.product_id}" ${sel.has(r.product_id) ? 'checked' : ''} />
      <span class="evp-row__t"><b>${esc(r.name)}</b><small>${esc([r.brand, r.unit].filter(Boolean).join(' · '))} · hoje ${brl(Number(r.promo_price || r.price))}</small></span>
      <span class="evp-row__p">R$ <input inputmode="decimal" placeholder="especial" value="${sel.get(r.product_id) != null ? String(sel.get(r.product_id)).replace('.', ',') : ''}" data-evp-price="${r.product_id}" aria-label="Preço especial de ${esc(r.name)}" /></span></label>`).join('')}</div>
    <p class="form__err" role="alert"></p>
    <div class="row-actions"><button class="btn btn--primary">Salvar produtos</button><button class="btn btn--ghost" type="button" data-close>Cancelar</button></div></form>`);
}

document.addEventListener('click', (e) => { const b = e.target.closest('[data-evp]'); if (b && C) picker(b.dataset.evp); });
document.addEventListener('input', (e) => {
  if (e.target.id === 'evpQ') { const q = e.target.value.toLowerCase().trim(); $$('.evp-row').forEach((l) => { l.hidden = q && !l.dataset.name.includes(q); }); }
});
document.addEventListener('change', (e) => {
  if (!e.target.closest?.('#evpForm') || e.target.type !== 'checkbox') return;
  const n = $$('#evpForm input[type=checkbox]:checked').length;
  if (n > 24) { e.target.checked = false; C.toast('No máximo 24 produtos por data especial.'); }
  $('#evpN').textContent = Math.min(n, 24);
});
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'evpForm') return;
  e.preventDefault();
  const items = $$('#evpForm input[type=checkbox]:checked').map((x) => {
    const pid = Number(x.value); const raw = $(`[data-evp-price="${pid}"]`)?.value.trim().replace(/\./g, '').replace(',', '.');
    const v = parseFloat(raw); return { product_id: pid, special_price: v > 0 ? Math.round(v * 100) / 100 : null };
  });
  try { await P.setEventProducts(cur.slug, C.mid, items); C.closeSheet(); C.toast(`${items.length} ${items.length === 1 ? 'produto salvo' : 'produtos salvos'} na página especial.`); render(C); }
  catch (err) { e.target.querySelector('.form__err').textContent = err.message; }
});
