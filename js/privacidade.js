// Privacidade (LGPD): "Baixar meus dados" e "Excluir minha conta" (Você › Conta e Preferências).
// • Baixar: um arquivo .json com tudo o que está na conta (banco) e neste aparelho.
// • Excluir: apaga a conta e o que é dela; os números de uso continuam, sem ligação com a pessoa.
// Política completa em privacidade.html.
import * as api from './api.js';
import { S, $, hooks } from './core.js';
import { ic } from './icons.js';

function deviceData() {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('tb.') || k.startsWith('tb.off.')) continue; // tb.off.* = cópia dos preços do site
      const v = localStorage.getItem(k);
      try { out[k] = JSON.parse(v); } catch { out[k] = v; }
    }
  } catch {}
  return out;
}

function download(name, obj) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
  a.download = name; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}

export async function exportData(btn) {
  const old = btn?.innerHTML; if (btn) { btn.disabled = true; btn.textContent = 'Juntando seus dados…'; }
  let conta = null, aviso = null;
  if (S.user) {
    try { conta = await api.myDataExport(); }
    catch (e) { aviso = e.code === 'sem_funcao' ? 'A cópia da conta ainda não está disponível (a administração precisa atualizar o banco). Baixamos o que está neste aparelho.' : 'Não deu para buscar os dados da conta agora. Baixamos o que está neste aparelho.'; }
  }
  const day = new Date().toISOString().slice(0, 10);
  download(`meus-dados-tabaratomesmo-${day}.json`, {
    sobre: 'Seus dados no Tá Barato Mesmo? (LGPD, art. 18). "conta" vem do servidor; "aparelho" é o que está guardado neste navegador.',
    gerado_em: new Date().toISOString(),
    conta: conta ?? (S.user ? null : 'Sem conta: nada guardado no servidor além de números de uso sem identificação.'),
    aparelho: deviceData(),
  });
  if (btn) { btn.disabled = false; btn.innerHTML = old; }
  hooks.toast?.(aviso || 'Pronto! O arquivo com seus dados foi baixado.', aviso ? 'warn' : undefined);
}

function deleteSheet() {
  $('#toolBody').innerHTML = `<div class="tool zr">
    <h2 class="sheet__title" id="toolTitle"><span aria-hidden="true">${ic('trash')}</span> Excluir minha conta</h2>
    <p class="tool__lead">A conta e tudo o que é seu saem do servidor. Não dá para desfazer.</p>
    <div class="zr-cols">
      <div class="zr-box is-out"><b>${ic('trash')} Vai ser apagado</b><ul>
        <li>E-mail, senha, nome, celular, bairro e endereço de casa</li>
        <li>Listas, ranchos, favoritos, notas, pontos e avisos no celular</li>
        <li>Tudo o que está guardado neste aparelho</li></ul></div>
      <div class="zr-box is-keep"><b>${ic('lock')} Continua, sem o seu nome</b><ul>
        <li>Os preços que você ajudou a confirmar (eles são do mercado, não seus)</li>
        <li>Números gerais de uso, como "quantas buscas por arroz", sem ligação com você</li></ul></div>
    </div>
    <p class="small">Quer uma cópia antes? <button class="linkish" data-priv="export">Baixar meus dados</button></p>
    <div class="form"><label>Para confirmar, digite EXCLUIR<input id="privConfirm" autocomplete="off" autocapitalize="characters" /></label></div>
    <div class="tool__actions">
      <button class="btn btn--danger btn--xl" id="privGo" data-priv="delete-go" disabled>${ic('trash')} Excluir para sempre</button>
      <button class="btn btn--text" data-close>Cancelar</button>
    </div></div>`;
  $('#toolSheet').dataset.tool = 'excluir';
  if ($('#toolSheet').hidden) hooks.openSheet('#toolSheet');
}

async function deleteGo(btn) {
  btn.disabled = true; btn.textContent = 'Excluindo…';
  try {
    await (await import('./push.js')).unsubscribe();
    await api.deleteMyAccount($('#privConfirm').value);
  } catch (e) {
    btn.disabled = false; btn.innerHTML = `${ic('trash')} Excluir para sempre`;
    hooks.toast?.(e.code === 'sem_funcao' ? 'A exclusão pelo site ainda não está disponível. Fale com a administração pelo contato da política de privacidade.' : e.message || 'Não deu para excluir agora.', 'warn');
    return;
  }
  try { await api.signOut(); } catch {}
  try {
    const ks = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && (k.startsWith('tb.') || k.startsWith('sb-')) && !k.startsWith('tb.off.')) ks.push(k); }
    ks.forEach((k) => localStorage.removeItem(k)); sessionStorage.clear();
  } catch {}
  $('#toolBody').innerHTML = `<div class="tool zr-done"><span class="zr-done__i">${ic('check')}</span>
    <h2 class="sheet__title" id="toolTitle">Conta excluída</h2><p class="tool__lead">Obrigado por ter usado o Tá Barato Mesmo?. Você pode voltar quando quiser.</p></div>`;
  setTimeout(() => location.replace(location.pathname), 2200);
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-priv]'); if (!b) return;
  const k = b.dataset.priv;
  if (k === 'export') exportData(b);
  else if (k === 'delete') deleteSheet();
  else if (k === 'delete-go' && $('#privConfirm')?.value.trim().toUpperCase() === 'EXCLUIR') deleteGo(b);
});
document.addEventListener('input', (e) => { if (e.target.id === 'privConfirm') { const g = $('#privGo'); if (g) g.disabled = e.target.value.trim().toUpperCase() !== 'EXCLUIR'; } });
