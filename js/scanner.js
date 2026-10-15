// Leitor de código de barras: a pessoa aponta a câmera para as listrinhas do produto
// e vê na hora o preço aqui e onde está mais barato.
// Usa o BarcodeDetector do navegador (Android/Chrome) e, se não houver (iPhone), a biblioteca ZXing.
import * as api from './api.js';
import { S, $, esc, brl, logo, media, hooks, isOn } from './core.js';
import { perUnit } from './unitprice.js';
import { currentMarket, addProduct, addFromSpeech } from './carrinho.js';
import { strip } from './voice.js';
import { track } from './track.js';
import * as fiscal from './fiscal.js';

const ZXING = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm';
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
const MAP_KEY = 'tb.eanMap'; // códigos que a própria pessoa ensinou: { "789...": product_id }

let stream = null, loopId = null, zx = null, busy = false, opts = {};

// ---------------------------------------------------------------- código
const digits = (s) => String(s || '').replace(/\D/g, '');
const norm = (s) => digits(s).replace(/^0+/, ''); // UPC-A (12) e EAN-13 com zero na frente são o mesmo código

/** confere o dígito verificador (EAN-8, UPC-A, EAN-13, GTIN-14) para não aceitar leitura torta */
export function validEan(code) {
  const d = digits(code);
  if (![8, 12, 13, 14].includes(d.length)) return false;
  const n = d.split('').map(Number); const check = n.pop();
  const sum = n.reverse().reduce((s, v, i) => s + v * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

export function findByEan(code) {
  const k = norm(code);
  if (!k) return null;
  const p = S.products.find((x) => x.ean && norm(x.ean) === k);
  if (p) return p;
  const pid = api.store.get(MAP_KEY, {})[k];
  return pid ? S.products.find((x) => x.id === pid) || null : null;
}

// ---------------------------------------------------------------- tela
const body = () => $('#toolBody');
const HOW = `<ol class="how" aria-label="Como usar">
  <li><span class="how__i" aria-hidden="true">📱</span><span>Aponte para as <b>listrinhas</b></span></li>
  <li><span class="how__i" aria-hidden="true">🔔</span><span>Espere o <b>apito</b></span></li>
  <li><span class="how__i" aria-hidden="true">💰</span><span>Veja o <b>preço</b></span></li>
</ol>`;

/** abre o leitor. mode: 'preco' (só olhar) ou 'carrinho' (já pôr no carrinho) */
export function open(o = {}) {
  opts = o;
  $('#toolSheet').dataset.tool = 'scan';
  body().innerHTML = `
    <div class="tool tool--scan">
      <h2 class="sheet__title" id="toolTitle"><span aria-hidden="true">📷</span> Ler o código de barras</h2>
      ${HOW}
      <div class="scan" id="scanBox">
        <video id="scanVideo" playsinline muted autoplay></video>
        <div class="scan__frame" aria-hidden="true"><i></i><i></i><i></i><i></i><span class="scan__laser"></span></div>
        <div class="scan__msg" id="scanMsg"><span class="spin" aria-hidden="true"></span> Ligando a câmera…</div>
        <button class="scan__torch" id="scanTorch" type="button" hidden aria-pressed="false">🔦 Lanterna</button>
      </div>
      <details class="scan__type" id="scanType">
        <summary>⌨️ Não está lendo? Digite os números</summary>
        <form id="scanForm" class="scan__form" autocomplete="off">
          <input name="code" inputmode="numeric" pattern="[0-9]*" maxlength="14" placeholder="7891234567895" aria-label="Números do código de barras" />
          <button class="btn btn--primary">Ver preço</button>
        </form>
        <p class="muted small">São os números embaixo das listrinhas.</p>
      </details>
    </div>`;
  if ($('#toolSheet').hidden) hooks.openSheet('#toolSheet');
  start();
}

async function start() {
  stop();
  busy = false;
  const msg = $('#scanMsg');
  if (!navigator.mediaDevices?.getUserMedia) return camFail('Este navegador não abre a câmera. Digite os números do código abaixo.');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch (e) {
    return camFail(e.name === 'NotAllowedError'
      ? 'Precisamos da câmera para ler o código. Toque no cadeado ao lado do endereço do site e permita a câmera.'
      : 'Não consegui abrir a câmera. Digite os números do código abaixo.');
  }
  const v = $('#scanVideo'); if (!v) return stop();
  v.srcObject = stream;
  try { await v.play(); } catch {}
  if (msg) msg.innerHTML = 'Aponte para as listrinhas ▮▯▮▮▯▮';
  torchSetup();

  if ('BarcodeDetector' in window) {
    try {
      const ok = (await window.BarcodeDetector.getSupportedFormats?.()) || FORMATS;
      const det = new window.BarcodeDetector({ formats: FORMATS.filter((f) => ok.includes(f)) });
      const tick = async () => {
        if (!stream) return;
        if (v.readyState >= 2 && !busy) {
          try { const r = await det.detect(v); const c = r.find((x) => validEan(x.rawValue)); if (c) return found(c.rawValue); } catch {}
        }
        loopId = setTimeout(tick, 120);
      };
      return tick();
    } catch { /* cai para o ZXing */ }
  }
  try {
    const { BrowserMultiFormatReader } = await import(ZXING);
    const reader = new BrowserMultiFormatReader();
    const cb = (res) => { if (res && !busy && validEan(res.getText())) found(res.getText()); };
    zx = reader.decodeFromStream ? await reader.decodeFromStream(stream, v, cb) : await reader.decodeFromVideoElement(v, cb);
  } catch (e) {
    console.warn('leitor de código', e);
    if (msg) msg.textContent = 'A leitura automática não funciona aqui. Digite os números abaixo.';
    $('#scanType')?.setAttribute('open', '');
  }
}

function camFail(text) {
  const box = $('#scanBox'); if (box) box.classList.add('is-off');
  const msg = $('#scanMsg'); if (msg) msg.innerHTML = `<span class="scan__big" aria-hidden="true">📷</span>${esc(text)}<button class="btn btn--sm btn--ghost" data-scan="retry">Tentar de novo</button>`;
  $('#scanType')?.setAttribute('open', '');
}

function torchSetup() {
  const track0 = stream?.getVideoTracks?.()[0];
  const caps = track0?.getCapabilities?.() || {};
  const b = $('#scanTorch'); if (!b || !caps.torch) return;
  b.hidden = false;
  b.onclick = async () => {
    const on = b.getAttribute('aria-pressed') !== 'true';
    try { await track0.applyConstraints({ advanced: [{ torch: on }] }); b.setAttribute('aria-pressed', on); } catch {}
  };
}

export function stop() {
  clearTimeout(loopId); loopId = null;
  try { zx?.stop?.(); } catch {}
  zx = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

function beep() {
  try { navigator.vibrate?.(90); } catch {}
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = 1320; o.type = 'sine'; g.gain.value = 0.08;
    o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.12);
    setTimeout(() => ac.close?.(), 400);
  } catch {}
}

// ---------------------------------------------------------------- resultado
function found(code) {
  if (busy) return; busy = true;
  beep(); stop();
  const p = findByEan(code);
  track('scan', { product_id: p?.id || null, market_id: currentMarket(), query: digits(code) });
  if (p) showProduct(p, code); else showUnknown(code);
}

/** mostra o resultado de um produto: aqui x mais barato, com um rosto grande dizendo se vale */
export function showProduct(p, code = '') {
  stop(); busy = true;
  $('#toolSheet').dataset.tool = 'scan';
  if ($('#toolSheet').hidden) hooks.openSheet('#toolSheet');
  const mid = currentMarket(); const here = S.markets.get(mid);
  const prices = p.prices.filter((x) => isOn(x.market_id) || x.market_id === mid);
  const best = prices[0]; const hx = prices.find((x) => x.market_id === mid);
  const bm = best && S.markets.get(best.market_id);
  let face, cls, title, line;
  if (!best) { face = '🤔'; cls = 'is-meh'; title = 'Ainda não sabemos o preço'; line = 'Você pode ser o primeiro a informar.'; }
  else if (hx && hx.price <= best.price + 0.009) { face = '😀'; cls = 'is-good'; title = 'Aqui é o mais barato!'; line = `Pode levar sem medo: ${esc(here.name)} tem o menor preço.`; }
  else if (hx) { face = '😬'; cls = 'is-bad'; title = `No ${esc(bm.name)} é mais barato`; line = `Lá custa <b>${brl(hx.price - best.price)} a menos</b>.`; }
  else { face = '🧐'; cls = 'is-meh'; title = `Mais barato: ${esc(bm.name)}`; line = `Ainda não sabemos o preço no ${esc(here?.name || 'mercado em que você está')}.`; }
  const pu = best && perUnit(p.unit, (hx || best).price);
  body().innerHTML = `
    <div class="tool tool--result">
      <div class="res-prod">${media(p, 'res-prod__m')}<div><h2 class="sheet__title" id="toolTitle">${esc(p.name)}</h2><p class="muted small">${esc([p.brand, p.unit].filter(Boolean).join(' · '))}</p></div></div>
      <div class="verdict ${cls}">
        <span class="verdict__face" aria-hidden="true">${face}</span>
        <b class="verdict__t">${title}</b>
        <span class="verdict__l">${line}</span>
      </div>
      ${best ? `<div class="vs">
        <div class="vs__c ${hx && hx === best ? 'is-win' : ''}"><small>Aqui ${here ? `(${esc(here.name)})` : ''}</small><b>${hx ? brl(hx.price) : '?'}</b></div>
        ${hx !== best ? `<div class="vs__c is-win"><small>${logo(bm, 'xs')} ${esc(bm.name)}</small><b>${brl(best.price)}</b></div>` : ''}
      </div>` : ''}
      ${pu && Math.abs(pu.qty - 1) > 1e-9 ? `<p class="res-ppu">⚖️ Isso dá <b>${pu.text}</b></p>` : ''}
      ${prices.length > 1 ? `<details class="res-all"><summary>Ver todos os mercados (${prices.length})</summary><ol>${prices.map((x) => `<li>${logo(S.markets.get(x.market_id), 'xs')}<span>${esc(S.markets.get(x.market_id).name)}${x.market_id === mid ? ' (aqui)' : ''}</span><b>${brl(x.price)}</b></li>`).join('')}</ol></details>` : ''}
      <div class="tool__actions">
        <button class="btn btn--primary btn--xl" data-scan="cart" data-pid="${p.id}">🛒 Pôr no carrinho</button>
        <button class="btn btn--ghost btn--xl" data-scan="again">📷 Ler outro</button>
        ${!hx ? `<button class="btn btn--text" data-scan="tell" data-pid="${p.id}">Eu sei o preço daqui</button>` : ''}
      </div>
      ${code ? `<p class="muted small center">Código ${esc(digits(code))}</p>` : ''}
    </div>`;
}

async function offLookup(code) {
  // Open Food Facts: base aberta de produtos, só para sugerir o nome
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${digits(code)}.json?fields=product_name,brands,quantity`, { signal: ctl.signal });
    clearTimeout(t);
    const j = await r.json();
    const pr = j?.product; if (!pr?.product_name) return null;
    return [pr.product_name, pr.brands?.split(',')[0], pr.quantity].filter(Boolean).join(' ');
  } catch { return null; }
}

function showUnknown(code) {
  body().innerHTML = `
    <div class="tool tool--result">
      <div class="verdict is-meh"><span class="verdict__face" aria-hidden="true">🤔</span>
        <b class="verdict__t">Ainda não conheço este produto</b>
        <span class="verdict__l" id="offName">Procurando o nome…</span></div>
      <h3 class="pd__h">Me ensina: qual é?</h3>
      <input class="tool-search" id="learnQ" type="search" placeholder="Escreva o nome, ex.: Nescau" autocomplete="off" aria-label="Nome do produto" />
      <ul class="learn" id="learnList"></ul>
      <div class="tool__actions">
        <button class="btn btn--ghost btn--xl" data-scan="again">📷 Ler outro</button>
        <button class="btn btn--text" data-scan="cartnew" data-code="${esc(digits(code))}">Pôr no carrinho mesmo assim</button>
      </div>
      <p class="muted small center">Código ${esc(digits(code))}</p>
    </div>`;
  $('#toolBody').dataset.code = digits(code);
  learnList('');
  offLookup(code).then((name) => {
    const el = $('#offName'); if (!el) return;
    el.innerHTML = name ? `Parece ser: <b>${esc(name)}</b>` : 'Escolha abaixo qual é o produto. Da próxima vez eu já sei!';
    if (name) { const q = $('#learnQ'); q.value = name.split(' ').slice(0, 2).join(' '); learnList(q.value); $('#toolBody').dataset.offname = name; }
  });
}

function learnList(q) {
  const ul = $('#learnList'); if (!ul) return;
  const k = strip(q).split(/\s+/).filter((w) => w.length > 1);
  const res = S.products.filter((p) => { const t = strip(`${p.name} ${p.brand || ''}`); return !k.length || k.some((w) => t.includes(w)); })
    .sort((a, b) => k.filter((w) => strip(`${b.name} ${b.brand}`).includes(w)).length - k.filter((w) => strip(`${a.name} ${a.brand}`).includes(w)).length)
    .slice(0, 6);
  ul.innerHTML = res.length ? res.map((p) => `<li><button data-scan="learn" data-pid="${p.id}">${media(p, 'rx-media')}<span><b>${esc(p.name)}</b><small>${esc([p.brand, p.unit].filter(Boolean).join(' · '))}</small></span><em>É este</em></button></li>`).join('')
    : '<li class="muted small">Não achei. Tente outra palavra.</li>';
}

async function learn(code, pid) {
  const map = api.store.get(MAP_KEY, {}); map[norm(code)] = pid; api.store.set(MAP_KEY, map);
  api.suggestEan?.(digits(code), pid).catch(() => {});
  hooks.toast?.('Obrigado! Agora eu conheço este código. 🎉');
  showProduct(S.products.find((x) => x.id === pid), code);
}

// ---------------------------------------------------------------- eventos
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-scan]'); if (!t) return;
  const a = t.dataset.scan;
  if (a === 'retry' || a === 'again') return open(opts);
  if (a === 'cart') {
    const p = S.products.find((x) => x.id === Number(t.dataset.pid)); if (!p) return;
    addProduct(p); hooks.closeSheet('#toolSheet');
    if (opts.mode !== 'carrinho' && location.hash !== '#carrinho') location.hash = '#carrinho';
    return;
  }
  if (a === 'tell') { hooks.closeSheet('#toolSheet'); return fiscal.open({ product: Number(t.dataset.pid), market: currentMarket() }); }
  if (a === 'learn') return learn($('#toolBody').dataset.code, Number(t.dataset.pid));
  if (a === 'cartnew') {
    hooks.closeSheet('#toolSheet');
    if (location.hash !== '#carrinho') location.hash = '#carrinho';
    return setTimeout(() => addFromSpeech([$('#toolBody').dataset.offname || `produto ${t.dataset.code}`]), 200);
  }
});
document.addEventListener('submit', (e) => {
  if (e.target.id !== 'scanForm') return;
  e.preventDefault();
  const code = digits(e.target.code.value);
  if (!validEan(code)) { hooks.toast?.('Esse código não parece certo. Confira os números embaixo das listrinhas.', 'warn'); return; }
  busy = false; found(code);
});
document.addEventListener('input', (e) => { if (e.target.id === 'learnQ') learnList(e.target.value); });
// fechar a janela desliga a câmera
document.addEventListener('DOMContentLoaded', bindClose); bindClose();
function bindClose() { const s = $('#toolSheet'); if (s && !s.dataset.bound) { s.dataset.bound = 1; s.addEventListener('sheetclose', stop); } }
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (stream) stop(); return; }
  if (!$('#toolSheet')?.hidden && $('#scanVideo') && !stream && !busy) start();
});
