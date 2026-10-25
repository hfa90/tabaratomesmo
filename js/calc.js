// 🧮 Calculadora do caixa (modo "Digitar preços" do Carrinho).
// Teclado de caixa (1 2 9 0 = R$ 12,90), quantidade, nome opcional e, ANTES de somar,
// a conta com o que a pessoa tem na carteira: "ainda sobra R$ 18,11" ou "passa R$ 3,20".
// Os valores entram no mesmo carrinho (um total só). A fita permite editar e excluir,
// e o histórico guarda cada ação com "desfazer".
import { S, $, esc, brl, hooks } from './core.js';
import { parse, match } from './voice.js';

let digits = '';        // centavos digitados, como na maquininha
let qty = 1;
let name = '';
let editing = null;     // id do item em edição
let showLog = false;

const cents = () => (digits ? Number(digits) / 100 : 0);
const fmt = (v) => brl(v).replace(/\s/g, ' ');
const uid = () => Math.random().toString(36).slice(2, 9);

/** ctx = { st, save, total, rerender } vem do carrinho */
let C = null;
export function bind(ctx) { C = ctx; }

function log(kind, data) {
  const c = C.st(); c.log ||= [];
  c.log.unshift({ id: uid(), at: new Date().toISOString(), kind, ...data });
  c.log = c.log.slice(0, 80);
}
const itemLabel = (i, idx) => i.name || `Item ${idx}`;

// ---------------------------------------------------------------- conta com a carteira
function wallet(add = 0) {
  const c = C.st(); const t = C.total(); const b = c.budget;
  const after = t + add;
  if (!b) return { t, after, b: null };
  return { t, after, b, left: b - after, over: after > b, near: after > b * 0.9 && after <= b };
}

/** item que, se tirado, faz a compra caber na carteira (o menor que resolve) */
function fixSuggestion(excess) {
  const items = C.st().items.filter((i) => (i.price || 0) * i.qty >= excess - 0.001).sort((a, b) => a.price * a.qty - b.price * b.qty);
  return items[0] || null;
}

function preview() {
  const add = cents() * qty;
  const w = wallet(editing ? add - editingValue() : add);
  if (!digits) {
    if (!w.b) return '<span>Digite o preço da etiqueta. Ex.: <b>1 2 9 0</b> = R$ 12,90</span>';
    return w.over ? `<span class="is-bad">Já passou ${fmt(w.after - w.b)} do que você tem.</span>` : `<span>Você ainda pode gastar <b>${fmt(w.left)}</b>.</span>`;
  }
  const what = `${qty > 1 ? `${qty} × ${fmt(cents())} = <b>${fmt(add)}</b>` : `<b>${fmt(add)}</b>`}`;
  if (!w.b) return `<span>${what} · o total fica <b>${fmt(w.after)}</b></span>`;
  if (w.over) return `<span class="is-bad">${what} · passa <b>${fmt(w.after - w.b)}</b> do que você tem!</span>`;
  return `<span class="${w.near ? 'is-near' : 'is-good'}">${what} · ainda sobra <b>${fmt(w.left)}</b></span>`;
}
function editingValue() { const i = C.st().items.find((x) => x.id === editing); return i ? (i.price || 0) * i.qty : 0; }

// ---------------------------------------------------------------- tela
export function html() {
  const c = C.st(); const w = wallet(); const n = c.items.length;
  const pct = w.b ? Math.min(w.t / w.b, 1) : 0;
  const tape = c.items.slice().reverse();
  const logList = (c.log || []);
  return `
  <section class="calc" id="calc" aria-label="Calculadora do caixa">
    <div class="calc-wallet ${w.b ? (w.t > w.b ? 'is-over' : w.t > w.b * 0.9 ? 'is-near' : '') : 'is-unset'}">
      ${w.b ? `<div class="calc-wallet__row"><span>👛 Na carteira <b>${fmt(w.b)}</b></span><button class="linkish small" data-ck="budget">mudar</button></div>
        <div class="calc-wallet__bar"><span style="--w:${pct * 100}%"></span></div>
        <div class="calc-wallet__row"><span>Somando <b>${fmt(w.t)}</b></span><span>${w.t > w.b ? `<b class="is-bad">Passou ${fmt(w.t - w.b)}</b>` : `Sobra <b>${fmt(w.b - w.t)}</b>`}</span></div>`
      : `<div class="calc-wallet__row calc-wallet__tot"><span>Total da compra</span><b>${fmt(w.t)}</b></div>
         <button class="calc-wallet__set" data-ck="budget">👛 <span><b>Quanto você tem para gastar?</b><small>Eu aviso antes de passar do valor</small></span></button>`}
    </div>

    <div class="calc-screen ${editing ? 'is-editing' : ''}">
      ${editing ? '<span class="calc-tag">✏️ Editando</span>' : ''}
      <div class="calc-row">
        <input class="calc-name" id="calcName" value="${esc(name)}" placeholder="O que é? (opcional)" aria-label="Nome do produto (opcional)" maxlength="60" autocomplete="off" />
        <span class="calc-qty" aria-label="Quantidade"><button data-calc="q-" aria-label="Menos uma unidade">−</button><output id="calcQty">${qty}×</output><button data-calc="q+" aria-label="Mais uma unidade">+</button></span>
      </div>
      <output class="calc-val" id="calcVal" aria-live="polite">${fmt(cents())}</output>
      <p class="calc-hint" id="calcHint">${preview()}</p>
    </div>

    <div class="calc-pad" role="group" aria-label="Teclado">
      ${['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0'].map((k) => `<button class="calc-k" data-calc="${k}">${k}</button>`).join('')}
      <button class="calc-k calc-k--del" data-calc="del" aria-label="Apagar o último número">⌫</button>
      <button class="calc-k calc-k--clear" data-calc="clear">Limpar</button>
      <button class="calc-k calc-k--add" data-calc="add">${editing ? '✓ Salvar' : '＋ Somar'}</button>
    </div>
    ${editing ? '<button class="btn btn--text btn--block" data-calc="cancel">Cancelar edição</button>' : ''}

    <div class="calc-tabs" role="tablist">
      <button role="tab" aria-selected="${!showLog}" data-calc="tab-fita">🧾 Fita <small>${n}</small></button>
      <button role="tab" aria-selected="${showLog}" data-calc="tab-log">🕘 Histórico <small>${logList.length}</small></button>
      ${logList.length ? '<button class="calc-undo" data-calc="undo" title="Desfazer a última ação">↶ Desfazer</button>' : ''}
    </div>

    ${!showLog ? (n ? `<ol class="calc-tape">${tape.map((i, k) => `<li class="${i.id === editing ? 'is-editing' : ''}" data-ci="${i.id}">
        <span class="calc-tape__n">${k + 1}</span>
        <span class="calc-tape__t"><b>${esc(itemLabel(i, k + 1))}</b>${i.qty > 1 ? `<small>${i.qty} × ${fmt(i.price || 0)}</small>` : ''}</span>
        <b class="calc-tape__v">${fmt((i.price || 0) * i.qty)}</b>
        <button class="calc-ic" data-calc-edit="${i.id}" aria-label="Editar ${esc(itemLabel(i, k + 1))}">✏️</button>
        <button class="calc-ic" data-calc-del="${i.id}" aria-label="Excluir ${esc(itemLabel(i, k + 1))}">🗑️</button>
      </li>`).join('')}</ol>
      <div class="calc-sum"><span>Total</span><b>${fmt(w.t)}</b></div>`
      : '<p class="muted small center calc-empty">Os valores que você somar aparecem aqui, como na fita do caixa.</p>')
    : (logList.length ? `<ul class="calc-log">${logList.map((l) => `<li class="is-${l.kind}">
        <span class="calc-log__i">${{ add: '＋', edit: '✏️', del: '🗑️', undo: '↶' }[l.kind]}</span>
        <span>${logText(l)}<small>${new Date(l.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small></span>
        ${l.kind === 'del' && l.item && !C.st().items.some((i) => i.id === l.item.id) ? `<button class="btn btn--sm btn--ghost" data-calc-restore="${l.id}">Voltar</button>` : ''}
      </li>`).join('')}</ul>` : '<p class="muted small center calc-empty">Tudo o que você somar, mudar ou excluir fica registrado aqui. Errou? É só voltar.</p>')}
  </section>`;
}

function logText(l) {
  const v = (x) => (x ? `${x.qty > 1 ? `${x.qty} × ` : ''}${fmt(x.price || 0)}` : '');
  if (l.kind === 'add') return `Somou <b>${esc(l.item.name)}</b> ${v(l.item)}`;
  if (l.kind === 'del') return `Excluiu <b>${esc(l.item.name)}</b> ${v(l.item)}`;
  if (l.kind === 'edit') return `Mudou <b>${esc(l.after.name)}</b>: ${v(l.before)} → ${v(l.after)}`;
  return esc(l.text || 'Desfez a última ação');
}

// atualiza só o visor (sem redesenhar a tela toda a cada número)
function paint() {
  const v = $('#calcVal'), h = $('#calcHint'), q = $('#calcQty');
  if (!v) return;
  v.textContent = fmt(cents()); h.innerHTML = preview(); q.textContent = `${qty}×`;
  v.classList.remove('is-tick'); void v.offsetWidth; v.classList.add('is-tick');
}

// ---------------------------------------------------------------- ações
function press(k) {
  if (/^\d+$/.test(k)) { if (digits.length < 7) digits = (digits + k).replace(/^0+/, ''); }
  else if (k === 'del') digits = digits.slice(0, -1);
  else if (k === 'clear') { digits = ''; qty = 1; name = ''; const n = $('#calcName'); if (n) n.value = ''; }
  else if (k === 'q+') qty = Math.min(99, qty + 1);
  else if (k === 'q-') qty = Math.max(1, qty - 1);
  try { navigator.vibrate?.(8); } catch {}
  paint();
}

function guessProduct(text) {
  if (!text || text.length < 3) return null;
  const best = match(parse(text), S.products)[0];
  return best && best.id >= 0.72 && best.sizeOk !== false ? best.p : null;
}

function commit() {
  const price = cents();
  if (!(price > 0)) { hooks.toast?.('Digite o preço primeiro. Ex.: 5 4 9 = R$ 5,49'); return; }
  const c = C.st();
  const typed = ($('#calcName')?.value || name).trim();
  if (editing) {
    const i = c.items.find((x) => x.id === editing);
    if (i) {
      const before = { name: i.name, price: i.price, qty: i.qty };
      i.price = price; i.qty = qty; if (typed) i.name = typed;
      if (i.site_price != null) i.status = Math.abs(i.price - i.site_price) <= 0.01 ? 'confere' : 'diferente';
      log('edit', { before, after: { name: i.name, price: i.price, qty: i.qty }, itemId: i.id });
    }
    editing = null;
  } else {
    const p = guessProduct(typed);
    const n = c.items.length + 1;
    const item = { id: uid(), spoken: typed || 'calculadora', qty, name: typed ? (typed[0].toUpperCase() + typed.slice(1)) : `Item ${n}`, product_id: p?.id || null, guess_id: p?.id || null,
      price, status: 'manual', site_price: null, size: null, at: new Date().toISOString(), calc: true };
    c.startedAt ||= item.at; c.items.unshift(item);
    log('add', { item: { ...item } });
    const w = wallet();
    if (w.b && w.t > w.b) {
      const s = fixSuggestion(w.t - w.b);
      hooks.toast?.(`⚠️ Passou ${fmt(w.t - w.b)} do que você tem.${s ? ` Tirando “${s.name}” (${fmt(s.price * s.qty)}) cabe.` : ''}`, 'warn');
    }
  }
  digits = ''; qty = 1; name = '';
  C.save(); C.rerender();
  setTimeout(() => { const v = $('#calcVal'); v?.classList.add('is-added'); setTimeout(() => v?.classList.remove('is-added'), 500); }, 0);
}

function remove(id) {
  const c = C.st(); const idx = c.items.findIndex((i) => i.id === id); if (idx < 0) return;
  const [it] = c.items.splice(idx, 1);
  log('del', { item: { ...it }, index: idx });
  if (editing === id) { editing = null; digits = ''; qty = 1; name = ''; }
  C.save(); C.rerender();
  hooks.toast?.(`🗑️ ${it.name} excluído. Dá para voltar no Histórico.`);
}

function edit(id) {
  const i = C.st().items.find((x) => x.id === id); if (!i) return;
  editing = id; digits = String(Math.round((i.price || 0) * 100)); qty = i.qty; name = i.name;
  C.rerender();
  $('#calc')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function undo() {
  const c = C.st(); const l = (c.log || []).find((x) => x.kind !== 'undo'); if (!l) return;
  if (l.kind === 'add') c.items = c.items.filter((i) => i.id !== l.item.id);
  else if (l.kind === 'del') { if (!c.items.some((i) => i.id === l.item.id)) c.items.splice(Math.min(l.index ?? 0, c.items.length), 0, { ...l.item }); }
  else if (l.kind === 'edit') { const i = c.items.find((x) => x.id === l.itemId); if (i) Object.assign(i, l.before); }
  c.log = c.log.filter((x) => x !== l);
  log('undo', { text: `Desfez: ${logText(l).replace(/<[^>]+>/g, '')}` });
  C.save(); C.rerender();
}

function restore(logId) {
  const c = C.st(); const l = (c.log || []).find((x) => x.id === logId); if (!l?.item) return;
  if (!c.items.some((i) => i.id === l.item.id)) c.items.splice(Math.min(l.index ?? 0, c.items.length), 0, { ...l.item });
  log('add', { item: { ...l.item } });
  C.save(); C.rerender();
  hooks.toast?.(`↶ ${l.item.name} voltou para a conta.`);
}

export function reset() { digits = ''; qty = 1; name = ''; editing = null; }

// ---------------------------------------------------------------- eventos
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-calc], [data-calc-edit], [data-calc-del], [data-calc-restore]'); if (!t || !C) return;
  const d = t.dataset;
  if (d.calcEdit) return edit(d.calcEdit);
  if (d.calcDel) return remove(d.calcDel);
  if (d.calcRestore) return restore(d.calcRestore);
  const k = d.calc;
  if (k === 'add') return commit();
  if (k === 'undo') return undo();
  if (k === 'cancel') { reset(); return C.rerender(); }
  if (k === 'tab-fita' || k === 'tab-log') { showLog = k === 'tab-log'; return C.rerender(); }
  press(k);
});
document.addEventListener('input', (e) => { if (e.target.id === 'calcName') name = e.target.value; });
// teclado do computador: números, Backspace, Enter, + e −
document.addEventListener('keydown', (e) => {
  if (!$('#calc') || location.hash !== '#carrinho' || document.querySelector('.sheet.is-open')) return;
  if (e.target.matches?.('input, textarea, select') && e.target.id !== 'calcName') return;
  if (e.target.id === 'calcName' && e.key !== 'Enter') return;
  if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); }
  else if (e.key === 'Backspace') { e.preventDefault(); press('del'); }
  else if (e.key === 'Enter') { e.preventDefault(); commit(); }
  else if (e.key === '+' ) { e.preventDefault(); press('q+'); }
  else if (e.key === '-') { e.preventDefault(); press('q-'); }
  else if (e.key === 'Escape' && editing) { reset(); C.rerender(); }
});
