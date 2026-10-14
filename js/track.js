// Fila de eventos de uso (buscas, produtos vistos, itens no rancho, rotas).
// Vai em lotes para a função track() do banco; serve para as métricas agregadas
// que os supermercados veem no portal. Nada de nome, e-mail ou posição exata.
import * as api from './api.js';
import { S } from './core.js';

const q = [];
let timer = null;
const session = (() => {
  try {
    let s = sessionStorage.getItem('tb.sid');
    if (!s) { s = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('tb.sid', s); }
    return s;
  } catch { return 'x' + Date.now(); }
})();

export function track(kind, data = {}) {
  q.push({ kind, session, neighborhood: S.pos?.label && S.pos.label !== 'Sua localização' ? S.pos.label : null, ...data });
  clearTimeout(timer);
  timer = setTimeout(flush, q.length >= 20 ? 0 : 4000);
}

export function flush() {
  if (!q.length) return;
  const batch = q.splice(0, 50);
  api.track(batch).catch(() => {});
}
addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
