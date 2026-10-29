// De quem são os dados guardados neste aparelho.
// Tudo o que a pessoa faz (lista, ranchos, compras, notas, economia, favoritos, casa…) fica no navegador em
// chaves "tb.*". Sem dono marcado, uma conta nova herdava o histórico da conta anterior e o sync ainda subia
// esses dados para ela. Agora:
//   • tb.owner guarda o id da conta dona dos dados ('anon' = montados sem conta).
//   • Entrou uma conta diferente da dona → apaga os dados do aparelho antes de qualquer leitura/envio e recarrega.
//   • Saiu da conta (botão, sessão encerrada em outra aba ou expirada) → apaga os dados e o aparelho volta a ser 'anon'.
//   • Dados montados sem conta ('anon') continuam indo para a conta na primeira entrada (nada se perde).
// Só ficam as preferências do aparelho (letra grande, vibração, tema…) e as cópias públicas para usar sem sinal.

const OWNER = 'tb.owner';
// chaves do aparelho, não da pessoa
const KEEP = new Set(['tb.owner', 'tb.dev', 'tb.haptics', 'tb.bigText', 'tb.trackOff', 'tb.theme', 'tb.splash', 'tb.anonUsed',
  'tb.notifyAsked', 'tb.seenHome', 'tb.calcHelp', 'tb.osmMercados', 'tb.eanMap', 'tb.sid', 'tb.sessions', 'tb.sessCounted']);
const KEEP_PREFIX = ['tb.off.', 'tb.demo', 'tb.portalDemo', 'tb.adminDemo'];

const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };

export const owner = () => get(OWNER);

/** algum dado deste aparelho já foi sincronizado com uma conta? (aparelhos de antes desta correção) */
function hadAccount() {
  try { const s = JSON.parse(get('tb.syncAt') || '{}'); return Object.keys(s).length > 0; } catch { return false; }
}

/** apaga do aparelho tudo o que é da pessoa (parte síncrona: localStorage e sessionStorage) */
function wipeSync(newOwner) {
  try {
    const ks = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('tb.') && !KEEP.has(k) && !KEEP_PREFIX.some((p) => k.startsWith(p))) ks.push(k);
    }
    ks.forEach((k) => localStorage.removeItem(k));
  } catch {}
  try { for (const k of Object.keys(sessionStorage)) if (k.startsWith('tb.') && k !== 'tb.wipedElsewhere' && k !== 'tb.saiu') sessionStorage.removeItem(k); } catch {}
  set(OWNER, newOwner);
}
/** + envios esperando sinal (preços, fotos, notas): eram da conta anterior, não podem sair com a próxima */
export async function wipe(newOwner = 'anon') {
  wipeSync(newOwner);
  try { await (await import('./offline.js')).clearQueue(); } catch {}
}

/**
 * Chamado assim que a conta é conhecida, ANTES de ler perfil, sincronizar ou gravar no servidor.
 * Devolve true quando apagou os dados (quem chamou deve recarregar a página para limpar a memória).
 */
export async function claim(userId) {
  if (!userId) return false;
  const o = owner();
  if (o === userId) return false;
  if (o === 'anon' || (o == null && !hadAccount())) { set(OWNER, userId); return false; } // montado sem conta: vai para esta conta
  await wipe(userId); // outra conta (ou aparelho antigo já ligado a alguma conta): começa limpo e baixa só o desta conta
  return true;
}

/** a conta saiu: limpa os dados se eram de alguém */
export async function release() {
  const o = owner();
  if (!o || o === 'anon') { set(OWNER, 'anon'); return false; }
  await wipe('anon');
  return true;
}

// ---------------------------------------------------------------- checagem antes de qualquer módulo ler o aparelho
// Este arquivo é importado pelo api.js, que é o primeiro a carregar; assim core.js já nasce com os dados certos
// e nem por um instante aparece na tela o histórico de outra conta.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function sessionUser() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && /^sb-.+-auth-token$/.test(k)) {
        const v = JSON.parse(localStorage.getItem(k) || 'null');
        return { found: true, id: v?.user?.id || v?.currentSession?.user?.id || null };
      }
    }
  } catch {}
  return { found: false, id: null };
}
export const precheck = (() => {
  const o = owner();
  if (!o || !UUID.test(o)) return 'ok'; // anon, demo ou aparelho antigo: o claim() decide quando a conta aparecer
  const s = sessionUser();
  if (s.found && s.id && s.id !== o) { wipeSync(s.id); queueMicrotask(() => wipe(s.id)); return 'trocou'; }
  if (!s.found) { wipeSync('anon'); queueMicrotask(() => wipe('anon')); return 'saiu'; }
  return 'ok';
})();
