// Calculadora do caixa — tela cheia, visual limpo e didático (segue o tema claro/escuro do app).
// • Teclado de maquininha: 1 2 9 0 = R$ 12,90. "×" multiplica pela quantidade, "+" soma o item.
// • Guia de passos (Preço → Quantidade → Somar) acende conforme a pessoa digita; teclas têm legenda.
// • A carteira fica no topo: antes de somar já mostra "sobra R$ X" ou "passa R$ Y".
// • Tela travada: sem rolar, sem zoom de toque duplo ou pinça, sem gesto que leve para outra página
//   (o "voltar" do celular só fecha a calculadora).
// • "=" fecha a compra: confere se o caixa cobrou o valor previsto e lembra de mandar a nota fiscal.
// Os valores entram no mesmo carrinho (um total só); lista com editar/excluir e histórico com desfazer.
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

// ícones de traço (sem emoji): herdam a cor do texto
const svg = (d, w = 2) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  back: svg('<path d="M21 6H9l-6 6 6 6h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1z"/><path d="M17 10l-4 4M13 10l4 4"/>'),
  list: svg('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  wallet: svg('<path d="M19 7V5a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4"/><path d="M3 6v12a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-3"/><path d="M21 12h-4a2 2 0 0 0 0 4h4z"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 2.4),
  tag: svg('<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.2"/>'),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  trash: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  receipt: svg('<path d="M5 3v18l2.5-1.5L10 21l2-1.5 2 1.5 2.5-1.5L19 21V3l-2.5 1.5L14 3l-2 1.5L10 3 7.5 4.5z"/><path d="M9 9h6M9 13h6"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.4"/><path d="M12 17h.01"/>'),
  alert: svg('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'),
  down: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  law: svg('<path d="M12 3v18M5 21h14M6 7h12M6 7l-3 7a3 3 0 0 0 6 0zM18 7l-3 7a3 3 0 0 0 6 0z"/>'),
  calc: svg('<rect x="5" y="2.5" width="14" height="19" rx="2.5"/><path d="M8.5 6.5h7M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M15.5 14.5h.01M8.5 18h.01M12 18h3.5"/>'),
};

function hint() {
  if (mode === 'wallet') return 'Quanto você tem para gastar? Digite e toque em <b>OK</b>.';
  if (mode === 'paid') return 'Quanto deu no caixa? Digite e toque em <b>OK</b>.';
  const add = editing ? subtotal() - editingValue() : subtotal();
  const w = wallet(price ? add : 0);
  const what = stage === 'qty' ? `${fmt(cents())} × ${qtyTxt || '…'} = <b>${fmt(subtotal())}</b> · ` : '';
  if (!w.b) return price ? `${what}o total vai para <b>${fmt(w.after)}</b>` : 'Digite só os números da etiqueta: <b>1 2 9 0</b> vira R$ 12,90';
  if (w.left < 0) return `<span class="is-bad">${what}passa <b>${fmt(-w.left)}</b> do que você tem</span>`;
  return `<span class="${w.left < w.b * 0.1 ? 'is-near' : 'is-good'}">${what}${price ? 'ainda sobra' : 'pode gastar'} <b>${fmt(w.left)}</b></span>`;
}

// passo atual do guia: 1 preço · 2 quantidade · 3 somar
const stepNow = () => (stage === 'qty' ? 2 : price ? 3 : 1);
function stepsHTML() {
  if (mode !== 'calc') return `<div class="cf-steps cf-steps--mode" id="cfSteps">${mode === 'wallet' ? `${I.wallet}<span>Digite quanto você tem e toque em <b>OK</b></span>` : `${I.receipt}<span>Digite o valor que o caixa cobrou e toque em <b>OK</b></span>`}</div>`;
  const s = stepNow();
  const st = (n, key, t, sub) => {
    const cls = s === n ? 'is-on' : n < s && !(n === 2 && s === 3) ? 'is-done' : '';
    return `<li class="${cls}"><span class="cf-steps__n">${cls === 'is-done' ? I.check : n}</span><span class="cf-steps__t"><b>${t}</b><small>${sub}</small></span>${key ? `<kbd>${key}</kbd>` : ''}</li>`;
  };
  return `<ol class="cf-steps" id="cfSteps" aria-label="Como somar um item">
    ${st(1, '', 'Preço', 'digite')}${st(2, '×', 'Qtd.', 'opcional')}${st(3, '+', editing ? 'Salvar' : 'Somar', 'no total')}
  </ol>`;
}

// ---------------------------------------------------------------- tela cheia
// [tecla, símbolo, estilo, legenda]
const KEYS = [
  ['ac', 'C', 'fn', 'limpar'], ['del', I.back, 'fn', 'apagar'], ['fita', I.list, 'fn', 'lista'], ['x', '×', 'op', 'quantidade'],
  ['7', '7'], ['8', '8'], ['9', '9'], ['undo', I.undo, 'op', 'desfazer'],
  ['4', '4'], ['5', '5'], ['6', '6'], ['wallet', I.wallet, 'op', 'carteira'],
  ['1', '1'], ['2', '2'], ['3', '3'], ['add', '+', 'add', 'somar'],
  ['0', '0', 'zero'], ['00', '00'], ['end', '=', 'eq', 'finalizar'],
];
const ARIA = { ac: 'Limpar tudo', del: 'Apagar o último número', fita: 'Ver a lista de itens', x: 'Multiplicar pela quantidade', undo: 'Desfazer', wallet: 'Quanto tenho na carteira' };

function screenHTML() {
  const c = C.st(); const w = wallet(); const n = c.items.length;
  const isPad = mode !== 'calc';
  const last = c.items.slice(0, 1);
  const wcls = w.b ? (w.t > w.b ? 'is-over' : w.t > w.b * 0.9 ? 'is-near' : 'is-ok') : 'is-empty';
  return `
  <div class="cf-top">
    <button class="cf-ib" data-cf="close" aria-label="Fechar a calculadora">${I.close}</button>
    <button class="cf-wallet ${wcls}" data-cf="wallet" aria-label="Definir quanto posso gastar">
      ${w.b ? `<span class="cf-wallet__row"><span>${I.wallet}<b>${fmt(w.b)}</b></span><span class="cf-wallet__st">${w.t > w.b ? `passou ${fmt(w.t - w.b)}` : `sobra ${fmt(w.b - w.t)}`}</span></span>
        <i class="cf-wallet__bar"><b style="--w:${Math.min(w.t / w.b, 1) * 100}%"></b></i>`
      : `<span class="cf-wallet__row"><span>${I.wallet} Quanto você pode gastar?</span><span class="cf-wallet__cta">${I.plus} definir</span></span>`}
    </button>
    <button class="cf-ib" data-cf="help" aria-label="Como usar">${I.help}</button>
  </div>
  <div class="cf-screen">
    <div class="cf-screen__head">
      ${mode === 'calc' ? `<span class="cf-count">${n} ${n === 1 ? 'item' : 'itens'} · total <b>${fmt(w.t)}</b></span>` : '<span></span>'}
      ${editing ? `<span class="cf-tag">${I.edit} editando</span>` : ''}${mode === 'wallet' ? `<span class="cf-tag">${I.wallet} carteira</span>` : ''}${mode === 'paid' ? `<span class="cf-tag">${I.receipt} valor do caixa</span>` : ''}
    </div>
    <div class="cf-last">${mode === 'calc' && !editing ? last.map((i) => `<span><em>${esc(i.name)}</em><b>${i.qty > 1 ? `${i.qty} × ` : ''}${fmt(i.price)}</b></span>`).join('') : ''}</div>
    <output class="cf-val ${stage === 'qty' && !isPad ? 'is-qty' : ''} ${price ? '' : 'is-zero'}" id="cfVal">${valHTML()}</output>
    <p class="cf-hint" id="cfHint">${hint()}</p>
    ${mode === 'calc' ? `<button class="cf-name" data-cf="name">${I.tag}<span>${name ? esc(name) : 'Dar nome ao item (opcional)'}</span></button>` : ''}
  </div>
  ${stepsHTML()}
  <div class="cf-pad ${isPad ? 'is-input' : ''}">
    ${KEYS.map(([k, label, cls = 'num', cap = '']) => {
      if (isPad && ['fita', 'x', 'undo', 'wallet'].includes(k)) return `<span class="cf-k cf-k--off" aria-hidden="true"></span>`;
      let lbl = label, c2 = cap;
      if (k === 'add') { lbl = isPad ? 'OK' : editing ? I.check : '+'; c2 = isPad ? 'confirmar' : editing ? 'salvar' : 'somar'; }
      if (k === 'end' && isPad) { lbl = I.close; c2 = 'cancelar'; }
      const aria = ARIA[k] || (k === 'add' ? (isPad ? 'Confirmar' : editing ? 'Salvar o item' : 'Somar o item') : k === 'end' ? (isPad ? 'Cancelar' : 'Finalizar a compra') : label);
      const next = k === 'add' && price && mode === 'calc' ? ' is-next' : '';
      return `<button class="cf-k cf-k--${cls}${next}" data-cf="${k}" aria-label="${aria}"><span class="cf-k__s">${lbl}</span>${c2 ? `<small class="cf-k__c">${c2}</small>` : ''}${k === 'fita' && n ? `<sup>${n}</sup>` : ''}</button>`;
    }).join('')}
  </div>
  ${panel ? panelHTML() : ''}`;
}
function valHTML() { return `${fmt(cents())}${stage === 'qty' && mode === 'calc' ? `<em> × ${qtyTxt || '_'}</em>` : ''}`; }

function panelHTML() {
  const c = C.st();
  if (panel === 'help') {
    return `<div class="cf-panel"><div class="cf-panel__in cf-scroll cf-help">
      <div class="cf-tabs"><h2>Como usar</h2><button class="cf-ib cf-tabs__x" data-cf="panel-close" aria-label="Fechar">${I.close}</button></div>
      <ol class="cf-guide">
        <li><span class="cf-guide__n">1</span><div><b>Digite o preço da etiqueta</b><p>Só os números, sem vírgula. <span class="cf-chips"><kbd>1</kbd><kbd>2</kbd><kbd>9</kbd><kbd>0</kbd></span> vira <b>R$&nbsp;12,90</b></p></div></li>
        <li><span class="cf-guide__n">2</span><div><b>Levou mais de um?</b><p>Toque <kbd class="op">×</kbd> e digite a quantidade. Ex.: <b>R$&nbsp;12,90&nbsp;×&nbsp;3</b></p></div></li>
        <li><span class="cf-guide__n">3</span><div><b>Some ao total</b><p>Toque <kbd class="add">+</kbd>. O valor entra na conta e o visor zera para o próximo item.</p></div></li>
      </ol>
      <ul class="cf-tips">
        <li>${I.wallet}<span><b>Carteira</b> mostra quanto ainda sobra antes de você somar.</span></li>
        <li>${I.list}<span><b>Lista</b> mostra tudo que foi somado, para corrigir ou excluir.</span></li>
        <li>${I.undo}<span><b>Desfazer</b> volta a última ação.</span></li>
        <li><kbd class="eq">=</kbd><span><b>Finalizar</b> no caixa: confere se cobraram o valor certo.</span></li>
      </ul>
      <button class="cf-btn cf-btn--ok" data-cf="panel-close">Entendi, começar</button>
    </div></div>`;
  }
  if (panel === 'end') {
    const t = C.total();
    return `<div class="cf-panel cf-end"><div class="cf-panel__in">
      <p class="cf-step-lbl">Conferir no caixa</p>
      <h2>Terminou de somar?</h2>
      <p class="cf-big">${fmt(t)}</p><p class="cf-sub">${c.items.length} ${c.items.length === 1 ? 'item' : 'itens'} na sua conta</p>
      <p class="cf-note">Na hora de pagar, compare com o valor que o caixa cobrou.</p>
      <button class="cf-btn cf-btn--ok" data-cf="paid-same">${I.check} Deu exatamente ${fmt(t)}</button>
      <button class="cf-btn" data-cf="paid-other">${I.edit} Deu outro valor</button>
      <button class="cf-btn cf-btn--text" data-cf="panel-close">Continuar somando</button>
    </div></div>`;
  }
  if (panel === 'result') {
    const d = Math.round((result.paid - result.predicted) * 100) / 100;
    const kind = Math.abs(d) < 0.01 ? 'ok' : d > 0 ? 'bad' : 'good';
    return `<div class="cf-panel cf-end"><div class="cf-panel__in">
      <span class="cf-badge cf-badge--${kind}">${kind === 'ok' ? I.check : kind === 'bad' ? I.alert : I.down}</span>
      <h2>${kind === 'ok' ? 'Bateu certinho' : kind === 'bad' ? `O caixa cobrou ${fmt(d)} a mais` : `Saiu ${fmt(-d)} mais barato`}</h2>
      <div class="cf-cmp"><span><small>Sua conta</small><b>${fmt(result.predicted)}</b></span><span><small>Caixa</small><b>${fmt(result.paid)}</b></span></div>
      ${d > 0.009 ? `<p class="cf-law">${I.law}<span>Se a etiqueta mostrava preço menor, <b>vale o menor</b> (Lei 10.962/2004). A nota fiscal mostra item por item: dá para achar a diferença e pedir no balcão.</span></p>` : ''}
      <div class="cf-nf">${I.receipt}<div><b>Agora mande a nota fiscal</b><small>Ela organiza o seu rancho (gastos por mês e por mercado), confere item por item o que o caixa cobrou e vale pontos e comparações extras.</small></div></div>
      <button class="cf-btn cf-btn--ok" data-cf="nf-now">${I.receipt} Mandar a nota agora</button>
      <button class="cf-btn cf-btn--text" data-cf="nf-later">Depois (vou lembrar você)</button>
    </div></div>`;
  }
  const tape = c.items.slice().reverse(); const logs = c.log || [];
  return `<div class="cf-panel"><div class="cf-panel__in cf-scroll">
    <div class="cf-tabs"><button class="${panel === 'fita' ? 'is-on' : ''}" data-cf="tab-fita">${I.list} Lista</button><button class="${panel === 'log' ? 'is-on' : ''}" data-cf="tab-log">${I.clock} Histórico</button>
      <button class="cf-ib cf-tabs__x" data-cf="panel-close" aria-label="Voltar ao teclado">${I.close}</button></div>
    ${panel === 'fita' ? (tape.length ? `<ol class="cf-tape">${tape.map((i, k) => `<li><span class="n">${k + 1}</span><span class="t"><b>${esc(i.name)}</b>${i.qty > 1 ? `<small>${i.qty} × ${fmt(i.price)}</small>` : ''}</span><b class="v">${fmt((i.price || 0) * i.qty)}</b>
        <button data-cf-edit="${i.id}" aria-label="Editar">${I.edit}</button><button class="is-del" data-cf-del="${i.id}" aria-label="Excluir">${I.trash}</button></li>`).join('')}</ol>
        <div class="cf-sum"><span>Total</span><b>${fmt(C.total())}</b></div>` : '<p class="cf-empty">Nada somado ainda. Digite um preço e toque em <b>+</b>.</p>')
    : (logs.length ? `<ul class="cf-log">${logs.map((l) => `<li><span class="cf-log__i is-${l.kind}">${{ add: I.plus, edit: I.edit, del: I.trash, undo: I.undo }[l.kind]}</span><span>${logText(l)}<small>${new Date(l.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small></span>
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
  v.innerHTML = valHTML(); v.classList.toggle('is-zero', !price); v.classList.toggle('is-qty', stage === 'qty' && mode === 'calc');
  h.innerHTML = hint();
  const s = $('#cfSteps'); if (s) s.outerHTML = stepsHTML();
  $('.cf-pad [data-cf="add"]')?.classList.toggle('is-next', !!price && mode === 'calc');
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
  try { if (!localStorage.getItem('tb.calcHelp')) { panel = 'help'; localStorage.setItem('tb.calcHelp', '1'); } } catch {}
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
  C.save(); draw(); flashHint('Desfeito.');
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
    <button class="calc-open" data-cf="open"><span class="calc-open__i" aria-hidden="true">${I.calc}</span>
      <span><b>Abrir a calculadora</b><small>Tela cheia, teclado grande e passo a passo</small></span></button>
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
  if (k === 'help') { panel = 'help'; return draw(); }
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
