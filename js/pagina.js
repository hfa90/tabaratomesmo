// Comum às páginas avulsas (privacidade.html e mercado.html): mensagens curtas e a conta, se houver.
import * as api from './api.js';
import { S, hooks } from './core.js';

hooks.toast = (msg, kind) => {
  const wrap = document.getElementById('toasts'); if (!wrap) return;
  const el = Object.assign(document.createElement('div'), { className: `toast ${kind ? 'toast--' + kind : ''}`, textContent: msg });
  wrap.append(el); requestAnimationFrame(() => el.classList.add('is-in'));
  setTimeout(() => { el.classList.remove('is-in'); setTimeout(() => el.remove(), 300); }, 5200);
};
export function initAccount() {
  api.onAuth((u) => { S.user = u; });
  return api.initAuth().catch(() => {});
}
