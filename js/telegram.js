// Robô do Telegram (@tabaratomesmo_bot): ligar a conta do site ao Telegram (Você › Conta).
// O site pede um código de uso único ao banco (telegram_link_code, vale 15 min) e abre
// t.me/<robô>?start=<código>. A pessoa toca em "Iniciar" e o robô liga a conta.
// Depois, o que ela faz na lista pelo Telegram chega aqui na hora (user_state + Realtime).
// Precisa de supabase/atualizacoes/atualizacao-2026-10-telegram.sql e da função supabase/functions/telegram.
import * as api from './api.js';
import { CONFIG } from './config.js';
import { $, esc, hooks } from './core.js';
import { ic } from './icons.js';

const BOT = CONFIG.TELEGRAM_BOT || 'tabaratomesmo_bot';
const botUrl = (start) => `https://t.me/${BOT}${start ? `?start=${encodeURIComponent(start)}` : ''}`;
let st = null, poll = null;

/** quadro "Telegram" da aba Conta (preenchido por fill()) */
export function panel() {
  return `<section class="panel" id="tgPanel"><div class="panel__head"><h2>${ic('send')} Telegram</h2></div><div id="tgBody"><div class="skeleton" style="height:64px"></div></div></section>`;
}

export async function fill() {
  const box = $('#tgBody'); if (!box) return;
  try { st = await api.telegramStatus(); } catch { st = undefined; }
  if (!$('#tgBody')) return;
  if (st === null) { $('#tgPanel')?.remove(); return; } // banco sem a atualização (ou modo demonstração): não mostra
  if (st === undefined) { box.innerHTML = '<p class="muted small">Não consegui ver agora. Tente de novo daqui a pouco.</p>'; return; }
  if (st.linked) {
    stopPoll();
    box.innerHTML = `<p class="small"><span class="status status--ok">Ligado</span> ${st.username ? `ao Telegram <b>@${esc(st.username)}</b>` : 'ao seu Telegram'}.</p>
      <p class="small muted">Pergunte preços, mande a nota fiscal e mexa na Lista do mês pelo robô. O que mudar lá aparece aqui na hora.</p>
      <div class="row-actions"><a class="btn btn--primary btn--sm" href="${botUrl()}" target="_blank" rel="noopener">${ic('send')} Abrir o robô</a>
      <button class="btn btn--text btn--sm" data-tg="unlink">Desligar</button></div>`;
  } else {
    box.innerHTML = `<p class="small">Pergunte <i>“quanto tá o óleo?”</i>, mande a foto da nota fiscal e mexa na sua lista pelo Telegram, sem abrir o site.</p>
      <div class="row-actions"><button class="btn btn--primary btn--sm" data-tg="link">${ic('link')} Ligar ao Telegram</button></div>
      <p class="small muted" id="tgHint" hidden>Toque em <b>Iniciar</b> no Telegram. Esta tela atualiza sozinha quando ligar.</p>`;
  }
}

function stopPoll() { clearInterval(poll); poll = null; }
function startPoll() {
  stopPoll();
  const until = Date.now() + 3 * 60e3;
  poll = setInterval(async () => {
    if (!$('#tgBody') || Date.now() > until) return stopPoll();
    try { const s = await api.telegramStatus(); if (s?.linked) { stopPoll(); await fill(); hooks.toast?.('Telegram ligado!'); } } catch {}
  }, 3000);
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-tg]'); if (!b) return;
  if (b.dataset.tg === 'link') {
    // abre a janela já no toque (senão o navegador bloqueia) e depois manda para o link com o código
    const w = window.open('', '_blank');
    b.disabled = true;
    try {
      const code = await api.telegramLinkCode();
      if (w) w.location.href = botUrl(code); else location.href = botUrl(code);
      const h = $('#tgHint'); if (h) h.hidden = false;
      startPoll();
    } catch (err) {
      w?.close();
      hooks.toast?.(err.message || 'Não consegui gerar o link agora.');
    } finally { b.disabled = false; }
  }
  if (b.dataset.tg === 'unlink') {
    b.disabled = true;
    try { await api.telegramUnlink(); await fill(); hooks.toast?.('Telegram desligado.'); }
    catch (err) { b.disabled = false; hooks.toast?.(err.message || 'Não consegui desligar agora.'); }
  }
});
