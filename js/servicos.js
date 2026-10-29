// Diferenciais de cada rede (açougue, entrega, estacionamento…): o supermercado marca no portal
// (Minha página) e o consumidor vê na página da rede e no relatório do rancho. A lista é a mesma do banco
// (market_set_profile): mudou aqui, mude lá.
export const SERVICOS = [
  ['acougue', '🥩', 'Açougue'],
  ['padaria', '🥖', 'Padaria'],
  ['peixaria', '🐟', 'Peixaria'],
  ['hortifruti', '🥬', 'Hortifrúti'],
  ['estacionamento', '🅿️', 'Estacionamento'],
  ['entrega', '🛵', 'Entrega em casa'],
  ['retirada', '🛍️', 'Retirada na loja'],
  ['vale', '💳', 'Aceita vale-alimentação'],
  ['cartao_loja', '🪪', 'Cartão da loja'],
  ['pix', '⚡', 'Pix'],
  ['farmacia', '💊', 'Farmácia'],
  ['climatizado', '❄️', 'Loja climatizada'],
  ['acessivel', '♿', 'Acessibilidade'],
  ['24h', '🌙', 'Aberto 24 horas'],
  ['caixa_rapido', '⏱️', 'Caixa rápido'],
  ['wifi', '📶', 'Wi-Fi'],
];
const MAP = new Map(SERVICOS.map(([k, e, n]) => [k, { e, n }]));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** chips dos diferenciais ("🥩 Açougue · 🛵 Entrega…"); max = quantos mostrar */
export function chips(m, max = 99, cls = 'svc') {
  const list = (m?.services || []).filter((k) => MAP.has(k));
  if (!list.length) return '';
  const shown = list.slice(0, max);
  return `<span class="${cls}">${shown.map((k) => `<span title="${esc(MAP.get(k).n)}"><i aria-hidden="true">${MAP.get(k).e}</i>${esc(MAP.get(k).n)}</span>`).join('')}${list.length > max ? `<span class="svc__more">+${list.length - max}</span>` : ''}</span>`;
}
export const nome = (k) => MAP.get(k)?.n || k;
