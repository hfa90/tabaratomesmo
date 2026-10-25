// 🧮 Calculadora do caixa — tela cheia, no jeito do app Calculadora do iPhone.
// • Teclado de maquininha: 1 2 9 0 = R$ 12,90. "×" multiplica pela quantidade, "+" soma o item.
// • A carteira fica no topo: antes de somar já mostra "sobra R$ X" ou "passa R$ Y".
// • Tela travada: sem rolar, sem zoom de toque duplo ou pinça, sem gesto que leve para outra página
//   (o "voltar" do celular só fecha a calculadora).
// • "=" fecha a compra: confere se o caixa cobrou o valor previsto e lembra de mandar a nota fiscal.
// Os valores entram no mesmo carrinho (um total só); fita com editar/excluir e histórico com desfazer.
import { S, $, esc, brl, hooks } from './core.js';

let C = null;                 // { st, save, total, rerender, closePurchase }
export function bind(ctx) { C = ctx; }

const uid = () => Math.random().toString(36).slice(2, 9);
const fmt = (v) => brl(v || 0);
let price = '';               // centavos digitados
let qtyTxt = '';              // quantidade digitada depois do "×"
let stage = 'price';          // 'price' | 'qty'
let mode = 'calc';            // 'calc' | 'wallet' | 'paid' (o teclado serve para os três)
let editing = null;           // item em edição
let name = '';
let panel = null;             // null | 'fita' | 'log' | 'end' | 'result'
let result = null;            // { predicted, paid }
let open_ = false;

const cents = () => (price ? Number(price) / 100 : 0);
const qty = () => Math.max(1, Number(qtyTxt) || 1);
const subtotal = () => Math.round(cents() * qty() * 100) / 100;

function log(kind, data) {
  const c = C.st(); c.log ||= [];
  c.log.unshift({ id: uid(), at: new Date().toISOString(), kind, ...data });
  c.log = c.log.slice(0, 80);
}

// ---------------------------------------------------------------- conta com a carteira
function wallet(extra = 0) {
  const c = C.st(); const t = C.total(); const b = c.budget;
  return { t, after: t + extra, b, left: b ? b - (t + extra) : null };
}
function editingValue() { const i = C.st().items.find((x) => x.id === editing); return i ? (i.price || 0) * i.qty : 0; }
function fixSuggestion(excess) {
  return C.st().items.filter((i) => (i.price || 0) * i.qty >= excess - 0.001).sort((a, b) => a.price * a.qty - b.price * b.qty)[0] || null;
}

function hint() {
  if (mode === 'wallet') return 'Quanto você tem para gastar? Digite e toque em <b>OK</b>.';
  if (mode === 'paid') return 'Quanto deu no caixa? Digite e toque em <b>OK</b>.';
  const add = editing ? subtotal() - editingValue() : subtotal();
  const w = wallet(price ? add : 0);
  const what = stage === 'qty' ? `${fmt(cents())} × ${qtyTxt || '…'} = <b>${fmt(subtotal())}</b> · ` : '';
  if (!w.b) return price ? `${what}total fica <b>${fmt(w.after)}</b>` : 'Digite o preço da etiqueta: <b>1 2 9 0</b> = R$ 12,90';
  if (w.left < 0) return `<span class="is-bad">${what}passa <b>${fmt(-w.left)}</b> do que você tem!</span>`;
  return `<span class="${w.left < w.b * 0.1 ? 'is-near' : 'is-good'}">${what}${price ? 'ainda sobra' : 'pode gastar'} <b>${fmt(w.left)}</b></span>`;
}

// ---------------------------------------------------------------- tela cheia
const KEYS = [
  ['ac', 'AC', 'fn'], ['del', '⌫', 'fn'], ['fita', '🧾', 'fn'], ['x', '×', 'op'],
  ['7', '7'], ['8', '8'], ['9', '9'], ['undo', '↶', 'op'],
  ['4', '4'], ['5', '5'], ['6', '6'], ['wallet', '👛', 'op'],
  ['1', '1'], ['2', '2'], ['3', '3'], ['add', '+', 'add'],
  ['0', '0', 'zero'], ['00', '00'], ['end', '=', 'eq'],
];

function screenHTML() {
  const c = C.st(); const w = wallet(); const n = c.items.length;
  const isPad = mode !== 'calc';
  const shown = mode === 'calc' ? cents() : cents();
  const last = c.items.slice(0, 2);
  return `
  <div class="cf-top">
    <button class="cf-x" data-cf="close" aria-label="Fechar a calculadora">✕</button>
    <div class="cf-wallet ${w.b ? (w.t > w.b ? 'is-over' : w.t > w.b * 0.9 ? 'is-near' : '') : ''}" data-cf="wallet">
      ${w.b ? `<span>👛 ${fmt(w.b)}</span><i><b style="--w:${Math.min(w.t / w.b, 1) * 100}%"></b></i><span>${w.t > w.b ? `passou ${fmt(w.t - w.b)}` : `sobra ${fmt(w.b - w.t)}`}</span>` : '<span>👛 Quanto você tem? <u>toque aqui</u></span>'}
    </div>
  </div>
  <div class="cf-screen">
    <div class="cf-last">${mode === 'calc' && !editing ? last.map((i) => `<span>${esc(i.name)} <b>${i.qty > 1 ? `${i.qty}×` : ''}${fmt(i.price)}</b></span>`).join('') : ''}
      ${editing ? '<span class="cf-tag">✏️ Editando item</span>' : ''}${mode === 'wallet' ? '<span class="cf-tag">👛 Sua carteira</span>' : ''}${mode === 'paid' ? '<span class="cf-tag">🧾 Valor do caixa</span>' : ''}</div>
    ${mode === 'calc' ? `<button class="cf-name" data-cf="name">${name ? `🏷️ ${esc(name)}` : '🏷️ dar nome (opcional)'}</button>` : ''}
    <div class="cf-total"><small>${mode === 'calc' ? `Total · ${n} ${n === 1 ? 'item' : 'itens'}` : ''}</small><b>${mode === 'calc' ? fmt(w.t) : ''}</b></div>
    <output class="cf-val ${stage === 'qty' && !isPad ? 'is-qty' : ''}" id="cfVal">${fmt(shown)}${stage === 'qty' && !isPad ? `<em> × ${qtyTxt || ''}</em>` : ''}</output>
    <p class="cf-hint" id="cfHint">${hint()}</p>
  </div>
  <div class="cf-pad ${isPad ? 'is-input' : ''}">
    ${KEYS.map(([k, label, cls = 'num']) => {
      if (isPad && ['fita', 'x', 'undo', 'wallet'].includes(k)) return `<span class="cf-k cf-k--off"></span>`;
      const lbl = k === 'add' && isPad ? 'OK' : k === 'add' && editing ? '✓' : k === 'end' && isPad ? '✕' : label;
      return `<button class="cf-k cf-k--${cls}" data-cf="${k}" aria-label="${{ ac: 'Limpar tudo', del: 'Apagar o último número', fita: 'Ver a fita', x: 'Multiplicar pela quantidade', undo: 'Desfazer', wallet: 'Quanto tenho na carteira', add: isPad ? 'Confirmar' : 'Somar o item', end: isPad ? 'Cancelar' : 'Terminar a compra' }[k] || label}">${lbl}${k === 'fita' && n ? `<sup>${n}</sup>` : ''}</button>`;
    }).join('')}
  </div>
  ${panel ? panelHTML() : ''}`;
}

function panelHTML() {
  const c = C.st();
  if (panel === 'end') {
    const t = C.total();
    return `<div class="cf-panel cf-end"><div class="cf-panel__in">
      <h2>Terminou de somar?</h2>
      <p class="cf-big">${fmt(t)}</p><p class="cf-sub">${c.items.length} ${c.items.length === 1 ? 'item' : 'itens'} na sua conta</p>
      <p>Na hora de pagar, <b>confira o valor que o caixa cobrou</b>.</p>
      <button class="cf-btn cf-btn--ok" data-cf="paid-same">✅ Deu exatamente ${fmt(t)}</button>
      <button class="cf-btn" data-cf="paid-other">✏️ Deu outro valor</button>
      <button class="cf-btn cf-btn--text" data-cf="panel-close">Continuar somando</button>
    </div></div>`;
  }
  if (panel === 'result') {
    const d = Math.round((result.paid - result.predicted) * 100) / 100;
    const face = Math.abs(d) < 0.01 ? '🎉' : d > 0 ? '😬' : '🤑';
    return `<div class="cf-panel cf-end"><div class="cf-panel__in">
      <p class="cf-face">${face}</p>
      <h2>${Math.abs(d) < 0.01 ? 'Bateu certinho!' : d > 0 ? `O caixa cobrou ${fmt(d)} a mais` : `Saiu ${fmt(-d)} mais barato`}</h2>
      <p class="cf-sub">Sua conta: ${fmt(result.predicted)} · Caixa: ${fmt(result.paid)}</p>
      ${d > 0.009 ? '<p class="cf-law">⚖️ Se a etiqueta mostrava preço menor, <b>vale o menor</b> (Lei 10.962/2004). A nota fiscal mostra item por item: dá para achar a diferença e pedir no balcão.</p>' : ''}
      <div class="cf-nf"><span>🧾</span><div><b>Agora mande a nota fiscal</b><small>Ela organiza o seu rancho (gastos por mês e por mercado), confere item por item o que o caixa cobrou e vale pontos e comparações extras.</small></div></div>
      <button class="cf-btn cf-btn--ok" data-cf="nf-now">🧾 Mandar a nota agora</button>
      <button class="cf-btn cf-btn--text" data-cf="nf-later">Depois (vou lembrar você)</button>
    </div></div>`;
  }
  const tape = c.items.slice().reverse(); const logs = c.log || [];
  return `<div class="cf-panel"><div class="cf-panel__in cf-scroll">
    <div class="cf-tabs"><button class="${panel === 'fita' ? 'is-on' : ''}" data-cf="tab-fita">🧾 Fita</button><button class="${panel === 'log' ? 'is-on' : ''}" data-cf="tab-log">🕘 Histórico</button>
      <button class="cf-tabs__x" data-cf="panel-close" aria-label="Voltar ao teclado">✕</button></div>
    ${panel === 'fita' ? (tape.length ? `<ol class="cf-tape">${tape.map((i, k) => `<li><span class="n">${k + 1}</span><span class="t"><b>${esc(i.name)}</b>${i.qty > 1 ? `<small>${i.qty} × ${fmt(i.price)}</small>` : ''}</span><b class="v">${fmt((i.price || 0) * i.qty)}</b>
        <button data-cf-edit="${i.id}" aria-label="Editar">✏️</button><button data-cf-del="${i.id}" aria-label="Excluir">🗑️</button></li>`).join('')}</ol>
        <div class="cf-sum"><span>Total</span><b>${fmt(C.total())}</b></div>` : '<p class="cf-empty">Nada somado ainda.</p>')
    : (logs.length ? `<ul class="cf-log">${logs.map((l) => `<li><span>${{ add: '＋', edit: '✏️', del: '🗑️', undo: '↶' }[l.kind]}</span><span>${logText(l)}<small>${new Date(l.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small></span>
        ${l.kind === 'del' && l.item && !c.items.some((i) => i.id === l.item.id) ? `<button data-cf-restore="${l.id}">Voltar</button>` : ''}</li>`).join('')}</ul>` : '<p class="cf-empty">Tudo o que você somar, mudar ou excluir aparece aqui.</p>')}
  </div></div>`;
}

function logText(l) {
  const v = (x) => (x ? `${x.qty > 1 ? `${x.qty} × ` : ''}${fmt(x.price || 0)}` : '');
  if (l.kind === 'add') return `Somou <b>${esc(l.item.name)}</b> ${v(l.item)}`;
  if (l.kind === 'del') return `Excluiu <b>${esc(l.item.name)}</b> ${v(l.item)}`;
  if (l.kind === 'edit') return `Mudou <b>${esc(l.after.name)}</b>: ${v(l.before)} → ${v(l.after)}`;
  return esc(l.text || 'Desfez a última ação');
}

function draw() { const el = $('#calcFull'); if (el) el.innerHTML = screenHTML(); }
function paint() {
  const v = $('#cfVal'), h = $('#cfHint'); if (!v) return draw();
  v.innerHTML = `${fmt(cents())}${stage === 'qty' && mode === 'calc' ? `<em> × ${qtyTxt || ''}</em>` : ''}`;
  h.innerHTML = hint();
  v.classList.remove('is-tick'); void v.offsetWidth; v.classList.add('is-tick');
}

// ---------------------------------------------------------------- abrir / fechar (travado)
const stop = (e) => { if (!e.target.closest('.cf-scroll')) e.preventDefault(); };
const noGesture = (e) => e.preventDefault();

export function openFull() {
  if (open_) return;
  open_ = true;
  const el = document.createElement('div');
  el.id = 'calcFull'; el.className = 'cf'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Calculadora do caixa');
  document.body.append(el);
  document.documentElement.classList.add('cf-lock');
  // sem zoom só enquanto a calculadora está aberta (o resto do site continua com zoom liberado)
  const vp = document.querySelector('meta[name=viewport]'); if (vp) { vp.dataset.orig ||= vp.content; vp.content = vp.dataset.orig + ', maximum-scale=1, user-scalable=no'; }
  el.addEventListener('touchmove', stop, { passive: false });
  // tecla responde no toque (sem esperar o "clique"): digitar rápido não perde número nem dá zoom
  el.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.cf-pad [data-cf]'); if (!b || e.button > 0) return;
    e.preventDefault(); b.classList.add('is-down'); b._fast = true; press(b.dataset.cf);
  });
  el.addEventListener('pointerup', () => el.querySelectorAll('.is-down').forEach((x) => x.classList.remove('is-down')));
  el.addEventListener('pointercancel', () => el.querySelectorAll('.is-down').forEach((x) => x.classList.remove('is-down')));
  document.addEventListener('gesturestart', noGesture); // pinça no iPhone
  document.addEventListener('dblclick', noGesture);
  history.pushState({ calc: 1 }, ''); // o "voltar" do celular fecha a calculadora
  draw();
}
function closeFull(fromPop = false) {
  if (!open_) return;
  open_ = false; panel = null; mode = 'calc';
  $('#calcFull')?.remove();
  document.documentElement.classList.remove('cf-lock');
  const vp = document.querySelector('meta[name=viewport]'); if (vp?.dataset.orig) vp.content = vp.dataset.orig;
  document.removeEventListener('gesturestart', noGesture);
  document.removeEventListener('dblclick', noGesture);
  if (!fromPop && history.state?.calc) history.back();
  C.rerender();
}
addEventListener('popstate', () => { if (open_) closeFull(true); });

// ---------------------------------------------------------------- teclas
function press(k) {
  try { navigator.vibrate?.(6); } catch {}
  if (/^\d+$/.test(k)) {
    if (stage === 'qty' && mode === 'calc') { if (qtyTxt.length < 3) qtyTxt = (qtyTxt + k).replace(/^0+/, ''); }
    else if (price.length < 8) price = (price + k).replace(/^0+/, '');
    return paint();
  }
  if (k === 'del') { if (stage === 'qty' && mode === 'calc') { if (qtyTxt) qtyTxt = qtyTxt.slice(0, -1); else stage = 'price'; } else price = price.slice(0, -1); return paint(); }
  if (k === 'ac') { price = ''; qtyTxt = ''; stage = 'price'; if (mode === 'calc') { name = ''; editing = null; } return draw(); }
  if (k === 'x') { if (!(cents() > 0)) return flashHint('Digite o preço primeiro, depois toque em × e na quantidade.'); stage = 'qty'; qtyTxt = ''; return paint(); }
  if (k === 'add') return mode === 'wallet' ? saveWallet() : mode === 'paid' ? savePaid() : commit();
  if (k === 'end') { if (mode !== 'calc') { mode = 'calc'; price = ''; return draw(); } if (!C.st().items.length) return flashHint('Some pelo menos um item antes de terminar.'); panel = 'end'; return draw(); }
  if (k === 'undo') return undo();
  if (k === 'wallet') { mode = 'wallet'; price = C.st().budget ? String(Math.round(C.st().budget * 100)) : ''; stage = 'price'; return draw(); }
  if (k === 'fita') { panel = 'fita'; return draw(); }
}
function flashHint(t) { const h = $('#cfHint'); if (h) { h.innerHTML = `<span class="is-bad">${t}</span>`; h.classList.add('is-shake'); setTimeout(() => h.classList.remove('is-shake'), 400); } }

function commit() {
  if (!(cents() > 0)) return flashHint('Digite o preço da etiqueta. Ex.: 5 4 9 = R$ 5,49');
  const c = C.st();
  if (editing) {
    const i = c.items.find((x) => x.id === editing);
    if (i) {
      const before = { name: i.name, price: i.price, qty: i.qty };
      i.price = cents(); i.qty = qty(); if (name) i.name = name;
      if (i.site_price != null) i.status = Math.abs(i.price - i.site_price) <= 0.01 ? 'confere' : 'diferente';
      log('edit', { before, after: { name: i.name, price: i.price, qty: i.qty }, itemId: i.id });
    }
    editing = null;
  } else {
    const n = c.items.length + 1;
    const item = { id: uid(), spoken: name || 'calculadora', qty: qty(), name: name || `Item ${n}`, product_id: null, guess_id: null, price: cents(), status: 'manual', site_price: null, size: null, at: new Date().toISOString(), calc: true };
    c.startedAt ||= item.at; c.items.unshift(item);
    log('add', { item: { ...item } });
  }
  price = ''; qtyTxt = ''; stage = 'price'; name = '';
  C.save(); draw();
  const v = $('#cfVal'); v?.classList.add('is-added'); setTimeout(() => v?.classList.remove('is-added'), 450);
  const w = wallet();
  if (w.b && w.t > w.b) { const s = fixSuggestion(w.t - w.b); flashHint(`Passou ${fmt(w.t - w.b)}.${s ? ` Tirando “${esc(s.name)}” (${fmt(s.price * s.qty)}) cabe.` : ''}`); }
}

function saveWallet() { C.st().budget = cents() > 0 ? cents() : null; mode = 'calc'; price = ''; C.save(); draw(); }
function savePaid() {
  if (!(cents() > 0)) return flashHint('Digite quanto o caixa cobrou.');
  result = { predicted: Math.round(C.total() * 100) / 100, paid: cents() }; mode = 'calc'; price = ''; panel = 'result'; draw();
}

function undo() {
  const c = C.st(); const l = (c.log || []).find((x) => x.kind !== 'undo'); if (!l) return flashHint('Nada para desfazer.');
  if (l.kind === 'add') c.items = c.items.filter((i) => i.id !== l.item.id);
  else if (l.kind === 'del') { if (!c.items.some((i) => i.id === l.item.id)) c.items.splice(Math.min(l.index ?? 0, c.items.length), 0, { ...l.item }); }
  else if (l.kind === 'edit') { const i = c.items.find((x) => x.id === l.itemId); if (i) Object.assign(i, l.before); }
  c.log = c.log.filter((x) => x !== l);
  log('undo', { text: `Desfez: ${logText(l).replace(/<[^>]+>/g, '')}` });
  C.save(); draw(); flashHint('↶ Desfeito.');
}
function remove(id) {
  const c = C.st(); const idx = c.items.findIndex((i) => i.id === id); if (idx < 0) return;
  const [it] = c.items.splice(idx, 1); log('del', { item: { ...it }, index: idx }); C.save(); draw();
}
function restore(logId) {
  const c = C.st(); const l = (c.log || []).find((x) => x.id === logId); if (!l?.item) return;
  if (!c.items.some((i) => i.id === l.item.id)) c.items.splice(Math.min(l.index ?? 0, c.items.length), 0, { ...l.item });
  log('add', { item: { ...l.item } }); C.save(); draw();
}
function edit(id) {
  const i = C.st().items.find((x) => x.id === id); if (!i) return;
  editing = id; price = String(Math.round((i.price || 0) * 100)); qtyTxt = i.qty > 1 ? String(i.qty) : ''; stage = i.qty > 1 ? 'qty' : 'price'; name = i.name.startsWith('Item ') ? '' : i.name;
  panel = null; draw();
}
function askName() {
  const v = prompt('Nome do item (opcional):', name); // teclado do celular aparece só aqui
  if (v !== null) { name = v.trim().slice(0, 40); draw(); }
}

async function finishPurchase(sendNow) {
  const sum = C.closePurchase({ paid: result?.paid ?? null });
  result = null; closeFull();
  if (sendNow) { location.hash = '#notas'; const n = await import('./notas.js'); setTimeout(() => n.openQR(), 350); }
  else hooks.toast?.(`Compra de ${fmt(sum?.paid ?? sum?.total ?? 0)} guardada. Vou lembrar você de mandar a nota em Minhas notas.`);
}

// ---------------------------------------------------------------- na página do carrinho
/** cartão do modo "Digitar preços" dentro do carrinho (abre a tela cheia) */
export function html() {
  const c = C.st(); const w = wallet(); const n = c.items.length;
  return `<section class="calc-launch">
    <button class="calc-open" data-cf="open"><span class="calc-open__i" aria-hidden="true">🧮</span>
      <span><b>Abrir a calculadora</b><small>Tela cheia, teclado grande, como no celular</small></span></button>
    ${n ? `<div class="calc-mini"><span>${n} ${n === 1 ? 'item' : 'itens'}</span><b>${fmt(w.t)}</b>${w.b ? `<small class="${w.t > w.b ? 'up' : 'down'}">${w.t > w.b ? `passou ${fmt(w.t - w.b)}` : `sobra ${fmt(w.b - w.t)}`}</small>` : ''}</div>` : ''}
  </section>`;
}
export function reset() { price = ''; qtyTxt = ''; stage = 'price'; editing = null; name = ''; panel = null; mode = 'calc'; }

// ---------------------------------------------------------------- eventos
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-cf], [data-cf-edit], [data-cf-del], [data-cf-restore]'); if (!t || !C) return;
  const d = t.dataset;
  if (d.cfEdit) return edit(d.cfEdit);
  if (d.cfDel) return remove(d.cfDel);
  if (d.cfRestore) return restore(d.cfRestore);
  const k = d.cf;
  if (t.closest('.cf-pad')) return; // teclado da calculadora: tratado no toque (pointerdown)
  if (k === 'open') return openFull();
  if (k === 'close') return closeFull();
  if (k === 'name') return askName();
  if (k === 'tab-fita' || k === 'tab-log') { panel = k === 'tab-fita' ? 'fita' : 'log'; return draw(); }
  if (k === 'panel-close') { panel = null; return draw(); }
  if (k === 'paid-same') { result = { predicted: Math.round(C.total() * 100) / 100, paid: Math.round(C.total() * 100) / 100 }; panel = 'result'; return draw(); }
  if (k === 'paid-other') { panel = null; mode = 'paid'; price = ''; return draw(); }
  if (k === 'nf-now') return finishPurchase(true);
  if (k === 'nf-later') return finishPurchase(false);
  press(k);
});
// teclado do computador
document.addEventListener('keydown', (e) => {
  if (!open_ || panel) { if (open_ && e.key === 'Escape') { panel ? (panel = null, draw()) : closeFull(); } return; }
  if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); }
  else if (e.key === 'Backspace') { e.preventDefault(); press('del'); }
  else if (e.key === 'Enter' || e.key === '+') { e.preventDefault(); press('add'); }
  else if (e.key === '*' || e.key.toLowerCase() === 'x') { e.preventDefault(); press('x'); }
  else if (e.key === '=') { e.preventDefault(); press('end'); }
  else if (e.key === 'Escape') { e.preventDefault(); closeFull(); }
});
