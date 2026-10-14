import { CONFIG, BAIRROS } from './config.js';
import * as api from './api.js';
import { lineChart } from './chart.js';
import {
  S, $, $$, esc, brl, pct, km, reduceMotion, haversine, isOn, visiblePrices,
  initials, logo, logoFull, priceTag, changeBadge, stepper, hooks, ago, media, promoPill,
} from './core.js';
import * as rancho from './rancho.js';
import * as fiscal from './fiscal.js';
import * as account from './account.js';
import { track } from './track.js';


function card(p, i) {
  const prices = visiblePrices(p);
  if (!prices.length) return '';
  const best = prices[0];
  const bm = S.markets.get(best.market_id);
  const nb = S.nearest.get(best.market_id);
  const others = prices.slice(1);
  const c = p.change_pct;
  // no card só aparece queda relevante; altas ficam no detalhe e na ordenação "Subiram"
  const trend = c != null && (c <= -1 || (S.sort === 'alta' && c >= 0.5))
    ? `<span class="trend ${c < 0 ? 'down' : 'up'}" title="Variação média em 7 dias">${c < 0 ? '▼' : '▲'} ${Math.abs(c).toFixed(1).replace('.', ',')}%</span>` : '';
  const promo = prices.find((x) => x.promo);
  return `<article class="card" data-pid="${p.id}" style="--i:${Math.min(i, 12)}">
    <button class="card__hit" data-open-product="${p.id}" aria-label="Comparar ${esc(p.name)} ${esc(p.brand || '')}"></button>
    ${media(p)}
    <div class="card__title">
      <h3>${esc(p.name)}</h3>
      <p>${esc([p.brand, p.unit].filter(Boolean).join(' · '))}</p>
    </div>
    <div class="card__price">${priceTag(best.price)}${best.regular ? `<s class="was">${brl(best.regular)}</s>` : ''}${trend}${promo ? promoPill(promo) : ''}</div>
    <div class="card__where">${logo(bm, 'xs')}<span>${esc(bm.name)}${nb ? ` · ${km(nb.km)}` : ''}</span></div>
    <footer class="card__foot">
      <span class="card__others">${others.length ? `+${others.length} ${others.length > 1 ? 'mercados' : 'mercado'}, até ${brl(others[others.length - 1].price)}` : 'Só neste mercado'}</span>
      ${stepper(p.id)}
    </footer>
    <button class="fav ${S.favs.has(p.id) ? 'is-on' : ''}" data-fav="${p.id}" aria-pressed="${S.favs.has(p.id)}" aria-label="Favoritar">
      <svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.7 4.5c2.1 0 3.6 1.2 4.3 2.4.7-1.2 2.2-2.4 4.3-2.4 3.7 0 5.8 3.8 4.3 7.2C19.5 16.4 12 21 12 21z"/></svg>
    </button>
  </article>`;
}

// ======================================================================
//  Ofertas
// ======================================================================
function filtered() {
  const q = S.q.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  let arr = S.products.filter((p) => visiblePrices(p).length);
  if (S.category === 'fav') arr = arr.filter((p) => S.favs.has(p.id));
  else if (S.category !== 'all') arr = arr.filter((p) => p.category_slug === S.category);
  if (q) arr = arr.filter((p) => (p.name + ' ' + (p.brand || '') + ' ' + p.category_name).toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').includes(q));
  const minOf = (p) => visiblePrices(p)[0].price;
  const spread = (p) => { const v = visiblePrices(p); return v[v.length - 1].price - v[0].price; };
  switch (S.sort) {
    case 'queda': arr = arr.filter((p) => (p.change_pct ?? 0) < -0.4).sort((a, b) => a.change_pct - b.change_pct); break;
    case 'alta': arr = arr.filter((p) => (p.change_pct ?? 0) > 0.4).sort((a, b) => b.change_pct - a.change_pct); break;
    case 'economia': arr.sort((a, b) => spread(b) - spread(a)); break;
    default: arr.sort((a, b) => minOf(a) - minOf(b));
  }
  return arr;
}

function renderGrid() {
  const arr = filtered();
  const grid = $('#productGrid');
  grid.innerHTML = arr.map(card).join('');
  grid.classList.toggle('is-anim', !reduceMotion);
  $('#emptyState').hidden = arr.length > 0;
  if (!arr.length) {
    $('#emptyState').textContent = S.sort === 'queda' ? 'Nenhum preço caiu nos últimos 7 dias com esses filtros.'
      : S.sort === 'alta' ? 'Nenhum preço subiu nos últimos 7 dias com esses filtros.'
      : S.category === 'fav' ? 'Você ainda não favoritou produtos. Toque no coração de um card.'
      : 'Nenhum produto encontrado. Tente outro nome ou outra categoria.';
  }
}

function renderChips() {
  const chips = [{ slug: 'all', name: 'Tudo' }, ...S.categories, { slug: 'fav', name: 'Favoritos' }];
  $('#catChips').innerHTML = chips.map((c) =>
    `<button class="chip ${S.category === c.slug ? 'is-on' : ''}" data-cat="${c.slug}" aria-pressed="${S.category === c.slug}">${esc(c.name)}</button>`).join('');
}

const marketsByDistance = () => [...S.markets.values()].map((m) => ({ m, n: S.nearest.get(m.id) }))
  .sort((a, b) => (a.n?.km ?? 999) - (b.n?.km ?? 999) || a.m.name.localeCompare(b.m.name));

/** uma linha só: "Comparando 5 mercados · mais perto: Nova Era, 124 m · Ajustar" */
function renderNearby() {
  const on = [...S.markets.values()].filter((m) => isOn(m.id));
  const closest = marketsByDistance().find((x) => isOn(x.m.id) && x.n);
  $('#marketCount').textContent = S.markets.size;
  $('#compareLine').innerHTML = `
    <span class="logos">${on.map((m) => logo(m, 'xs')).join('')}</span>
    <span>Comparando <b>${on.length === S.markets.size ? `todos os ${on.length}` : `${on.length} de ${S.markets.size}`}</b> mercados<span class="cl-near">${closest ? ` · mais perto: <b>${esc(closest.m.name)}</b>, ${km(closest.n.km)}` : ''}</span></span>
    <em>Ajustar</em>`;
  const list = $('#marketsList');
  if (list) list.innerHTML = marketsByDistance().map(({ m, n }) => `
    <li><label class="mk-row">${logo(m, 'md')}
      <span><b>${esc(m.name)}</b><small>${n ? `Loja mais perto: ${esc(n.store.neighborhood || n.store.name)}, ${km(n.km)}` : `${S.stores.filter((s) => s.supermarket_id === m.id).length} lojas em Manaus`}</small></span>
      <span class="switch"><input type="checkbox" data-market-toggle="${m.id}" ${isOn(m.id) ? 'checked' : ''} aria-label="Incluir ${esc(m.name)}" /><i></i></span>
    </label></li>`).join('');
}

/** faixa de destaques: promoções dos mercados primeiro, depois as maiores quedas */
function renderDeals() {
  const promos = S.products.flatMap((p) => p.prices.filter((x) => x.promo && isOn(x.market_id)).map((x) => ({ p, x, promo: true })))
    .sort((a, b) => (b.x.regular - b.x.price) / b.x.regular - (a.x.regular - a.x.price) / a.x.regular);
  const drops = S.products.flatMap((p) => p.prices.filter((x) => x.prev && !x.promo && isOn(x.market_id)).map((x) => ({ p, x, c: (x.price / x.prev - 1) * 100 })))
    .filter((r) => r.c <= -3).sort((a, b) => a.c - b.c);
  const seen = new Set();
  const rows = [...promos, ...drops].filter((r) => (seen.has(r.p.id) ? false : seen.add(r.p.id))).slice(0, 10);
  const el = $('#deals');
  if (!rows.length) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<div class="sec-head"><h2>${promos.length ? 'Ofertas da semana' : 'Baixaram de preço'}</h2></div>
    <div class="deals__row">${rows.map(({ p, x, promo }) => {
      const m = S.markets.get(x.market_id);
      const was = promo ? x.regular : x.prev;
      return `<button class="deal" data-open-product="${p.id}" ${promo ? `data-promo-view="${p.id}:${m.id}"` : ''}>
        ${media(p, 'card__media')}
        <span class="deal__txt"><b>${esc(p.name)}</b>
          <span class="deal__price">${brl(x.price)}<s>${brl(was)}</s></span>
          <small>${logo(m, 'xs')} ${esc(m.name)} ${promo ? promoPill(x) : `<span class="trend down">▼ ${Math.abs((x.price / x.prev - 1) * 100).toFixed(0)}%</span>`}</small></span>
      </button>`;
    }).join('')}</div>`;
}

// ======================================================================
//  Localização
// ======================================================================
function computeNearest() {
  S.nearest.clear();
  if (!S.pos) return;
  for (const s of S.stores) {
    const d = haversine(S.pos, s);
    const cur = S.nearest.get(s.supermarket_id);
    if (!cur || d < cur.km) S.nearest.set(s.supermarket_id, { store: s, km: d });
  }
}

function setPos(pos) {
  S.pos = pos; api.store.set('tb.pos', pos);
  computeNearest();
  $('#locLabel').textContent = pos.label || 'Minha localização';
  $('#locBtn').classList.add('is-set');
  renderNearby(); renderGrid();
  if (S.map) drawMap();
  if (location.hash === '#lista') renderList();
  fiscal.checkAtStore();
}

// A mesma folha de localização serve para "onde estou" e "onde fica minha casa"
let locMode = 'pos', locCb = null;
function openLoc(mode = 'pos', cb = null) {
  locMode = mode; locCb = cb;
  $('#locTitle').textContent = mode === 'home' ? 'Onde fica sua casa?' : 'Onde você está?';
  $('#locIntro').textContent = mode === 'home'
    ? 'Usamos para calcular a distância até cada mercado e se vale a pena ir mais longe. Fica salvo só na sua conta.'
    : 'Usamos sua posição só no seu aparelho, para calcular a distância até as lojas.';
  $('#useGps').textContent = mode === 'home' ? 'Estou em casa agora: usar minha localização' : 'Usar a localização do aparelho';
  openSheet('#locSheet');
}
function applyLoc(pos) {
  if (locMode === 'home') {
    rancho.setHome(pos); closeSheet('#locSheet'); toast(`Casa definida: ${pos.label}.`);
    const cb = locCb; locCb = null; locMode = 'pos'; cb?.();
  } else { setPos(pos); closeSheet('#locSheet'); }
}

function requestGps() {
  if (!('geolocation' in navigator)) return toast('Seu navegador não informa a localização. Escolha o bairro.', 'warn');
  const btn = $('#useGps'); btn.disabled = true; btn.textContent = 'Localizando…';
  navigator.geolocation.getCurrentPosition(
    (g) => {
      btn.disabled = false;
      const p = { lat: g.coords.latitude, lng: g.coords.longitude };
      const near = BAIRROS.map((b) => ({ b, d: haversine(p, b) })).sort((a, b) => a.d - b.d)[0];
      const wasHome = locMode === 'home';
      applyLoc({ ...p, label: near.d < 4 ? near.b.name : 'Sua localização', gps: !wasHome });
      if (wasHome) return;
      const closest = [...S.nearest.entries()].sort((a, b) => a[1].km - b[1].km)[0];
      if (closest) toast(`Mais perto: ${S.markets.get(closest[0]).name}, a ${km(closest[1].km)}.`);
    },
    (err) => {
      btn.disabled = false; btn.textContent = 'Usar a localização do aparelho';
      toast(err.code === 1 ? 'Permissão de localização negada. Escolha seu bairro abaixo.' : 'Não foi possível obter a localização. Escolha seu bairro.', 'warn');
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 },
  );
}

function renderBairros() {
  $('#bairroList').innerHTML = BAIRROS.map((b, i) => `<button class="chip" data-bairro="${i}">${esc(b.name)}</button>`).join('');
}

// ======================================================================
//  Sheets (bottom sheet no celular, modal no desktop)
// ======================================================================
let lastFocus = null;
function openSheet(sel) {
  const el = $(sel); lastFocus = document.activeElement;
  el.hidden = false; document.body.classList.add('no-scroll');
  requestAnimationFrame(() => el.classList.add('is-open'));
  setTimeout(() => (el.querySelector('input, select, button:not([data-close])') || el.querySelector('.sheet__close'))?.focus({ preventScroll: true }), 60);
}
function closeSheet(sel) {
  const el = typeof sel === 'string' ? $(sel) : sel;
  if (!el || el.hidden) return;
  el.classList.remove('is-open');
  setTimeout(() => { el.hidden = true; if (!$$('.sheet.is-open').length) document.body.classList.remove('no-scroll'); }, reduceMotion ? 0 : 260);
  lastFocus?.focus?.({ preventScroll: true });
}
// clicar fora do painel fecha (só se o clique começou fora, para não fechar ao selecionar texto)
let downOnBackdrop = false;
document.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target.classList?.contains('sheet__backdrop') || e.target.classList?.contains('sheet'); });
document.addEventListener('click', (e) => {
  if (downOnBackdrop && (e.target.classList.contains('sheet__backdrop') || e.target.classList.contains('sheet'))) closeSheet(e.target.closest('.sheet'));
  downOnBackdrop = false;
});
// arrastar para fechar (mobile)
$$('.sheet__panel').forEach((panel) => {
  let y0 = null, dy = 0;
  panel.addEventListener('touchstart', (e) => { if (panel.scrollTop <= 0 && e.target.closest('.sheet__grip, .sheet__title, .pd__head, .mk-list')) y0 = e.touches[0].clientY; }, { passive: true });
  panel.addEventListener('touchmove', (e) => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); panel.style.transform = `translateY(${dy}px)`; }, { passive: true });
  panel.addEventListener('touchend', () => { if (y0 == null) return; panel.style.transform = ''; if (dy > 110) closeSheet(panel.closest('.sheet')); y0 = null; dy = 0; });
});

// ======================================================================
//  Detalhe do produto (a "comparação")
// ======================================================================
async function canCompare() {
  if (!S.user) {
    if (S.anonUsed < CONFIG.ANON_COMPARISONS) {
      S.anonUsed++; api.store.set('tb.anonUsed', S.anonUsed);
      const left = CONFIG.ANON_COMPARISONS - S.anonUsed;
      if (left <= 1) toast(left ? 'Resta 1 comparação sem cadastro.' : 'Esta foi sua última comparação sem cadastro.');
      return true;
    }
    openAuth('signup', 'Crie sua conta em 20 segundos para continuar comparando.');
    return false;
  }
  try {
    const r = await api.registerComparison();
    if (r.allowed) {
      if (!r.completed && S.profile) { S.profile.comparisons_used = r.used; S.compLimit = r.limit; renderProfileBanner(); }
      return true;
    }
    openAuth('complete', `Você usou as ${r.limit} comparações do cadastro rápido. Complete o cadastro para comparar sem limite.`);
    return false;
  } catch (e) {
    console.error(e); return true; // não bloqueia o usuário por falha de rede
  }
}

async function openProduct(pid) {
  const p = S.products.find((x) => x.id === pid);
  if (!p || !(await canCompare())) return;
  track('view', { product_id: pid, market_id: visiblePrices(p)[0]?.market_id });
  const prices = visiblePrices(p).length ? visiblePrices(p) : p.prices;
  const best = prices[0], worst = prices[prices.length - 1];
  const bm = S.markets.get(best.market_id);
  const span = Math.max(worst.price - best.price, 0.01);
  const unknown = [...S.markets.values()].filter((m) => isOn(m.id) && !p.prices.some((x) => x.market_id === m.id));
  const promos = prices.filter((x) => x.promo);
  $('#sheetBody').innerHTML = `
    <div class="pd">
      <div class="pd__head">
        ${media(p, 'pd__media')}
        <div>
          <p class="muted small">${esc(p.category_name)}</p>
          <h2 id="sheetTitle" class="sheet__title">${esc(p.name)}</h2>
          <p class="muted small">${esc([p.brand, p.unit].filter(Boolean).join(' · '))}</p>
        </div>
      </div>
      <div class="pd__hero">
        <div>
          <p>Menor preço no <b>${esc(bm.name)}</b></p>
          ${priceTag(best.price, 'lg')} ${best.regular ? `<s class="was">${brl(best.regular)}</s>` : ''}
        </div>
        ${changeBadge(p.change_pct)}
      </div>

      ${promos.map((x) => {
        const m = S.markets.get(x.market_id);
        const ends = x.promo.ends ? new Date(x.promo.ends).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '';
        return x.promo.kind === 'exclusiva'
          ? `<div class="promo-box is-excl">${logo(m, 'md')}<p><b>Preço exclusivo do Tá Barato Mesmo?</b><br/>${brl(x.price)} no ${esc(m.name)}${ends ? ` até ${ends}` : ''}. Mostre o código no caixa.</p>${x.promo.code ? `<span class="promo-code">${esc(x.promo.code)}</span>` : ''}</div>`
          : `<div class="promo-box">${logo(m, 'md')}<p><b>Oferta no ${esc(m.name)}</b><br/>De ${brl(x.regular)} por ${brl(x.price)}${ends ? `, até ${ends}` : ''}.</p></div>`;
      }).join('')}

      <div>
        <h3 class="pd__h">Preço em cada mercado</h3>
        <ol class="bars">
          ${prices.map((x, j) => {
            const m = S.markets.get(x.market_id); const n = S.nearest.get(x.market_id);
            const w = 14 + 86 * ((x.price - best.price) / span);
            const ch = x.prev ? (x.price / x.prev - 1) * 100 : null;
            return `<li class="bar ${j === 0 ? 'is-best' : ''}">
              ${logo(m, 'md')}
              <div class="bar__main">
                <div class="bar__top"><b>${esc(m.name)} ${promoPill(x)}</b><span class="bar__price">${brl(x.price)}</span></div>
                <div class="bar__track"><span style="--w:${w}%"></span></div>
                <div class="bar__meta">
                  <span>${j === 0 ? 'Menor preço' : `+${brl(x.price - best.price)} (${pct((x.price / best.price - 1) * 100)})`}</span>
                  ${ch != null && Math.abs(ch) >= 0.5 ? `<span class="${ch < 0 ? 'down' : 'up'}">${ch < 0 ? '▼' : '▲'} ${Math.abs(ch).toFixed(1).replace('.', ',')}% em 7 dias</span>` : ''}
                  ${x.src === 'comunidade' ? `<span>informado por vizinhos ${ago(x.at)}</span>` : ''}
                  ${n ? `<a href="https://www.google.com/maps/dir/?api=1&destination=${n.store.lat},${n.store.lng}" target="_blank" rel="noopener" data-route="${m.id}">${esc(n.store.neighborhood)}, ${km(n.km)}</a>` : ''}
                </div>
              </div>
            </li>`;
          }).join('')}
        </ol>
      </div>

      ${unknown.length ? `<div class="ask-row"><span>Sem preço em ${esc(unknown.map((m) => m.name).join(', '))}.</span><button class="btn btn--sm btn--ghost" data-fiscal-one="${p.id}" data-fiscal-m="${unknown[0].id}">Eu sei o preço</button></div>` : ''}

      <div class="pd__chart">
        <div class="pd__charthead">
          <h3 class="pd__h">Histórico de preço</h3>
          <div class="seg seg--sm" role="tablist" id="rangeTabs">
            <button role="tab" aria-selected="false" data-range="7">7 dias</button>
            <button role="tab" aria-selected="false" data-range="15">15 dias</button>
            <button role="tab" aria-selected="true" data-range="30">30 dias</button>
          </div>
        </div>
        <div id="chartBox" class="chart"><div class="skeleton" style="height:220px"></div></div>
      </div>

      <div class="pd__actions">
        ${S.list.get(p.id) ? stepper(p.id) : `<button class="btn btn--primary" data-add="${p.id}">Adicionar ao rancho</button>`}
        <button class="btn btn--ghost" data-report="${p.id}">Viu outro preço?</button>
      </div>
      <p class="muted small">Atualizado ${new Date(p.updated_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}. ${api.MODE === 'demo' ? 'Dados de demonstração.' : ''}</p>
    </div>`;
  $('#productSheet').dataset.pid = pid;
  openSheet('#productSheet');
  drawHistory(pid, 30);
}

async function drawHistory(pid, days) {
  $$('#rangeTabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.range == days));
  try {
    const rows = await api.priceHistory(pid, days);
    const series = [...S.markets.values()].filter((m) => isOn(m.id)).map((m) => ({
      id: m.id, name: m.name, color: m.color,
      points: rows.filter((r) => r.market_id === m.id).sort((a, b) => a.t - b.t).map((r) => ({ t: r.t, v: r.price })),
    })).filter((s) => s.points.length);
    $('#chartBox').innerHTML = lineChart(series, { format: brl });
  } catch (e) {
    $('#chartBox').innerHTML = `<p class="muted">Não foi possível carregar o histórico.</p>`;
  }
}

function openReport(pid) { fiscal.open({ product: pid }); }

// ======================================================================
//  Lista de compras
// ======================================================================
function saveList() { api.store.set('tb.list', [...S.list]); updateListBadge(); }
function updateListBadge() {
  const n = S.list.size;
  $$('[data-list-count]').forEach((b) => { b.hidden = !n; b.textContent = n; });
}
function setQty(pid, q) {
  if (q > 0 && !S.list.has(pid)) { const p = S.products.find((x) => x.id === pid); track('add', { product_id: pid, market_id: p && visiblePrices(p)[0]?.market_id }); }
  if (q <= 0) S.list.delete(pid); else S.list.set(pid, q);
  saveList(); rancho.onListChange();
  $$(`[data-pid="${pid}"] .card__foot .stepper, [data-pid="${pid}"] .card__foot .add-btn`).forEach((el) => (el.outerHTML = stepper(pid)));
  const pd = $('#productSheet');
  if (!pd.hidden && Number(pd.dataset.pid) === pid) { const a = $('.pd__actions > .stepper, .pd__actions > [data-add]', pd); if (a) a.outerHTML = q > 0 ? stepper(pid) : `<button class="btn btn--primary" data-add="${pid}">Adicionar ao rancho</button>`; }
  if (location.hash === '#lista') renderList();
}
const renderList = () => rancho.render();

// ======================================================================
//  Mapa
// ======================================================================
function drawMap() {
  if (!window.L) return;
  const center = S.pos || CONFIG.DEFAULT_POS;
  if (!S.map) {
    S.map = L.map('map', { zoomControl: true, attributionControl: true }).setView([center.lat, center.lng], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(S.map);
    S.mapLayers = L.layerGroup().addTo(S.map);
  }
  S.mapLayers.clearLayers();
  const stores = S.stores.filter((s) => !S.mapFilter || s.supermarket_id === S.mapFilter)
    .map((s) => ({ s, d: S.pos ? haversine(S.pos, s) : null }))
    .sort((a, b) => (a.d ?? 0) - (b.d ?? 0));
  const bounds = [];
  for (const { s, d } of stores) {
    const m = S.markets.get(s.supermarket_id);
    const icon = L.divIcon({ className: 'pin', html: `<div class="pin__b" style="--c:${esc(m.color)}">${logo(m, 'xs')}</div>`, iconSize: [40, 48], iconAnchor: [20, 46] });
    L.marker([s.lat, s.lng], { icon, title: s.name }).addTo(S.mapLayers).bindPopup(`
      <b>${esc(s.name)}</b><br/>${esc(s.neighborhood)}${s.approx ? ' <small>(posição aproximada)</small>' : ''}
      ${d != null ? `<br/>${km(d)} de você` : ''}<br/>
      <a href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}" target="_blank" rel="noopener">Abrir rota</a>`);
    bounds.push([s.lat, s.lng]);
  }
  if (S.pos) {
    L.circleMarker([S.pos.lat, S.pos.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#2563EB', fillOpacity: 1 }).addTo(S.mapLayers).bindPopup('Você está aqui');
    bounds.push([S.pos.lat, S.pos.lng]);
  }
  if (bounds.length) S.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
  setTimeout(() => S.map.invalidateSize(), 50);

  $('#mapFilters').innerHTML = [`<button class="chip ${!S.mapFilter ? 'is-on' : ''}" data-mapf="">Todos</button>`,
    ...[...S.markets.values()].map((m) => `<button class="chip ${S.mapFilter === m.id ? 'is-on' : ''}" data-mapf="${m.id}">${logo(m, 'xs')}${esc(m.name)}</button>`)].join('');
  $('#storeList').innerHTML = stores.map(({ s, d }) => {
    const m = S.markets.get(s.supermarket_id);
    return `<li><button class="store" data-fly="${s.id}">${logo(m, 'sm')}<span><b>${esc(s.name)}</b><small>${esc(s.neighborhood)}${s.approx ? '*' : ''}</small></span>${d != null ? `<em>${km(d)}</em>` : ''}</button></li>`;
  }).join('');
}

// ======================================================================
//  Autenticação e cadastro
// ======================================================================
const phoneMask = (v) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};
const cepMask = (v) => { const d = v.replace(/\D/g, '').slice(0, 8); return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d; };

function openAuth(mode = 'signup', reason = '') {
  const body = $('#authBody');
  const note = reason ? `<p class="note">${esc(reason)}</p>` : '';
  if (mode === 'signup') {
    body.innerHTML = `
      <h2 id="authTitle" class="sheet__title">Cadastro rápido</h2>
      ${note}
      <p class="muted">Só nome, e-mail e senha. O resto você completa depois, quando quiser.</p>
      <form class="form" id="signupForm" novalidate>
        <label>Seu nome<input name="name" autocomplete="given-name" required minlength="2" placeholder="Como podemos te chamar?" /></label>
        <label>E-mail<input name="email" type="email" autocomplete="email" inputmode="email" required placeholder="voce@email.com" /></label>
        <label>Senha<span class="pw"><input name="password" type="password" autocomplete="new-password" required minlength="6" placeholder="Mínimo 6 caracteres" /><button type="button" class="pw__t" aria-label="Mostrar senha">Mostrar</button></span></label>
        <p class="form__err" role="alert"></p>
        <button class="btn btn--primary btn--block" type="submit">Criar conta</button>
      </form>
      <p class="center small">Já tem conta? <button class="linkish" data-auth="login">Entrar</button></p>`;
  } else if (mode === 'login') {
    body.innerHTML = `
      <h2 id="authTitle" class="sheet__title">Entrar</h2>${note}
      <form class="form" id="loginForm" novalidate>
        <label>E-mail<input name="email" type="email" autocomplete="email" inputmode="email" required /></label>
        <label>Senha<span class="pw"><input name="password" type="password" autocomplete="current-password" required /><button type="button" class="pw__t" aria-label="Mostrar senha">Mostrar</button></span></label>
        <p class="form__err" role="alert"></p>
        <button class="btn btn--primary btn--block" type="submit">Entrar</button>
      </form>
      <p class="center small"><button class="linkish" data-auth="forgot">Esqueci a senha</button> · Novo aqui? <button class="linkish" data-auth="signup">Criar conta</button></p>`;
  } else if (mode === 'forgot') {
    body.innerHTML = `
      <h2 id="authTitle" class="sheet__title">Recuperar senha</h2>
      <form class="form" id="forgotForm"><label>E-mail<input name="email" type="email" required autocomplete="email" /></label>
      <p class="form__err" role="alert"></p><button class="btn btn--primary btn--block">Enviar link</button></form>
      <p class="center small"><button class="linkish" data-auth="login">Voltar</button></p>`;
  } else if (mode === 'complete') {
    if (!S.user) return openAuth('signup', reason);
    const p = S.profile || {};
    body.innerHTML = `
      <h2 id="authTitle" class="sheet__title">Complete seu cadastro</h2>${note}
      <p class="muted">Com o cadastro completo você compara sem limite e recebe alertas dos mercados que escolher.</p>
      <form class="form" id="completeForm" novalidate>
        <label>Nome completo<input name="full_name" autocomplete="name" required value="${esc(p.full_name || S.user.user_metadata?.full_name || '')}" /></label>
        <div class="form__row">
          <label>Celular (WhatsApp)<input name="phone" type="tel" inputmode="tel" autocomplete="tel" required placeholder="(92) 9 0000-0000" value="${esc(p.phone || '')}" /></label>
          <label>Nascimento<input name="birth_date" type="date" required max="${new Date().toISOString().slice(0, 10)}" value="${esc(p.birth_date || '')}" /></label>
        </div>
        <div class="form__row">
          <label>CEP<input name="cep" inputmode="numeric" autocomplete="postal-code" placeholder="69000-000" value="${esc(p.cep || '')}" /></label>
          <label>Bairro<input name="neighborhood" list="bairrosDl" required value="${esc(p.neighborhood || S.pos?.label || '')}" /></label>
        </div>
        <fieldset class="pick">
          <legend>Sexo <span class="muted">(usado só em números agregados, nunca individualmente)</span></legend>
          <div class="radios">${[['feminino', 'Feminino'], ['masculino', 'Masculino'], ['outro', 'Outro'], ['nao_informar', 'Prefiro não informar']].map(([v, l]) => `<label><input type="radio" name="gender" value="${v}" ${p.gender === v ? 'checked' : ''} />${l}</label>`).join('')}</div>
        </fieldset>
        <datalist id="bairrosDl">${BAIRROS.map((b) => `<option value="${esc(b.name)}">`).join('')}</datalist>
        <fieldset class="pick">
          <legend>Onde você costuma comprar?</legend>
          ${[...S.markets.values()].map((m) => `<label class="pick__i"><input type="checkbox" name="markets" value="${m.id}" ${(p.preferred_markets || []).includes(m.id) ? 'checked' : ''} />${logo(m, 'sm')}<span>${esc(m.name)}</span></label>`).join('')}
        </fieldset>
        <label class="check"><input type="checkbox" name="accepts_offers" ${p.accepts_offers ? 'checked' : ''} /> Quero receber alertas quando um produto da minha lista baixar</label>
        <p class="form__err" role="alert"></p>
        <button class="btn btn--primary btn--block" type="submit">Concluir cadastro</button>
      </form>`;
    const f = $('#completeForm');
    f.phone.addEventListener('input', () => (f.phone.value = phoneMask(f.phone.value)));
    f.cep.addEventListener('input', async () => {
      f.cep.value = cepMask(f.cep.value);
      const d = f.cep.value.replace(/\D/g, '');
      if (d.length === 8) {
        try {
          const r = await (await fetch(`https://viacep.com.br/ws/${d}/json/`)).json();
          if (!r.erro && r.bairro) { f.neighborhood.value = r.bairro; f.neighborhood.classList.add('flash'); setTimeout(() => f.neighborhood.classList.remove('flash'), 800); }
        } catch {}
      }
    });
  }
  bindAuthForms();
  if ($('#authSheet').hidden) openSheet('#authSheet');
  else setTimeout(() => $('#authBody input')?.focus(), 30);
}

function formError(f, msg) { const e = $('.form__err', f); e.textContent = msg; e.hidden = !msg; }
function busy(f, on, label) { const b = $('button[type=submit], button:not([type])', f); b.disabled = on; if (label) b.dataset.l ??= b.textContent; b.textContent = on ? label : b.dataset.l || b.textContent; }
const authMsg = (e) => {
  const m = (e?.message || '').toLowerCase();
  if (m.includes('already registered') || m.includes('already been registered')) return 'Este e-mail já tem conta. Use “Entrar”.';
  if (m.includes('invalid login')) return 'E-mail ou senha incorretos.';
  if (m.includes('email not confirmed')) return 'Confirme seu e-mail pelo link que enviamos e tente de novo.';
  if (m.includes('password')) return 'A senha precisa ter pelo menos 6 caracteres.';
  return e?.message || 'Algo deu errado. Tente novamente.';
};

function bindAuthForms() {
  $$('#authBody .pw__t').forEach((b) => b.addEventListener('click', () => {
    const i = b.previousElementSibling; const show = i.type === 'password';
    i.type = show ? 'text' : 'password'; b.textContent = show ? 'Ocultar' : 'Mostrar';
  }));
  const su = $('#signupForm');
  su?.addEventListener('submit', async (e) => {
    e.preventDefault(); formError(su, '');
    const name = su.name.value.trim(), email = su.email.value.trim(), password = su.password.value;
    if (name.length < 2) return formError(su, 'Informe seu nome.');
    if (!/^\S+@\S+\.\S+$/.test(email)) return formError(su, 'Informe um e-mail válido.');
    if (password.length < 6) return formError(su, 'A senha precisa ter pelo menos 6 caracteres.');
    busy(su, true, 'Criando conta…');
    try {
      const r = await api.signUp({ name, email, password });
      if (r.needsConfirm) {
        $('#authBody').innerHTML = `<h2 class="sheet__title">Confirme seu e-mail</h2><p>Enviamos um link para <b>${esc(email)}</b>. Abra o e-mail e toque no link para ativar sua conta.</p><button class="btn btn--primary btn--block" data-close>Entendi</button>`;
      } else {
        closeSheet('#authSheet');
        toast(`Bem-vindo, ${name.split(' ')[0]}! Você tem ${CONFIG.QUICK_COMPARISONS} comparações para usar.`);
      }
    } catch (err) { formError(su, authMsg(err)); } finally { busy(su, false); }
  });
  const li = $('#loginForm');
  li?.addEventListener('submit', async (e) => {
    e.preventDefault(); formError(li, ''); busy(li, true, 'Entrando…');
    try { await api.signIn({ email: li.email.value.trim(), password: li.password.value }); closeSheet('#authSheet'); toast('Você entrou.'); }
    catch (err) { formError(li, authMsg(err)); } finally { busy(li, false); }
  });
  const fg = $('#forgotForm');
  fg?.addEventListener('submit', async (e) => {
    e.preventDefault(); busy(fg, true, 'Enviando…');
    try { await api.resetPassword(fg.email.value.trim()); fg.outerHTML = `<p class="ok-box">Se houver conta com esse e-mail, o link chega em instantes.</p>`; }
    catch (err) { formError(fg, authMsg(err)); busy(fg, false); }
  });
  const cf = $('#completeForm');
  cf?.addEventListener('submit', async (e) => {
    e.preventDefault(); formError(cf, '');
    const data = {
      full_name: cf.full_name.value.trim(), phone: cf.phone.value.trim(), birth_date: cf.birth_date.value,
      neighborhood: cf.neighborhood.value.trim(), cep: cf.cep.value.trim(),
      preferred_markets: $$('input[name=markets]:checked', cf).map((i) => Number(i.value)),
      accepts_offers: cf.accepts_offers.checked,
      gender: cf.querySelector('input[name=gender]:checked')?.value || 'nao_informar',
    };
    if (data.full_name.split(/\s+/).length < 2) return formError(cf, 'Informe nome e sobrenome.');
    if (data.phone.replace(/\D/g, '').length < 10) return formError(cf, 'Informe um celular com DDD.');
    if (!data.birth_date) return formError(cf, 'Informe sua data de nascimento.');
    if (!data.neighborhood) return formError(cf, 'Informe seu bairro.');
    busy(cf, true, 'Salvando…');
    try {
      S.profile = await api.completeProfile(data);
      closeSheet('#authSheet'); renderProfileBanner(); renderAccount();
      if (data.preferred_markets.length) { S.enabled = new Set(data.preferred_markets); api.store.set('tb.enabled', [...S.enabled]); renderNearby(); renderGrid(); }
      const b = BAIRROS.find((x) => x.name.toLowerCase() === data.neighborhood.toLowerCase());
      if (b && !S.pos?.gps) setPos({ lat: b.lat, lng: b.lng, label: b.name });
      toast('Cadastro completo. Agora é sem limite.');
    } catch (err) { formError(cf, authMsg(err)); } finally { busy(cf, false); }
  });
}

function renderProfileBanner() {
  const p = S.profile; const el = $('#profileBanner');
  if (!S.user || !p || p.completed_at) { el.hidden = true; return; }
  const lim = S.compLimit || CONFIG.QUICK_COMPARISONS;
  const used = p.comparisons_used || 0, left = Math.max(lim - used, 0);
  el.hidden = false;
  $('#profileRing').style.setProperty('--p', Math.min(used / lim, 1));
  $('#profileRing').textContent = left;
  $('#profileBannerTitle').textContent = left ? `${left} ${left > 1 ? 'comparações restantes' : 'comparação restante'}` : 'Comparações esgotadas';
  $('#profileBannerText').textContent = 'Complete o cadastro para comparar sem limite.';
}

function renderAccount() { account.render(); }

// ======================================================================
//  Rotas
// ======================================================================
function route() {
  const v = (location.hash || '#ofertas').slice(1).split('?')[0];
  const view = ['ofertas', 'mapa', 'lista', 'conta'].includes(v) ? v : 'ofertas';
  $$('.view').forEach((s) => (s.hidden = s.dataset.view !== view));
  $$('[data-nav]').forEach((a) => a.classList.toggle('is-active', a.dataset.nav === view));
  if (view === 'mapa') drawMap();
  if (view === 'lista') renderList();
  if (view === 'conta') renderAccount();
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

// ======================================================================
//  Toasts
// ======================================================================
function toast(msg, kind = '') {
  const wrap = $('#toasts');
  if ([...wrap.children].some((c) => c.textContent === msg)) return;
  while (wrap.children.length >= 2) wrap.firstElementChild.remove();
  const t = document.createElement('div');
  t.className = `toast ${kind ? 'toast--' + kind : ''}`; t.textContent = msg;
  $('#toasts').append(t);
  requestAnimationFrame(() => t.classList.add('is-in'));
  setTimeout(() => { t.classList.remove('is-in'); setTimeout(() => t.remove(), 300); }, 3800);
}

// ======================================================================
//  Eventos
// ======================================================================
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, a'); if (!t) return;
  const d = t.dataset;
  if (d.close !== undefined) return closeSheet(t.closest('.sheet'));
  if (d.add) return setQty(Number(d.add), 1), toast('Adicionado à lista.');
  if (d.inc) return setQty(Number(d.inc), (S.list.get(Number(d.inc)) || 0) + 1);
  if (d.dec) return setQty(Number(d.dec), (S.list.get(Number(d.dec)) || 0) - 1);
  if (d.fav) {
    const id = Number(d.fav); const on = !S.favs.has(id);
    if (!S.user) return openAuth('signup', 'Crie sua conta para salvar favoritos.');
    on ? S.favs.add(id) : S.favs.delete(id);
    $$(`[data-fav="${id}"]`).forEach((b) => { b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on); });
    api.toggleFavorite(S.user.id, id, on).catch(() => toast('Não foi possível salvar o favorito.', 'warn'));
    return;
  }
  if (d.openProduct) return openProduct(Number(d.openProduct));
  if (d.report) return openReport(Number(d.report));
  if (d.range) return drawHistory(Number($('#productSheet').dataset.pid), Number(d.range));
  if (d.cat) { S.category = d.cat; renderChips(); return renderGrid(); }
  if (d.route) track('route', { market_id: Number(d.route) });
  if (d.bairro) { const b = BAIRROS[Number(d.bairro)]; return applyLoc({ lat: b.lat, lng: b.lng, label: b.name }); }
  if (d.mapf !== undefined) { S.mapFilter = d.mapf ? Number(d.mapf) : null; return drawMap(); }
  if (d.fly) {
    const s = S.stores.find((x) => x.id === Number(d.fly));
    S.map.flyTo([s.lat, s.lng], 15, { duration: reduceMotion ? 0 : 0.8 });
    S.mapLayers.eachLayer((l) => { if (l.options.title === s.name) setTimeout(() => l.openPopup(), reduceMotion ? 0 : 850); });
    $('#map').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    return;
  }
  if (d.auth) return openAuth(d.auth);
  if (d.open === 'loc') return openLoc('pos');
  if (d.open === 'markets') return openSheet('#marketsSheet');
  if (d.open === 'home') return openLoc('home', () => renderAccount());
  if (d.open === 'complete') return openAuth('complete');
  if (t.id === 'locBtn') return openLoc('pos');
  if (t.id === 'themeBtn') return toggleTheme();
  if (t.id === 'useGps') return requestGps();
  if (t.id === 'logout') { await api.signOut(); location.hash = '#ofertas'; toast('Você saiu da conta.'); }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { const open = $$('.sheet.is-open').pop(); if (open) closeSheet(open); }
});

let qTimer, trackTimer;
$('#searchInput').addEventListener('input', (e) => {
  clearTimeout(qTimer); clearTimeout(trackTimer);
  qTimer = setTimeout(() => { S.q = e.target.value; renderGrid(); }, 120);
  // registra a busca quando a pessoa para de digitar
  trackTimer = setTimeout(() => { const v = e.target.value.trim(); if (v.length >= 3) track('search', { query: v, results: filtered().length }); }, 1500);
});
$('#sortSelect').addEventListener('change', (e) => { S.sort = e.target.value; renderGrid(); });
document.addEventListener('change', (e) => {
  const id = Number(e.target.dataset?.marketToggle); if (!id) return;
  if (S.enabled.size === 0) S.enabled = new Set([...S.markets.keys()]);
  if (!e.target.checked) {
    if (S.enabled.size === 1) { e.target.checked = true; return toast('Deixe pelo menos um mercado na comparação.', 'warn'); }
    S.enabled.delete(id);
  } else S.enabled.add(id);
  if (S.enabled.size === S.markets.size) S.enabled.clear();
  api.store.set('tb.enabled', [...S.enabled]);
  renderNearby(); renderDeals(); renderGrid();
});
// borda na barra de filtros quando ela gruda no topo
{
  const sentinel = Object.assign(document.createElement('div'), { style: 'height:1px;margin-bottom:-1px' });
  $('.toolbar').before(sentinel);
  new IntersectionObserver(([en]) => $('.toolbar').classList.toggle('is-stuck', !en.isIntersecting && en.boundingClientRect.top < 100),
    { rootMargin: '-70px 0px 0px 0px' }).observe(sentinel);
}

window.addEventListener('hashchange', route);

// ======================================================================
//  Início
// ======================================================================
function skeleton() {
  $('#productGrid').innerHTML = Array.from({ length: 6 }, () => `<div class="card card--skel"><div class="skeleton" style="height:48px"></div><div class="skeleton" style="height:64px;width:60%"></div><div class="skeleton" style="height:40px"></div></div>`).join('');
}

function toggleTheme() {
  const dark = document.documentElement.dataset.theme !== 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  api.store.set('tb.theme', dark ? 'dark' : 'light');
  $('meta[name=theme-color]').content = dark ? '#111513' : '#FFFFFF';
  $('#themeBtn').setAttribute('aria-pressed', dark);
  $('#themeBtn').setAttribute('aria-label', dark ? 'Usar tema claro' : 'Usar tema escuro');
}

async function refreshCatalog() {
  const data = await api.loadCatalog();
  S.products = data.products; renderGrid();
  if (location.hash === '#lista') renderList();
}
Object.assign(hooks, {
  setQty, toast, openSheet, closeSheet, openAuth, refreshCatalog, card,
  afterListLoad: () => { updateListBadge(); renderGrid(); if (location.hash === '#lista') renderList(); },
  openHome: (cb) => openLoc('home', cb),
  afterContribution: () => { fiscal.renderHome(); if (S.user) api.getProfile().then((p) => { S.profile = p; renderProfileBanner(); }).catch(() => {}); },
});

async function boot() {
  skeleton(); renderBairros(); updateListBadge();
  const data = await api.loadCatalog();
  data.supermarkets.forEach((m) => S.markets.set(m.id, m));
  S.stores = data.stores; S.categories = data.categories; S.products = data.products;
  // remove mercados ligados que não existem mais
  S.enabled = new Set([...S.enabled].filter((id) => S.markets.has(id)));

  if (S.pos) { computeNearest(); $('#locLabel').textContent = S.pos.label || 'Minha localização'; $('#locBtn').classList.add('is-set'); }
  rancho.meta();
  renderChips(); renderNearby(); renderDeals(); renderGrid(); route();
  fiscal.renderHome(); fiscal.checkAtStore();

  // Se o usuário já autorizou a localização antes, atualiza em silêncio
  try {
    const perm = await navigator.permissions?.query({ name: 'geolocation' });
    if (perm?.state === 'granted') navigator.geolocation.getCurrentPosition((g) => {
      const p = { lat: g.coords.latitude, lng: g.coords.longitude };
      const near = BAIRROS.map((b) => ({ b, d: haversine(p, b) })).sort((a, b) => a.d - b.d)[0];
      setPos({ ...p, label: near.d < 4 ? near.b.name : 'Sua localização', gps: true });
    });
    else if (!S.pos) setTimeout(() => { if (!S.pos && !$$('.sheet.is-open').length) openLoc('pos'); }, 1400);
  } catch {}

  api.onAuth(async (user) => {
    S.user = user;
    S.profile = user ? await api.getProfile().catch(() => null) : null;
    S.favs = new Set(user ? await api.loadFavorites().catch(() => []) : []);
    if (user && S.profile?.transport) { const m = rancho.MODES[S.profile.transport]; if (m && S.transport.mode !== S.profile.transport) S.transport = { mode: S.profile.transport, value: m.value }; }
    if (user && S.profile?.home_lat && !S.home) S.home = { lat: S.profile.home_lat, lng: S.profile.home_lng, label: S.profile.home_label || S.profile.neighborhood };
    renderProfileBanner(); renderAccount(); renderGrid(); fiscal.renderHome();
    if (user) await rancho.syncFromServer();
    if (location.hash === '#lista') renderList();
  });
  await api.initAuth();

  api.onNewPrice((row) => {
    const p = S.products.find((x) => x.id === row.product_id); if (!p) return;
    const x = p.prices.find((r) => r.market_id === row.supermarket_id);
    const price = Number(row.price);
    if (x) { x.price = price; x.at = row.collected_at; } else p.prices.push({ market_id: row.supermarket_id, price, prev: null, at: row.collected_at });
    p.prices.sort((a, b) => a.price - b.price);
    p.min_price = p.prices[0].price; p.max_price = p.prices[p.prices.length - 1].price;
    renderGrid();
    toast(`Novo preço: ${p.name} a ${brl(price)} no ${S.markets.get(row.supermarket_id)?.name}.`);
  });

  if (api.MODE === 'demo') document.body.classList.add('is-demo');
}

boot().catch((e) => {
  console.error(e);
  $('#productGrid').innerHTML = `<p class="empty">Não foi possível carregar os preços. Verifique sua conexão e recarregue a página.</p>`;
});

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
