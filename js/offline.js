// Sem sinal dentro do mercado: o catálogo fica salvo no aparelho e o que a pessoa envia
// (preços vistos, códigos ensinados, fotos de etiqueta, eventos) espera numa fila até a internet voltar.
// Guarda em IndexedDB; se o navegador não deixar, usa localStorage para o catálogo e segue sem fila.

const DB = 'tb-offline', VER = 1;
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    if (!('indexedDB' in window)) return rej(new Error('sem IndexedDB'));
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}
const tx = async (store, mode, fn) => {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode); const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => res(out?.result ?? out);
    t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
};

// ---------------------------------------------------------------- cópia guardada (catálogo, descontos…)
export async function save(key, value) {
  try { await tx('kv', 'readwrite', (s) => s.put({ at: new Date().toISOString(), value }, key)); }
  catch { try { localStorage.setItem('tb.off.' + key, JSON.stringify({ at: new Date().toISOString(), value })); } catch {} }
}
export async function read(key) {
  try { const r = await tx('kv', 'readonly', (s) => s.get(key)); if (r) return r; } catch {}
  try { const v = localStorage.getItem('tb.off.' + key); return v ? JSON.parse(v) : null; } catch { return null; }
}

// ---------------------------------------------------------------- fila de envios
const handlers = {}; // kind → async (payload) => void (registrado pelo api.js)
export function handle(kind, fn) { handlers[kind] = fn; }

export async function queue(kind, payload) {
  try { await tx('outbox', 'readwrite', (s) => s.add({ kind, payload, at: new Date().toISOString() })); }
  catch { return false; }
  status();
  return true;
}
export async function pending() {
  try { return await tx('outbox', 'readonly', (s) => s.getAll()); } catch { return []; }
}

let flushing = false;
/** tenta mandar o que está na fila; o que falhar por rede continua lá */
export async function flush() {
  if (flushing || !navigator.onLine) return 0;
  flushing = true; let sent = 0;
  try {
    for (const it of await pending()) {
      const fn = handlers[it.kind];
      try {
        if (fn) await fn(it.payload);
        sent++;
      } catch (e) {
        if (isNetworkError(e)) break; // ainda sem conexão de verdade
        // erro de regra (valor fora do normal, limite do dia…): descarta para não travar a fila
      }
      await tx('outbox', 'readwrite', (s) => s.delete(it.id)).catch(() => {});
    }
  } finally { flushing = false; status(); }
  if (sent) onSent?.(sent);
  return sent;
}
let onSent = null;
export function onFlush(cb) { onSent = cb; }

export const isNetworkError = (e) => !navigator.onLine || e instanceof TypeError || /failed to fetch|network|load failed|timeout|fetch/i.test(String(e?.message || e));

// ---------------------------------------------------------------- aviso na tela
let savedAt = null, usingSaved = false;
/** iso = quando a cópia foi salva; using = o app está mostrando a cópia (o banco não respondeu) */
export function setSavedAt(iso, using = false) { savedAt = iso; usingSaved = using; status(); }
async function status() {
  const el = document.getElementById('netPill'); if (!el) return;
  const n = (await pending()).length;
  const off = !navigator.onLine || usingSaved;
  document.body.classList.toggle('is-offline', off);
  if (!off && !n) { el.hidden = true; return; }
  el.hidden = false;
  const when = savedAt ? new Date(savedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null;
  el.innerHTML = off
    ? `<span aria-hidden="true">📴</span><span><b>${navigator.onLine ? 'Sem conexão com o site.' : 'Sem internet.'}</b> Tudo continua funcionando${when ? ` com os preços salvos em ${when}` : ''}.${n ? ` ${n} ${n > 1 ? 'envios esperando' : 'envio esperando'}.` : ''}</span>`
    : `<span aria-hidden="true">📤</span><span>Enviando ${n} ${n > 1 ? 'coisas' : 'coisa'} que ficaram na fila…</span>`;
}
addEventListener('online', () => { status(); flush(); });
addEventListener('offline', status);
export { status };
