// "Zerar meu histórico" (Você › Preferências): a pessoa recomeça como se fosse nova.
// • No celular: apaga lista, carrinho, ranchos, economia, notas guardadas, favoritos, pontos vistos,
//   lista da família, preferências e a página inicial volta a aparecer.
// • Na conta: o banco marca a data do recomeço (reset_my_history); listas, notas, preços enviados e
//   métricas continuam guardados para os supermercados e a administração, só não aparecem mais para ela.
// • Continua: a conta (e-mail e senha), o cadastro, a cópia dos preços para usar sem internet e
//   os envios que ainda estavam na fila sem internet (eles ajudam o site).
import * as api from './api.js';
import { S, $, hooks } from './core.js';
import { ic } from './icons.js';

function sheet() {
  const body = $('#toolBody');
  body.innerHTML = `<div class="tool zr">
    <h2 class="sheet__title" id="toolTitle"><span aria-hidden="true">${ic('trash')}</span> Zerar meu histórico</h2>
    <p class="tool__lead">Você recomeça como se fosse a primeira vez no site.</p>
    <div class="zr-cols">
      <div class="zr-box is-out"><b>${ic('trash')} Vai sumir para você</b><ul>
        <li>Lista do mês, carrinho e histórico de ranchos</li>
        <li>Economia, conquistas, pontos e posição no ranking</li>
        <li>Notas guardadas em Minhas notas e favoritos</li>
        <li>Lista da família e as preferências deste celular</li></ul></div>
      <div class="zr-box is-keep"><b>${ic('lock')} Continua</b><ul>
        ${S.user ? '<li>Sua conta (e-mail e senha) e o seu cadastro</li>' : ''}
        <li>Os preços e notas que você já mandou continuam ajudando o site e os supermercados, sem aparecer no seu histórico</li></ul></div>
    </div>
    <label class="zr-ok"><input type="checkbox" id="zrOk" /> <span>Entendi que não dá para desfazer</span></label>
    <div class="tool__actions">
      <button class="btn btn--danger btn--xl" id="zrGo" data-zerar="go" disabled>${ic('trash')} Zerar tudo</button>
      <button class="btn btn--text" data-close>Cancelar</button>
    </div></div>`;
  $('#toolSheet').dataset.tool = 'zerar';
  if ($('#toolSheet').hidden) hooks.openSheet('#toolSheet');
}

function wipeDevice() {
  // mantém só a cópia dos preços para usar sem internet (tb.off.*) e a sessão da conta (chaves do Supabase)
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('tb.') && !k.startsWith('tb.off.')) keys.push(k); }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {}
  try { sessionStorage.clear(); } catch {}
}

async function go(btn) {
  btn.disabled = true; btn.textContent = 'Zerando…';
  let gen = null;
  if (S.user) {
    try { gen = (await api.resetHistory())?.gen ?? null; }
    catch (e) {
      btn.disabled = false; btn.innerHTML = `${ic('trash')} Zerar tudo`;
      hooks.toast?.(e.code === 'sem_funcao'
        ? 'Ainda não dá para zerar a conta: o administrador precisa ativar esta função no site.'
        : 'Não deu para zerar agora. Confira a internet e tente de novo.', 'warn');
      return;
    }
  }
  wipeDevice();
  // este aparelho já está na época nova: não se apaga de novo; os outros aparelhos se limpam sozinhos
  if (gen != null) { try { localStorage.setItem('tb.syncGen', String(gen)); } catch {} }
  $('#toolBody').innerHTML = `<div class="tool zr-done"><span class="zr-done__i">${ic('sparkle')}</span>
    <h2 class="sheet__title" id="toolTitle">Tudo zerado</h2><p class="tool__lead">Recomeçando do início…</p></div>`;
  setTimeout(() => location.replace(location.pathname), 1200);
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-zerar]'); if (!b) return;
  if (b.dataset.zerar === 'open') return sheet();
  if (b.dataset.zerar === 'go' && $('#zrOk')?.checked) return go(b);
});
document.addEventListener('change', (e) => { if (e.target.id === 'zrOk') { const g = $('#zrGo'); if (g) g.disabled = !e.target.checked; } });
