// Regra única de interrupção: no máximo UMA coisa que aparece sozinha por visita
// (janela de campanha, aviso flutuante de mercado, pedido para ligar avisos, boas-vindas na loja).
// O que a pessoa abre tocando não conta. A segunda que pedir espera a próxima visita.
const K = 'tb.intr';
const get = () => { try { return sessionStorage.getItem(K); } catch { return null; } };

/** ainda dá para interromper nesta visita? (e não há janela aberta agora) */
export function can() {
  if (get()) return false;
  if (document.querySelector('.sheet.is-open, .camp-pop, #calcFull, .notify-ask')) return false;
  return true;
}
/** reserva a interrupção desta visita; devolve false se já foi usada */
export function claim(kind) {
  if (!can()) return false;
  try { sessionStorage.setItem(K, kind); } catch {}
  return true;
}
export const used = () => get();
