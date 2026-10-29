// Versão do site no rodapé: mostra qual versão está rodando NESTE aparelho e avisa quando já existe uma mais nova.
// O número é carimbado sozinho pelo GitHub a cada envio para o main (.github/workflows/versao.yml):
//   1.<nº do envio>.<AAMMDD>.<HHMM>  (horário de Manaus)
// Rodando local (sem o carimbo), aparece "dev".
export const VERSAO = { versao: '1.5.261029.1858', data: '2026-10-29T18:58:13-04:00', commit: 'ce0e87a6eea1ff29c835618bc35cd4786fb6a5d6' };

const fmt = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Manaus' });

/** "29/10 às 11:20" */
const curto = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Manaus' }).replace(', ', ' às ');

function slots() {
  let els = [...document.querySelectorAll('[data-versao]')];
  if (!els.length) {
    // página sem lugar marcado: põe no rodapé (ou cria um rodapé discreto)
    let foot = document.querySelector('.site-foot');
    if (!foot) { foot = document.createElement('footer'); foot.className = 'site-foot site-foot--min'; document.body.append(foot); }
    const s = document.createElement('span'); s.dataset.versao = ''; foot.append(s); els = [s];
  }
  return els;
}

function paint(newer = null) {
  const txt = `Versão ${VERSAO.versao}`;
  const title = VERSAO.data ? `Publicada em ${fmt(VERSAO.data)} (horário de Manaus)${VERSAO.commit ? ` · ${VERSAO.commit.slice(0, 7)}` : ''}` : 'Versão de desenvolvimento';
  for (const el of slots()) {
    el.classList.add('versao');
    el.innerHTML = `<span title="${title}">${txt}${VERSAO.data ? ` · ${curto(VERSAO.data)}` : ''}</span>`
      + (newer ? ` <button type="button" class="versao__nova" data-versao-up title="Versão ${newer} já está no ar">Nova versão ${newer}: atualizar</button>` : '');
  }
}

/** confere no servidor (sem cache) se já saiu uma versão mais nova que a que está rodando */
async function check() {
  if (VERSAO.versao === 'dev') return;
  try {
    const r = await fetch(`versao.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    const v = await r.json();
    if (v?.versao && v.versao !== VERSAO.versao) paint(v.versao);
  } catch { /* sem internet: fica a versão atual */ }
}

document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-versao-up]')) return;
  e.target.disabled = true; e.target.textContent = 'Atualizando…';
  try { const reg = await navigator.serviceWorker?.getRegistration(); await reg?.update(); } catch {}
  location.reload();
});

const start = () => { paint(); check(); setInterval(check, 30 * 60 * 1000); };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
