// Retorno ao toque: vibração curta e animações pequenas que confirmam cada ação.
// • haptic(): vibra de leve (Android; no iPhone o navegador não deixa e nada acontece).
// • flyTo(): uma bolinha sai do botão tocado e "voa" até a aba da Lista ou do Mercado.
// • bump(): o contador ou o botão dá um pulinho.
// Tudo respeita "reduzir movimento" do celular e pode ser desligado em Você (tb.haptics = false).
import { reduceMotion } from './core.js';

const PATTERNS = { tap: 8, success: [10, 40, 16], warn: [30, 50, 30], remove: 14 };
const on = () => { try { return localStorage.getItem('tb.haptics') !== 'false'; } catch { return true; } };

export function haptic(kind = 'tap') {
  if (!on()) return;
  try { navigator.vibrate?.(PATTERNS[kind] ?? 8); } catch {}
}

export function bump(el, cls = 'fx-bump') {
  if (!el || reduceMotion) return;
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

/** alvo visível da aba (barra do celular ou menu do computador) */
function tabTarget(nav) {
  const cands = [...document.querySelectorAll(`.tabbar [data-nav="${nav}"], .topnav [data-nav="${nav}"]`)];
  return cands.find((el) => el.offsetParent !== null && el.getBoundingClientRect().width > 0) || null;
}

export function flyTo(fromEl, nav) {
  const target = tabTarget(nav);
  if (!fromEl || !target) return;
  const a = fromEl.getBoundingClientRect(), b = (target.querySelector('svg') || target).getBoundingClientRect();
  const done = () => { bump(target.querySelector('.badge:not([hidden])') || target.querySelector('svg') || target); };
  if (reduceMotion || !a.width) return done();
  const dot = document.createElement('span');
  dot.className = 'fx-dot';
  const x0 = a.left + a.width / 2, y0 = a.top + a.height / 2, x1 = b.left + b.width / 2, y1 = b.top + b.height / 2;
  dot.style.left = `${x0}px`; dot.style.top = `${y0}px`;
  document.body.append(dot);
  const dx = x1 - x0, dy = y1 - y0;
  const anim = dot.animate([
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
    { transform: `translate(calc(-50% + ${dx * 0.5}px), calc(-50% + ${dy * 0.5 - 60}px)) scale(1.1)`, opacity: 1, offset: 0.5 },
    { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.4)`, opacity: 0.2 },
  ], { duration: 560, easing: 'cubic-bezier(.3,.7,.4,1)' });
  anim.onfinish = () => { dot.remove(); done(); };
}

// ---------------------------------------------------------------- ligações automáticas
// fase de captura: pega a posição do botão antes de ele virar o "− 1 +"
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-add], [data-inc], [data-dec], [data-fav], .chip, .tool-chip, [data-dday]'); if (!t) return;
  if (t.dataset.add) { haptic('success'); flyTo(t, 'lista'); return; }
  if (t.dataset.inc) { haptic('tap'); return; }
  if (t.dataset.dec) { haptic('remove'); return; }
  if (t.dataset.fav) { haptic('tap'); bump(t, 'fx-pop'); return; }
  haptic('tap');
}, true);

// marcar "já peguei" na lista
document.addEventListener('change', (e) => {
  const t = e.target; if (!t.matches?.('[data-check]')) return;
  if (t.checked) { haptic('success'); bump(t.closest('.tick') || t, 'fx-pop'); } else haptic('remove');
});
