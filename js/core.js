// Estado e componentes compartilhados entre os módulos.
import * as api from './api.js';

// ======================================================================
//  Estado
// ======================================================================
export const S = {
  markets: new Map(), stores: [], categories: [], products: [],
  pos: api.store.get('tb.pos'), nearest: new Map(),
  sort: 'baratos', category: 'all', q: '',
  enabled: new Set(api.store.get('tb.enabled', [])), // mercados ligados (vazio = todos)
  list: new Map(api.store.get('tb.list', [])),
  rancho: api.store.get('tb.rancho', null),   // { name, month, status, checked: [] }
  home: api.store.get('tb.home', null),       // { lat, lng, label }
  transport: api.store.get('tb.transport', { mode: 'carro', cost: 0.85 }),
  favs: new Set(),
  user: null, profile: null,
  anonUsed: api.store.get('tb.anonUsed', 0),
  map: null, mapLayers: null, mapFilter: null,
};

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const pct = (v) => (v > 0 ? '+' : '') + v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
export const km = (d) => (d < 1 ? Math.round(d * 1000) + ' m' : d.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' km');
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function haversine(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const isOn = (mid) => S.enabled.size === 0 || S.enabled.has(mid);
export const visiblePrices = (p) => p.prices.filter((x) => isOn(x.market_id));

// ======================================================================
//  Componentes
// ======================================================================
export function initials(name) {
  return name.replace(/^Supermercados?\s+/i, '').split(/\s+/).filter((w) => w.length > 2 || /^[A-Z]{2,}$/.test(w))
    .slice(0, 2).map((w) => w[0]).join('').toUpperCase() || name.slice(0, 2).toUpperCase();
}

/** Ícone da logomarca oficial (assets/logos/<slug>-icon.png) para miniaturas.
 *  Se a imagem não existir, mostra um monograma com a cor da rede. */
const iconUrl = (m) => (m.logo_url && m.logo_url.startsWith('assets/') ? m.logo_url.replace(/\.png$/, '-icon.png') : m.logo_url);
export function logo(m, size = 'sm') {
  const src = iconUrl(m);
  return `<span class="logo logo--${size}" style="--c:${esc(m.color || '#0E3B2E')}" title="${esc(m.name)}">
    <i aria-hidden="true">${esc(initials(m.name))}</i>
    ${src ? `<img src="${esc(src)}" alt="${esc(m.name)}" loading="lazy" decoding="async" />` : ''}
  </span>`;
}
/** Logomarca completa, para destaques grandes */
export function logoFull(m, cls = '') {
  return m.logo_url
    ? `<img class="logo-full ${cls}" src="${esc(m.logo_url)}" alt="${esc(m.name)}" loading="lazy" decoding="async" />`
    : logo(m, 'lg');
}
// imagem quebrada → remove e deixa o monograma
document.addEventListener('error', (e) => {
  if (e.target.tagName === 'IMG' && e.target.closest('.logo')) e.target.remove();
}, true);

export function priceTag(v, size = '') {
  const [int, dec] = v.toFixed(2).split('.');
  return `<span class="tag ${size}"><span class="tag__cur">R$</span><span class="tag__int">${Number(int).toLocaleString('pt-BR')}</span><span class="tag__dec">,${dec}</span></span>`;
}

export function changeBadge(c) {
  if (c == null || Math.abs(c) < 0.5) return `<span class="chg chg--flat">estável em 7 dias</span>`;
  const down = c < 0;
  return `<span class="chg ${down ? 'chg--down' : 'chg--up'}" title="Variação média nos últimos 7 dias">
    <svg viewBox="0 0 12 12" aria-hidden="true"><path d="${down ? 'M6 10 1.5 4h9z' : 'M6 2l4.5 6h-9z'}" fill="currentColor"/></svg>
    ${down ? 'caiu' : 'subiu'} ${pct(Math.abs(c)).replace('+', '')} em 7 dias</span>`;
}

export function stepper(pid) {
  const q = S.list.get(pid) || 0;
  if (!q) return `<button class="btn btn--sm btn--add" data-add="${pid}" aria-label="Adicionar à lista">+ Lista</button>`;
  return `<span class="stepper" role="group" aria-label="Quantidade na lista">
    <button data-dec="${pid}" aria-label="Diminuir">−</button><output>${q}</output><button data-inc="${pid}" aria-label="Aumentar">+</button></span>`;
}

// Funções que o app.js registra para os outros módulos usarem (sheets, toast, auth…)
export const hooks = {};
export const DOW = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const DOW_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const ago = (iso) => {
  const h = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (h < 1) return 'agora há pouco';
  if (h < 24) return `há ${Math.round(h)} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ontem' : `há ${d} dias`;
};
