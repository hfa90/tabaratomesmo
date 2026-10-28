// Mapa de unidades: os supermercados de Manaus no OpenStreetMap, para cadastrar cada unidade com um toque.
// Usado em dois lugares (render(head, cfg)):
//   • admin.html#unidades: todas as redes; pode criar rede nova (admin_save_store / admin_save_market)
//   • parceiros.html#unidades: só as unidades da própria rede (market_save_store, que o banco limita à rede)
// • Fonte: OpenStreetMap (Overpass API), lojas com shop=supermarket ou shop=wholesale na área de Manaus.
//   Dados © colaboradores do OpenStreetMap, licença ODbL: podem ser guardados no banco, com os créditos no mapa.
// • Verde = já cadastrada no site · laranja = de uma rede do site, falta cadastrar · cinza = outros mercados.
// • Tocar numa unidade abre o cadastro já preenchido (rede, nome, bairro, endereço, horário, coordenadas).
//   Faltou no OpenStreetMap? Busque o endereço ou toque em qualquer ponto do mapa e cadastre ali.
// • stores.osm_ref guarda de onde a loja veio (atualizacao-2026-10-mapa-unidades.sql) e impede cadastro repetido.
import * as api from './api.js';
import { BAIRROS } from './config.js';
import { $, esc, logo } from './core.js';

const BBOX = [-3.2, -60.13, -2.9, -59.85]; // sul, oeste, norte, leste (Manaus)
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const CACHE_KEY = 'tb.osmMercados';
const NEAR_M = 150; // uma loja já cadastrada a até 150 m é provavelmente a mesma unidade
const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/';

const S = { map: null, layer: null, temp: null, osm: [], stores: [], markets: [], filter: 'todas', sel: null, head: null, cfg: null };
const isMk = () => S.cfg?.mode === 'market';
const own = () => (isMk() ? S.markets[0] : null);

// ---------------------------------------------------------------- ajudantes
const strip = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const words = (name) => strip(name).replace(/\b(supermercados?|mercado|atacadista|atacado|super|loja|ltda)\b/g, ' ').split(' ').filter((w) => w.length > 1);
const short = (m) => (m?.name || '').replace(/^supermercados?\s+/i, '').trim() || m?.name || '';
function meters(a, b) {
  const R = 6371e3, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const nearestBairro = (p) => BAIRROS.map((b) => ({ n: b.name, d: meters(p, b) })).sort((a, b) => a.d - b.d)[0]?.n || '';
/** bairro escrito no nome da unidade ("Supermercado DB Ponta Negra") */
const bairroInName = (name) => { const n = ` ${strip(name)} `; return BAIRROS.map((b) => b.name).filter((b) => n.includes(` ${strip(b)} `)).sort((a, b) => b.length - a.length)[0] || ''; };
const isMobile = () => matchMedia('(max-width: 900px)').matches;
const showPanel = () => { if (isMobile()) $('#umPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

/** endereço e bairro do ponto pelo próprio OpenStreetMap (Nominatim): só preenche o que estiver vazio */
async function fillAddress(lat, lng, { force = false } = {}) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=pt-BR&lat=${lat}&lon=${lng}`);
    const a = (await r.json()).address || {}; const f = $('#umForm');
    if (!f || (S.sel && S.sel.lat !== lat)) return;
    const street = [a.road, a.house_number].filter(Boolean).join(', ');
    if (street && !f.address.value) f.address.value = street;
    const sub = a.suburb || a.neighbourhood || a.quarter;
    if (sub && !f.neighborhood.dataset.touched && (force || f.neighborhood.dataset.guess)) {
      f.neighborhood.value = sub; delete f.neighborhood.dataset.guess;
      const m = S.markets.find((x) => String(x.id) === f.market.value);
      if (m && !f.name.dataset.touched && f.dataset.nameGuess) f.name.value = `${short(m)} ${sub}`.trim();
    }
  } catch {}
}
const fmtM = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);
const DAYS = { Mo: 'Seg', Tu: 'Ter', We: 'Qua', Th: 'Qui', Fr: 'Sex', Sa: 'Sáb', Su: 'Dom', PH: 'Feriados' };
const hoursPt = (h) => String(h || '').replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, (d) => DAYS[d]).replace(/\boff\b/g, 'fechado').replace(/;\s*/g, '; ');

/** qual rede do site é esta unidade do mapa (pelo nome ou pela marca) */
function marketOf(el) {
  const n = ` ${strip(`${el.name} ${el.brand || ''}`)} `;
  let best = null;
  for (const m of S.markets) {
    const w = words(m.name);
    if (w.length && w.every((x) => n.includes(` ${x} `)) && (!best || w.length > words(best.name).length)) best = m;
  }
  return best;
}
/** a loja já cadastrada que corresponde a esta unidade (pela referência do mapa ou por estar a até 150 m) */
function storeOf(el) {
  const byRef = S.stores.find((s) => s.osm_ref && s.osm_ref === el.ref);
  if (byRef) return { store: byRef, sure: true, d: 0 };
  const near = S.stores.filter((s) => !s.osm_ref && (!el.market || s.supermarket_id === el.market.id))
    .map((s) => ({ store: s, d: meters(el, { lat: Number(s.lat), lng: Number(s.lng) }) })).filter((x) => x.d <= NEAR_M).sort((a, b) => a.d - b.d)[0];
  return near ? { ...near, sure: false } : null;
}

// ---------------------------------------------------------------- dados
async function loadLeaflet() {
  if (window.L) return;
  if (!document.querySelector('link[href*="leaflet"]')) document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: LEAFLET + 'leaflet.css' }));
  await new Promise((ok, fail) => { const s = Object.assign(document.createElement('script'), { src: LEAFLET + 'leaflet.js', onload: ok, onerror: () => fail(new Error('Não consegui carregar o mapa. Confira a internet.')) }); document.head.append(s); });
}

async function loadOsm(force = false) {
  if (!force) {
    try { const c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null'); if (c && Date.now() - c.at < 6 * 3600e3) return c.items; } catch {}
  }
  const q = `[out:json][timeout:60];(nwr["shop"~"^(supermarket|wholesale)$"](${BBOX.join(',')}););out center tags;`;
  let lastErr;
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }) });
      if (!r.ok) throw new Error(`OpenStreetMap respondeu ${r.status}`);
      const j = await r.json();
      const items = (j.elements || []).map((e) => {
        const t = e.tags || {}; const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
        if (lat == null || lng == null) return null;
        const street = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(', ');
        return { ref: `${e.type}/${e.id}`, lat, lng, name: t.name || t.brand || 'Mercado sem nome', brand: t.brand || null,
          kind: t.shop === 'wholesale' ? 'Atacado' : 'Supermercado', address: street || null,
          suburb: t['addr:suburb'] || t['addr:neighbourhood'] || null, hours: t.opening_hours || null, phone: t.phone || t['contact:phone'] || null };
      }).filter(Boolean);
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), items })); } catch {}
      return items;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('OpenStreetMap não respondeu.');
}

async function loadStores() {
  let list;
  if (S.cfg.demo) list = await S.cfg.demoStores(S.markets);
  else {
    const c = await api.sbClient();
    const { data, error } = await c.from('stores').select('*');
    if (error) throw error;
    list = data || [];
  }
  // no portal, só as lojas da própria rede contam
  return isMk() ? list.filter((x) => x.supermarket_id === own()?.id) : list;
}

// ---------------------------------------------------------------- tela
/**
 * cfg: { mode: 'admin' | 'market', demo, markets(): Promise<[]>, saveStore(p), saveMarket?(p), demoStores(markets): Promise<[]> }
 * No modo 'market', markets() devolve só a rede do portal.
 */
export async function render(head, cfg = S.cfg) {
  S.head = head; S.cfg = cfg; S.sel = null; S.filter = 'todas';
  $('#ptMain').innerHTML = head('Mapa de unidades', isMk()
    ? 'As unidades da sua rede no OpenStreetMap. Toque numa unidade laranja para cadastrar no site; se faltar alguma, busque o endereço ou toque no lugar certo do mapa.'
    : 'Os supermercados de Manaus no OpenStreetMap. Toque numa unidade para cadastrar no site; se faltar alguma, busque o endereço ou toque no lugar certo do mapa.',
    '<button class="btn btn--ghost" data-um="reload">Atualizar do mapa</button>') + `
    <div class="um-bar">
      <div class="chips" id="umChips"></div>
      <form class="um-search" id="umSearch" role="search"><input name="q" type="search" placeholder="Buscar lugar ou endereço em Manaus" aria-label="Buscar lugar ou endereço" /><button class="btn btn--ghost btn--sm">Buscar</button></form>
    </div>
    <p class="um-legend small muted"><span><i class="um-dot um-dot--ok"></i>cadastrada</span><span><i class="um-dot um-dot--todo"></i>rede do site, falta cadastrar</span><span><i class="um-dot um-dot--other"></i>outros mercados</span><span id="umCount"></span></p>
    <div class="um-wrap"><div id="umMap" class="um-map" role="application" aria-label="Mapa dos supermercados"></div><aside class="um-panel panel" id="umPanel"></aside></div>
    <p class="small muted um-credit">Unidades e mapa: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">colaboradores do OpenStreetMap</a> (ODbL). Viu uma unidade errada ou faltando? Dá para corrigir no próprio OpenStreetMap.</p>`;
  panelIntro('<div class="skeleton" style="height:120px"></div>');
  try {
    await loadLeaflet();
    S.markets = await cfg.markets();
    [S.stores, S.osm] = await Promise.all([loadStores(), loadOsm()]);
  } catch (e) { panelIntro(`<p class="note">${esc(e.message || 'Não consegui carregar.')}</p><button class="btn btn--ghost btn--sm" data-um="reload">Tentar de novo</button>`); return; }
  initMap();
  draw();
}

function initMap() {
  if (S.map) { S.map.remove(); S.map = null; }
  S.map = L.map('umMap', { zoomControl: true }).setView([-3.07, -60.02], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">colaboradores do OpenStreetMap</a>' }).addTo(S.map);
  S.layer = L.layerGroup().addTo(S.map);
  S.map.on('click', (e) => pickPoint(e.latlng.lat, e.latlng.lng));
  setTimeout(() => S.map.invalidateSize(), 200);
}

function enrich() {
  S.osm.forEach((el) => { el.market = marketOf(el); el.match = storeOf(el); });
}

function draw() {
  enrich();
  // filtros: todas, cada rede do site e "outros"
  const counts = new Map();
  S.osm.forEach((el) => { const k = el.market ? String(el.market.id) : 'outros'; counts.set(k, (counts.get(k) || 0) + 1); });
  const chips = [['todas', 'Todas', S.osm.length], ...S.markets.map((m) => [String(m.id), isMk() ? `Minha rede (${short(m)})` : short(m), counts.get(String(m.id)) || 0]), ['outros', 'Outros mercados', counts.get('outros') || 0], ['falta', 'Falta cadastrar', S.osm.filter((e) => e.market && !e.match).length]];
  $('#umChips').innerHTML = chips.map(([k, l, n]) => `<button class="chip ${S.filter === k ? 'is-on' : ''}" data-um-filter="${k}">${esc(l)} <small>${n}</small></button>`).join('');

  S.layer.clearLayers();
  const show = S.osm.filter((el) => S.filter === 'todas' || (S.filter === 'outros' ? !el.market : S.filter === 'falta' ? el.market && !el.match : el.market && String(el.market.id) === S.filter));
  const used = new Set();
  for (const el of show) {
    const cls = el.match ? 'ok' : el.market ? 'todo' : 'other';
    if (el.match) used.add(el.match.store.id);
    L.circleMarker([el.lat, el.lng], { radius: cls === 'other' ? 6 : 9, weight: 2, className: `um-pin um-pin--${cls}` })
      .bindTooltip(esc(el.name), { direction: 'top' }).on('click', (ev) => { L.DomEvent.stopPropagation(ev); select(el); }).addTo(S.layer);
  }
  // lojas cadastradas que não estão no OpenStreetMap (ou ainda não foram ligadas a ele)
  const linked = new Set(S.osm.filter((e) => e.match).map((e) => e.match.store.id));
  for (const s of S.stores) {
    if (linked.has(s.id) || (S.filter !== 'todas' && S.filter !== String(s.supermarket_id))) continue;
    const m = S.markets.find((x) => x.id === s.supermarket_id);
    L.circleMarker([Number(s.lat), Number(s.lng)], { radius: 8, weight: 2, className: 'um-pin um-pin--ok um-pin--site' })
      .bindTooltip(`${esc(s.name)} (só no site)`, { direction: 'top' }).on('click', (ev) => { L.DomEvent.stopPropagation(ev); selectStore(s, m); }).addTo(S.layer);
  }
  const ok = S.osm.filter((e) => e.match).length;
  $('#umCount').textContent = `· ${S.osm.length} no mapa · ${ok} ligadas ao site · ${S.stores.length} lojas cadastradas`;
  if (!S.sel) panelIntro();
}

function panelIntro(extra = '') {
  const todo = S.osm.filter((e) => e.market && !e.match);
  $('#umPanel').innerHTML = extra || `<h2>Cadastrar unidades</h2>
    ${isMk() ? `<p class="small">Toque num ponto <b class="um-t--todo">laranja</b> para cadastrar uma unidade do ${esc(own()?.name || '')}. Os <b class="um-t--other">cinzas</b> são outros mercados; se um deles for uma unidade sua com outro nome no mapa, toque e cadastre.</p>`
      : '<p class="small">Toque num ponto <b class="um-t--todo">laranja</b> para cadastrar uma unidade de uma rede do site, ou num <b class="um-t--other">cinza</b> para outros mercados.</p>'}
    <p class="small muted">Faltou alguma? Busque o endereço acima ou toque no lugar certo do mapa.</p>
    ${todo.length ? `<h3 class="pd__h" style="margin-top:12px">Falta cadastrar (${todo.length})</h3><ul class="um-list">${todo.slice(0, 40).map((e) => `<li><button data-um-go="${esc(e.ref)}">${logo(e.market, 'xs')} <span>${esc(e.name)}<small class="muted">${esc(e.address || e.suburb || nearestBairro(e))}</small></span></button></li>`).join('')}</ul>` : '<p class="small">Todas as unidades das redes do site que estão no mapa já foram cadastradas. 👏</p>'}`;
}

function marker(lat, lng) {
  if (S.temp) S.temp.remove();
  const icon = L.divIcon({ className: 'um-sel', html: '<span></span>', iconSize: [30, 30], iconAnchor: [15, 30] });
  S.temp = L.marker([lat, lng], { draggable: true, autoPan: true, icon, title: 'Arraste até a entrada da loja', zIndexOffset: 1000 }).addTo(S.map);
  S.temp.on('dragend', () => { const p = S.temp.getLatLng(); const f = $('#umForm'); if (f) { f.lat.value = p.lat.toFixed(6); f.lng.value = p.lng.toFixed(6); } });
}

/** uma unidade do OpenStreetMap */
function select(el) {
  S.sel = el;
  marker(el.lat, el.lng);
  const m = el.match;
  if (m?.sure) {
    const mk = S.markets.find((x) => x.id === m.store.supermarket_id);
    $('#umPanel').innerHTML = `${top(el)}<p class="pill pill--ok">Já cadastrada</p><p class="small">No site como <b>${esc(m.store.name)}</b> (${esc(mk?.name || '')}).</p>
      ${form({ el, store: m.store, market: mk, title: 'Corrigir dados desta loja' })}`;
    bindForm(); return showPanel();
  }
  if (m) {
    $('#umPanel').innerHTML = `${top(el)}<div class="note"><b>Parece a loja ${esc(m.store.name)}</b>, já cadastrada a ${fmtM(m.d)} daqui.
      <div class="row-actions" style="margin-top:8px"><button class="btn btn--primary btn--sm" data-um="link" data-store="${m.store.id}">É a mesma: ligar ao mapa</button>
      <button class="btn btn--ghost btn--sm" data-um="asnew">Não, é outra unidade</button></div></div>`;
    return showPanel();
  }
  $('#umPanel').innerHTML = `${top(el)}${form({ el, market: el.market || own(), title: 'Cadastrar esta unidade' })}`;
  bindForm(); showPanel();
  if (!el.address || !el.suburb) fillAddress(el.lat, el.lng);
}

/** loja do site que não está no OpenStreetMap */
function selectStore(s, m) {
  S.sel = { ref: null, lat: Number(s.lat), lng: Number(s.lng), name: s.name };
  marker(Number(s.lat), Number(s.lng));
  $('#umPanel').innerHTML = `<h2>${logo(m, 'sm')} ${esc(s.name)}</h2><p class="pill pill--ok">Cadastrada no site</p>
    <p class="small muted">Esta loja não está no OpenStreetMap (ou ainda não foi ligada a uma unidade dele). Arraste o marcador para corrigir a posição.</p>
    ${form({ store: s, market: m, title: 'Corrigir dados desta loja' })}`;
  bindForm(); showPanel();
}

/** um ponto qualquer do mapa (unidade que falta no OpenStreetMap) */
async function pickPoint(lat, lng, name = '') {
  S.sel = { ref: null, lat, lng, name: name || '' };
  marker(lat, lng);
  $('#umPanel').innerHTML = `<h2>Nova unidade aqui</h2><p class="small muted">Arraste o marcador até a entrada da loja.</p>${form({ el: S.sel, market: own(), title: 'Cadastrar unidade' })}`;
  bindForm(); showPanel();
  fillAddress(lat, lng, { force: true }); // endereço e bairro do ponto, pelo próprio OpenStreetMap
}

const top = (el) => `<h2>${esc(el.name)}</h2><p class="small muted">${esc(el.kind)}${el.brand && el.brand !== el.name ? ` · marca ${esc(el.brand)}` : ''} · <a href="https://www.openstreetmap.org/${esc(el.ref)}" target="_blank" rel="noopener">ver no OpenStreetMap</a></p>`;

function form({ el = null, store = null, market = null, title }) {
  const lat = store ? Number(store.lat) : el.lat, lng = store ? Number(store.lng) : el.lng;
  const guess = !store?.neighborhood && !el?.suburb && !bairroInName(el?.name);
  const bairro = store?.neighborhood || el?.suburb || bairroInName(el?.name) || nearestBairro({ lat, lng });
  const name = store?.name || (market ? `${short(market)} ${bairro}`.trim() : el?.name || '');
  const opts = S.markets.map((m) => `<option value="${m.id}" ${market?.id === m.id ? 'selected' : ''}>${esc(m.name)}${m.active === false ? ' (fora do site)' : ''}</option>`).join('');
  return `<form class="form um-form" id="umForm" data-store="${store?.id || ''}" data-ref="${esc(el?.ref || store?.osm_ref || '')}" ${!store && market ? 'data-name-guess="1"' : ''}>
    <h3 class="pd__h">${title}</h3>
    <label>Rede<select name="market" ${store || isMk() ? 'disabled' : ''}>${isMk() ? '' : '<option value="">Escolha a rede…</option>'}${opts}${isMk() ? '' : '<option value="new">+ Nova rede…</option>'}</select></label>
    <label class="um-new" hidden>Nome da nova rede<input name="newmarket" placeholder="Ex.: Supermercados São Jorge" /></label>
    <label>Nome da unidade<input name="name" required value="${esc(name)}" placeholder="Ex.: Nova Era Cidade Nova" /></label>
    <div class="form__row"><label>Bairro<input name="neighborhood" value="${esc(bairro)}" ${guess ? 'data-guess="1"' : ''} /></label><label>Horário<input name="hours" value="${esc(store?.opening_hours || hoursPt(el?.hours))}" placeholder="Seg-Sáb 07:00-22:00" /></label></div>
    <label>Endereço<input name="address" value="${esc(store?.address || el?.address || '')}" /></label>
    <div class="form__row"><label>Latitude<input name="lat" inputmode="decimal" required value="${lat.toFixed(6)}" /></label><label>Longitude<input name="lng" inputmode="decimal" required value="${lng.toFixed(6)}" /></label></div>
    <p class="small muted">Arraste o marcador no mapa para ajustar a posição até a entrada da loja: as boas-vindas na loja e o "mercado mais perto" usam este ponto.</p>
    <p class="form__err" role="alert"></p>
    <div class="row-actions"><button class="btn btn--primary">${store ? 'Salvar alterações' : 'Cadastrar unidade'}</button><button type="button" class="btn btn--text" data-um="cancel">Cancelar</button></div>
  </form>`;
}

function bindForm() {
  const f = $('#umForm'); if (!f) return;
  f.market?.addEventListener('change', () => {
    const isNew = f.market.value === 'new';
    f.querySelector('.um-new').hidden = !isNew;
    const m = S.markets.find((x) => String(x.id) === f.market.value);
    if (m && !f.name.dataset.touched) { f.name.value = `${short(m)} ${f.neighborhood.value}`.trim(); f.dataset.nameGuess = '1'; }
  });
  f.name.addEventListener('input', () => { f.name.dataset.touched = '1'; });
  f.neighborhood.addEventListener('input', () => { f.neighborhood.dataset.touched = '1'; delete f.neighborhood.dataset.guess; });
  f.addEventListener('submit', save);
}

async function save(e) {
  e.preventDefault();
  const f = e.target; const err = f.querySelector('.form__err'); err.textContent = '';
  const lat = Number(String(f.lat.value).replace(',', '.')), lng = Number(String(f.lng.value).replace(',', '.'));
  if (!(lat < -2.5 && lat > -3.5 && lng < -59.5 && lng > -60.5)) { err.textContent = 'A posição precisa ficar em Manaus.'; return; }
  const btn = f.querySelector('.btn--primary'); btn.disabled = true;
  try {
    let mid = f.dataset.store ? S.stores.find((s) => String(s.id) === f.dataset.store)?.supermarket_id : Number(f.market.value);
    if (!f.dataset.store && f.market.value === 'new') {
      const nm = f.newmarket.value.trim(); if (!nm) throw new Error('Informe o nome da nova rede.');
      // rede nova entra fora do site: aparece para os clientes quando tiver preços (Supermercados › "Aparece no site")
      const r = await S.cfg.saveMarket({ name: nm, active: false, portal_enabled: true });
      S.markets = await S.cfg.markets();
      mid = r?.id ?? S.markets.find((m) => strip(m.name) === strip(nm))?.id;
    }
    if (!mid) throw new Error('Escolha a rede.');
    const p = { id: f.dataset.store || null, supermarket_id: mid, name: f.name.value.trim(), neighborhood: f.neighborhood.value.trim(),
      address: f.address.value.trim(), opening_hours: f.hours.value.trim(), lat, lng, approx: false };
    if (f.dataset.ref) p.osm_ref = f.dataset.ref;
    await S.cfg.saveStore(p);
    S.stores = await loadStores();
    S.sel = null; if (S.temp) { S.temp.remove(); S.temp = null; }
    draw();
    const m = S.markets.find((x) => x.id === mid);
    $('#umPanel').insertAdjacentHTML('afterbegin', `<p class="note">✅ ${esc(p.name)} ${f.dataset.store ? 'atualizada' : 'cadastrada'}${m?.active === false ? `. A rede ${esc(m.name)} está fora do site: ligue em Supermercados › "Aparece no site" quando tiver preços.` : '.'}</p>`);
  } catch (ex) { err.textContent = ex.message || 'Não foi possível salvar.'; btn.disabled = false; }
}

async function link(storeId) {
  const s = S.stores.find((x) => x.id === storeId); const el = S.sel; if (!s || !el) return;
  try {
    await S.cfg.saveStore({ id: s.id, supermarket_id: s.supermarket_id, name: s.name, neighborhood: s.neighborhood, address: s.address || el.address || '',
      opening_hours: s.opening_hours || hoursPt(el.hours), lat: el.lat, lng: el.lng, approx: false, osm_ref: el.ref });
    S.stores = await loadStores(); S.sel = null; draw();
    $('#umPanel').insertAdjacentHTML('afterbegin', `<p class="note">✅ ${esc(s.name)} ligada ao mapa, com a posição do OpenStreetMap.</p>`);
  } catch (ex) { $('#umPanel').insertAdjacentHTML('afterbegin', `<p class="note">${esc(ex.message)}</p>`); }
}

async function search(q) {
  const box = $('#umPanel');
  box.innerHTML = '<div class="skeleton" style="height:120px"></div>';
  try {
    const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&accept-language=pt-BR&limit=8&bounded=1&viewbox=${BBOX[1]},${BBOX[2]},${BBOX[3]},${BBOX[0]}&q=${encodeURIComponent(q)}`;
    const res = await (await fetch(u)).json();
    box.innerHTML = `<h2>Resultados para “${esc(q)}”</h2>${res.length ? `<ul class="um-list">${res.map((r, i) => `<li><button data-um-res="${i}"><span>${esc(r.name || r.display_name.split(',')[0])}<small class="muted">${esc(r.display_name.split(',').slice(1, 4).join(','))}</small></span></button></li>`).join('')}</ul>` : '<p class="small">Nada encontrado. Toque no lugar certo do mapa para cadastrar ali.</p>'}
      <button class="btn btn--text btn--sm" data-um="cancel">Voltar</button>`;
    box._res = res;
  } catch { box.innerHTML = '<p class="note">A busca não respondeu. Toque no lugar certo do mapa para cadastrar ali.</p>'; }
}

// ---------------------------------------------------------------- eventos
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-um], [data-um-filter], [data-um-go], [data-um-res]'); if (!t || !$('#umMap')) return;
  if (t.dataset.umFilter) { S.filter = t.dataset.umFilter; draw(); return; }
  if (t.dataset.umGo) { const el = S.osm.find((x) => x.ref === t.dataset.umGo); if (el) { S.map.setView([el.lat, el.lng], 17); select(el); } return; }
  if (t.dataset.umRes) { const r = $('#umPanel')._res?.[Number(t.dataset.umRes)]; if (r) { S.map.setView([Number(r.lat), Number(r.lon)], 18); pickPoint(Number(r.lat), Number(r.lon), r.name); } return; }
  const a = t.dataset.um;
  if (a === 'reload') { try { sessionStorage.removeItem(CACHE_KEY); } catch {} render(S.head); }
  if (a === 'cancel') { S.sel = null; if (S.temp) { S.temp.remove(); S.temp = null; } panelIntro(); }
  if (a === 'link') link(Number(t.dataset.store));
  if (a === 'asnew' && S.sel) { const el = S.sel; $('#umPanel').innerHTML = `${top(el)}${form({ el, market: el.market || own(), title: 'Cadastrar esta unidade' })}`; bindForm(); }
});
document.addEventListener('submit', (e) => {
  if (e.target.id !== 'umSearch') return;
  e.preventDefault(); const q = e.target.q.value.trim(); if (q.length >= 3) search(q);
});
