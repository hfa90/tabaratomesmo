// Conferir a nota do caixa (NFC-e): a pessoa lê o QR da nota e o app compara o que foi cobrado
// com o preço da etiqueta que ela anotou no carrinho. Pela Lei 10.962/2004, se o preço da etiqueta
// e o do caixa forem diferentes, o consumidor paga o menor.
import * as api from './api.js';
import { ic } from './icons.js';
import { S, $, esc, brl, logo, hooks } from './core.js';
import { parse, match, strip, phon } from './voice.js';
import * as scanner from './scanner.js';
import { currentMarket } from './carrinho.js';
import { track } from './track.js';

const body = () => $('#toolBody');
let last = null; // { receipt, res, mid }

/** itens para comparar: o carrinho atual ou, se já foi finalizado, a última compra */
function cartItems() {
  const now = (S.cart || api.store.get('tb.cart', null))?.items || [];
  if (now.length) return { items: now, market: (S.cart || api.store.get('tb.cart', null))?.market };
  const prev = api.store.get('tb.lastCart', null);
  return { items: prev?.items || [], market: prev?.market || null, prev: true };
}

export function open() {
  scanner.open({ kind: 'qr', demo: api.MODE !== 'live', onCode: check });
}

async function check(url) {
  body().innerHTML = `<div class="tool"><h2 class="sheet__title" id="toolTitle"><span aria-hidden="true">${ic('receipt')}</span> Lendo a nota…</h2>
    <div class="cupom-wait"><span class="cupom-wait__i" aria-hidden="true">${ic('receipt')}</span><p>Buscando os itens na Sefaz. Leva alguns segundos.</p></div></div>`;
  let receipt;
  try {
    receipt = url === 'demo' || api.MODE !== 'live' ? demoReceipt() : await api.readNfce(url);
  } catch (e) {
    const why = {
      offline: [ic('offline'), 'Sem internet agora', 'A nota precisa ser lida na Sefaz. Guarde o papel e confira quando o sinal voltar.'],
      sem_funcao: [ic('tool'), 'Função ainda não instalada', 'O administrador precisa publicar a função "nfce" no Supabase (veja o README).'],
      host: [ic('question'), 'Esse QR não é de nota fiscal', 'Aponte para o quadradinho que fica no fim da nota do caixa.'],
    }[e.code] || [ic('alert'), 'Não consegui ler a nota', `A Sefaz não respondeu direito (${esc(e.message || 'erro')}). Tente de novo em alguns minutos.`];
    body().innerHTML = `<div class="tool"><div class="verdict is-meh"><span class="verdict__face" aria-hidden="true">${why[0]}</span><b class="verdict__t">${why[1]}</b><span class="verdict__l">${why[2]}</span></div>
      <div class="tool__actions"><button class="btn btn--primary btn--xl" data-cupom="again">${ic('receipt')} Tentar de novo</button></div></div>`;
    return;
  }
  show(receipt);
}

// ---------------------------------------------------------------- comparação
const tokens = (s) => strip(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !/^\d+$/.test(w)).map(phon);
function nameSim(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.length || !B.length) return 0;
  const hit = B.filter((k) => A.some((x) => x.startsWith(k.slice(0, 4)) || k.startsWith(x.slice(0, 4)))).length;
  return hit / B.length;
}
function catalogOf(name) {
  const best = match(parse(name), S.products)[0];
  return best && best.id >= 0.6 ? best.p : null;
}
function marketOf(storeName) {
  const n = strip(storeName || '');
  for (const m of S.markets.values()) {
    const words = strip(m.name).replace(/supermercados?/g, '').split(/\s+/).filter((w) => w.length > 1);
    if (words.length && words.every((w) => n.includes(w))) return m.id;
  }
  return null;
}

export function compare(receipt, items) {
  const free = new Set(items.map((i) => i.id));
  const rows = receipt.items.map((ri) => {
    const p = catalogOf(ri.name);
    let ci = p ? items.find((i) => free.has(i.id) && (i.product_id === p.id || i.guess_id === p.id)) : null;
    if (!ci) {
      const cand = items.filter((i) => free.has(i.id)).map((i) => ({ i, s: nameSim(ri.name, i.name) })).sort((a, b) => b.s - a.s)[0];
      if (cand && cand.s >= 0.5) ci = cand.i;
    }
    if (ci) free.delete(ci.id);
    const shelf = ci?.price ?? null;
    const diff = shelf != null ? Math.round((ri.unit_price - shelf) * 100) / 100 : null;
    return { ri, p, ci, shelf, diff };
  });
  const over = rows.filter((r) => r.diff != null && r.diff > 0.009);
  const under = rows.filter((r) => r.diff != null && r.diff < -0.009);
  const extra = rows.filter((r) => !r.ci);
  const missing = items.filter((i) => free.has(i.id));
  const overTotal = over.reduce((s, r) => s + r.diff * Math.max(1, r.ri.qty || 1), 0);
  return { rows, over, under, extra, missing, overTotal };
}

function show(receipt) {
  const { items, market, prev } = cartItems();
  const res = compare(receipt, items);
  const mid = marketOf(receipt.store?.name) || market || currentMarket();
  last = { receipt, res, mid };
  track('tool', { market_id: mid, query: 'cupom', value: receipt.total ?? null });
  const m = S.markets.get(mid);
  const cartTotal = items.reduce((s, i) => s + (i.price || 0) * i.qty, 0);
  const sendable = res.rows.filter((r) => r.p && r.ri.unit_price > 0);
  let face, cls, t, l;
  if (!items.length) { face = ic('receipt'); cls = 'is-meh'; t = 'Nota lida!'; l = 'Seu carrinho estava vazio, então não tenho etiquetas para comparar. Da próxima vez, anote no Carrinho enquanto compra.'; }
  else if (res.over.length) { face = ic('warn'); cls = 'is-bad'; t = `${res.over.length} ${res.over.length > 1 ? 'itens passaram' : 'item passou'} mais caro`; l = `Você pagou <b>${brl(res.overTotal)} a mais</b> que o preço da etiqueta.`; }
  else { face = ic('good'); cls = 'is-good'; t = 'O caixa cobrou certinho!'; l = res.under.length ? `E ${res.under.length} ${res.under.length > 1 ? 'itens saíram' : 'item saiu'} até mais barato.` : 'Todos os preços batem com a etiqueta.'; }

  body().innerHTML = `
    <div class="tool">
      <div class="cupom-head">${m ? logo(m, 'md') : ('<span aria-hidden="true">' + ic('receipt') + '</span>')}<span><b>${esc(receipt.store?.name || m?.name || 'Nota fiscal')}</b><small>${esc(receipt.date || '')}${receipt.demo ? ' · nota de exemplo' : ''}</small></span>${receipt.total != null ? `<em>${brl(receipt.total)}</em>` : ''}</div>
      <div class="verdict ${cls}"><span class="verdict__face" aria-hidden="true">${face}</span><b class="verdict__t" id="toolTitle">${t}</b><span class="verdict__l">${l}</span></div>

      ${res.over.length ? `<ul class="cupom-list is-over">${res.over.map((r) => `<li><span class="cupom-list__n">${esc(r.ci.name)}</span>
        <span class="cupom-list__v"><small>Etiqueta</small><b>${brl(r.shelf)}</b></span><span class="cupom-list__v is-bad"><small>Caixa</small><b>${brl(r.ri.unit_price)}</b></span></li>`).join('')}</ul>
        <p class="cupom-law">${ic('scale')} Quando a etiqueta e o caixa mostram preços diferentes, <b>vale o menor</b> (Lei 10.962/2004). Mostre esta tela no balcão de atendimento e peça a diferença.</p>` : ''}

      ${items.length ? `<div class="cupom-tot"><span><small>Nota</small><b>${receipt.total != null ? brl(receipt.total) : '–'}</b></span><span><small>Seu carrinho${prev ? ' (última compra)' : ''}</small><b>${brl(cartTotal)}</b></span></div>` : ''}

      ${res.missing.length ? `<details class="cupom-more"><summary>${ic('bag')} ${res.missing.length} ${res.missing.length > 1 ? 'itens do carrinho não aparecem' : 'item do carrinho não aparece'} na nota</summary>
        <p class="muted small">Pode ter ficado sem passar no caixa (confira a sacola) ou estar com outro nome na nota.</p>
        <ul>${res.missing.map((i) => `<li>${esc(i.name)} <span class="muted">${brl(i.price || 0)}</span></li>`).join('')}</ul></details>` : ''}
      ${res.extra.length && items.length ? `<details class="cupom-more"><summary>${ic('plus')} ${res.extra.length} ${res.extra.length > 1 ? 'itens da nota não estavam' : 'item da nota não estava'} no carrinho</summary>
        <ul>${res.extra.map((r) => `<li>${esc(r.ri.name)} <span class="muted">${r.ri.qty > 1 ? `${r.ri.qty} × ` : ''}${brl(r.ri.unit_price)}</span></li>`).join('')}</ul></details>` : ''}

      <div class="tool__actions">
        ${sendable.length ? `<button class="btn btn--primary btn--xl" data-cupom="send">${ic('send')} Mandar ${sendable.length} ${sendable.length > 1 ? 'preços' : 'preço'} da nota para o site</button>
          <p class="muted small center">São preços reais de hoje${m ? ` no ${esc(m.name)}` : ''}: ajudam seus vizinhos e valem pontos.</p>` : ''}
        <button class="btn btn--ghost btn--xl" data-cupom="again">${ic('receipt')} Ler outra nota</button>
      </div>
    </div>`;
}

async function sendPrices(btn) {
  if (!last) return;
  if (!S.user && api.MODE === 'live') { hooks.closeSheet('#toolSheet'); return hooks.openAuth('signup', 'Crie sua conta para mandar os preços da nota e ganhar pontos.'); }
  btn.disabled = true; btn.textContent = 'Enviando…';
  let ok = 0, pts = 0, queued = 0;
  for (const r of last.res.rows.filter((x) => x.p && x.ri.unit_price > 0)) {
    try {
      const out = await api.reportPrice({ product_id: r.p.id, supermarket_id: last.mid, price: Math.round(r.ri.unit_price * 100) / 100, note: 'cupom fiscal' });
      ok++; pts += out.points || 0; if (out.queued) queued++;
    } catch { /* valor fora do normal ou limite do dia: segue com os outros */ }
  }
  btn.outerHTML = `<p class="ok-box">✓ ${ok} ${ok === 1 ? 'preço enviado' : 'preços enviados'}${pts ? ` · <b>+${pts} pts</b>` : ''}${queued ? ' (sem internet: vão quando o sinal voltar)' : ''}. Obrigado!</p>`;
  hooks.afterContribution?.();
}

/** nota de exemplo a partir do carrinho (modo demonstração): um item cobrado a mais e um que não passou */
function demoReceipt() {
  const { items } = cartItems();
  let base = items.filter((i) => i.price > 0).map((i) => ({ name: i.name, qty: i.qty, price: i.price }));
  if (!base.length) {
    const mid = currentMarket();
    base = S.products.filter((p) => p.prices.some((x) => x.market_id === mid)).slice(0, 5)
      .map((p) => ({ name: `${p.name} ${p.brand || ''} ${p.unit || ''}`, qty: 1, price: p.prices.find((x) => x.market_id === mid).price }));
  }
  const its = base.slice(0, base.length >= 3 ? base.length - 1 : base.length).map((b, i) => {
    const unit = i === 0 && items.length ? Math.round((b.price + 0.5) * 100) / 100 : b.price;
    return { name: strip(b.name).toUpperCase().slice(0, 40), qty: b.qty, unit: 'UN', unit_price: unit, total: Math.round(unit * b.qty * 100) / 100 };
  });
  const m = S.markets.get(currentMarket());
  return { demo: true, store: { name: (m?.name || 'Supermercado').toUpperCase(), cnpj: null }, date: new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }),
    total: Math.round(its.reduce((s, i) => s + i.total, 0) * 100) / 100, items: its };
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-cupom]'); if (!t) return;
  if (t.dataset.cupom === 'open' || t.dataset.cupom === 'again') { if (t.dataset.cupom === 'open') hooks.closeSheet?.('#cartSheet'); return setTimeout(open, t.dataset.cupom === 'open' ? 280 : 0); }
  if (t.dataset.cupom === 'send') return sendPrices(t);
});
