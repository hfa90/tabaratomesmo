// Carrinho: a compra de agora, dentro da loja. A pessoa fala o item ("Nescau 370 gramas 9 e 49"),
// o site anota, soma, compara com o orçamento e confere o preço com o do site.
import * as api from './api.js';
import { S, $, $$, esc, brl, logo, hooks, haversine, isOn, media } from './core.js';
import { parse, match, verdict, promoEffective } from './voice.js';
import { track } from './track.js';
import * as ads from './ads.js';

const KEY = 'tb.cart';
const st = () => (S.cart ||= api.store.get(KEY, null) || { market: null, budget: null, items: [], startedAt: null });
const save = () => { api.store.set(KEY, S.cart); badge(); };
const total = () => st().items.reduce((s, i) => s + (i.price || 0) * i.qty, 0);
const uid = () => Math.random().toString(36).slice(2, 9);
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false, lastAdded = null;

export function badge() {
  const n = (S.cart || api.store.get(KEY, null))?.items?.length || 0;
  $$('[data-cart-count]').forEach((b) => { b.hidden = !n; b.textContent = n; });
}

/** mercado em que a pessoa está: GPS dentro de uma loja, ou o escolhido, ou o mais perto */
function currentMarket() {
  const c = st();
  if (c.market && S.markets.has(c.market)) return c.market;
  if (S.pos?.gps) {
    for (const s of S.stores) if (haversine(S.pos, s) <= 0.35) { c.market = s.supermarket_id; save(); return c.market; }
  }
  const near = [...S.nearest.entries()].filter(([id]) => isOn(id)).sort((a, b) => a[1].km - b[1].km)[0];
  return near?.[0] ?? [...S.markets.keys()][0];
}

// ---------------------------------------------------------------- render
export function render() {
  const el = $('#cartView'); if (!el) return;
  const c = st(); const mid = currentMarket(); const m = S.markets.get(mid);
  const t = total(); const b = c.budget;
  const pct = b ? Math.min(t / b, 1.2) : 0;
  const state = !b ? '' : t > b ? 'is-over' : t > b * 0.9 ? 'is-near' : '';
  el.innerHTML = `
    <div class="ck">
      <header class="ck-head">
        <div><h1>Carrinho</h1><p class="muted small">O que você está pegando agora, com o preço da etiqueta.</p></div>
        <button class="ck-market" data-ck="market" aria-label="Trocar o mercado">${m ? logo(m, 'sm') : ''}<span><small>Você está no</small><b>${esc(m?.name || 'mercado')}</b></span><em>Trocar</em></button>
      </header>

      <section class="ck-total ${state}" aria-live="polite">
        <div class="ck-total__row">
          <div><span class="ck-total__k">Total no carrinho</span><b class="ck-total__v">${brl(t)}</b>
            <small>${c.items.length} ${c.items.length === 1 ? 'item' : 'itens'}${c.items.reduce((s, i) => s + i.qty, 0) > c.items.length ? `, ${c.items.reduce((s, i) => s + i.qty, 0)} unidades` : ''}</small></div>
          <div class="ck-budget">${b ? `<span class="ck-total__k">Orçamento</span><b>${brl(b)}</b><small>${t > b ? `passou ${brl(t - b)}` : `faltam ${brl(b - t)}`}</small>` : ''}
            <button class="linkish small" data-ck="budget">${b ? 'Alterar' : 'Definir orçamento'}</button></div>
        </div>
        ${b ? `<div class="ck-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${b}" aria-valuenow="${t.toFixed(2)}"><span style="--w:${Math.min(pct, 1) * 100}%"></span></div>
          ${t > b ? '<p class="ck-alert">Você passou do orçamento. Tire algo do carrinho ou ajuste o valor.</p>' : t > b * 0.9 ? '<p class="ck-alert ck-alert--soft">Quase no limite do orçamento.</p>' : ''}` : ''}
      </section>

      <section class="ck-voice">
        ${SR ? `<button class="ck-mic ${listening ? 'is-on' : ''}" data-ck="mic" aria-pressed="${listening}">
            <span class="ck-mic__b">${MIC}</span>
            <span><b>${listening ? 'Ouvindo… fale o item' : 'Toque e fale o item'}</b><small>Ex.: “Nescau 370 gramas 9 e 49”</small></span>
          </button>` : '<p class="note small">Seu navegador não reconhece fala. Digite como você falaria, por exemplo “arroz 5 quilos 25,75”.</p>'}
        <div class="ck-tools">
          <button class="ck-tool ck-tool--scan" data-tool="scan"><span aria-hidden="true">📷</span><b>Ler código</b></button>
          <button class="ck-tool" data-tool="promo"><span aria-hidden="true">🏷️</span><b>Promoção vale?</b></button>
          <button class="ck-tool" data-tool="tamanho"><span aria-hidden="true">⚖️</span><b>Qual compensa?</b></button>
        </div>
        <div class="ck-heard" id="ckHeard" ${listening ? '' : 'hidden'}></div>
        <form class="ck-type" id="ckType" autocomplete="off">
          <input name="q" placeholder="ou digite: leite 1 litro 5,49" enterkeyhint="done" aria-label="Digite o item com o preço" />
          <button class="btn btn--ghost btn--sm">Adicionar</button>
        </form>
      </section>

      ${c.items.length ? `<ul class="ck-list">${c.items.map(row).join('')}</ul>
        <div class="row-actions ck-actions">
          <button class="btn btn--ghost btn--sm" data-ck="compare">Comparar com outros mercados</button>
          <a class="btn btn--ghost btn--sm" href="#fila">Estou na fila do caixa</a>
          <button class="btn btn--ghost btn--sm" data-cupom="open">🧾 Conferir a nota</button>
          <button class="btn btn--primary btn--sm" data-ck="finish">Finalizar compra</button>
          <button class="btn btn--text btn--sm" data-ck="clear">Esvaziar</button>
        </div>`
      : `<div class="rx-empty"><span class="big" aria-hidden="true">🛒</span><b>Seu carrinho está vazio</b><p class="muted small">Toque no microfone e fale o nome, o tamanho e o preço da etiqueta. A gente soma e confere com o site.</p></div>`}
      <div id="adCarrinho"></div>
    </div>`;
  ads.render('carrinho', $('#adCarrinho'));
}

const MIC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const STATUS = {
  confere: ['ok', '✓', 'Confere com o site'], diferente: ['warn', '!', 'Diferente do site'], sem_preco: ['soft', '?', 'Sem preço no site'],
  tamanho: ['soft', '?', 'Tamanho novo'], novo: ['soft', '+', 'Produto novo'], manual: ['soft', '', ''], sem_valor: ['soft', '', 'Preço do site'],
};
function row(i) {
  const [cls, ic, tip] = STATUS[i.status] || STATUS.manual;
  const p = i.product_id ? S.products.find((x) => x.id === i.product_id) : null;
  return `<li class="ck-item" data-ci="${i.id}">
    ${p ? media(p, 'rx-media') : '<span class="rx-media" aria-hidden="true">🛒</span>'}
    <div class="rx-txt"><span class="rx-name">${esc(i.name)}</span>
      <span class="rx-meta">${ic ? `<span class="ck-st ck-st--${cls}" title="${tip}">${ic} ${tip}</span>` : ''}${i.site_price != null && i.status === 'diferente' ? ` <span>site: ${brl(i.site_price)}</span>` : ''}${i.photo ? ' <span>· foto enviada</span>' : ''}${i.promo ? ` <span class="pill pill--promo">🏷️ ${esc(i.promo)}</span>` : ''}</span></div>
    <label class="price-in ck-price"><span>R$</span><input inputmode="decimal" value="${i.price != null ? i.price.toFixed(2).replace('.', ',') : ''}" placeholder="0,00" data-ck-price="${i.id}" aria-label="Preço de ${esc(i.name)}" /></label>
    <span class="stepper"><button data-ck-dec="${i.id}" aria-label="Menos">−</button><output>${i.qty}</output><button data-ck-inc="${i.id}" aria-label="Mais">+</button></span>
    <b class="rx-sub">${brl((i.price || 0) * i.qty)}</b>
  </li>`;
}

// ---------------------------------------------------------------- adicionar item
function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

/** escolhe a melhor leitura entre as alternativas do reconhecedor e adiciona */
export function addFromSpeech(alternatives, source = 'voz') {
  const mid = currentMarket();
  const options = alternatives.filter(Boolean).map((text) => {
    const p = parse(text); const best = match(p, S.products)[0] || null;
    const score = (p.price != null ? 1 : 0) + (best ? best.id : 0) + (p.name ? 0.2 : 0);
    return { text, p, best, score };
  }).sort((a, b) => b.score - a.score);
  const o = options[0];
  if (!o || (!o.p.name && !o.best)) { hooks.toast?.('Não entendi o item. Fale o nome e o preço, por exemplo “leite 1 litro 5 e 49”.', 'warn'); return; }
  const v = verdict(o.p, o.best, mid);
  const known = o.best && o.best.id >= 0.6 && o.best.sizeOk !== false;
  const item = {
    id: uid(), spoken: o.text, qty: o.p.qty,
    name: known ? `${o.best.p.name}${o.best.p.brand && o.best.p.brand !== 'Granel' ? ' ' + o.best.p.brand : ''} ${o.best.p.unit || ''}`.trim()
      : `${capitalize(o.p.name || 'Item')}${o.p.size ? ' ' + o.p.size.label : ''}`,
    product_id: known ? o.best.p.id : null, guess_id: o.best && o.best.id >= 0.6 ? o.best.p.id : null,
    price: o.p.price ?? (v.site ?? null), status: o.p.price == null && v.site != null ? 'sem_valor' : v.kind,
    site_price: v.site ?? null, size: o.p.size?.label || null, at: new Date().toISOString(),
  };
  // promoção falada ("leve 3 pague 2"): guarda a quantidade e o preço de cada um já com o desconto
  const pe = o.p.promo && item.price != null ? promoEffective(o.p.promo, item.price) : null;
  if (pe) { item.qty = pe.qty; item.price = pe.unit; item.promo = o.p.promo.label; item.status = 'manual'; }
  const c = st(); c.startedAt ||= item.at; c.items.unshift(item); save(); lastAdded = item.id;
  track('cart_item', { product_id: item.product_id, market_id: mid, value: item.price });
  render();
  if (pe) { flash(item.id); hooks.toast?.(`🏷️ ${item.promo}: cada um sai ${brl(pe.unit)}. Você economiza ${brl(pe.save)}.`); return; }
  flash(item.id);
  if (item.price == null) return askPrice(item);
  if (['diferente', 'sem_preco', 'tamanho', 'novo'].includes(item.status)) return askPhoto(item, v);
  hooks.toast?.(item.status === 'confere' ? `✓ ${item.name}: ${brl(item.price)}, confere com o site.` : `${item.name}: ${brl(item.price)} adicionado.`);
}

/** adiciona um produto conhecido (do leitor de código de barras ou da calculadora de promoção) */
export function addProduct(p, { price = null, qty = 1, note = '' } = {}) {
  const mid = currentMarket();
  const x = p.prices?.find((y) => y.market_id === mid);
  const site = x?.price ?? null;
  const value = price ?? site;
  const item = {
    id: uid(), spoken: note || p.name, qty,
    name: `${p.name}${p.brand && p.brand !== 'Granel' ? ' ' + p.brand : ''} ${p.unit || ''}`.trim(),
    product_id: p.id, guess_id: p.id, price: value,
    status: price == null ? (site != null ? 'sem_valor' : 'sem_preco') : note ? 'manual' : site == null ? 'sem_preco' : Math.abs(price - site) <= 0.01 ? 'confere' : note ? 'manual' : 'diferente',
    site_price: site, size: p.unit || null, at: new Date().toISOString(), promo: note || null,
  };
  const c = st(); c.startedAt ||= item.at; c.items.unshift(item); save(); lastAdded = item.id;
  track('cart_item', { product_id: p.id, market_id: mid, value: item.price });
  if (location.hash === '#carrinho') { render(); flash(item.id); }
  if (item.price == null) { askPrice(item); return item; }
  hooks.toast?.(`🛒 ${item.name}: ${brl(item.price)}${qty > 1 ? ` × ${qty}` : ''} no carrinho.`);
  return item;
}

/** item sem cadastro no site (nome livre), por exemplo vindo da calculadora de promoção */
export function addCustom({ name, price, qty = 1, note = '' }) {
  const item = { id: uid(), spoken: name, qty, name, product_id: null, guess_id: null, price, status: 'manual', site_price: null, size: null, at: new Date().toISOString(), promo: note || null };
  const c = st(); c.startedAt ||= item.at; c.items.unshift(item); save();
  if (location.hash === '#carrinho') { render(); flash(item.id); }
  hooks.toast?.(`🛒 ${name}: ${brl(price)}${qty > 1 ? ` × ${qty}` : ''} no carrinho.`);
  return item;
}

function flash(id) {
  const li = $(`[data-ci="${id}"]`); if (!li) return;
  li.classList.add('is-new'); setTimeout(() => li.classList.remove('is-new'), 1600);
}

// ---------------------------------------------------------------- popups
function sheet(html) { $('#cartSheetBody').innerHTML = html; hooks.openSheet('#cartSheet'); }

function askPrice(item) {
  sheet(`<h2 class="sheet__title" id="cartSheetTitle">Qual o preço?</h2>
    <p class="muted small">Entendi “${esc(item.spoken)}”, mas não ouvi o valor.</p>
    <form class="form" id="ckPriceForm" data-id="${item.id}"><label>${esc(item.name)}<input name="price" inputmode="decimal" placeholder="0,00" required /></label>
    <button class="btn btn--primary btn--block">Salvar</button></form>`);
}

function askPhoto(item, v) {
  const m = S.markets.get(currentMarket());
  const titles = { diferente: 'O preço está diferente do site', sem_preco: 'Ainda não temos esse preço', tamanho: 'Esse tamanho é novo para nós', novo: 'Esse produto ainda não está no site' };
  sheet(`<h2 class="sheet__title" id="cartSheetTitle">${titles[item.status]}</h2>
    <div class="ck-cmp">
      <div><small>Você falou</small><b>${brl(item.price)}</b><span>${esc(item.name)}</span></div>
      ${item.site_price != null ? `<div><small>No site (${esc(m?.name || '')})</small><b>${brl(item.site_price)}</b><span>${item.price > item.site_price ? `+${brl(item.price - item.site_price)}` : `−${brl(item.site_price - item.price)}`}</span></div>` : ''}
    </div>
    <p class="small">${v.text} Tire uma foto da etiqueta com o preço para conferirmos. Se estiver certo, o preço entra no site e ajuda todo mundo${S.user ? '' : ' (precisa estar com a conta aberta)'}.</p>
    <label class="btn btn--primary btn--block ck-cam"><input type="file" accept="image/*" capture="environment" data-ck-photo="${item.id}" hidden />📷 Tirar foto da etiqueta</label>
    <button class="btn btn--text btn--block" data-close>Agora não</button>
    <p class="muted small center">O item já está no seu carrinho com ${brl(item.price)}.</p>`);
}

function compress(file, max = 1280, q = 0.8) {
  return new Promise((res, rej) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const cv = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
      cv.toBlob((b) => (b ? res(b) : rej(new Error('Não foi possível ler a foto.'))), 'image/webp', q);
    };
    img.onerror = () => rej(new Error('Arquivo de imagem inválido.'));
    img.src = url;
  });
}

async function sendPhoto(id, file) {
  const item = st().items.find((i) => i.id === id); if (!item) return;
  if (!S.user && api.MODE !== 'demo') { hooks.closeSheet('#cartSheet'); return hooks.openAuth('signup', 'Crie sua conta para enviar a foto da etiqueta. Seu carrinho continua salvo.'); }
  $('#cartSheetBody').innerHTML = '<div class="skeleton" style="height:160px"></div><p class="center small muted">Enviando a foto…</p>';
  try {
    const blob = await compress(file);
    const sent = await api.sendShelfPhoto(blob, { supermarket_id: currentMarket(), product_id: item.product_id || item.guess_id || null, spoken: item.spoken, name: item.name,
      size: item.size, price: item.price, site_price: item.site_price, lat: S.pos?.gps ? S.pos.lat : null, lng: S.pos?.gps ? S.pos.lng : null });
    item.photo = true; save(); render();
    if (sent?.queued) { $('#cartSheetBody').innerHTML = `<div class="fx-done"><p class="fx-done__pts">📴</p><h2 class="sheet__title">Foto guardada</h2><p>Você está sem internet. A foto fica no celular e é enviada sozinha quando o sinal voltar.</p><button class="btn btn--primary btn--block" data-close>Voltar ao carrinho</button></div>`; return; }
    $('#cartSheetBody').innerHTML = `<div class="fx-done"><p class="fx-done__pts">✓</p><h2 class="sheet__title">Foto enviada</h2><p>A equipe confere a etiqueta e, se estiver certo, o preço entra no site. Obrigado!</p><button class="btn btn--primary btn--block" data-close>Voltar ao carrinho</button></div>`;
  } catch (e) {
    $('#cartSheetBody').innerHTML = `<p class="note">${esc(e.message)}</p><button class="btn btn--ghost btn--block" data-close style="margin-top:12px">Fechar</button>`;
  }
}

function compareSheet() {
  const c = st(); const mid = currentMarket();
  const rows = [...S.markets.values()].filter((m) => isOn(m.id)).map((m) => {
    let sum = 0, have = 0, miss = 0;
    for (const i of c.items) {
      const p = i.product_id && S.products.find((x) => x.id === i.product_id);
      const x = p?.prices.find((y) => y.market_id === m.id);
      if (m.id === mid) { sum += (i.price || 0) * i.qty; have++; continue; }
      if (x) { sum += x.price * i.qty; have++; } else { sum += (i.price || 0) * i.qty; miss++; }
    }
    return { m, sum, have, miss };
  }).sort((a, b) => a.sum - b.sum);
  const here = rows.find((r) => r.m.id === mid);
  sheet(`<h2 class="sheet__title" id="cartSheetTitle">Este carrinho em outros mercados</h2>
    <p class="muted small">Itens que não estão no site contam pelo preço que você falou.</p>
    <ol class="rank-list" style="margin-top:12px">${rows.map((r, i) => `<li class="${i === 0 ? 'is-best' : ''}">${logo(r.m, 'xs')}<b>${esc(r.m.name)}${r.m.id === mid ? ' (aqui)' : ''}</b><span class="v">${brl(r.sum)}</span>
      <small style="grid-column:2/-1">${r.m.id === mid ? 'preços que você anotou' : r.sum < here.sum ? `${brl(here.sum - r.sum)} a menos` : r.sum > here.sum ? `${brl(r.sum - here.sum)} a mais` : 'igual'}${r.miss ? ` · ${r.miss} sem preço lá` : ''}</small></li>`).join('')}</ol>`);
}

function marketSheet() {
  const mid = currentMarket();
  sheet(`<h2 class="sheet__title" id="cartSheetTitle">Em qual mercado você está?</h2>
    <ul class="mk-list">${[...S.markets.values()].map((m) => `<li><button class="mk-row" data-ck-market="${m.id}" style="width:100%;text-align:left">${logo(m, 'md')}<span><b>${esc(m.name)}</b><small>${S.nearest.get(m.id) ? `loja mais perto a ${S.nearest.get(m.id).km.toFixed(1).replace('.', ',')} km` : ''}</small></span>${m.id === mid ? '<span class="pill pill--ok">aqui</span>' : ''}</button></li>`).join('')}</ul>`);
}

function budgetSheet() {
  const b = st().budget;
  sheet(`<h2 class="sheet__title" id="cartSheetTitle">Orçamento desta compra</h2>
    <form class="form" id="ckBudget"><label>Quanto você quer gastar no máximo?<input name="v" inputmode="decimal" placeholder="Ex.: 300" value="${b ? String(b).replace('.', ',') : ''}" /></label>
    <div class="chips">${[100, 200, 300, 500, 800].map((v) => `<button type="button" class="chip" data-ck-bset="${v}">${brl(v)}</button>`).join('')}</div>
    <button class="btn btn--primary btn--block">Salvar</button>${b ? '<button class="btn btn--text btn--block" type="button" data-ck-bset="0">Sem orçamento</button>' : ''}</form>`);
}

function finish() {
  const c = st(); const mid = currentMarket(); const t = total();
  if (!c.items.length) return;
  const list = api.store.get('tb.purchases', []);
  list.unshift({ at: new Date().toISOString(), market: mid, total: Math.round(t * 100) / 100, items: c.items.length, budget: c.budget });
  api.store.set('tb.purchases', list.slice(0, 100));
  track('bought', { market_id: mid, value: Math.round(t * 100) / 100 });
  api.store.set('tb.lastCart', { at: new Date().toISOString(), market: mid, items: c.items, total: t });
  sheet(`<div class="fx-done"><p class="fx-done__pts">${brl(t)}</p><h2 class="sheet__title">Compra registrada</h2>
    <p>${c.items.length} itens no ${esc(S.markets.get(mid)?.name || '')}${c.budget ? `, ${t <= c.budget ? `${brl(c.budget - t)} abaixo do orçamento` : `${brl(t - c.budget)} acima do orçamento`}` : ''}.</p>
    <button class="btn btn--primary btn--block" data-cupom="open">🧾 Conferir a nota do caixa</button>
    <p class="muted small center">Leia o QR da nota e veja se o caixa cobrou o preço da etiqueta.</p>
    <button class="btn btn--text btn--block" data-close>Fechar</button></div>`);
  S.cart = { market: c.market, budget: c.budget, items: [], startedAt: null }; save(); render();
}

// ---------------------------------------------------------------- reconhecimento de fala
function startMic() {
  if (!SR) return;
  if (listening) { rec?.stop(); return; }
  rec = new SR();
  rec.lang = 'pt-BR'; rec.interimResults = true; rec.maxAlternatives = 5; rec.continuous = false;
  let finalAlts = null;
  rec.onstart = () => { listening = true; render(); const h = $('#ckHeard'); if (h) { h.hidden = false; h.textContent = 'Pode falar…'; } };
  rec.onresult = (e) => {
    const r = e.results[e.results.length - 1];
    const h = $('#ckHeard'); if (h) h.textContent = `“${r[0].transcript}”`;
    if (r.isFinal) finalAlts = [...r].map((a) => a.transcript);
  };
  rec.onerror = (e) => {
    listening = false; render();
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') hooks.toast?.('Libere o microfone para o site nas configurações do navegador.', 'warn');
    else if (e.error === 'no-speech') hooks.toast?.('Não ouvi nada. Toque e fale de novo.', 'warn');
    else if (e.error !== 'aborted') hooks.toast?.('Não consegui ouvir. Tente de novo ou digite.', 'warn');
  };
  rec.onend = () => { listening = false; if (finalAlts) { const a = finalAlts; finalAlts = null; addFromSpeech(a); } else render(); };
  try { rec.start(); } catch { listening = false; }
}

// ---------------------------------------------------------------- eventos
document.addEventListener('click', (e) => {
  const t = e.target.closest('button, a'); if (!t || !t.closest('#cartView, #cartSheet')) return;
  const d = t.dataset;
  const c = st();
  if (d.ck === 'mic') return startMic();
  if (d.ck === 'market') return marketSheet();
  if (d.ck === 'budget') return budgetSheet();
  if (d.ck === 'compare') return compareSheet();
  if (d.ck === 'finish') return finish();
  if (d.ck === 'clear') { if (confirm('Esvaziar o carrinho?')) { c.items = []; c.startedAt = null; save(); render(); } return; }
  if (d.ckMarket) {
    c.market = Number(d.ckMarket);
    for (const i of c.items) { // reconfere os preços no novo mercado
      const p = i.product_id && S.products.find((x) => x.id === i.product_id);
      const x = p?.prices.find((y) => y.market_id === c.market);
      i.site_price = x?.price ?? null;
      if (i.product_id) i.status = x ? (Math.abs((i.price || 0) - x.price) <= 0.01 ? 'confere' : 'diferente') : 'sem_preco';
    }
    save(); hooks.closeSheet('#cartSheet'); return render();
  }
  if (d.ckBset !== undefined) { c.budget = Number(d.ckBset) || null; save(); hooks.closeSheet('#cartSheet'); return render(); }
  const it = (id) => c.items.find((i) => i.id === id);
  if (d.ckInc) { it(d.ckInc).qty++; save(); return render(); }
  if (d.ckDec) { const i = it(d.ckDec); if (i.qty > 1) i.qty--; else c.items = c.items.filter((x) => x !== i); save(); return render(); }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset?.ckPhoto && t.files?.[0]) return sendPhoto(t.dataset.ckPhoto, t.files[0]);
  if (t.dataset?.ckPrice) {
    const i = st().items.find((x) => x.id === t.dataset.ckPrice); if (!i) return;
    const v = parseFloat(t.value.replace(/\s|R\$/g, '').replace(',', '.'));
    if (!(v > 0)) { t.value = i.price ? i.price.toFixed(2).replace('.', ',') : ''; return; }
    i.price = Math.round(v * 100) / 100;
    if (i.site_price != null) i.status = Math.abs(i.price - i.site_price) <= 0.01 ? 'confere' : 'diferente';
    save(); render();
    if (i.status === 'diferente' && !i.photo) askPhoto(i, { text: `No site está ${brl(i.site_price)}.` });
  }
});

document.addEventListener('submit', (e) => {
  const f = e.target;
  if (f.id === 'ckType') {
    e.preventDefault(); const q = f.q.value.trim(); if (!q) return;
    addFromSpeech([q], 'texto'); const nf = $('#ckType'); if (nf) nf.q.focus();
  } else if (f.id === 'ckBudget') {
    e.preventDefault(); const v = parseFloat(f.v.value.replace(/\./g, '').replace(',', '.'));
    st().budget = v > 0 ? v : null; save(); hooks.closeSheet('#cartSheet'); render();
  } else if (f.id === 'ckPriceForm') {
    e.preventDefault(); const i = st().items.find((x) => x.id === f.dataset.id);
    const v = parseFloat(f.price.value.replace(/\s|R\$/g, '').replace(',', '.'));
    if (!(v > 0) || !i) return;
    i.price = Math.round(v * 100) / 100; save(); hooks.closeSheet('#cartSheet'); render();
    const best = i.product_id ? { p: S.products.find((x) => x.id === i.product_id), id: 1, sizeOk: true } : null;
    const vv = verdict({ price: i.price, size: null }, best, currentMarket());
    i.status = vv.kind; i.site_price = vv.site ?? null; save(); render();
    if (['diferente', 'sem_preco', 'novo'].includes(i.status)) setTimeout(() => askPhoto(i, vv), 300);
  }
});

export { total, currentMarket };
