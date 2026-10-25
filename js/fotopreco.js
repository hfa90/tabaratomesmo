// 📸 Foto do preço: a pessoa fotografa o produto com a etiqueta da prateleira.
// A IA lê nome, marca, tamanho e preço; o app acha o produto no catálogo (código de barras
// ou nome) e compara com o preço do site naquele mercado:
//   😀 confere  → confirma o preço (atualiza a data, ganha pontos)
//   😬 mudou    → manda o preço novo com a foto como prova; na loja (GPS), entra no site na hora
//   ❔ não existe → manda para cadastro (moderação) com o que a IA leu
import * as api from './api.js';
import { S, $, esc, brl, logo, hooks, isOn } from './core.js';
import { parse, match } from './voice.js';
import { findByEan, validEan } from './scanner.js';
import { currentMarket } from './carrinho.js';
import * as ia from './ia.js';
import { track } from './track.js';

const body = () => $('#toolBody');
let st = null; // { mid, cv, read, reading_id, photo_url, p, cands, ean }
const pname = (p) => [p.name, p.brand, p.unit].filter(Boolean).join(' ');

function sheet(html) {
  $('#toolSheet').dataset.tool = 'fotopreco';
  body().innerHTML = `<div class="tool fp">${html}</div>`;
  if ($('#toolSheet').hidden) hooks.openSheet('#toolSheet');
}

function marketPicker(mid) {
  return `<details class="fp-mk"><summary>${S.markets.get(mid) ? `${logo(S.markets.get(mid), 'sm')} <span>Você está no <b>${esc(S.markets.get(mid).name)}</b></span>` : '<span>Em qual mercado você está?</span>'} <u>trocar</u></summary>
    <div class="chips chips--wrap">${[...S.markets.values()].map((m) => `<button class="chip ${m.id === mid ? 'is-on' : ''}" data-fp-mk="${m.id}">${logo(m, 'xs')} ${esc(m.name)}</button>`).join('')}</div></details>`;
}

export function open() {
  st = { mid: st?.mid || currentMarket() || [...S.markets.keys()][0] };
  if (api.MODE === 'live' && !S.user) { hooks.closeSheet?.('#toolSheet'); return hooks.openAuth('signup', 'Crie sua conta para conferir preços pela foto e ganhar pontos.'); }
  sheet(`
    <h2 class="sheet__title" id="toolTitle"><span aria-hidden="true">📸</span> Foto do preço</h2>
    <ol class="how" aria-label="Como usar">
      <li><span class="how__i" aria-hidden="true">🥫</span><span>Produto e <b>etiqueta</b> juntos</span></li>
      <li><span class="how__i" aria-hidden="true">📸</span><span>Foto <b>nítida</b>, de perto</span></li>
      <li><span class="how__i" aria-hidden="true">✅</span><span>Veja se o preço <b>confere</b></span></li>
    </ol>
    ${marketPicker(st.mid)}
    <div class="tool__actions">
      <button class="btn btn--primary btn--xl" data-fp="cam">📷 Tirar foto</button>
      <button class="btn btn--ghost btn--block" data-fp="gal">🖼️ Escolher da galeria</button>
    </div>
    <p class="muted small center">A foto vale como prova: se você estiver na loja, o preço novo entra no site na hora.</p>`);
}

function pick(capture) {
  const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
  if (capture) inp.setAttribute('capture', 'environment');
  inp.addEventListener('change', () => inp.files[0] && read(inp.files[0]));
  inp.click();
}

// ---------------------------------------------------------------- ler
async function read(file) {
  let cv;
  try { cv = (await ia.fileCanvases(file, { max: 1800 }))[0]; } catch (e) { return fail('😕', 'Não consegui abrir a foto', esc(e.message)); }
  st.cv = cv;
  const thumb = ia.toCanvas(cv, 520).toDataURL('image/jpeg', 0.8);
  sheet(`<h2 class="sheet__title" id="toolTitle"><span aria-hidden="true">📸</span> Lendo a etiqueta…</h2>
    <div class="fp-photo is-reading"><img src="${thumb}" alt="Sua foto" /><span class="fp-scan" aria-hidden="true"></span></div>
    <p class="muted center">Procurando o produto e o preço.</p>`);

  // código de barras na foto (rápido, no aparelho)
  const eanLocal = await barcodeIn(cv);
  let out;
  try {
    out = api.MODE === 'live' ? await ia.iaRead('etiqueta', [cv], { supermarket_id: st.mid }) : demoRead();
  } catch (e) {
    return fail(e.code === 'limite' ? '⏳' : '😕', e.code === 'limite' ? 'Limite de hoje atingido' : 'Não consegui ler agora', esc(e.message));
  }
  const r = out.result || {};
  st.read = r; st.reading_id = out.reading_id; st.photo_url = out.photo_url; st.thumb = thumb;
  st.ean = [eanLocal, r.ean].find((c) => c && validEan(c)) || null;
  track('tool', { query: 'fotopreco', market_id: st.mid });
  if (!r.legivel || !r.preco) return fail('🔍', 'Não deu para ler o preço', esc(r.motivo || 'Chegue mais perto da etiqueta, sem reflexo, e tente de novo.'));

  // achar o produto
  let p = st.ean ? findByEan(st.ean) : null;
  const q = [r.nome, r.marca, r.tamanho].filter(Boolean).join(' ') || r.texto_etiqueta || '';
  const found = q ? match(parse(q), S.products, { limit: 4 }) : [];
  st.cands = found.map((x) => x.p);
  if (!p && found[0] && found[0].id >= 0.62 && found[0].sizeOk !== false) p = found[0].p;
  st.p = p;
  result();
}

async function barcodeIn(cv) {
  if (!('BarcodeDetector' in window)) return null;
  try { const d = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a'] }); const r = await d.detect(cv); return r[0]?.rawValue || null; } catch { return null; }
}

// ---------------------------------------------------------------- resultado
function result() {
  const { read: r, p, mid } = st; const m = S.markets.get(mid);
  const head = `<div class="fp-read"><img src="${st.thumb}" alt="" /><span><small>A IA leu</small><b>${esc([r.nome, r.marca, r.tamanho].filter(Boolean).join(' · ') || r.texto_etiqueta || 'Produto')}</b><em>${brl(r.preco)}</em>${r.preco_promocional ? `<small>🏷️ ${brl(r.preco_promocional)} ${esc(r.condicao || '')}</small>` : ''}</span></div>`;
  if (!p) {
    sheet(`${head}
      <div class="verdict is-meh"><span class="verdict__face" aria-hidden="true">❔</span><b class="verdict__t" id="toolTitle">Qual destes é o produto?</b><span class="verdict__l">Não achei com certeza no site.</span></div>
      <ul class="fp-cands">${(st.cands || []).map((c) => `<li><button data-fp-set="${c.id}">${c.emoji || '🛒'} ${esc(pname(c))}</button></li>`).join('')}</ul>
      <form class="fp-search" id="fpSearch" autocomplete="off"><input type="search" name="q" placeholder="Buscar outro produto…" aria-label="Buscar produto" /></form><ul class="fp-cands" id="fpRes"></ul>
      <div class="tool__actions"><button class="btn btn--ghost btn--block" data-fp="new">➕ Não está no site: pedir cadastro</button><button class="btn btn--text" data-fp="again">Tirar outra foto</button></div>`);
    $('#fpSearch').addEventListener('input', (e) => {
      const q = e.target.value.trim();
      $('#fpRes').innerHTML = q.length < 2 ? '' : match(parse(q), S.products, { limit: 6 }).map((x) => `<li><button data-fp-set="${x.p.id}">${x.p.emoji || '🛒'} ${esc(pname(x.p))}</button></li>`).join('');
    });
    return;
  }
  const here = p.prices.find((x) => x.market_id === mid);
  const site = here ? (here.regular ?? here.price) : null; // preço normal da loja (sem promoção do site)
  const diff = site != null ? Math.round((r.preco - site) * 100) / 100 : null;
  const best = p.prices.filter((x) => isOn(x.market_id) && x.market_id !== mid)[0];
  let face, cls, title, line, cta;
  if (site == null) { face = '🆕'; cls = 'is-meh'; title = `Primeiro preço no ${esc(m?.name || 'mercado')}`; line = 'Ninguém tinha mandado ainda. Vale pontos extras!'; cta = '📤 Mandar este preço'; }
  else if (Math.abs(diff) < 0.01) { face = '😀'; cls = 'is-good'; title = 'Confere! O site está certo'; line = `${brl(site)} no ${esc(m?.name || '')}. Confirme para deixar o preço fresquinho.`; cta = '✅ Confirmar o preço'; }
  else { face = diff > 0 ? '😬' : '🤑'; cls = diff > 0 ? 'is-bad' : 'is-good'; title = diff > 0 ? `Subiu ${brl(diff)}` : `Baixou ${brl(-diff)}`; line = `No site: <s>${brl(site)}</s> → na etiqueta: <b>${brl(r.preco)}</b>`; cta = '📤 Atualizar o preço no site'; }
  sheet(`${head}
    <div class="fp-prod"><button data-open-product="${p.id}">${p.emoji || '🛒'} <span><b>${esc(pname(p))}</b><small>reconhecido ${st.ean ? 'pelo código de barras' : 'pelo nome'}</small></span></button><button class="linkish" data-fp="other">não é este?</button></div>
    <div class="verdict ${cls}"><span class="verdict__face" aria-hidden="true">${face}</span><b class="verdict__t" id="toolTitle">${title}</b><span class="verdict__l">${line}</span></div>
    ${best && best.price < r.preco - 0.009 ? `<p class="fp-best">💡 No ${logo(S.markets.get(best.market_id), 'xs')} <b>${esc(S.markets.get(best.market_id)?.name || '')}</b> está ${brl(best.price)}.</p>` : ''}
    ${marketPicker(mid)}
    <div class="tool__actions"><button class="btn btn--primary btn--xl" data-fp="send">${cta}</button><button class="btn btn--text" data-fp="again">Tirar outra foto</button></div>`);
}

function fail(face, title, text) {
  sheet(`<div class="verdict is-meh"><span class="verdict__face" aria-hidden="true">${face}</span><b class="verdict__t" id="toolTitle">${title}</b><span class="verdict__l">${text}</span></div>
    <div class="tool__actions"><button class="btn btn--primary btn--xl" data-fp="cam">📷 Tirar outra foto</button><button class="btn btn--text" data-close>Fechar</button></div>`);
}

// ---------------------------------------------------------------- enviar
const gps = () => new Promise((res) => {
  if (!navigator.geolocation) return res(S.pos?.gps ? S.pos : null);
  navigator.geolocation.getCurrentPosition((g) => res({ lat: g.coords.latitude, lng: g.coords.longitude }), () => res(S.pos?.gps ? S.pos : null), { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 });
});

async function send(btn) {
  btn.disabled = true; btn.textContent = 'Enviando…';
  const pos = await gps();
  try {
    const out = await api.reportPriceWithPhoto({ product_id: st.p.id, supermarket_id: st.mid, price: st.read.preco, note: 'foto da etiqueta',
      lat: pos?.lat ?? null, lng: pos?.lng ?? null, ia_reading_id: st.reading_id || null, photo_url: st.photo_url || null });
    const live = out.status === 'aprovado';
    sheet(`<div class="fx-done"><p class="fx-done__pts">+${out.points || 0} pts</p>
      <h2 class="sheet__title" id="toolTitle">${live ? 'Preço atualizado no site!' : out.queued ? 'Guardado para enviar' : 'Preço enviado!'}</h2>
      <p>${live ? `Agora todo mundo vê ${brl(st.read.preco)} no ${esc(S.markets.get(st.mid)?.name || '')}.` : out.queued ? 'Sem internet: vai sozinho quando o sinal voltar.' : out.at_store ? 'Entra no site assim que for confirmado.' : 'Como você não parece estar na loja agora, ele passa pela confirmação da comunidade.'}</p>
      <div class="tool__actions"><button class="btn btn--primary btn--xl" data-fp="cam">📸 Conferir outro preço</button><button class="btn btn--text" data-close>Fechar</button></div></div>`);
    if (live) hooks.refreshCatalog?.().catch(() => {});
    hooks.afterContribution?.();
  } catch (e) {
    btn.disabled = false; btn.textContent = '📤 Tentar de novo';
    hooks.toast?.(e.message || 'Não consegui enviar agora.', 'warn');
  }
}

async function askNew(btn) {
  btn.disabled = true; btn.textContent = 'Enviando…';
  const r = st.read; const pos = await gps();
  const blob = await new Promise((res) => ia.toCanvas(st.cv, 1200).toBlob(res, 'image/webp', 0.82));
  try {
    await api.sendShelfPhoto(blob, { supermarket_id: st.mid, product_id: null, spoken: r.texto_etiqueta || null, name: [r.nome, r.marca].filter(Boolean).join(' ') || null,
      size: r.tamanho || null, price: r.preco, site_price: null, lat: pos?.lat ?? null, lng: pos?.lng ?? null });
    sheet(`<div class="fx-done"><p class="fx-done__pts">📮</p><h2 class="sheet__title" id="toolTitle">Pedido de cadastro enviado</h2>
      <p>A equipe confere a foto e coloca o produto no site. Obrigado!</p>
      <div class="tool__actions"><button class="btn btn--primary btn--xl" data-fp="cam">📸 Conferir outro preço</button><button class="btn btn--text" data-close>Fechar</button></div></div>`);
  } catch (e) { btn.disabled = false; btn.textContent = '➕ Tentar de novo'; hooks.toast?.(e.message, 'warn'); }
}

// ---------------------------------------------------------------- demonstração
function demoRead() {
  const p = S.products.filter((x) => x.prices.some((y) => y.market_id === st.mid))[Math.floor(Math.random() * 12)] || S.products[0];
  const x = p.prices.find((y) => y.market_id === st.mid) || p.prices[0];
  const preco = Math.random() < 0.5 ? x.price : Math.round(x.price * 1.08 * 100) / 100;
  return { reading_id: null, result: { legivel: true, nome: p.name, marca: p.brand, tamanho: p.unit, preco, ean: p.ean || null, confianca: 0.9, texto_etiqueta: `${p.name} ${p.brand || ''} ${p.unit || ''}`.toUpperCase() } };
}

// ---------------------------------------------------------------- eventos
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-fp], [data-fp-mk], [data-fp-set]'); if (!t) return;
  const d = t.dataset;
  if (d.fp === 'cam') return pick(true);
  if (d.fp === 'gal') return pick(false);
  if (d.fp === 'again') return open();
  if (d.fp === 'send') return send(t);
  if (d.fp === 'new') return askNew(t);
  if (d.fp === 'other') { st.p = null; return result(); }
  if (d.fpMk) { st.mid = Number(d.fpMk); return st.read ? result() : open(); }
  if (d.fpSet) { st.p = S.products.find((x) => x.id === Number(d.fpSet)) || null; return result(); }
});
