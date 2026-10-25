// Ajudantes do mercado: ferramentas de toque grande, com figuras e quase sem texto.
//  📷 Ler código   ⚖️ Qual pacote compensa?   🏷️ Promoção vale?   🗺️ Caminho no mercado
import * as api from './api.js';
import { S, $, $$, esc, brl, logo, media, hooks, isOn } from './core.js';
import { perUnit, compareTwo, sizeOf } from './unitprice.js';
import { promoEffective, strip, parseUnit } from './voice.js';
import { currentMarket, addProduct, addCustom } from './carrinho.js';
import * as scanner from './scanner.js';
import { track } from './track.js';

const TOOLS = [
  { id: 'scan', icon: '📷', name: 'Ler código', sub: 'Aponte e veja o preço', c: '#2E6BE6' },
  { id: 'tamanho', icon: '⚖️', name: 'Qual compensa?', sub: 'Pacote grande ou pequeno', c: '#0F8A5F' },
  { id: 'promo', icon: '🏷️', name: 'Promoção vale?', sub: 'Leve 3, pague 2…', c: '#D9480F' },
  { id: 'caminho', icon: '🗺️', name: 'Caminho no mercado', sub: 'Lista na ordem dos corredores', c: '#7048E8' },
  { id: 'fotopreco', icon: '📸', name: 'Foto do preço', sub: 'Fotografe a etiqueta e confira', c: '#C2255C' },
  { id: 'notas', icon: '🧾', name: 'Mandar nota', sub: 'Ganhe pontos com a sua compra', c: '#0B7285' },
];

/** fileira de ajudantes. compact = versão menor (carrinho) */
export function hubHTML(compact = false) {
  return `<div class="hub ${compact ? 'hub--compact' : ''}" role="list">${TOOLS.map((t) => `
    <button class="hub__t" role="listitem" data-tool="${t.id}" style="--c:${t.c}">
      <span class="hub__i" aria-hidden="true">${t.icon}</span>
      <b>${t.name}</b>${compact ? '' : `<small>${t.sub}</small>`}
    </button>`).join('')}</div>`;
}

export function renderHub() {
  const el = $('#toolHub'); if (!el) return;
  el.innerHTML = `<h2 class="hub__h">Ajudantes do mercado</h2>${hubHTML()}`;
}

const body = () => $('#toolBody');
function openTool(name, html) {
  $('#toolSheet').dataset.tool = name;
  body().innerHTML = html;
  if ($('#toolSheet').hidden) hooks.openSheet('#toolSheet');
  else body().scrollIntoView?.({ block: 'start' });
  track('tool', { query: name });
}

const num = (v) => { const n = parseFloat(String(v ?? '').replace(/\s|R\$/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const fmt = (v) => (v == null ? '' : String(Math.round(v * 100) / 100).replace('.', ','));
const herePrice = (p) => { const mid = currentMarket(); return p.prices.find((x) => x.market_id === mid)?.price ?? p.prices.filter((x) => isOn(x.market_id))[0]?.price ?? p.prices[0]?.price ?? null; };

// =====================================================================
//  ⚖️ Qual pacote compensa?
// =====================================================================
const UNITS = [['g', 'g'], ['kg', 'kg'], ['ml', 'ml'], ['l', 'L'], ['un', 'un']];
const SIZE_CHIPS = { g: [200, 500, 1000], kg: [1, 2, 5], ml: [350, 500, 900], l: [1, 2, 5], un: [6, 12, 30] };

let T = null; // estado da ferramenta de tamanho
function tamanhoState(p) {
  const blank = () => ({ price: null, amount: null, unit: 'g' });
  T = { a: blank(), b: blank() };
  if (p) {
    const u = parseUnit(p.unit || '');
    if (u) T.a = { price: herePrice(p), amount: u.amount, unit: u.unit === 'rolos' ? 'un' : u.unit, name: p.name };
    T.b.unit = T.a.unit;
  }
}

function pack(k) {
  const x = T[k]; const L = k.toUpperCase();
  return `<div class="pk pk--${k}" data-pk="${k}">
    <span class="pk__badge" aria-hidden="true">${L}</span>
    <span class="pk__crown" aria-hidden="true">👑</span>
    <p class="pk__h">Pacote ${L}</p>
    <label class="big-in"><span>R$</span><input inputmode="decimal" placeholder="0,00" value="${fmt(x.price)}" data-tz="${k}.price" aria-label="Preço do pacote ${L}" /></label>
    <p class="pk__q">Tamanho</p>
    <div class="pk__size">
      <input class="pk__amt" inputmode="decimal" placeholder="500" value="${fmt(x.amount)}" data-tz="${k}.amount" aria-label="Tamanho do pacote ${L}" />
      <div class="pk__units" role="radiogroup" aria-label="Unidade do pacote ${L}">${UNITS.map(([u, l]) => `<button type="button" role="radio" aria-checked="${x.unit === u}" data-tzu="${k}:${u}">${l}</button>`).join('')}</div>
    </div>
    <div class="pk__chips">${(SIZE_CHIPS[x.unit] || []).map((v) => `<button type="button" class="chip" data-tzs="${k}:${v}">${String(v).replace('.', ',')} ${x.unit === 'l' ? 'L' : x.unit}</button>`).join('')}</div>
    <p class="pk__pu" data-pkpu="${k}"></p>
  </div>`;
}

export function openTamanho(p = null) {
  tamanhoState(p);
  openTool('tamanho', `
    <div class="tool">
      <h2 class="sheet__title" id="toolTitle"><span aria-hidden="true">⚖️</span> Qual pacote compensa?</h2>
      <ol class="how">
        <li><span class="how__i" aria-hidden="true">🅰️</span><span>Preço e tamanho do <b>pacote A</b></span></li>
        <li><span class="how__i" aria-hidden="true">🅱️</span><span>Preço e tamanho do <b>pacote B</b></span></li>
        <li><span class="how__i" aria-hidden="true">👑</span><span>A <b>coroa</b> mostra o que compensa</span></li>
      </ol>
      <div class="pks" id="pks">${pack('a')}<span class="pks__vs" aria-hidden="true">ou</span>${pack('b')}</div>
      <div class="tz-res" id="tzRes" aria-live="polite"></div>
      <p class="muted small center">Pacote maior só compensa se você usar tudo antes de estragar.</p>
    </div>`);
  tamanhoCalc();
  setTimeout(() => body().querySelector(T.a.price ? '[data-tz="b.price"]' : '[data-tz="a.price"]')?.focus({ preventScroll: true }), 320);
}

function tamanhoCalc() {
  const res = $('#tzRes'); if (!res) return;
  for (const k of ['a', 'b']) {
    const x = T[k]; const pu = x.price && x.amount ? perUnit(`${x.amount} ${x.unit}`, x.price) : null;
    const el = $(`[data-pkpu="${k}"]`); if (el) el.innerHTML = pu ? `= <b>${pu.text}</b>` : '&nbsp;';
  }
  $$('.pk').forEach((el) => el.classList.remove('is-win', 'is-lose'));
  const ready = (x) => x.price > 0 && x.amount > 0;
  if (!ready(T.a) || !ready(T.b)) {
    res.className = 'tz-res is-wait';
    res.innerHTML = `<span class="tz-res__face" aria-hidden="true">🤔</span><span>${!ready(T.a) ? 'Escreva o <b>preço</b> e o <b>tamanho</b> do pacote A' : 'Agora escreva o <b>preço</b> e o <b>tamanho</b> do pacote B'}</span>`;
    return;
  }
  const r = compareTwo(T.a, T.b);
  if (!r) {
    res.className = 'tz-res is-warn';
    res.innerHTML = `<span class="tz-res__face" aria-hidden="true">🙃</span><span>Compare coisas iguais: <b>peso com peso</b> (g, kg), <b>líquido com líquido</b> (ml, L) ou <b>unidade com unidade</b>.</span>`;
    return;
  }
  if (!r.win) {
    res.className = 'tz-res is-tie';
    res.innerHTML = `<span class="tz-res__face" aria-hidden="true">🤝</span><span><b>Empate!</b> Os dois saem ${r.pa.text}. Leve o que for usar.</span>`;
    return;
  }
  const W = r.win.toUpperCase(); const w = r.win === 'a' ? r.pa : r.pb;
  $(`.pk--${r.win}`)?.classList.add('is-win'); $(`.pk--${r.win === 'a' ? 'b' : 'a'}`)?.classList.add('is-lose');
  res.className = 'tz-res is-win';
  res.innerHTML = `<span class="tz-res__face" aria-hidden="true">🎉</span>
    <span><b class="tz-res__big">O pacote ${W} compensa!</b>
    Cada ${w.kind === 'un' ? 'unidade' : w.word} sai <b>${brl(r.diff)} mais barato</b> (${Math.round(r.pct)}% a menos).</span>`;
}

// =====================================================================
//  🏷️ Promoção vale a pena?
// =====================================================================
const KINDS = [
  { id: 'leve', icon: '3→2', name: 'Leve 3, pague 2', ex: 'Leva mais e paga menos' },
  { id: 'segunda', icon: '½', name: '2ª unidade com desconto', ex: 'A segunda sai mais barata' },
  { id: 'atacado', icon: '📦', name: 'Levando vários, cada um sai menos', ex: '“A partir de 3 un.: R$ 4,99”' },
  { id: 'depor', icon: '✂️', name: 'De R$… por R$…', ex: 'Preço riscado na etiqueta' },
];
let P = null;

export function openPromo(p = null) {
  P = { kind: null, product: p, price: p ? herePrice(p) : null, buy: 3, pay: 2, off: 50, from: 3, promoPrice: null };
  promoStep();
}

function promoStep() {
  if (!P.kind) {
    return openTool('promo', `
      <div class="tool">
        <h2 class="sheet__title" id="toolTitle"><span aria-hidden="true">🏷️</span> A promoção vale a pena?</h2>
        <p class="tool__lead">Qual é a promoção da etiqueta?</p>
        <div class="kinds">${KINDS.map((k) => `<button class="kind" data-pk-kind="${k.id}"><span class="kind__i" aria-hidden="true">${k.icon}</span><b>${k.name}</b><small>${k.ex}</small></button>`).join('')}</div>
      </div>`);
  }
  const K = KINDS.find((k) => k.id === P.kind);
  const step = (key, label, min, max) => `<div class="pstep"><span>${label}</span>
    <span class="pstep__c"><button type="button" data-pstep="${key}:-1" aria-label="Menos">−</button><output data-pout="${key}">${P[key]}</output><button type="button" data-pstep="${key}:1" aria-label="Mais">+</button></span></div>`;
  const priceIn = (key, label) => `<label class="big-in big-in--row"><span class="big-in__l">${label}</span><span>R$</span><input inputmode="decimal" placeholder="0,00" value="${fmt(P[key])}" data-pin="${key}" /></label>`;
  let fields = '';
  if (P.kind === 'leve') fields = `${step('buy', 'Leve', 2, 12)}${step('pay', 'Pague', 1, 11)}${priceIn('price', 'Preço de 1')}`;
  if (P.kind === 'segunda') fields = `${priceIn('price', 'Preço de 1')}<div class="pstep"><span>Desconto na 2ª</span><span class="chips chips--wrap">${[30, 50, 100].map((v) => `<button type="button" class="chip ${P.off === v ? 'is-on' : ''}" data-poff="${v}">${v === 100 ? 'Grátis' : v + '%'}</button>`).join('')}</span></div>`;
  if (P.kind === 'atacado') fields = `${priceIn('price', 'Preço de 1 (normal)')}${step('from', 'A partir de', 2, 24)}${priceIn('promoPrice', 'Preço de cada')}`;
  if (P.kind === 'depor') fields = `${priceIn('price', 'De (riscado)')}${priceIn('promoPrice', 'Por (agora)')}`;
  openTool('promo', `
    <div class="tool">
      <button class="btn btn--text back" data-pk-kind="">‹ Outra promoção</button>
      <h2 class="sheet__title" id="toolTitle"><span aria-hidden="true">${K.icon}</span> ${K.name}</h2>
      <div class="pprod" id="pProd">${prodPick()}</div>
      <div class="pfields">${fields}</div>
      <div class="pres" id="pRes" aria-live="polite"></div>
    </div>`);
  promoCalc();
}

function prodPick() {
  const p = P.product;
  if (p) return `<div class="pprod__on">${media(p, 'rx-media')}<span><b>${esc(p.name)}</b><small>${esc([p.brand, p.unit].filter(Boolean).join(' · '))}</small></span><button class="btn btn--text" data-pprod="clear">trocar</button></div>`;
  return `<input class="tool-search" id="pQ" type="search" placeholder="Qual produto? (opcional)" autocomplete="off" aria-label="Qual produto" /><ul class="learn" id="pList" hidden></ul>`;
}

function promoNumbers() {
  if (P.kind === 'leve') return { kind: 'leve', buy: P.buy, pay: Math.min(P.pay, P.buy - 1) };
  if (P.kind === 'segunda') return { kind: 'segunda', off: P.off };
  if (P.kind === 'atacado') return P.promoPrice ? { kind: 'atacado', from: P.from, price: P.promoPrice } : null;
  if (P.kind === 'depor') return P.promoPrice ? { kind: 'depor', price: P.promoPrice } : null;
  return null;
}
const promoLabel = () => ({ leve: `Leve ${P.buy}, pague ${Math.min(P.pay, P.buy - 1)}`, segunda: P.off === 100 ? '2ª unidade grátis' : `2ª unidade com ${P.off}% off`, atacado: `A partir de ${P.from}: ${brl(P.promoPrice || 0)} cada`, depor: `De ${brl(P.price || 0)} por ${brl(P.promoPrice || 0)}` }[P.kind]);

function promoCalc() {
  const el = $('#pRes'); if (!el) return;
  $$('[data-pout]').forEach((o) => (o.textContent = P[o.dataset.pout]));
  const pr = promoNumbers();
  const r = pr && promoEffective(pr, P.price);
  if (!r) { el.className = 'pres is-wait'; el.innerHTML = `<span class="tz-res__face" aria-hidden="true">✍️</span><span>Escreva os <b>preços</b> da etiqueta.</span>`; return; }
  if (r.save <= 0.004) { el.className = 'pres is-bad'; el.innerHTML = `<span class="tz-res__face" aria-hidden="true">😐</span><span><b>Não tem desconto nenhum.</b> Confira os valores da etiqueta.</span>`; return; }
  // compara com o preço normal em outros mercados, se o produto foi escolhido
  let other = '';
  const p = P.product;
  if (p) {
    const mid = currentMarket();
    const cheaper = p.prices.filter((x) => isOn(x.market_id) && x.market_id !== mid && x.price < r.unit - 0.009)[0];
    if (cheaper) other = `<div class="pres__warn">😬 Mas no <b>${esc(S.markets.get(cheaper.market_id).name)}</b> cada um custa <b>${brl(cheaper.price)}</b> sem promoção.</div>`;
    else other = `<div class="pres__ok">👍 Nenhum outro mercado tem mais barato que isso.</div>`;
  }
  const many = r.qty > 1;
  el.className = 'pres is-good';
  el.innerHTML = `
    <div class="pres__top"><span class="tz-res__face" aria-hidden="true">🎉</span>
      <span><small>Cada um sai por</small><b class="pres__big">${brl(r.unit)}</b></span></div>
    <ul class="pres__list">
      ${many ? `<li><span aria-hidden="true">🛍️</span><span>Você leva <b>${r.qty}</b> e paga <b>${brl(r.total)}</b></span></li>` : ''}
      <li><span aria-hidden="true">💰</span><span>Economiza <b>${brl(r.save)}</b> (${Math.round(r.pct)}% a menos)</span></li>
      ${many ? `<li><span aria-hidden="true">💡</span><span>Só vale se você for usar os <b>${r.qty}</b>. Se precisa de 1, paga ${brl(P.price)}.</span></li>` : ''}
    </ul>
    ${other}
    <button class="btn btn--primary btn--xl btn--block" data-pcart>🛒 Pôr ${many ? r.qty + ' ' : ''}no carrinho</button>`;
}

function prodList(q) {
  const ul = $('#pList'); if (!ul) return;
  const k = strip(q).split(/\s+/).filter((w) => w.length > 1);
  if (!k.length) { ul.hidden = true; return; }
  const res = S.products.filter((p) => { const t = strip(`${p.name} ${p.brand || ''}`); return k.every((w) => t.includes(w)); }).slice(0, 5);
  ul.hidden = false;
  ul.innerHTML = res.length ? res.map((p) => `<li><button data-pprod="${p.id}">${media(p, 'rx-media')}<span><b>${esc(p.name)}</b><small>${esc([p.brand, p.unit].filter(Boolean).join(' · '))}</small></span><em>${brl(herePrice(p) || 0)}</em></button></li>`).join('')
    : '<li class="muted small">Não achei. Sem problema: a conta funciona sem o produto.</li>';
}

// =====================================================================
//  eventos
// =====================================================================
document.addEventListener('click', (e) => {
  const t = e.target.closest('button, a'); if (!t) return;
  const d = t.dataset;
  if (d.tool) {
    const p = d.toolPid ? S.products.find((x) => x.id === Number(d.toolPid)) : null;
    if (d.tool === 'scan') return scanner.open({ mode: location.hash === '#carrinho' ? 'carrinho' : 'preco' });
    if (d.tool === 'fotopreco') return import('./fotopreco.js').then((m) => m.open());
    if (d.tool === 'notas') { hooks.closeSheet?.('#toolSheet'); location.hash = '#notas'; return; }
    if (d.tool === 'tamanho') return openTamanho(p);
    if (d.tool === 'promo') return openPromo(p);
    if (d.tool === 'caminho') { if (!S.list.size) hooks.toast?.('Primeiro coloque os produtos no rancho. Depois eu mostro o caminho! 🗺️'); hooks.closeSheet?.('#toolSheet'); api.store.set('tb.rmode', 'shop'); hooks.ranchoMode?.('shop'); location.hash = '#lista'; return; }
  }
  if (!t.closest('#toolSheet')) return;
  // tamanho
  if (d.tzu) { const [k, u] = d.tzu.split(':'); T[k].unit = u; const old = $('#pks'); if (old) { old.innerHTML = `${pack('a')}<span class="pks__vs" aria-hidden="true">ou</span>${pack('b')}`; } return tamanhoCalc(); }
  if (d.tzs) { const [k, v] = d.tzs.split(':'); T[k].amount = Number(v); const i = $(`[data-tz="${k}.amount"]`); if (i) i.value = fmt(T[k].amount); return tamanhoCalc(); }
  // promoção
  if (d.pkKind !== undefined) { P.kind = d.pkKind || null; return promoStep(); }
  if (d.pstep) {
    const [k, dv] = d.pstep.split(':'); const lim = { buy: [2, 12], pay: [1, 11], from: [2, 24] }[k];
    P[k] = Math.max(lim[0], Math.min(lim[1], P[k] + Number(dv)));
    if (k === 'buy' && P.pay >= P.buy) P.pay = P.buy - 1;
    if (k === 'pay' && P.pay >= P.buy) P.buy = P.pay + 1;
    return promoCalc();
  }
  if (d.poff) { P.off = Number(d.poff); $$('[data-poff]').forEach((b) => b.classList.toggle('is-on', b === t)); return promoCalc(); }
  if (d.pprod) {
    if (d.pprod === 'clear') P.product = null;
    else { P.product = S.products.find((x) => x.id === Number(d.pprod)); if (P.product && !P.price) P.price = herePrice(P.product); }
    $('#pProd').innerHTML = prodPick();
    const i = $('[data-pin="price"]'); if (i && P.price) i.value = fmt(P.price);
    return promoCalc();
  }
  if (d.pcart !== undefined) {
    const r = promoEffective(promoNumbers(), P.price); if (!r) return;
    if (P.product) addProduct(P.product, { price: r.unit, qty: r.qty, note: promoLabel() });
    else addCustom({ name: `Item em promoção (${promoLabel()})`, price: r.unit, qty: r.qty, note: promoLabel() });
    hooks.closeSheet('#toolSheet');
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset?.tz) { const [k, f] = t.dataset.tz.split('.'); T[k][f] = num(t.value); return tamanhoCalc(); }
  if (t.dataset?.pin) { P[t.dataset.pin] = num(t.value); return promoCalc(); }
  if (t.id === 'pQ') return prodList(t.value);
});

export { openTool, sizeOf };
