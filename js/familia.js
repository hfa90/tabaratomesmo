// Lista da família: a mesma Lista do mês em vários celulares, ao vivo.
// • "Fazer junto com a família" cria um código (ex.: K7QM-2XPA) e um link para mandar no WhatsApp.
// • Quem abre o link entra na lista: os itens das duas listas se juntam.
// • Cada mudança (pôr, tirar, marcar "já peguei") é gravada no Supabase e avisada na hora
//   pelo canal ao vivo; a cada 20 s confere de novo, caso algum aviso tenha se perdido.
// • Sem o SQL instalado (ou sem internet), o botão manda a lista por link para importar.
import * as api from './api.js';
import { S, $, esc, hooks } from './core.js';
import { ic } from './icons.js';
import * as fx from './fx.js';

let code = api.store.get('tb.family', null);   // código da lista da família (sem traço)
let ch = null, pushT = null, pollT = null, lastAt = null, applying = false;
let members = 1;

const fmt = (c) => (c ? `${c.slice(0, 4)}-${c.slice(4)}` : '');
const myName = () => (S.profile?.full_name || S.user?.user_metadata?.full_name || api.store.get('tb.famName', '') || '').split(' ')[0];
const state = () => ({
  items: [...S.list].map(([product_id, qty]) => ({ product_id, qty })),
  checked: [...(S.rancho?.checked || [])],
  name: S.rancho?.name || 'Lista da família', month: S.rancho?.month || new Date().toISOString().slice(0, 7),
});
const link = (c) => `${location.origin}${location.pathname}#lista?familia=${c}`;
const pname = (id) => S.products.find((p) => p.id === id)?.name || 'um item';

export const active = () => !!code;

// ---------------------------------------------------------------- aplicar o que veio da família
function describe(before, after) {
  const bItems = new Map(before.items.map((i) => [i.product_id, i.qty])), aItems = new Map(after.items.map((i) => [i.product_id, i.qty]));
  const bChk = new Set(before.checked), aChk = new Set(after.checked);
  for (const id of aChk) if (!bChk.has(id)) return `marcou ${pname(id)}`;
  for (const [id] of aItems) if (!bItems.has(id)) return `pôs ${pname(id)}`;
  for (const [id] of bItems) if (!aItems.has(id)) return `tirou ${pname(id)}`;
  return 'mudou a lista';
}
function apply(remote, { by = null, silent = false } = {}) {
  if (!remote) return;
  const before = state();
  applying = true;
  S.list = new Map((remote.items || []).map((i) => [Number(i.product_id), Number(i.qty) || 1]));
  if (!S.rancho) S.rancho = { name: remote.name || 'Lista da família', month: remote.month || before.month, status: 'aberta', checked: [] };
  S.rancho.checked = (remote.checked || []).map(Number).filter((id) => S.list.has(id));
  if (remote.name) S.rancho.name = remote.name;
  api.store.set('tb.list', [...S.list]); api.store.set('tb.rancho', S.rancho);
  if (remote.members) members = remote.members;
  if (remote.updated_at) lastAt = remote.updated_at;
  hooks.afterListLoad?.();
  applying = false;
  if (!silent && (by || remote.updated_by)) {
    const after = state();
    if (JSON.stringify(before) !== JSON.stringify(after)) { hooks.toast?.(`${by || remote.updated_by} ${describe(before, after)}.`); fx.haptic('tap'); }
  }
  render();
}

// ---------------------------------------------------------------- enviar mudanças
/** chamado pela lista sempre que algo muda (rancho.persist) */
export function changed() {
  if (!code || applying) return;
  clearTimeout(pushT);
  pushT = setTimeout(async () => {
    const s = state(); const by = myName() || 'Alguém da família';
    ch?.send({ ...s, by });
    try { lastAt = await api.familyPut(code, s.name, s.month, s.items, s.checked, by); } catch (e) { console.warn('família', e); }
  }, 500);
}

async function connect() {
  if (!code) return;
  ch?.close(); ch = null;
  try { ch = await api.familyChannel(code, (p) => apply(p, { by: p.by })); } catch {}
  clearInterval(pollT);
  pollT = setInterval(async () => {
    if (document.hidden || !code) return;
    try { const r = await api.familyGet(code); if (r && r.updated_at !== lastAt) apply(r, { silent: false }); } catch {}
  }, 20000);
}

// ---------------------------------------------------------------- criar, entrar, sair
async function create() {
  const s = state();
  try {
    code = await api.familyCreate(s.name, s.month, s.items, s.checked, myName() || null);
    api.store.set('tb.family', code); members = 1;
    await connect(); render(); showShare();
  } catch (e) {
    if (e.code === 'sem_funcao' || !navigator.onLine) return showLinkOnly();
    hooks.toast?.('Não deu para criar a lista da família agora. Tente de novo.', 'warn');
  }
}
async function join(c) {
  c = String(c).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length !== 8) return hooks.toast?.('Esse código não parece certo. Ele tem 8 letras e números.', 'warn');
  try {
    const r = await api.familyJoin(c);
    // junta o que já estava no celular com a lista da família
    const mine = state();
    const items = new Map((r.items || []).map((i) => [Number(i.product_id), Number(i.qty)]));
    for (const i of mine.items) items.set(i.product_id, Math.max(items.get(i.product_id) || 0, i.qty));
    const merged = { ...r, items: [...items].map(([product_id, qty]) => ({ product_id, qty })), checked: [...new Set([...(r.checked || []), ...mine.checked])] };
    code = c; api.store.set('tb.family', code);
    apply(merged, { silent: true });
    await connect(); changed();
    hooks.toast?.(`Pronto! Você entrou na lista da família (${merged.items.length} itens).`);
    fx.haptic('success');
  } catch (e) {
    hooks.toast?.(e.code === 'sem_funcao' ? 'A lista da família ainda não foi ativada no site.' : 'Código não encontrado. Confira e tente de novo.', 'warn');
  }
}
function leave() {
  ch?.close(); ch = null; clearInterval(pollT);
  code = null; api.store.set('tb.family', null);
  hooks.closeSheet?.('#toolSheet');
  hooks.toast?.('Você saiu da lista da família. A lista continua no seu celular.');
  render();
}

// ---------------------------------------------------------------- telas
function sheet(html) {
  const body = $('#toolBody'); body.innerHTML = `<div class="tool fam">${html}</div>`;
  $('#toolSheet').dataset.tool = 'familia';
  if ($('#toolSheet').hidden) hooks.openSheet('#toolSheet');
}
function shareLinks(url, text) {
  return `<div class="tool__actions">
    <a class="btn btn--primary btn--xl" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}">${ic('send')} Mandar no WhatsApp</a>
    <button class="btn btn--ghost btn--block" data-fam="copy" data-url="${esc(url)}">${ic('copy')} Copiar o link</button></div>`;
}
function showShare() {
  sheet(`<h2 class="sheet__title" id="toolTitle"><span aria-hidden="true">${ic('users')}</span> Lista da família</h2>
    <p class="tool__lead">Quem abrir o link entra na mesma lista. Tudo que um puser ou marcar aparece na hora para os outros.</p>
    <div class="fam-code"><small>Código da lista</small><b>${fmt(code)}</b><span>${members > 1 ? `${members} pessoas na lista` : 'Só você por enquanto'}</span></div>
    ${!myName() ? `<label class="fam-name">Como a família te chama? <input id="famName" maxlength="20" placeholder="Ex.: Mãe, Ana, Pedro" /></label>` : ''}
    ${shareLinks(link(code), 'Vamos fazer o rancho juntos? Entra na nossa lista do Tá Barato Mesmo?:')}
    <button class="btn btn--text btn--block" data-fam="leave">Sair da lista da família</button>`);
}
function showLinkOnly() {
  // sem a função no banco: manda a lista por link (a outra pessoa importa uma cópia)
  const s = state();
  const data = btoa(unescape(encodeURIComponent(JSON.stringify(s.items.map((i) => [i.product_id, i.qty]))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const url = `${location.origin}${location.pathname}#lista?importar=${data}`;
  sheet(`<h2 class="sheet__title" id="toolTitle"><span aria-hidden="true">${ic('users')}</span> Mandar a lista</h2>
    <p class="tool__lead">Quem abrir o link recebe uma cópia da sua lista (${s.items.length} itens) e vê onde ela sai mais barata.</p>
    ${shareLinks(url, 'Olha a lista do rancho:')}`);
}
function askJoin(c) {
  sheet(`<h2 class="sheet__title" id="toolTitle"><span aria-hidden="true">${ic('users')}</span> Entrar na lista da família?</h2>
    <p class="tool__lead">Alguém te convidou para fazer o rancho junto. Os itens que você já tem continuam e se juntam aos da família.</p>
    <div class="fam-code"><small>Código</small><b>${fmt(c)}</b></div>
    ${!myName() ? `<label class="fam-name">Como a família te chama? <input id="famName" maxlength="20" placeholder="Ex.: Mãe, Ana, Pedro" /></label>` : ''}
    <div class="tool__actions"><button class="btn btn--primary btn--xl" data-fam="join" data-code="${esc(c)}">${ic('check')} Entrar na lista</button>
    <button class="btn btn--text" data-close>Agora não</button></div>`);
}
function askImport(items) {
  sheet(`<h2 class="sheet__title" id="toolTitle"><span aria-hidden="true">${ic('list')}</span> Receber esta lista?</h2>
    <p class="tool__lead">${items.length} itens vão entrar na sua Lista do mês (os que você já tem continuam).</p>
    <div class="tool__actions"><button class="btn btn--primary btn--xl" data-fam="import">${ic('check')} Pôr na minha lista</button><button class="btn btn--text" data-close>Agora não</button></div>`);
  pendingImport = items;
}
let pendingImport = null;

/** faixa no topo da Lista do mês */
export function render() {
  const el = $('#famBox'); if (!el) return;
  el.innerHTML = code
    ? `<button class="fam-bar is-on" data-fam="open"><span class="fam-bar__i">${ic('users')}</span><span><b>Lista da família</b><small>${members > 1 ? `${members} pessoas` : 'código'} · ${fmt(code)} · ao vivo</small></span><span class="fam-dot" aria-hidden="true"></span></button>`
    : S.list.size ? `<button class="fam-bar" data-fam="new"><span class="fam-bar__i">${ic('users')}</span><span><b>Fazer junto com a família</b><small>A mesma lista em vários celulares, marcando ao vivo</small></span>${ic('arrow')}</button>` : '';
}

// ---------------------------------------------------------------- eventos
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-fam]'); if (!b) return;
  const nameIn = $('#famName'); if (nameIn?.value.trim()) api.store.set('tb.famName', nameIn.value.trim().slice(0, 20));
  const a = b.dataset.fam;
  if (a === 'new') return create();
  if (a === 'open') { try { const r = await api.familyGet(code); if (r?.members) members = r.members; } catch {} return showShare(); }
  if (a === 'copy') { try { await navigator.clipboard.writeText(b.dataset.url); hooks.toast?.('Link copiado.'); } catch { prompt('Copie o link:', b.dataset.url); } return; }
  if (a === 'leave') return leave();
  if (a === 'join') { hooks.closeSheet?.('#toolSheet'); return join(b.dataset.code); }
  if (a === 'import' && pendingImport) {
    for (const [pid, q] of pendingImport) if (S.products.some((p) => p.id === pid)) S.list.set(pid, Math.max(S.list.get(pid) || 0, q));
    api.store.set('tb.list', [...S.list]); hooks.afterListLoad?.(); hooks.closeSheet?.('#toolSheet');
    hooks.toast?.('Lista recebida. Veja em qual mercado ela sai mais barata.'); fx.haptic('success'); pendingImport = null;
  }
});

/** link de convite (#lista?familia=CODIGO) ou de cópia (#lista?importar=...) */
function fromHash() {
  const q = new URLSearchParams((location.hash.split('?')[1] || ''));
  const fam = q.get('familia'), imp = q.get('importar');
  if (!fam && !imp) return;
  history.replaceState(null, '', '#lista');
  if (fam) { const c = fam.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (c === code) return; return setTimeout(() => askJoin(c), 400); }
  try {
    const items = JSON.parse(decodeURIComponent(escape(atob(imp.replace(/-/g, '+').replace(/_/g, '/'))))).filter((x) => Array.isArray(x)).map(([a, b]) => [Number(a), Number(b) || 1]);
    if (items.length) setTimeout(() => askImport(items), 400);
  } catch {}
}
addEventListener('hashchange', fromHash);

/** depois que o catálogo carregou */
export async function init() {
  fromHash();
  if (code) {
    try { const r = await api.familyGet(code); if (r) apply(r, { silent: true }); else { code = null; api.store.set('tb.family', null); } } catch {}
    await connect(); render();
  }
}
