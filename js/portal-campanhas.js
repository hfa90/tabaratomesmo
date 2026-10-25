// Portal › Campanhas: o supermercado lembra, convence e mostra promoções aos clientes do site.
// Formatos: aviso no celular (como app) · janela na tela · vitrine de produtos nas ofertas.
// Público: todos · quem tem o mercado como preferido · quem está a até X km de uma loja.
// As regras que evitam incômodo ficam no site (js/campanhas.js) e estão explicadas aqui para o mercado.
import * as P from './portal-api.js';
import { $, $$, esc, brl } from './core.js';
import { fmtN } from './viz.js';
import { ic } from './icons.js';

const KINDS = {
  aviso: { name: 'Aviso no celular', sub: 'Chega como notificação de app. Ideal para quem está perto da loja.', icon: 'bell' },
  janela: { name: 'Janela na tela', sub: 'Aparece uma vez, na hora certa, com produtos e um botão.', icon: 'sparkle' },
  vitrine: { name: 'Vitrine de produtos', sub: 'Faixa com seus produtos em promoção no topo das ofertas.', icon: 'tag' },
};
const AUD = { todos: 'Todas as pessoas', preferem: 'Quem tem o mercado como preferido', perto: 'Quem está perto de uma loja' };
const CTA = { ofertas: 'Ver as ofertas', rota: 'Como chegar', produtos: 'Ver os produtos' };
const STATUS = { ativa: ['ok', 'No ar'], pausada: ['soft', 'Pausada'], encerrada: ['soft', 'Encerrada'], bloqueada: ['warn', 'Bloqueada pela equipe'] };
const day = (d) => new Date(d).toISOString().slice(0, 10);
let C = null; // contexto do portal
let draft = null;

const blank = (mid) => ({ supermarket_id: mid, kind: 'janela', title: '', body: '', image_url: '', product_ids: [], cta: 'ofertas', audience: 'todos', radius_km: 2,
  starts_at: day(Date.now()), ends_at: day(Date.now() + 7 * 864e5) });

export async function render(ctx) {
  C = ctx;
  const m = ctx.market();
  ctx.main.innerHTML = `${ctx.banner}
    <header class="pt-head"><div><h1>Campanhas</h1><p class="muted">Lembre, convença e mostre suas promoções para quem usa o site — para todos, para seus clientes fiéis ou para quem está perto da loja.</p></div>
      <button class="btn btn--primary" data-camp="new">${ic('plus')} Nova campanha</button></header>
    <section class="panel camp-rules"><div class="panel__head"><h2>${ic('lock')} Para não incomodar ninguém</h2></div>
      <ul><li>Cada pessoa vê no máximo <b>1 janela por dia</b> (de todos os mercados) e nunca na primeira visita.</li>
      <li>Avisos no celular: no máximo <b>1 por dia</b>, só entre 8h e 21h, e só para quem ativou os avisos. Chegam até com o site fechado.</li>
      <li>Quem fecha uma campanha não a vê de novo por 3 dias; pode também esconder o seu mercado por 7 dias.</li>
      <li>No máximo <b>3 campanhas no ar</b> por mercado ao mesmo tempo.</li></ul></section>
    <div id="campList"><div class="skeleton" style="height:200px"></div></div>
    <section class="panel"><div class="panel__head"><h2>${ic('cart')} Sua loja online</h2></div>
      <p class="small muted">Quando o rancho de alguém sai mais barato no ${esc(m.name)}, o site mostra "Comprar no site do ${esc(m.name)}": copia a lista e abre a sua loja online ou app.</p>
      <form class="form form--inline" id="campShop"><label>Endereço da loja online ou do app<input name="url" type="url" value="${esc(m.shop_url || '')}" placeholder="https://" /></label><button class="btn btn--ghost">Salvar</button></form></section>`;
  let list;
  try { list = await P.campaigns(ctx.mid); }
  catch (e) { $('#campList').innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
  $('#campList').innerHTML = list.length ? `<div class="camp-cards">${list.map(card).join('')}</div>`
    : `<section class="panel camp-empty"><span>${ic('sparkle')}</span><b>Nenhuma campanha ainda</b><p class="muted small">Crie a primeira: por exemplo, um aviso para quem estiver a 2 km de uma loja do ${esc(m.name)} com a promoção da semana.</p><button class="btn btn--primary" data-camp="new">Criar campanha</button></section>`;
}

function card(c) {
  const [cls, lbl] = STATUS[c.status] || STATUS.encerrada;
  const ended = new Date(c.ends_at) < new Date();
  const ctr = c.views ? Math.round((c.clicks / c.views) * 1000) / 10 : 0;
  return `<article class="panel camp-card">
    <div class="camp-card__h"><span class="camp-k">${ic(KINDS[c.kind]?.icon || 'sparkle')} ${KINDS[c.kind]?.name || c.kind}</span>
      <span class="pill pill--${ended && c.status === 'ativa' ? 'soft' : cls}">${ended && c.status === 'ativa' ? 'Terminou' : lbl}</span></div>
    <h3>${esc(c.title)}</h3>${c.body ? `<p class="muted small">${esc(c.body)}</p>` : ''}
    <p class="camp-meta">${ic('users')} ${AUD[c.audience]}${c.audience === 'perto' ? ` (${String(c.radius_km).replace('.', ',')} km)` : ''} · ${new Date(c.starts_at).toLocaleDateString('pt-BR')} a ${new Date(c.ends_at).toLocaleDateString('pt-BR')}</p>
    <div class="camp-stats"><span><b>${fmtN(c.views || 0)}</b><small>vezes vista</small></span><span><b>${fmtN(c.people || 0)}</b><small>pessoas</small></span>
      <span><b>${fmtN(c.clicks || 0)}</b><small>toques (${String(ctr).replace('.', ',')}%)</small></span>${c.kind === 'aviso' ? `<span><b>${fmtN(c.notified || 0)}</b><small>avisos enviados</small></span>` : ''}</div>
    <div class="row-actions">
      ${c.status === 'bloqueada' ? '' : `<button class="btn btn--ghost btn--sm" data-camp-edit="${c.id}">Editar</button>`}
      ${c.status === 'ativa' && !ended ? `<button class="btn btn--ghost btn--sm" data-camp-st="${c.id}:pausada">Pausar</button>` : ''}
      ${c.status === 'pausada' && !ended ? `<button class="btn btn--ghost btn--sm" data-camp-st="${c.id}:ativa">Voltar ao ar</button>` : ''}
      ${['ativa', 'pausada'].includes(c.status) ? `<button class="btn btn--text btn--sm" data-camp-st="${c.id}:encerrada">Encerrar</button>` : ''}
      <button class="btn btn--text btn--sm" data-camp-dup="${c.id}">Duplicar</button></div>
  </article>`;
}

// ---------------------------------------------------------------- formulário com prévia ao vivo
async function form(c) {
  draft = { ...blank(C.mid), ...c, starts_at: day(c?.starts_at || Date.now()), ends_at: day(c?.ends_at || Date.now() + 7 * 864e5) };
  const cat = (await C.catalog()) || [];
  const prods = cat.filter((r) => r.active).sort((a, b) => (b.promo_price ? 1 : 0) - (a.promo_price ? 1 : 0) || a.name.localeCompare(b.name));
  C.openSheet(`<form class="form camp-form" id="campForm" novalidate>
    <h2 class="sheet__title" id="ptSheetTitle">${draft.id ? 'Editar campanha' : 'Nova campanha'}</h2>
    <div class="camp-grid">
      <div class="camp-fields">
        <fieldset><legend>Formato</legend><div class="camp-kinds">${Object.entries(KINDS).map(([k, v]) => `<label class="camp-kind"><input type="radio" name="kind" value="${k}" ${draft.kind === k ? 'checked' : ''} /><span>${ic(v.icon)}<b>${v.name}</b><small>${v.sub}</small></span></label>`).join('')}</div></fieldset>
        <label>Título<input name="title" maxlength="70" required value="${esc(draft.title)}" placeholder="Ex.: Semana da carne no ${esc(C.market().name)}" /></label>
        <label>Mensagem <small class="muted">(opcional)</small><textarea name="body" maxlength="180" rows="2" placeholder="Ex.: Picanha, frango e linguiça com até 20% off até domingo.">${esc(draft.body || '')}</textarea></label>
        <fieldset><legend>Produtos em destaque <small class="muted">(até 6; os com promoção aparecem primeiro)</small></legend>
          <input type="search" class="camp-q" id="campQ" placeholder="Buscar produto" />
          <div class="camp-prods" id="campProds">${prods.slice(0, 80).map((r) => `<label class="camp-prod" data-name="${esc((r.name + ' ' + (r.brand || '')).toLowerCase())}"><input type="checkbox" name="prod" value="${r.product_id}" ${draft.product_ids.includes(r.product_id) ? 'checked' : ''} />
            <span><b>${esc(r.name)}</b><small>${esc([r.brand, r.unit].filter(Boolean).join(' · '))} · ${r.promo_price ? `<em>${brl(Number(r.promo_price))}</em> <s>${brl(r.price)}</s>` : brl(r.price)}</small></span></label>`).join('')}</div></fieldset>
        <label>Imagem <small class="muted">(opcional; foto do encarte ou da loja)</small><input type="file" accept="image/*" id="campImg" /></label>
        <label>Botão<select name="cta">${Object.entries(CTA).map(([k, v]) => `<option value="${k}" ${draft.cta === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <fieldset><legend>Quem vê</legend><div class="camp-aud">${Object.entries(AUD).map(([k, v]) => `<label class="radio-row"><input type="radio" name="audience" value="${k}" ${draft.audience === k ? 'checked' : ''} /> ${v}</label>`).join('')}</div>
          <label class="camp-radius" ${draft.audience === 'perto' ? '' : 'hidden'}>Distância da loja: <b id="campR">${String(draft.radius_km).replace('.', ',')} km</b><input type="range" name="radius_km" min="0.5" max="10" step="0.5" value="${draft.radius_km}" /></label></fieldset>
        <div class="row2"><label>Começa<input type="date" name="starts_at" value="${draft.starts_at}" /></label><label>Termina<input type="date" name="ends_at" value="${draft.ends_at}" /></label></div>
        <p class="form__err" role="alert" id="campErr"></p>
        <div class="row-actions"><button class="btn btn--primary">${draft.id ? 'Salvar' : 'Pôr no ar'}</button><button class="btn btn--ghost" type="button" data-close>Cancelar</button></div>
      </div>
      <div class="camp-prev"><p class="muted small center">Como as pessoas vão ver</p><div class="phone" id="campPrev"></div></div>
    </div></form>`);
  C.prods = prods;
  preview();
}

function readForm() {
  const f = $('#campForm'); if (!f) return;
  draft.kind = f.kind.value; draft.title = f.title.value; draft.body = f.body.value; draft.cta = f.cta.value;
  draft.audience = f.audience.value; draft.radius_km = Number(f.radius_km.value);
  draft.starts_at = f.starts_at.value; draft.ends_at = f.ends_at.value;
  draft.product_ids = $$('input[name=prod]:checked', f).map((x) => Number(x.value)).slice(0, 6);
}

function preview() {
  const el = $('#campPrev'); if (!el) return;
  const m = C.market(); const ps = draft.product_ids.map((id) => C.prods.find((r) => r.product_id === id)).filter(Boolean);
  const title = esc(draft.title || 'Título da campanha'); const body = esc(draft.body || '');
  const chips = ps.slice(0, 3).map((r) => `<span class="pv-p"><b>${esc(r.name)}</b><em>${brl(Number(r.promo_price || r.price))}</em></span>`).join('');
  const img = draft.image_url ? `<img src="${esc(draft.image_url)}" alt="" />` : '';
  el.innerHTML = draft.kind === 'aviso'
    ? `<div class="pv-lock"><span class="pv-time">${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
        <div class="pv-notif"><span class="pv-app">${ic('tag')}</span><div><small>Tá Barato Mesmo? · agora</small><b>${title}</b><p>${body || `No ${esc(m.name)} perto de você.`}</p></div></div></div>`
    : draft.kind === 'janela'
      ? `<div class="pv-screen"><div class="pv-dim"></div><div class="pv-pop">${img}<small class="pv-mk">${esc(m.name)}</small><b>${title}</b>${body ? `<p>${body}</p>` : ''}${chips ? `<div class="pv-ps">${chips}</div>` : ''}<span class="pv-btn">${CTA[draft.cta]}</span><span class="pv-x">Agora não</span></div></div>`
      : `<div class="pv-screen pv-screen--light"><div class="pv-vit"><small>Vitrine · ${esc(m.name)}</small><b>${title}</b><div class="pv-row">${(ps.length ? ps : [{ name: 'Produto', price: 9.9 }, { name: 'Produto', price: 4.5 }]).slice(0, 4).map((r) => `<span class="pv-card"><i></i><b>${esc(r.name)}</b><em>${brl(Number(r.promo_price || r.price))}</em></span>`).join('')}</div></div><div class="pv-skel"></div><div class="pv-skel"></div></div>`;
}

// ---------------------------------------------------------------- eventos
document.addEventListener('click', async (e) => {
  if (!C) return;
  const t = e.target.closest('[data-camp], [data-camp-edit], [data-camp-st], [data-camp-dup]'); if (!t) return;
  const d = t.dataset;
  if (d.camp === 'new') return form(null);
  const list = await P.campaigns(C.mid).catch(() => []);
  if (d.campEdit) return form(list.find((x) => x.id === Number(d.campEdit)));
  if (d.campDup) { const x = list.find((y) => y.id === Number(d.campDup)); if (x) { const { id, status, views, clicks, notified, people, created_at, ...rest } = x; return form({ ...rest, title: `${x.title} (cópia)` }); } }
  if (d.campSt) {
    const [id, s] = d.campSt.split(':');
    try { await P.campaignStatus(Number(id), s); C.toast({ pausada: 'Campanha pausada.', ativa: 'Campanha de volta ao ar.', encerrada: 'Campanha encerrada.' }[s]); render(C); }
    catch (err) { C.toast(err.message, 'warn'); }
  }
});
document.addEventListener('input', (e) => {
  if (!e.target.closest?.('#campForm')) return;
  if (e.target.id === 'campQ') { const q = e.target.value.toLowerCase().trim(); $$('.camp-prod').forEach((l) => { l.hidden = q && !l.dataset.name.includes(q); }); return; }
  readForm();
  const r = $('.camp-radius'); if (r) r.hidden = draft.audience !== 'perto';
  const rv = $('#campR'); if (rv) rv.textContent = `${String(draft.radius_km).replace('.', ',')} km`;
  if (e.target.name === 'prod' && $$('input[name=prod]:checked').length > 6) { e.target.checked = false; C.toast('No máximo 6 produtos por campanha.'); }
  preview();
});
document.addEventListener('change', async (e) => {
  if (e.target.id === 'campImg' && e.target.files[0]) {
    try { draft.image_url = await P.uploadPhoto(C.mid, e.target.files[0], 'campanha'); preview(); }
    catch (err) { C.toast(`Não deu para enviar a imagem: ${err.message}`, 'warn'); }
  } else if (e.target.closest?.('#campForm')) { readForm(); preview(); }
});
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'campForm') return;
  e.preventDefault(); readForm();
  const err = $('#campErr');
  if (draft.title.trim().length < 3) { err.textContent = 'Escreva um título com pelo menos 3 letras.'; return; }
  if (draft.ends_at < draft.starts_at) { err.textContent = 'A data de fim precisa ser depois do começo.'; return; }
  if (draft.kind === 'vitrine' && !draft.product_ids.length) { err.textContent = 'A vitrine precisa de pelo menos 1 produto.'; return; }
  const btn = e.target.querySelector('button.btn--primary'); btn.disabled = true;
  try {
    await P.saveCampaign({ ...draft, starts_at: new Date(draft.starts_at + 'T00:00').toISOString(), ends_at: new Date(draft.ends_at + 'T23:59').toISOString() });
    C.closeSheet(); C.toast(draft.id ? 'Campanha salva.' : 'Campanha no ar!'); render(C);
  } catch (x) { err.textContent = x.message; btn.disabled = false; }
});

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'campShop' || !C) return;
  e.preventDefault();
  const v = e.target.url.value.trim();
  if (v && !/^https:\/\//.test(v)) { C.toast('O endereço precisa começar com https://', 'warn'); return; }
  try { await P.setShopUrl(C.mid, v || null); const m = C.market(); if (m) m.shop_url = v || null; C.toast(v ? 'Loja online salva.' : 'Link retirado.'); }
  catch (err) { C.toast(err.message, 'warn'); }
});
