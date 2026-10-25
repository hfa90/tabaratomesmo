// Mesma conta, vários aparelhos: o que a pessoa faz num celular aparece nos outros.
// • Cada chave do aparelho (lista, carrinho, ranchos, notas, mercados ligados, casa, tema…) vira uma linha
//   em user_state (supabase/atualizacoes/atualizacao-2026-10-sync-clientes-campanhas.sql). Só a dona da conta lê.
// • Ao entrar na conta: baixa tudo; o mais novo vence. Na primeira vez num aparelho, junta as listas
//   (nada que a pessoa montou sem conta se perde).
// • Depois, cada gravação sobe em até 1 s e chega na hora nos outros aparelhos (Realtime);
//   ao voltar para o app, confere de novo, caso algum aviso tenha se perdido.
import * as api from './api.js';
import { hooks } from './core.js';

// o que acompanha a conta (o resto é do aparelho: localização, cópia offline, avisos já vistos…)
const KEYS = new Set(['tb.list', 'tb.rancho', 'tb.rmode', 'tb.rgroups', 'tb.cart', 'tb.cartMode', 'tb.lastCart', 'tb.history', 'tb.purchases',
  'tb.enabled', 'tb.home', 'tb.transport', 'tb.theme', 'tb.watch', 'tb.drops', 'tb.family', 'tb.famName', 'tb.receipts', 'tb.nfPending',
  'tb.filaBest', 'tb.templates', 'tb.watchB', 'tb.changes', 'tb.welcomeOff', 'tb.adHide', 'tb.campHide', 'tb.notify', 'tb.calcHelp', 'tb.seenHome', 'tb.pushPrefs']);

let uid = null, stopRt = null, pushT = null, applying = false;
let epochAt = 0, epochOk = true;
const queue = new Map();
const raw = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
const stamps = () => { try { return JSON.parse(raw.get('tb.syncAt') || '{}'); } catch { return {}; } };
const setStamp = (k, at) => { const s = stamps(); s[k] = at; raw.set('tb.syncAt', JSON.stringify(s)); };
const device = () => { let d = raw.get('tb.dev'); if (!d) { d = Math.random().toString(36).slice(2, 10); raw.set('tb.dev', d); } return d; };

// junta o que havia no aparelho com o que veio da conta (só na primeira vez neste aparelho)
function merge(key, local, remote) {
  if (local == null) return remote; if (remote == null) return local;
  if (key === 'tb.list') { const m = new Map(remote); for (const [id, q] of local) m.set(id, Math.max(m.get(id) || 0, q)); return [...m]; }
  if (Array.isArray(local) && Array.isArray(remote)) {
    const id = (x) => (x && typeof x === 'object' ? x.key ?? x.id ?? x.at ?? JSON.stringify(x) : x);
    const m = new Map(remote.map((x) => [id(x), x])); for (const x of local) if (!m.has(id(x))) m.set(id(x), x); return [...m.values()];
  }
  if (typeof local === 'object' && typeof remote === 'object' && !Array.isArray(local)) {
    if (key === 'tb.cart' || key === 'tb.rancho') return remote; // estados inteiros: vale o da conta
    return { ...local, ...remote };
  }
  return remote;
}

function apply(key, value, at) {
  applying = true;
  raw.set(key, value == null ? null : JSON.stringify(value));
  setStamp(key, at);
  applying = false;
}

/** gravação local (api.store.set) → sobe para a conta */
function onWrite(k, v) {
  if (!uid || applying || !KEYS.has(k)) return;
  const at = new Date().toISOString();
  setStamp(k, at);
  queue.set(k, { key: k, value: v ?? null, device: device(), updated_at: at });
  clearTimeout(pushT);
  pushT = setTimeout(flush, 900);
}
// ---------------------------------------------------------------- zerar vale para todos os aparelhos
// O perfil guarda uma "época" (history_gen) que sobe quando a pessoa zera o histórico.
// Este aparelho guarda a época com que sincronizou (tb.syncGen). Se a da conta for mais nova,
// os dados daqui são de antes do zerar: apaga tudo deste aparelho e recarrega, sem reenviar nada.
const localGen = () => { const v = raw.get('tb.syncGen'); return v == null ? null : Number(v); };
function hasLocal() { for (const k of KEYS) if (raw.get(k) != null) return true; return false; }
function wipeLocal() {
  try {
    const ks = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('tb.') && !k.startsWith('tb.off.')) ks.push(k); }
    ks.forEach((k) => localStorage.removeItem(k));
  } catch {}
  try { sessionStorage.clear(); } catch {}
}
export async function checkEpoch({ force = false } = {}) {
  if (!uid) return true;
  if (!force && Date.now() - epochAt < 5000) return epochOk;
  const e = await api.profileEpoch();
  epochAt = Date.now();
  if (!e) return (epochOk = true); // banco sem a coluna: nada a conferir
  const lg = localGen();
  const last = Math.max(0, ...Object.values(stamps()).map((t) => Date.parse(t) || 0));
  const resetAt = e.reset_at ? Date.parse(e.reset_at) : 0;
  const stale = lg != null ? lg < e.gen : !!(resetAt && last && hasLocal() && last < resetAt);
  if (stale) {
    epochOk = false; stop();
    wipeLocal();
    raw.set('tb.syncGen', String(e.gen));
    try { sessionStorage.setItem('tb.wipedElsewhere', '1'); } catch {}
    location.replace(location.pathname);
    return false;
  }
  raw.set('tb.syncGen', String(e.gen));
  return (epochOk = true);
}

async function flush() {
  if (!queue.size || !uid) return;
  if (!(await checkEpoch())) return;
  const rows = [...queue.values()]; queue.clear();
  try { await api.statePush(rows, localGen()); }
  catch (e) {
    if (/historico_zerado/.test(e.message)) { checkEpoch({ force: true }); return; } // a conta foi zerada em outro aparelho
    rows.forEach((r) => { if (!queue.has(r.key)) queue.set(r.key, r); }); console.warn('sync', e.message);
  }
}
api.onStoreWrite(onWrite);

async function pull({ first = false } = {}) {
  if (!(await checkEpoch({ force: true }))) return;
  let rows;
  try { rows = await api.stateLoad(); } catch (e) { if (e.code === 'sem_tabela') { stop(); } return; }
  if (!rows) return;
  const st = stamps(); const changed = []; const remote = new Map(rows.map((r) => [r.key, r]));
  for (const key of KEYS) {
    const r = remote.get(key); const localAt = st[key];
    const lraw = raw.get(key); const local = lraw ? JSON.parse(lraw) : null;
    if (r && !localAt && local != null && first) {
      // primeira vez neste aparelho com coisas nos dois lados: junta e sobe o resultado
      const m = merge(key, local, r.value);
      apply(key, m, r.updated_at); changed.push(key);
      if (JSON.stringify(m) !== JSON.stringify(r.value)) onWrite(key, m);
    } else if (r && (!localAt || r.updated_at > localAt)) {
      if (JSON.stringify(local) !== JSON.stringify(r.value)) { apply(key, r.value, r.updated_at); changed.push(key); }
      else setStamp(key, r.updated_at);
    } else if (local != null && (!r || (localAt && localAt > r.updated_at))) {
      onWrite(key, local); // o aparelho tem algo mais novo: sobe
    }
  }
  if (changed.length) hooks.afterSync?.(changed);
}

export async function start(userId) {
  if (api.MODE !== 'live' || uid === userId) return;
  stop(); uid = userId;
  await pull({ first: true });
  if (!uid) return;
  try {
    stopRt = await api.stateChannel(uid, (row) => {
      if (!row) { checkEpoch({ force: true }); return; } // linhas apagadas: pode ter sido um "zerar" em outro aparelho
      if (row.device === device() || !KEYS.has(row.key)) return;
      if (row.updated_at <= (stamps()[row.key] || '')) return;
      apply(row.key, row.value, row.updated_at);
      hooks.afterSync?.([row.key]);
    });
  } catch {}
}
export function stop() { uid = null; stopRt?.(); stopRt = null; clearTimeout(pushT); queue.clear(); }

addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && uid) pull(); else if (uid) flush(); });
addEventListener('pagehide', () => { if (uid) flush(); });
