import { CONFIG, BAIRROS } from './config.js';
import * as api from './api.js';
import { lineChart } from './chart.js';

// ======================================================================
//  Estado
// ======================================================================
const S = {
  markets: new Map(), stores: [], categories: [], products: [],
  pos: api.store.get('tb.pos'), nearest: new Map(),
  sort: 'baratos', category: 'all', q: '',
  enabled: new Set(api.store.get('tb.enabled', [])), // mercados ligados (vazio = todos)
  list: new Map(api.store.get('tb.list', [])),
  favs: new Set(),
  user: null, profile: null,
  anonUsed: api.store.get('tb.anonUsed', 0),
  map: null, mapLayers: null, mapFilter: null,
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v) => (v > 0 ? '+' : '') + v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
const km = (d) => (d < 1 ? Math.round(d * 1000) + ' m' : d.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' km');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function haversine(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const isOn = (mid) => S.enabled.size === 0 || S.enabled.has(mid);
const visiblePrices = (p) => p.prices.filter((x) => isOn(x.market_id));

// ======================================================================
//  Componentes
// ======================================================================
function initials(name) {
  return name.replace(/^Supermercados?\s+/i, '').split(/\s+/).filter((w) => w.length > 2 || /^[A-Z]{2,}$/.test(w))
    .slice(0, 2).map((w) => w[0]).join('').toUpperCase() || name.slice(0, 2).toUpperCase();
}

/** Logomarca oficial (assets/logos/*.png). Se o arquivo não existir, mostra monograma. */
function logo(m, size = 'sm') {
  return `<span class="logo logo--${size}" style="--c:${esc(m.color || '#0E3B2E')}" title="${esc(m.name)}">
    <i aria-hidden="true">${esc(initials(m.name))}</i>
    ${m.logo_url ? `<img src="${esc(m.logo_url)}" alt="${esc(m.name)}" loading="lazy" decoding="async" />` : ''}
  </span>`;
}
// imagem quebrada → remove e deixa o monograma
document.addEventListener('error', (e) => {
  if (e.target.tagName === 'IMG' && e.target.closest('.logo')) e.target.remove();
}, true);

function priceTag(v, size = '') {
  const [int, dec] = v.toFixed(2).split('.');
  return `<span class="tag ${size}"><span class="tag__cur">R$</span><span class="tag__int">${Number(int).toLocaleString('pt-BR')}</span><span class="tag__dec">,${dec}</span></span>`;
}

function changeBadge(c) {
  if (c == null || Math.abs(c) < 0.5) return `<span class="chg chg--flat">estável em 7 dias</span>`;
  const down = c < 0;
  return `<span class="chg ${down ? 'chg--down' : 'chg--up'}" title="Variação média nos últimos 7 dias">
    <svg viewBox="0 0 12 12" aria-hidden="true"><path d="${down ? 'M6 10 1.5 4h9z' : 'M6 2l4.5 6h-9z'}" fill="currentColor"/></svg>
    ${down ? 'caiu' : 'subiu'} ${pct(Math.abs(c)).replace('+', '')} em 7 dias</span>`;
}

function stepper(pid) {
  const q = S.list.get(pid) || 0;
  if (!q) return `<button class="btn btn--sm btn--add" data-add="${pid}" aria-label="Adicionar à lista">+ Lista</button>`;
  return `<span class="stepper" role="group" aria-label="Quantidade na lista">
    <button data-dec="${pid}" aria-label="Diminuir">−</button><output>${q}</output><button data-inc="${pid}" aria-label="Aumentar">+</button></span>`;
}

function card(p, i) {
  const prices = visiblePrices(p);
  if (!prices.length) return '';
  const best = prices[0], worst = prices[prices.length - 1];
  const bm = S.markets.get(best.market_id);
  const nb = S.nearest.get(best.market_id);
  const nearestMarket = S.pos ? [...S.nearest.entries()].filter(([id]) => isOn(id)).sort((a, b) => a[1].km - b[1].km)[0]?.[0] : null;
  const save = worst.price - best.price;
  return `<article class="card" data-pid="${p.id}" style="--i:${Math.min(i, 12)}">
    <button class="card__hit" data-open-product="${p.id}" aria-label="Comparar ${esc(p.name)} ${esc(p.brand || '')}"></button>
    <header class="card__head">
      <span class="card__emoji" aria-hidden="true">${p.emoji || '🛒'}</span>
      <div class="card__title">
        <h3>${esc(p.name)}</h3>
        <p>${esc([p.brand, p.unit].filter(Boolean).join(', '))}</p>
      </div>
      <button class="fav ${S.favs.has(p.id) ? 'is-on' : ''}" data-fav="${p.id}" aria-pressed="${S.favs.has(p.id)}" aria-label="Favoritar">
        <svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.7 4.5c2.1 0 3.6 1.2 4.3 2.4.7-1.2 2.2-2.4 4.3-2.4 3.7 0 5.8 3.8 4.3 7.2C19.5 16.4 12 21 12 21z"/></svg>
      </button>
    </header>

    <div class="card__price">
      ${priceTag(best.price)}
      <div class="card__where">
        ${logo(bm, 'md')}
        <span><b>${esc(bm.name)}</b>${nb ? `<small>${km(nb.km)} de você</small>` : `<small>menor preço</small>`}</span>
      </div>
    </div>
    ${changeBadge(p.change_pct)}

    <ul class="mini" aria-label="Preço em cada supermercado">
      ${prices.map((x, j) => {
        const m = S.markets.get(x.market_id);
        const diff = x.price - best.price;
        return `<li class="${j === 0 ? 'is-best' : ''} ${x.market_id === nearestMarket ? 'is-near' : ''}" title="${esc(m.name)}${x.market_id === nearestMarket ? ' (mais perto)' : ''}">
          ${logo(m, 'xs')}<span class="mini__p">${brl(x.price)}</span>${j ? `<span class="mini__d">+${diff.toFixed(2).replace('.', ',')}</span>` : ''}
        </li>`;
      }).join('')}
    </ul>

    <footer class="card__foot">
      <span class="save">${prices.length > 1 && save > 0.009 ? `Economize até <b>${brl(save)}</b>` : prices.length === 1 ? 'Só em 1 mercado' : 'Mesmo preço'}</span>
      ${stepper(p.id)}
    </footer>
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
  const chips = [{ slug: 'all', name: 'Tudo', icon: '🛒' }, ...S.categories, { slug: 'fav', name: 'Favoritos', icon: '♥' }];
  $('#catChips').innerHTML = chips.map((c) =>
    `<button class="chip ${S.category === c.slug ? 'is-on' : ''}" data-cat="${c.slug}" aria-pressed="${S.category === c.slug}"><span aria-hidden="true">${c.icon || ''}</span>${esc(c.name)}</button>`).join('');
}

function renderNearby() {
  const ms = [...S.markets.values()].map((m) => ({ m, n: S.nearest.get(m.id) }))
    .sort((a, b) => (a.n?.km ?? 999) - (b.n?.km ?? 999) || a.m.name.localeCompare(b.m.name));
  $('#nearbyHint').innerHTML = S.pos
    ? `Perto de <b>${esc(S.pos.label || 'você')}</b>. Toque para incluir ou tirar da comparação.`
    : `<button class="linkish" data-open="loc">Ative a localização</button> para ver o mercado mais perto.`;
  $('#nearbyRow').innerHTML = ms.map(({ m, n }, i) => `
    <button class="market ${isOn(m.id) ? '' : 'is-off'} ${S.pos && i === 0 ? 'is-closest' : ''}" data-market="${m.id}" aria-pressed="${isOn(m.id)}">
      ${logo(m, 'lg')}
      <span class="market__txt"><b>${esc(m.name)}</b>
      <small>${n ? `${km(n.km)}, ${esc(n.store.neighborhood)}${n.store.approx ? '*' : ''}` : `${S.stores.filter((s) => s.supermarket_id === m.id).length} lojas`}</small></span>
      ${S.pos && i === 0 ? '<em>Mais perto</em>' : ''}
    </button>`).join('');
}

function renderSpotlight() {
  const rows = S.products.flatMap((p) => p.prices.filter((x) => x.prev).map((x) => ({ p, x, c: (x.price / x.prev - 1) * 100 })))
    .filter((r) => r.c < 0).sort((a, b) => a.c - b.c);
  const r = rows[0]; const el = $('#spotlight');
  if (!r) { el.hidden = true; return; }
  const m = S.markets.get(r.x.market_id);
  el.innerHTML = `<button class="spot__card" data-open-product="${r.p.id}">
    <span class="spot__kicker">Maior queda da semana</span>
    <span class="spot__emoji" aria-hidden="true">${r.p.emoji || '🛒'}</span>
    <span class="spot__name">${esc(r.p.name)}<small>${esc([r.p.brand, r.p.unit].filter(Boolean).join(', '))}</small></span>
    <span class="spot__row">${priceTag(r.x.price, 'tag--xl')}
      <span class="spot__was">era <s>${brl(r.x.prev)}</s><b>▼ ${Math.abs(r.c).toFixed(1).replace('.', ',')}%</b></span></span>
    <span class="spot__m">${logo(m, 'sm')} no ${esc(m.name)}</span>
  </button>`;
}

function renderTicker() {
  const movers = S.products.flatMap((p) => p.prices.filter((x) => x.prev).map((x) => ({ p, x, c: (x.price / x.prev - 1) * 100 })))
    .filter((r) => Math.abs(r.c) >= 4).sort((a, b) => Math.abs(b.c) - Math.abs(a.c)).slice(0, 14);
  if (!movers.length) { $('.hero__ticker').hidden = true; return; }
  const item = ({ p, x, c }) => {
    const m = S.markets.get(x.market_id);
    return `<button class="tick ${c < 0 ? 'tick--down' : 'tick--up'}" data-open-product="${p.id}">
      ${logo(m, 'xs')}<span class="tick__n">${esc(p.name)} <small>${esc(p.brand || '')}</small></span>
      <span class="tick__v">${brl(x.price)}</span><span class="tick__c">${c < 0 ? '▼' : '▲'} ${Math.abs(c).toFixed(1).replace('.', ',')}%</span></button>`;
  };
  const html = movers.map(item).join('');
  $('#ticker').innerHTML = `<div class="ticker__track">${html}</div><div class="ticker__track" aria-hidden="true">${html}</div>`;
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
}

function requestGps() {
  if (!('geolocation' in navigator)) return toast('Seu navegador não informa a localização. Escolha o bairro.', 'warn');
  const btn = $('#useGps'); btn.disabled = true; btn.textContent = 'Localizando…';
  navigator.geolocation.getCurrentPosition(
    (g) => {
      btn.disabled = false; btn.textContent = 'Usar a localização do aparelho';
      const p = { lat: g.coords.latitude, lng: g.coords.longitude };
      const near = BAIRROS.map((b) => ({ b, d: haversine(p, b) })).sort((a, b) => a.d - b.d)[0];
      setPos({ ...p, label: near.d < 4 ? near.b.name : 'Sua localização', gps: true });
      closeSheet('#locSheet');
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
// arrastar para fechar (mobile)
$$('.sheet__panel').forEach((panel) => {
  let y0 = null, dy = 0;
  panel.addEventListener('touchstart', (e) => { if (panel.scrollTop <= 0 && e.target.closest('.sheet__grip, .sheet__title, .pd__head')) y0 = e.touches[0].clientY; }, { passive: true });
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
      if (!r.completed && S.profile) { S.profile.comparisons_used = r.used; renderProfileBanner(); }
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
  const prices = visiblePrices(p).length ? visiblePrices(p) : p.prices;
  const best = prices[0], worst = prices[prices.length - 1];
  const span = Math.max(worst.price - best.price, 0.01);
  $('#sheetBody').innerHTML = `
    <div class="pd">
      <div class="pd__head">
        <span class="pd__emoji" aria-hidden="true">${p.emoji || '🛒'}</span>
        <div>
          <p class="muted">${esc(p.category_name)}</p>
          <h2 id="sheetTitle" class="sheet__title">${esc(p.name)}</h2>
          <p class="muted">${esc([p.brand, p.unit].filter(Boolean).join(', '))}</p>
        </div>
      </div>
      <div class="pd__hero">
        ${priceTag(best.price, 'tag--xl')}
        <div>
          <p>Mais barato no <b>${esc(S.markets.get(best.market_id).name)}</b></p>
          ${changeBadge(p.change_pct)}
        </div>
      </div>

      <h3 class="pd__h">Preço em cada mercado</h3>
      <ol class="bars">
        ${prices.map((x, j) => {
          const m = S.markets.get(x.market_id); const n = S.nearest.get(x.market_id);
          const w = 18 + 82 * ((x.price - best.price) / span);
          const ch = x.prev ? (x.price / x.prev - 1) * 100 : null;
          return `<li class="bar ${j === 0 ? 'is-best' : ''}">
            ${logo(m, 'md')}
            <div class="bar__main">
              <div class="bar__top"><b>${esc(m.name)}</b><span class="bar__price">${brl(x.price)}</span></div>
              <div class="bar__track"><span style="--w:${w}%;--c:${esc(m.color)}"></span></div>
              <div class="bar__meta">
                <span>${j === 0 ? 'Menor preço' : `+${brl(x.price - best.price)} (${pct((x.price / best.price - 1) * 100)})`}</span>
                ${ch != null && Math.abs(ch) >= 0.5 ? `<span class="${ch < 0 ? 'down' : 'up'}">${ch < 0 ? '▼' : '▲'} ${Math.abs(ch).toFixed(1).replace('.', ',')}% em 7d</span>` : ''}
                ${n ? `<a href="https://www.google.com/maps/dir/?api=1&destination=${n.store.lat},${n.store.lng}" target="_blank" rel="noopener">${esc(n.store.neighborhood)}, ${km(n.km)}</a>` : ''}
              </div>
            </div>
          </li>`;
        }).join('')}
      </ol>

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
        ${stepper(p.id)}
        <button class="btn btn--ghost" data-report="${p.id}">Informar preço diferente</button>
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

function openReport(pid) {
  if (!S.user) return openAuth('signup', 'Entre para informar preços e ajudar a comunidade.');
  const p = S.products.find((x) => x.id === pid);
  $('#sheetBody').insertAdjacentHTML('beforeend', `
    <form class="form report" id="reportForm">
      <h3 class="pd__h">Viu outro preço na loja?</h3>
      <div class="form__row">
        <label>Supermercado<select name="market" required>${[...S.markets.values()].map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></label>
        <label>Preço (R$)<input name="price" inputmode="decimal" required placeholder="0,00" /></label>
      </div>
      <label>Observação (opcional)<input name="note" maxlength="140" placeholder="Ex.: promoção até domingo" /></label>
      <button class="btn btn--primary btn--block">Enviar preço</button>
    </form>`);
  const f = $('#reportForm'); f.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  f.price.focus({ preventScroll: true });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const price = parseFloat(f.price.value.replace(/\./g, '').replace(',', '.'));
    if (!(price > 0)) return toast('Informe um preço válido.', 'warn');
    try {
      await api.reportPrice({ product_id: p.id, supermarket_id: Number(f.market.value), price, note: f.note.value || null });
      f.outerHTML = `<p class="ok-box">Preço enviado. Vamos conferir e atualizar.</p>`;
      toast('Preço enviado.');
    } catch (err) { toast(err.message, 'warn'); }
  });
}

// ======================================================================
//  Lista de compras
// ======================================================================
function saveList() { api.store.set('tb.list', [...S.list]); updateListBadge(); }
function updateListBadge() {
  const n = [...S.list.values()].reduce((a, b) => a + b, 0);
  $$('[data-list-count]').forEach((b) => { b.hidden = !n; b.textContent = n; });
}
function setQty(pid, q) {
  if (q <= 0) S.list.delete(pid); else S.list.set(pid, q);
  saveList();
  $$(`[data-pid="${pid}"] .card__foot .stepper, [data-pid="${pid}"] .card__foot .btn--add`).forEach((el) => (el.outerHTML = stepper(pid)));
  const pd = $('#productSheet');
  if (!pd.hidden && Number(pd.dataset.pid) === pid) { const a = $('.pd__actions .stepper, .pd__actions .btn--add', pd); if (a) a.outerHTML = stepper(pid); }
  if (location.hash === '#lista') renderList();
}

function renderList() {
  const items = [...S.list].map(([pid, q]) => ({ p: S.products.find((x) => x.id === pid), q })).filter((r) => r.p);
  if (!items.length) {
    $('#cartItems').innerHTML = `<li class="empty-box"><p><b>Sua lista está vazia.</b></p><p class="muted">Use “+ Lista” nos produtos para montar o carrinho e descobrir onde ele sai mais barato.</p><a class="btn btn--primary" href="#ofertas">Ver ofertas</a></li>`;
    $('#cartSummary').innerHTML = ''; return;
  }
  $('#cartItems').innerHTML = items.map(({ p, q }) => {
    const b = visiblePrices(p)[0] || p.prices[0];
    return `<li class="cart__item" data-pid="${p.id}">
      <span class="card__emoji" aria-hidden="true">${p.emoji || '🛒'}</span>
      <div class="cart__txt"><b>${esc(p.name)}</b><small>${esc([p.brand, p.unit].filter(Boolean).join(', '))}</small>
      <small class="cart__best">${logo(S.markets.get(b.market_id), 'xs')} ${brl(b.price)} no ${esc(S.markets.get(b.market_id).name)}</small></div>
      <div class="card__foot">${stepper(p.id)}</div>
    </li>`;
  }).join('');

  // total por mercado
  const totals = [...S.markets.values()].filter((m) => isOn(m.id)).map((m) => {
    let total = 0, missing = 0;
    for (const { p, q } of items) { const x = p.prices.find((r) => r.market_id === m.id); if (x) total += x.price * q; else missing += q; }
    return { m, total, missing, n: S.nearest.get(m.id) };
  }).sort((a, b) => a.missing - b.missing || a.total - b.total);
  const complete = totals.filter((t) => !t.missing);
  const combo = items.reduce((s, { p, q }) => s + (visiblePrices(p)[0] || p.prices[0]).price * q, 0);
  const comboMarkets = new Set(items.map(({ p }) => (visiblePrices(p)[0] || p.prices[0]).market_id));
  const best = complete[0];
  const worst = complete[complete.length - 1];
  const nearest = S.pos ? [...totals].filter((t) => t.n).sort((a, b) => a.n.km - b.n.km)[0] : null;

  $('#cartSummary').innerHTML = `
    <div class="sum-hero">
      <p class="muted">Comprando tudo no mais barato de cada item</p>
      ${priceTag(combo, 'tag--xl')}
      <p class="small">em ${comboMarkets.size} ${comboMarkets.size > 1 ? 'mercados' : 'mercado'}: ${[...comboMarkets].map((id) => logo(S.markets.get(id), 'xs')).join('')}</p>
    </div>
    ${best ? `<div class="sum-best">
      <p>Num lugar só, o melhor é</p>
      <div class="sum-best__m">${logo(best.m, 'lg')}<div><b>${esc(best.m.name)}</b><span>${brl(best.total)}</span></div></div>
      ${worst && worst !== best ? `<p class="small">Você economiza <b>${brl(worst.total - best.total)}</b> em relação ao ${esc(worst.m.name)}.</p>` : ''}
    </div>` : ''}
    <ol class="totals">
      ${totals.map((t) => `<li class="${t === best ? 'is-best' : ''} ${t === nearest ? 'is-near' : ''}">
        ${logo(t.m, 'sm')}
        <span class="totals__n">${esc(t.m.name)}${t.n ? `<small>${km(t.n.km)}</small>` : ''}</span>
        <span class="totals__v">${brl(t.total)}${t.missing ? `<small>faltam ${t.missing} ${t.missing > 1 ? 'itens' : 'item'}</small>` : ''}</span>
      </li>`).join('')}
    </ol>
    <div class="sum-actions">
      <button class="btn btn--ghost" id="shareList">Compartilhar lista</button>
      <button class="btn btn--text" id="clearList">Limpar</button>
    </div>`;
}

async function shareList() {
  const lines = [...S.list].map(([pid, q]) => {
    const p = S.products.find((x) => x.id === pid); const b = visiblePrices(p)[0] || p.prices[0];
    return `${q}x ${p.name} ${p.brand || ''} (${p.unit}): ${brl(b.price)} no ${S.markets.get(b.market_id).name}`;
  });
  const text = `Minha lista no Tá Barato Mesmo?\n\n${lines.join('\n')}\n\n${location.origin}${location.pathname}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Minha lista', text });
    else { await navigator.clipboard.writeText(text); toast('Lista copiada.'); }
  } catch {}
}

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
  const used = p.comparisons_used || 0, left = Math.max(CONFIG.QUICK_COMPARISONS - used, 0);
  el.hidden = false;
  $('#profileRing').style.setProperty('--p', used / CONFIG.QUICK_COMPARISONS);
  $('#profileRing').textContent = left;
  $('#profileBannerTitle').textContent = left ? `${left} ${left > 1 ? 'comparações restantes' : 'comparação restante'}` : 'Comparações esgotadas';
  $('#profileBannerText').textContent = 'Complete o cadastro para comparar sem limite.';
}

function renderAccount() {
  const link = $('#accountLink');
  if (!S.user) {
    link.textContent = 'Entrar';
    $('#accountBody').innerHTML = `
      <div class="acc-empty">
        <p>Crie sua conta para comparar quantos produtos quiser, salvar favoritos e informar preços.</p>
        <div class="acc-steps">
          <div><b>1. Cadastro rápido</b><span>Nome, e-mail e senha. Libera ${CONFIG.QUICK_COMPARISONS} comparações.</span></div>
          <div><b>2. Cadastro completo</b><span>Celular, bairro e mercados preferidos. Comparações sem limite.</span></div>
        </div>
        <button class="btn btn--primary" data-auth="signup">Criar conta</button>
        <button class="btn btn--ghost" data-auth="login">Já tenho conta</button>
      </div>`;
    return;
  }
  const p = S.profile || {};
  const name = p.full_name || S.user.user_metadata?.full_name || S.user.email;
  link.textContent = name.split(' ')[0];
  const done = !!p.completed_at;
  const pref = (p.preferred_markets || []).map((id) => S.markets.get(id)).filter(Boolean);
  const favs = S.products.filter((x) => S.favs.has(x.id));
  $('#accountBody').innerHTML = `
    <div class="acc">
      <div class="acc__card">
        <div class="avatar" aria-hidden="true">${esc(initials(name))}</div>
        <div><b>${esc(name)}</b><small>${esc(S.user.email || '')}</small>
        <span class="status ${done ? 'status--ok' : ''}">${done ? 'Cadastro completo' : `Cadastro rápido, ${Math.max(CONFIG.QUICK_COMPARISONS - (p.comparisons_used || 0), 0)} comparações restantes`}</span></div>
      </div>
      ${done ? `<dl class="acc__dl">
        <div><dt>Celular</dt><dd>${esc(p.phone || '')}</dd></div>
        <div><dt>Bairro</dt><dd>${esc(p.neighborhood || '')}</dd></div>
        <div><dt>Mercados</dt><dd>${pref.length ? pref.map((m) => logo(m, 'xs')).join('') : 'Todos'}</dd></div>
      </dl><button class="btn btn--ghost" data-open="complete">Editar dados</button>`
      : `<button class="btn btn--primary" data-open="complete">Completar cadastro</button>`}
      <h2 class="pd__h">Favoritos</h2>
      ${favs.length ? `<div class="grid grid--compact">${favs.map(card).join('')}</div>` : `<p class="muted">Toque no coração de um produto para acompanhar o preço dele aqui.</p>`}
      ${api.MODE === 'demo' ? '<p class="note">Modo demonstração: o banco ainda não respondeu, então a conta fica só neste aparelho.</p>' : ''}
      <button class="btn btn--text" id="logout">Sair da conta</button>
    </div>`;
}

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
  if (d.sort) { S.sort = d.sort; $$('#sortTabs button').forEach((b) => b.setAttribute('aria-selected', b === t)); return renderGrid(); }
  if (d.cat) { S.category = d.cat; renderChips(); return renderGrid(); }
  if (d.market) {
    const id = Number(d.market);
    if (S.enabled.size === 0) S.enabled = new Set([...S.markets.keys()]);
    if (S.enabled.has(id)) { if (S.enabled.size === 1) return toast('Deixe pelo menos um mercado na comparação.', 'warn'); S.enabled.delete(id); }
    else S.enabled.add(id);
    if (S.enabled.size === S.markets.size) S.enabled.clear();
    api.store.set('tb.enabled', [...S.enabled]);
    renderNearby(); renderGrid(); return;
  }
  if (d.bairro) { const b = BAIRROS[Number(d.bairro)]; setPos({ lat: b.lat, lng: b.lng, label: b.name }); return closeSheet('#locSheet'); }
  if (d.mapf !== undefined) { S.mapFilter = d.mapf ? Number(d.mapf) : null; return drawMap(); }
  if (d.fly) {
    const s = S.stores.find((x) => x.id === Number(d.fly));
    S.map.flyTo([s.lat, s.lng], 15, { duration: reduceMotion ? 0 : 0.8 });
    S.mapLayers.eachLayer((l) => { if (l.options.title === s.name) setTimeout(() => l.openPopup(), reduceMotion ? 0 : 850); });
    $('#map').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    return;
  }
  if (d.auth) return openAuth(d.auth);
  if (d.open === 'loc') return openSheet('#locSheet');
  if (d.open === 'complete') return openAuth('complete');
  if (t.id === 'locBtn') return openSheet('#locSheet');
  if (t.id === 'useGps') return requestGps();
  if (t.id === 'shareList') return shareList();
  if (t.id === 'clearList') { S.list.clear(); saveList(); renderList(); renderGrid(); return; }
  if (t.id === 'logout') { await api.signOut(); location.hash = '#ofertas'; toast('Você saiu da conta.'); }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { const open = $$('.sheet.is-open').pop(); if (open) closeSheet(open); }
});

let qTimer;
$('#searchInput').addEventListener('input', (e) => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => { S.q = e.target.value; renderGrid(); }, 120);
});

window.addEventListener('hashchange', route);

// ======================================================================
//  Início
// ======================================================================
function skeleton() {
  $('#productGrid').innerHTML = Array.from({ length: 6 }, () => `<div class="card card--skel"><div class="skeleton" style="height:48px"></div><div class="skeleton" style="height:64px;width:60%"></div><div class="skeleton" style="height:40px"></div></div>`).join('');
}

async function boot() {
  skeleton(); renderBairros(); updateListBadge();
  const data = await api.loadCatalog();
  data.supermarkets.forEach((m) => S.markets.set(m.id, m));
  S.stores = data.stores; S.categories = data.categories; S.products = data.products;
  // remove mercados ligados que não existem mais
  S.enabled = new Set([...S.enabled].filter((id) => S.markets.has(id)));

  if (S.pos) { computeNearest(); $('#locLabel').textContent = S.pos.label || 'Minha localização'; $('#locBtn').classList.add('is-set'); }
  renderChips(); renderNearby(); renderSpotlight(); renderTicker(); renderGrid(); route();

  // Se o usuário já autorizou a localização antes, atualiza em silêncio
  try {
    const perm = await navigator.permissions?.query({ name: 'geolocation' });
    if (perm?.state === 'granted') navigator.geolocation.getCurrentPosition((g) => {
      const p = { lat: g.coords.latitude, lng: g.coords.longitude };
      const near = BAIRROS.map((b) => ({ b, d: haversine(p, b) })).sort((a, b) => a.d - b.d)[0];
      setPos({ ...p, label: near.d < 4 ? near.b.name : 'Sua localização', gps: true });
    });
    else if (!S.pos) setTimeout(() => { if (!S.pos && !$$('.sheet.is-open').length) openSheet('#locSheet'); }, 1400);
  } catch {}

  api.onAuth(async (user) => {
    S.user = user;
    S.profile = user ? await api.getProfile().catch(() => null) : null;
    S.favs = new Set(user ? await api.loadFavorites().catch(() => []) : []);
    renderProfileBanner(); renderAccount(); renderGrid();
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
