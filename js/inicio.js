// Página inicial (#inicio): diz em poucos segundos o que o site faz, para quem é e como usar.
// • Exemplo real de hoje (do catálogo): o mesmo produto em cada mercado, com a diferença em reais.
// • "O que você quer fazer agora?": quatro caminhos diretos, um por momento da compra.
// • "Como usar": abas Em casa · No mercado · Depois de pagar, cada uma com as ferramentas daquele momento.
// • Perguntas rápidas e um único chamado para começar. Sem emoji: ícones de traço, cores do app.
import { CONFIG } from './config.js';
import { S, $, esc, brl, visiblePrices, reduceMotion } from './core.js';

const svg = (d) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  list: svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>'),
  cart: svg('<path d="M3 4h2l2.4 10.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 1.9-1.5L21 8H6.2"/><circle cx="9.5" cy="19.5" r="1.5"/><circle cx="17.5" cy="19.5" r="1.5"/>'),
  receipt: svg('<path d="M5 3v18l2.5-1.5L10 21l2-1.5 2 1.5 2.5-1.5L19 21V3l-2.5 1.5L14 3l-2 1.5L10 3 7.5 4.5z"/><path d="M9 9h6M9 13h6"/>'),
  home: svg('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>'),
  store: svg('<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0"/><path d="M5 11v9h14v-9"/><path d="M10 20v-5h4v5"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  tag: svg('<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.2"/>'),
  meal: svg('<path d="M4 13h16a8 8 0 0 1-16 0z"/><path d="M8 9c0-2 2-2 2-4M12 9c0-2 2-2 2-4"/>'),
  map: svg('<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>'),
  mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  calc: svg('<rect x="5" y="2.5" width="14" height="19" rx="2.5"/><path d="M8.5 6.5h7M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M15.5 14.5h.01M8.5 18h.01M12 18h3.5"/>'),
  barcode: svg('<path d="M4 6v12M7 6v12M10 6v12M14 6v12M17 6v12M20 6v12"/>'),
  scale: svg('<path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/>'),
  percent: svg('<path d="M19 5L5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>'),
  route: svg('<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16"/>'),
  camera: svg('<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>'),
  star: svg('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
  chart: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  wifi: svg('<path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0"/><path d="M12 19h.01"/>'),
  shield: svg('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>'),
  users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>'),
  gift: svg('<rect x="3" y="8" width="18" height="5" rx="1"/><path d="M5 13v8h14v-8M12 8v13"/><path d="M12 8C10 4 6.5 4.5 7 7c.3 1.2 2.5 1 5 1zM12 8c2-4 5.5-3.5 5-1-.3 1.2-2.5 1-5 1z"/>'),
};

let tab = 'casa';   // aba ativa de "Como usar"
let ex = 0;         // exemplo de preço mostrado

// ---------------------------------------------------------------- números reais do catálogo
function examples() {
  return S.products
    .map((p) => ({ p, pr: visiblePrices(p) }))
    .filter((x) => x.pr.length >= 3)
    .map((x) => ({ ...x, diff: x.pr[x.pr.length - 1].price - x.pr[0].price }))
    .filter((x) => x.diff >= 1)
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 4);
}
function stats() {
  const withPrices = S.products.filter((p) => visiblePrices(p).length >= 2);
  const pcts = withPrices.map((p) => { const pr = visiblePrices(p); return 1 - pr[0].price / pr[pr.length - 1].price; }).filter((v) => v > 0 && v < 0.9);
  const avg = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : 0;
  return { products: S.products.length, markets: S.markets.size || 5, avg: Math.round(avg * 100) };
}

// ---------------------------------------------------------------- partes
function exampleHTML() {
  const list = examples();
  if (!list.length) return `<div class="in-ex in-ex--skel" aria-hidden="true"><div class="skeleton" style="height:22px;width:60%"></div><div class="skeleton" style="height:120px"></div></div>`;
  ex = Math.min(ex, list.length - 1);
  const { p, pr, diff } = list[ex];
  const max = pr[pr.length - 1].price;
  const best = S.markets.get(pr[0].market_id);
  return `<div class="in-ex" id="inEx">
    <div class="in-ex__head">
      <span class="in-ex__lbl">Exemplo com preços de hoje</span>
      ${list.length > 1 ? `<div class="in-ex__tabs" role="tablist" aria-label="Escolher produto">${list.map((x, i) => `<button role="tab" aria-selected="${i === ex}" data-in-ex="${i}">${i + 1}</button>`).join('')}</div>` : ''}
    </div>
    <p class="in-ex__name"><b>${esc(p.name)}</b> <span>${esc([p.brand, p.unit].filter(Boolean).join(' · '))}</span></p>
    <ol class="in-bars">
      ${pr.slice(0, 5).map((x, i) => { const m = S.markets.get(x.market_id); return `<li class="${i === 0 ? 'is-best' : ''}" style="--w:${Math.max(18, (x.price / max) * 100)}%">
        <span class="in-bars__m">${esc(m?.name || 'Mercado')}</span>
        <span class="in-bars__b"><i></i></span>
        <b>${brl(x.price)}</b></li>`; }).join('')}
    </ol>
    <p class="in-ex__save">${I.check}<span>Comprando no <b>${esc(best?.name || 'mais barato')}</b> você paga <b>${brl(diff)} a menos</b> no mesmo produto.</span></p>
  </div>`;
}

const INTENTS = [
  { go: 'search', icon: I.search, t: 'Ver onde um produto está mais barato', s: 'Digite o nome e compare os mercados' },
  { go: '#lista', icon: I.list, t: 'Fazer a lista do mês', s: 'Descubra em qual mercado ela sai mais barata' },
  { go: '#carrinho', icon: I.cart, t: 'Estou no mercado agora', s: 'Some os itens e não passe do orçamento' },
  { go: '#notas', icon: I.receipt, t: 'Acabei de pagar', s: 'Confira a nota e ganhe pontos' },
];

const MOMENTS = {
  casa: {
    icon: I.home, t: 'Em casa', s: 'Planeje antes de sair',
    items: [
      { icon: I.tag, t: 'Preços de hoje', s: 'Cada produto mostra primeiro o mercado mais barato, com o preço dos outros ao lado.', go: '#ofertas' },
      { icon: I.list, t: 'Lista do mês (rancho)', s: 'Monte a lista e veja em qual mercado ela inteira sai mais barata, e se vale ir mais longe.', go: '#lista' },
      { icon: I.meal, t: 'Planejar refeições', s: 'Diga o que vai comer na semana e o site calcula o que comprar e quanto custa.', go: '#refeicoes' },
      { icon: I.map, t: 'Lojas no mapa', s: 'Veja a loja mais perto de você e abra a rota.', go: '#mapa' },
    ],
  },
  mercado: {
    icon: I.store, t: 'No mercado', s: 'Decida na frente da prateleira',
    items: [
      { icon: I.mic, t: 'Carrinho por voz', s: 'Fale "arroz 5 quilos 24 e 90" e o site anota e soma.', go: '#carrinho' },
      { icon: I.calc, t: 'Calculadora do caixa', s: 'Digite os preços e veja quanto ainda sobra antes de pôr no carrinho.', go: '#carrinho' },
      { icon: I.barcode, t: 'Conferir um preço', s: 'Leia o código, fotografe a etiqueta ou mande a nota.', tool: 'conferir' },
      { icon: I.scale, t: 'Qual compensa?', s: 'Pacote grande ou pequeno: veja qual sai mais barato por quilo.', tool: 'tamanho' },
      { icon: I.percent, t: 'Promoção vale?', s: '"Leve 3, pague 2" e similares: veja se compensa mesmo.', tool: 'promo' },
      { icon: I.route, t: 'Caminho no mercado', s: 'Sua lista na ordem dos corredores, numa volta só.', tool: 'caminho' },
    ],
  },
  depois: {
    icon: I.receipt, t: 'Depois de pagar', s: 'Confira e acompanhe seus gastos',
    items: [
      { icon: I.receipt, t: 'Conferir a nota', s: 'Leia o QR da nota: o site mostra se o caixa cobrou o preço da etiqueta.', go: '#notas' },
      { icon: I.chart, t: 'Seus gastos organizados', s: 'Cada nota entra no controle por mês e por mercado, sem digitar nada.', go: '#notas' },
      { icon: I.camera, t: 'Ajude com preços', s: 'Fotografe uma etiqueta e ganhe pontos; seus preços ajudam o bairro todo.', tool: 'fotopreco' },
      { icon: I.star, t: 'Quanto você economizou', s: 'Acompanhe a economia do mês e as conquistas na página Você.', go: '#conta' },
    ],
  },
};

function momentsHTML() {
  const m = MOMENTS[tab];
  return `<div class="in-tabs" role="tablist" aria-label="Momentos da compra">
      ${Object.entries(MOMENTS).map(([k, v], i) => `<button role="tab" id="inTab-${k}" aria-controls="inPanel" aria-selected="${k === tab}" data-in-tab="${k}">
        <span class="in-tabs__n">${i + 1}</span><span><b>${v.t}</b><small>${v.s}</small></span></button>`).join('')}
    </div>
    <div class="in-tools" id="inPanel" role="tabpanel" aria-labelledby="inTab-${tab}">
      ${m.items.map((x) => `<button class="in-tool" ${x.tool ? `data-tool="${x.tool}"` : `data-in-go="${x.go}"`}>
        <span class="in-ico">${x.icon}</span><span class="in-tool__t"><b>${x.t}</b><small>${x.s}</small></span><span class="in-tool__go">${I.arrow}</span>
      </button>`).join('')}
    </div>`;
}

function faqHTML() {
  const q = [
    ['É de graça?', 'Sim. Comparar preços, montar o rancho, usar o carrinho e as ferramentas do mercado não custa nada.'],
    ['Preciso criar conta?', `Não para começar: você pode abrir ${CONFIG.ANON_COMPARISONS} comparações sem cadastro. Com o cadastro rápido (nome, e-mail e senha) são ${CONFIG.QUICK_COMPARISONS}, e com o cadastro completo o uso é sem limite.`],
    ['De onde vêm os preços?', 'Dos próprios supermercados, das notas fiscais enviadas e de quem compra. Um preço informado por pessoas só entra quando é confirmado.'],
    ['Funciona sem internet dentro do mercado?', 'Sim. Os preços ficam salvos no celular a cada vez que você abre o site; sem sinal, ele abre com a última atualização.'],
    ['Posso instalar como aplicativo?', 'Pode. No menu do navegador, toque em "Adicionar à tela de início". Ele abre como um app, sem ocupar espaço de loja.'],
  ];
  return q.map(([t, a]) => `<details class="in-faq"><summary>${t}<span aria-hidden="true">${svg('<path d="M6 9l6 6 6-6"/>')}</span></summary><p>${a}</p></details>`).join('');
}

// ---------------------------------------------------------------- página
export function render() {
  const el = $('#inicioView'); if (!el) return;
  const st = stats();
  el.innerHTML = `
  <section class="in-hero">
    <div class="in-hero__txt">
      <p class="in-eyebrow">Grátis · ${st.markets} supermercados de Manaus</p>
      <h1>Saiba onde sua compra sai mais barata <em>antes de sair de casa</em>.</h1>
      <p class="in-lead">O Tá Barato Mesmo? compara os preços dos supermercados perto de você e ajuda do planejamento até a conferência da nota.</p>
      <form class="in-search" id="inSearch" role="search">
        ${I.search}
        <input type="search" id="inQ" placeholder="Experimente: arroz, café, frango…" autocomplete="off" enterkeyhint="search" aria-label="Buscar produto" />
        <button type="submit" class="btn btn--primary">Comparar</button>
      </form>
      <div class="in-ctas">
        <a class="btn btn--primary btn--lg" href="#ofertas" data-in-go="#ofertas">Ver os preços de hoje</a>
        <a class="btn btn--ghost btn--lg" href="#inComo" data-in-scroll="inComo">Como funciona</a>
      </div>
    </div>
    <div class="in-hero__ex" id="inExWrap">${exampleHTML()}</div>
  </section>

  <section class="in-facts" aria-label="Em números">
    <div><b>${st.markets}</b><span>supermercados comparados</span></div>
    <div><b>${st.products || '—'}</b><span>produtos com preço</span></div>
    ${st.avg ? `<div><b>${st.avg}%</b><span>de diferença média no mesmo produto</span></div>` : ''}
    <div><b>${I.wifi}</b><span>funciona sem internet no mercado</span></div>
  </section>

  <section class="in-sec">
    <h2>O que você quer fazer agora?</h2>
    <div class="in-intents">
      ${INTENTS.map((x) => `<button class="in-intent" data-in-go="${x.go}"><span class="in-ico">${x.icon}</span><b>${x.t}</b><small>${x.s}</small><span class="in-intent__go">${I.arrow}</span></button>`).join('')}
    </div>
  </section>

  <section class="in-sec" id="inComo">
    <h2>Como usar</h2>
    <p class="in-sub">O site acompanha a compra inteira. Escolha o momento e veja o que ajuda em cada um.</p>
    <div id="inMoments">${momentsHTML()}</div>
  </section>

  <section class="in-sec in-trust">
    <h2>Por que dá para confiar</h2>
    <ul>
      <li><span class="in-ico">${I.shield}</span><div><b>Preço confirmado</b><small>Um valor informado por pessoas só aparece quando duas confirmam o mesmo preço, ou vem da nota fiscal.</small></div></li>
      <li><span class="in-ico">${I.users}</span><div><b>Feito por quem compra</b><small>Cada preço que você confere ajuda outras famílias do seu bairro.</small></div></li>
      <li><span class="in-ico">${I.gift}</span><div><b>Você ganha com isso</b><small>Pontos, níveis e mais comparações a cada nota ou preço enviado.</small></div></li>
    </ul>
  </section>

  <section class="in-sec">
    <h2>Perguntas rápidas</h2>
    <div class="in-faqs">${faqHTML()}</div>
  </section>

  <section class="in-final">
    <h2>Pronto para pagar menos?</h2>
    <p>Comece pelos preços de hoje. Leva menos de um minuto.</p>
    <a class="btn btn--lg in-final__btn" href="#ofertas" data-in-go="#ofertas">Ver os preços de hoje ${I.arrow}</a>
  </section>`;
  try { localStorage.setItem('tb.seenHome', '1'); } catch {}
}

/** atualiza só o exemplo (quando o catálogo carrega depois) */
export function refresh() { const w = $('#inExWrap'); if (w && !$('#view-inicio').hidden) { w.innerHTML = exampleHTML(); } }

// ---------------------------------------------------------------- eventos
function go(dest) {
  if (dest === 'search') { const q = $('#inQ'); q?.focus(); q?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
  location.hash = dest;
}
function searchFor(q) {
  location.hash = '#ofertas';
  const input = $('#searchInput');
  if (input && q) { input.value = q; input.dispatchEvent(new Event('input', { bubbles: true })); }
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-in-go], [data-in-tab], [data-in-ex], [data-in-scroll]'); if (!t || !t.closest('#inicioView')) return;
  const d = t.dataset;
  if (d.inGo) { e.preventDefault(); return go(d.inGo); }
  if (d.inScroll) { e.preventDefault(); return $('#' + d.inScroll)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  if (d.inTab) { tab = d.inTab; $('#inMoments').innerHTML = momentsHTML(); $(`#inTab-${tab}`)?.focus(); return; }
  if (d.inEx) { ex = Number(d.inEx); $('#inExWrap').innerHTML = exampleHTML(); }
});
document.addEventListener('submit', (e) => {
  if (e.target.id !== 'inSearch') return;
  e.preventDefault(); searchFor($('#inQ').value.trim());
});
// setas do teclado nas abas
document.addEventListener('keydown', (e) => {
  const t = e.target.closest?.('[data-in-tab]'); if (!t || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const keys = Object.keys(MOMENTS); const i = keys.indexOf(tab);
  tab = keys[(i + (e.key === 'ArrowRight' ? 1 : keys.length - 1)) % keys.length];
  $('#inMoments').innerHTML = momentsHTML(); $(`#inTab-${tab}`)?.focus();
});
// troca o exemplo sozinho a cada 6 s enquanto a página está à vista (para quando a pessoa escolhe um)
let auto = reduceMotion ? null : setInterval(() => {
  const v = $('#view-inicio'); if (!v || v.hidden || document.hidden) return;
  const n = examples().length; if (n < 2) return;
  ex = (ex + 1) % n; const w = $('#inExWrap'); if (w) w.innerHTML = exampleHTML();
}, 6000);
document.addEventListener('click', (e) => { if (e.target.closest('[data-in-ex]')) { clearInterval(auto); auto = null; } });
