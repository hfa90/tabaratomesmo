// Rancho do mês: lista mensal, relatório "onde comprar", distância de casa e dias das proteínas.
import * as api from './api.js';
import { track } from './track.js';
import { BAIRROS } from './config.js';
import {
  S, $, $$, esc, brl, km, haversine, isOn, logo, logoFull, priceTag, stepper, hooks, DOW, DOW_SHORT, reduceMotion, media,
} from './core.js';

// ---------------------------------------------------------------- configuração do deslocamento
// Valores de referência editáveis pelo usuário (estimativas).
export const MODES = {
  carro:  { label: 'Carro',      unit: 'R$/km',     value: 0.85, leg: 0,   perKm: true,  speed: 25, wait: 0 },
  moto:   { label: 'Moto',       unit: 'R$/km',     value: 0.30, leg: 0,   perKm: true,  speed: 30, wait: 0 },
  onibus: { label: 'Ônibus',     unit: 'passagem',  value: 5.00, leg: 1,   perKm: false, speed: 15, wait: 12 },
  app:    { label: 'Aplicativo', unit: 'R$/km',     value: 2.10, leg: 6.0, perKm: true,  speed: 25, wait: 5 },
  ape:    { label: 'A pé',       unit: '',          value: 0,    leg: 0,   perKm: false, speed: 4.5, wait: 0 },
};
const ROUTE_FACTOR = 1.35; // distância em linha reta → distância real pelas ruas

const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
const monthName = (key) => new Date(key + '-15T12:00:00').toLocaleDateString('pt-BR', { month: 'long' });
const BASIC = ['Arroz tipo 1', 'Feijão carioca', 'Açúcar cristal', 'Café torrado e moído', 'Óleo de soja', 'Macarrão espaguete',
  'Farinha de mandioca', 'Leite UHT integral', 'Frango inteiro congelado', 'Ovos brancos', 'Papel higiênico folha dupla', 'Sabão em pó', 'Detergente líquido', 'Creme dental'];

let proteinCache = null;
let syncTimer = null;

// ---------------------------------------------------------------- estado
export function meta() {
  if (!S.rancho) {
    const m = monthKey();
    S.rancho = { name: `Rancho de ${monthName(m)}`, month: m, status: 'aberta', checked: [] };
    persist(false);
  }
  return S.rancho;
}

function persist(sync = true) {
  api.store.set('tb.rancho', S.rancho);
  api.store.set('tb.list', [...S.list]);
  if (sync && S.user) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      const items = [...S.list].map(([product_id, qty]) => ({ product_id, qty, checked: S.rancho.checked.includes(product_id) }));
      api.saveRancho(S.rancho, items).catch((e) => console.warn('sync rancho', e));
    }, 1200);
  }
}

/** chamada pelo app sempre que a quantidade de um item muda */
export function onListChange() {
  const m = meta();
  m.checked = m.checked.filter((id) => S.list.has(id));
  if (m.status === 'concluida' && S.list.size === 0) m.status = 'aberta';
  persist();
}

/** ao entrar na conta: se a lista local estiver vazia, usa a da nuvem; senão sobe a local */
export async function syncFromServer() {
  try {
    const remote = await api.loadRancho(meta().month);
    if (remote && S.list.size === 0 && remote.shopping_list_items?.length) {
      S.list = new Map(remote.shopping_list_items.map((i) => [i.product_id, Number(i.qty)]));
      S.rancho = { name: remote.name, month: remote.month.slice(0, 7), status: remote.status,
        completedAt: remote.completed_at, checked: remote.shopping_list_items.filter((i) => i.checked).map((i) => i.product_id) };
      persist(false);
      hooks.afterListLoad?.();
    } else if (S.list.size) persist();
  } catch (e) { console.warn('rancho remoto', e); }
}

// ---------------------------------------------------------------- casa e transporte
export function homePos() {
  if (S.home) return { ...S.home, source: 'home' };
  const p = S.profile;
  if (p?.home_lat) return { lat: p.home_lat, lng: p.home_lng, label: p.home_label || p.neighborhood, source: 'home' };
  if (p?.neighborhood) {
    const b = BAIRROS.find((x) => x.name.toLowerCase() === p.neighborhood.toLowerCase());
    if (b) return { lat: b.lat, lng: b.lng, label: b.name, source: 'profile' };
  }
  if (S.pos) return { ...S.pos, source: 'pos' };
  return null;
}

export function setHome(h) {
  S.home = h; api.store.set('tb.home', h);
  if (S.user) api.updateProfile({ home_lat: h.lat, home_lng: h.lng, home_label: h.label }).catch(() => {});
}

function tripFor(roadKmOneWay, legs = 2) {
  const t = S.transport; const M = MODES[t.mode] || MODES.carro;
  const v = t.value ?? M.value;
  let cost;
  if (t.mode === 'onibus') cost = v * legs;
  else if (t.mode === 'app') cost = legs * M.leg + v * roadKmOneWay * 2;
  else if (t.mode === 'ape') cost = 0;
  else cost = v * roadKmOneWay * 2;
  const minutes = (roadKmOneWay * 2) / M.speed * 60 + M.wait * legs;
  return { cost, minutes };
}

// ---------------------------------------------------------------- cálculo do relatório
function items() {
  return [...S.list].map(([pid, qty]) => ({ p: S.products.find((x) => x.id === pid), qty })).filter((r) => r.p);
}
const priceIn = (p, mid) => p.prices.find((x) => x.market_id === mid)?.price ?? null;
const cheapest = (p, except) => {
  const arr = p.prices.filter((x) => x.market_id !== except && isOn(x.market_id));
  return arr.length ? Math.min(...arr.map((x) => x.price)) : (p.prices[0]?.price ?? 0);
};

function nearestStore(mid, from) {
  let best = null;
  for (const s of S.stores) {
    if (s.supermarket_id !== mid) continue;
    const d = haversine(from, s);
    if (!best || d < best.km) best = { store: s, km: d };
  }
  return best;
}

export function computeReport() {
  const its = items();
  const home = homePos();
  const markets = [...S.markets.values()].filter((m) => isOn(m.id));
  const rows = markets.map((m) => {
    let goods = 0, subtotal = 0, extra = 0; const missing = [];
    for (const { p, qty } of its) {
      const pr = priceIn(p, m.id);
      if (pr != null) { subtotal += pr * qty; }
      else { missing.push(p); extra += cheapest(p, m.id) * qty; }
    }
    goods = subtotal + extra;
    const ns = home ? nearestStore(m.id, home) : null;
    const road = ns ? ns.km * ROUTE_FACTOR : null;
    const trip = road != null ? tripFor(road) : { cost: 0, minutes: 0 };
    return { m, subtotal, extra, goods, missing, store: ns?.store, km: ns?.km ?? null, road, trip, total: goods + trip.cost };
  });
  if (!rows.length) return null;

  const base = home ? [...rows].sort((a, b) => a.km - b.km)[0] : null;
  const ranked = [...rows].sort((a, b) => a.total - b.total);
  const best = ranked[0];
  for (const r of rows) {
    if (!base) { r.verdict = null; continue; }
    if (r === base) { r.verdict = { kind: 'home', label: 'Mais perto de casa', text: 'Referência para comparar os outros.' }; continue; }
    const gross = base.goods - r.goods;
    const extraTrip = r.trip.cost - base.trip.cost;
    const net = gross - extraTrip;
    r.net = net;
    if (gross <= 0.5) r.verdict = { kind: 'bad', label: 'Mais caro', text: `Os produtos saem ${brl(-gross)} mais caros que no ${base.m.name}.` };
    else if (net >= Math.max(10, base.goods * 0.03)) r.verdict = { kind: 'good', label: 'Vale a pena', text: `Economia de ${brl(net)} já descontando ${brl(Math.max(extraTrip, 0))} a mais de deslocamento.` };
    else if (net > 0) r.verdict = { kind: 'meh', label: 'Compensa pouco', text: `Os produtos são ${brl(gross)} mais baratos, mas sobram só ${brl(net)} depois do deslocamento.` };
    else r.verdict = { kind: 'bad', label: 'Não compensa a distância', text: `A economia de ${brl(gross)} some com ${brl(extraTrip)} a mais de deslocamento.` };
  }

  // melhor combinação de 2 mercados (uma volta: casa → A → B → casa)
  let split = null;
  if (home && its.length > 1) {
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
      const A = rows[i], B = rows[j];
      if (!A.store || !B.store) continue;
      let goods = 0; const inA = [], inB = [];
      for (const { p, qty } of its) {
        const a = priceIn(p, A.m.id), b = priceIn(p, B.m.id);
        if (a == null && b == null) goods += cheapest(p) * qty;
        else if (b == null || (a != null && a <= b)) { goods += a * qty; inA.push(p); }
        else { goods += b * qty; inB.push(p); }
      }
      if (!inA.length || !inB.length) continue;
      const road = (haversine(home, A.store) + haversine(A.store, B.store) + haversine(B.store, home)) * ROUTE_FACTOR;
      const trip = tripFor(road / 2, 3);
      const total = goods + trip.cost;
      if (!split || total < split.total) split = { A, B, inA, inB, goods, trip, total };
    }
    if (split && best.total - split.total < 8) split = null;
  }

  const savings = base ? base.total - best.total : (ranked[ranked.length - 1].total - best.total);
  return { its, home, rows, ranked, base, best, split, savings, qty: its.reduce((s, r) => s + r.qty, 0) };
}

// ---------------------------------------------------------------- proteínas por dia da semana
async function proteinInsights(its) {
  try { proteinCache ||= await api.proteinWeekday(); } catch { proteinCache = []; }
  if (!proteinCache.length) return null;
  const inList = its.filter(({ p }) => p.category_slug === 'carnes');
  const prots = inList.length ? inList : S.products.filter((p) => p.category_slug === 'carnes').slice(0, 6).map((p) => ({ p, qty: 1 }));
  const perProduct = prots.map(({ p, qty }) => {
    const rows = proteinCache.filter((r) => r.product_id === p.id && isOn(r.market_id) && r.samples >= 2);
    if (!rows.length) return null;
    const best = rows.reduce((a, b) => (b.avg_price < a.avg_price ? b : a));
    // por dia: menor preço médio entre os mercados
    const byDow = DOW.map((_, d) => {
      const r = rows.filter((x) => x.dow === d);
      return r.length ? r.reduce((a, b) => (b.avg_price < a.avg_price ? b : a)) : null;
    });
    const all = byDow.filter(Boolean).map((r) => r.avg_price);
    return { p, qty, best, byDow, min: Math.min(...all), max: Math.max(...all) };
  }).filter(Boolean);
  if (!perProduct.length) return null;

  // melhor (mercado, dia) para comprar todas as proteínas de uma vez
  let combo = null;
  for (const m of S.markets.values()) {
    if (!isOn(m.id)) continue;
    for (let d = 0; d < 7; d++) {
      let total = 0, ok = true;
      for (const x of perProduct) {
        const r = proteinCache.find((y) => y.product_id === x.p.id && y.market_id === m.id && y.dow === d);
        if (!r) { ok = false; break; }
        total += r.avg_price * x.qty;
      }
      if (ok && (!combo || total < combo.total)) combo = { m, d, total };
    }
  }
  let worst = 0;
  if (combo) {
    for (let d = 0; d < 7; d++) {
      let t = 0, ok = true;
      for (const x of perProduct) {
        const r = proteinCache.find((y) => y.product_id === x.p.id && y.market_id === combo.m.id && y.dow === d);
        if (!r) { ok = false; break; } t += r.avg_price * x.qty;
      }
      if (ok) worst = Math.max(worst, t);
    }
  }
  return { perProduct, combo, worst, fromList: inList.length > 0 };
}

// ---------------------------------------------------------------- histórico (página "Você")
export function history() { return api.store.get('tb.history', {}); }
function saveHistory(entry) {
  const h = history(); h[entry.month] = { ...(h[entry.month] || {}), ...entry }; api.store.set('tb.history', h);
}

// ---------------------------------------------------------------- render
const cats = () => new Map(S.categories.map((c) => [c.slug, c]));
let mode = api.store.get('tb.rmode', 'plan'); // 'plan' | 'shop'
const bestOf = (p) => p.prices.filter((x) => isOn(x.market_id))[0] || p.prices[0];

function shell() {
  const v = $('#ranchoView');
  if ($('#rxGroups', v)) return;
  v.innerHTML = `
    <div class="rx">
      <div id="rxNote"></div>
      <div class="rx-head" id="rxHead"></div>
      <div class="rx-layout">
        <div class="rx-main">
          <div class="rx-add">
            <label class="search search--sm">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 3a7.5 7.5 0 1 0 4.6 13.4l4.7 4.7 1.4-1.4-4.7-4.7A7.5 7.5 0 0 0 10.5 3zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z" fill="currentColor"/></svg>
              <input id="ranchoSearch" type="search" placeholder="Adicionar produto ao rancho" autocomplete="off" aria-autocomplete="list" aria-controls="ranchoSug" />
            </label>
            <ul class="sug" id="ranchoSug" role="listbox" hidden></ul>
            <div class="rx-quick" id="rxQuick"></div>
          </div>
          <div id="rxGroups"></div>
        </div>
        <aside class="rx-side" id="rxSide"></aside>
      </div>
      <div id="ranchoReport"></div>
      <div class="rbar" id="ranchoBar" hidden></div>
    </div>`;
}

export function render() {
  shell();
  const m = meta();
  const its = items();
  const cur = monthKey();
  const checked = new Set(m.checked);
  const done = its.filter(({ p }) => checked.has(p.id)).length;
  const lastMonth = Object.values(history()).filter((h) => h.month !== m.month && h.items?.length).sort((a, b) => b.month.localeCompare(a.month))[0];

  $('#rxNote').innerHTML = m.month !== cur
    ? `<div class="note">Começou ${esc(monthName(cur))}. <button class="linkish" data-rancho="newmonth">Montar o rancho de ${esc(monthName(cur))} com os mesmos itens</button></div>` : '';

  $('#rxHead').innerHTML = `
    <div class="rx-title">
      <label><span class="sr-only">Nome da lista</span><input id="ranchoName" value="${esc(m.name)}" maxlength="40" /></label>
      <div class="rx-progress">
        ${its.length ? `<span>${its.length} ${its.length > 1 ? 'itens' : 'item'}${done ? ` · ${done} no carrinho` : ''}</span><span class="track" aria-hidden="true"><span style="--w:${its.length ? Math.round((done / its.length) * 100) : 0}%"></span></span>`
          : '<span>Monte a lista do mês. No fim, mostramos onde ela sai mais barata.</span>'}
      </div>
    </div>
    ${its.length ? `<div class="seg" role="radiogroup" aria-label="Modo da lista">
      <button role="radio" aria-checked="${mode === 'plan'}" data-rmode="plan">Planejar</button>
      <button role="radio" aria-checked="${mode === 'shop'}" data-rmode="shop">No mercado</button>
    </div>` : ''}`;

  $('#rxQuick').innerHTML = [
    its.length < 6 ? `<button class="chip" data-rancho="basic">+ Cesta básica</button>` : '',
    lastMonth && its.length < 3 ? `<button class="chip" data-rancho="repeat" data-month="${lastMonth.month}">Repetir ${esc(monthName(lastMonth.month))}</button>` : '',
    S.favs.size && its.length < 6 ? `<button class="chip" data-rancho="favs">+ Meus favoritos</button>` : '',
  ].join('');

  if (!its.length) {
    $('#rxGroups').innerHTML = `<div class="rx-empty"><span class="big" aria-hidden="true">🛒</span><b>Seu rancho está vazio</b>
      <p class="muted small">Busque acima, comece pela cesta básica ou toque no + dos produtos em Ofertas.</p></div>`;
    $('#rxSide').innerHTML = ''; $('#ranchoReport').innerHTML = ''; $('#ranchoBar').hidden = true;
    return;
  }

  // ---- lista por categoria
  const C = cats();
  const groups = new Map();
  for (const it of its) { const k = it.p.category_slug; (groups.get(k) || groups.set(k, []).get(k)).push(it); }
  const openState = api.store.get('tb.rgroups', {});
  $('#rxGroups').classList.toggle('rx-mode-shop', mode === 'shop');
  $('#rxGroups').innerHTML = [...groups].sort((a, b) => (C.get(a[0])?.sort ?? 99) - (C.get(b[0])?.sort ?? 99)).map(([slug, arr]) => {
    const n = arr.filter(({ p }) => checked.has(p.id)).length;
    if (mode === 'shop') arr.sort((a, b) => checked.has(a.p.id) - checked.has(b.p.id));
    return `<details class="rx-group" data-group="${esc(slug)}" ${openState[slug] === false ? '' : 'open'}>
      <summary>${esc(C.get(slug)?.name || slug)}<span class="cnt">${n ? `${n}/` : ''}${arr.length}</span></summary>
      <ul class="rx-items">${arr.map(({ p, qty }) => {
        const b = bestOf(p); const on = checked.has(p.id);
        return `<li class="rx-item ${on ? 'is-checked' : ''}" data-pid="${p.id}">
          <label class="tick"><input type="checkbox" data-check="${p.id}" ${on ? 'checked' : ''} aria-label="Já peguei ${esc(p.name)}" /><span></span></label>
          ${media(p, 'rx-media')}
          <div class="rx-txt"><span class="rx-name">${esc(p.name)}</span>
            <span class="rx-meta">${mode === 'plan' ? `${logo(S.markets.get(b.market_id), 'xs')} <span>${brl(b.price)}${qty > 1 ? ` × ${qty}` : ''} · ${esc([p.brand, p.unit].filter(Boolean).join(' · '))}</span>` : `<span>${esc([p.brand, p.unit].filter(Boolean).join(' · '))}</span>`}</span></div>
          <span class="rx-qty">${qty}×</span>
          <span class="rx-sub">${brl(b.price * qty)}</span>
          ${stepper(p.id)}
        </li>`;
      }).join('')}</ul>
    </details>`;
  }).join('');

  // ---- resumo lateral
  const r = computeReport();
  if (r) {
    const max = Math.max(...r.ranked.map((x) => x.total));
    const min = r.best.total;
    $('#rxSide').innerHTML = `
      <div class="rx-best">
        <p class="pd__h" style="margin:0">Onde sai mais barato</p>
        <div class="rx-best__top"><span class="lf">${logoFull(r.best.m)}</span>
          <div><b>${esc(r.best.m.name)}</b><small>${r.best.km != null ? `${km(r.best.km)} de ${r.home?.source === 'pos' ? 'você' : 'casa'}` : 'menor total'}</small></div></div>
        ${priceTag(r.best.total, 'lg')}
        <p class="rx-best__save">${r.base && r.base !== r.best ? `<b>${brl(r.savings)}</b> a menos que no ${esc(r.base.m.name)}, o mais perto${r.home?.source === 'pos' ? ' de você' : ' de casa'}.`
          : r.base ? 'O mais perto também é o mais barato.' : `Até <b>${brl(r.savings)}</b> a menos que no mais caro.`}${r.home ? ' Já inclui o deslocamento.' : ''}</p>
        <ol class="rank-list">${r.ranked.map((x, i) => `<li class="${i === 0 ? 'is-best' : ''}">
          ${logo(x.m, 'xs')}<b>${esc(x.m.name)}</b><span class="v">${brl(x.total)}</span>
          <span class="rl-bar"><span style="--w:${max > min ? 30 + 70 * ((x.total - min) / (max - min)) : 100}%"></span></span>
          ${x.missing.length ? `<small style="grid-column:2/-1">${x.missing.length} ${x.missing.length > 1 ? 'itens' : 'item'} sem preço lá</small>` : ''}</li>`).join('')}</ol>
        ${m.status === 'concluida'
          ? `<button class="btn btn--ghost btn--block" data-rancho="report">Ver relatório completo</button>`
          : `<button class="btn btn--primary btn--block" data-rancho="finish">Concluir e ver relatório</button>`}
      </div>
      <div class="rx-tools">
        <button class="btn btn--text btn--sm" data-rancho="share">Compartilhar lista</button>
        <button class="btn btn--text btn--sm" data-rancho="clear">Limpar lista</button>
      </div>`;
  }

  $('#ranchoBar').hidden = false;
  $('#ranchoBar').innerHTML = m.status === 'concluida'
    ? `<span><b>Lista concluída</b><small>Mais barato: ${esc(r.best.m.name)}, ${brl(r.best.total)}</small></span><button class="btn btn--primary btn--sm" data-rancho="report">Relatório</button>`
    : `<span><b>${r ? `${esc(r.best.m.name)}: ${brl(r.best.total)}` : `${its.length} itens`}</b><small>${its.length} ${its.length > 1 ? 'itens' : 'item'} · mais barato agora</small></span><button class="btn btn--primary btn--sm" data-rancho="finish">Concluir</button>`;

  if (m.status === 'concluida') renderReport(false); else $('#ranchoReport').innerHTML = '';
}

export async function renderReport(scroll = true) {
  const r = computeReport();
  const el = $('#ranchoReport');
  if (!r) { el.innerHTML = ''; return; }
  const m = meta();
  m.bestMarket = r.best.m.id; m.bestTotal = Math.round(r.best.total * 100) / 100;
  m.baseTotal = Math.round((r.base || r.ranked[r.ranked.length - 1]).total * 100) / 100;
  const totals = Object.fromEntries(r.rows.map((x) => [x.m.id, Math.round(x.total * 100) / 100]));
  m.savings = m.bought ? Math.max(0, Math.round((m.baseTotal - (totals[m.bought] ?? m.bestTotal)) * 100) / 100) : Math.max(0, Math.round(r.savings * 100) / 100);
  persist();
  if (m.status === 'concluida') saveHistory({ month: m.month, name: m.name, best: m.bestMarket, bestTotal: m.bestTotal, baseTotal: m.baseTotal, base: r.base?.m.id ?? null, totals, savings: m.savings, items: [...S.list], completedAt: m.completedAt, bought: m.bought ?? null, spent: m.spent ?? null });
  const T = S.transport; const M = MODES[T.mode] || MODES.carro;
  const maxTotal = Math.max(...r.rows.map((x) => x.total));
  const stale = r.best.missing.length + r.its.filter(({ p }) => {
    const x = p.prices.find((y) => y.market_id === r.best.m.id);
    return x && (Date.now() - new Date(x.at).getTime()) / 864e5 > 5;
  }).length;

  el.innerHTML = `
    <section class="rep" aria-labelledby="repTitle">
      <header class="rep__hero">
        <p class="rep__kick">Relatório · ${esc(m.name)}</p>
        <div class="rep__win"><span class="rep__logo">${logoFull(r.best.m)}</span>
          <div><p class="muted small">Melhor lugar para este rancho</p><h2 id="repTitle">${esc(r.best.m.name)}</h2></div></div>
        ${priceTag(r.best.total, 'xl')}
        <p class="rep__lead">${r.base && r.base !== r.best
          ? `Você economiza <b>${brl(r.savings)}</b> em relação ao ${esc(r.base.m.name)}, o mercado mais perto ${r.home?.source === 'pos' ? 'de você' : 'da sua casa'}, já contando o deslocamento.`
          : r.base ? `O mercado mais perto ${r.home?.source === 'pos' ? 'de você' : 'da sua casa'} também é o mais barato para esta lista: economia e menos trânsito.`
          : `É o menor total para a sua lista. Informe onde fica sua casa para incluir o deslocamento.`}</p>
        <ul class="facts">
          <li><b>${r.qty}</b> itens</li>
          ${r.best.km != null ? `<li><b>${km(r.best.km)}</b> · ${esc(r.best.store.neighborhood)}</li><li><b>~${Math.round(r.best.trip.minutes)} min</b> ida e volta</li>` : ''}
          ${r.best.missing.length ? `<li><b>${r.best.missing.length}</b> sem preço lá</li>` : ''}
        </ul>
        <div class="rep__actions">
          ${r.best.store ? `<a class="btn btn--primary" href="https://www.google.com/maps/dir/?api=1&destination=${r.best.store.lat},${r.best.store.lng}" target="_blank" rel="noopener" data-route="${r.best.m.id}">Abrir rota</a>` : ''}
          <button class="btn btn--ghost" data-rancho="sharereport">Compartilhar</button>
          ${m.status === 'concluida' ? `<button class="btn btn--text" data-rancho="reopen">Editar lista</button>` : ''}
        </div>
      </header>

      <div class="rep__box bought" id="repBought">${boughtBox(r, m)}</div>

      <div class="rep__cfg">
        <div class="rep__home">
          <span class="muted small">Saindo de</span>
          ${r.home ? `<b>${esc(r.home.label || 'sua casa')}</b>${r.home.source === 'pos' ? ' <small class="muted">(localização atual)</small>' : ''}` : '<b>local não definido</b>'}
          <button class="linkish small" data-rancho="sethome">${r.home?.source === 'home' ? 'Alterar' : 'Definir minha casa'}</button>
        </div>
        <div class="seg seg--sm" role="radiogroup" aria-label="Como você vai ao mercado">
          ${Object.entries(MODES).map(([k, v]) => `<button role="radio" aria-checked="${T.mode === k}" data-mode="${k}">${v.label}</button>`).join('')}
        </div>
        ${M.unit ? `<label class="rep__cost">${T.mode === 'onibus' ? 'Passagem' : T.mode === 'app' ? 'Preço por km (+ R$ 6 por corrida)' : 'Custo por km rodado'}
          <span>R$ <input id="tripValue" inputmode="decimal" value="${(T.value ?? M.value).toFixed(2).replace('.', ',')}" /></span></label>` : ''}
      </div>

      <div>
        <h3 class="pd__h">Vale a pena ir mais longe?</h3>
        <ol class="vs">
          ${r.ranked.map((x) => `<li class="vs__row ${x === r.best ? 'is-best' : ''} ${x.verdict ? 'v-' + x.verdict.kind : ''}">
            <div class="vs__top">
              ${logo(x.m, 'md')}
              <div class="vs__n"><b>${esc(x.m.name)}</b><small>${x.km != null ? `${km(x.km)}, ~${Math.round(x.trip.minutes)} min ida e volta` : ''}</small></div>
              <div class="vs__t"><b>${brl(x.total)}</b></div>
            </div>
            <div class="vs__bar"><span style="--w:${(x.total / maxTotal) * 100}%"></span></div>
            <p class="vs__break">${brl(x.goods)} em produtos + ${brl(x.trip.cost)} de deslocamento</p>
            ${x.verdict ? `<p class="vs__v"><em>${x.verdict.label}</em>${x.verdict.text}</p>` : ''}
            ${x.missing.length ? `<p class="vs__miss">Sem preço lá: ${x.missing.slice(0, 4).map((p) => esc(p.name)).join(', ')}${x.missing.length > 4 ? '…' : ''} (contado pelo mais barato de outro mercado)</p>` : ''}
          </li>`).join('')}
        </ol>
      </div>

      ${r.split ? `<div class="rep__box">
        <h3 class="pd__h">Dá para economizar mais dividindo</h3>
        <p>Comprando parte no <b>${esc(r.split.A.m.name)}</b> e parte no <b>${esc(r.split.B.m.name)}</b>, numa volta só, o rancho sai por <b>${brl(r.split.total)}</b>: mais <b>${brl(r.best.total - r.split.total)}</b> de economia, com ~${Math.round(r.split.trip.minutes)} min de deslocamento.</p>
        <div class="split2">
          <div>${logo(r.split.A.m, 'sm')}<b>${esc(r.split.A.m.name)}</b><span>${r.split.inA.map((p) => esc(p.name)).join(', ')}</span></div>
          <div>${logo(r.split.B.m, 'sm')}<b>${esc(r.split.B.m.name)}</b><span>${r.split.inB.map((p) => esc(p.name)).join(', ')}</span></div>
        </div>
      </div>` : ''}

      <div class="rep__box" id="repProt"><h3 class="pd__h">Melhores dias para as proteínas</h3><div class="skeleton" style="height:140px"></div></div>

      ${stale ? `<div class="rep__box">
        <p class="small"><b>${stale} ${stale > 1 ? 'preços' : 'preço'} no ${esc(r.best.m.name)} sem confirmação recente.</b> Quando passar lá, confira em 1 minuto: você ganha pontos e o cálculo fica mais preciso para todo mundo.</p>
        <button class="btn btn--ghost btn--sm" style="margin-top:10px" data-fiscal-market="${r.best.m.id}">Conferir preços no ${esc(r.best.m.name)}</button>
      </div>` : ''}
    </section>`;

  if (scroll) el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });

  const pi = await proteinInsights(r.its);
  const box = $('#repProt'); if (!box) return;
  if (!pi) { box.innerHTML = `<h3 class="pd__h">Melhores dias para as proteínas</h3><p class="muted small">Ainda não há histórico suficiente.</p>`; return; }
  const today = new Date().getDay();
  box.innerHTML = `
    <h3 class="pd__h">Melhores dias para as proteínas</h3>
    ${pi.combo ? `<p class="prot__lead">Para comprar ${pi.fromList ? 'as proteínas da sua lista' : 'carnes, frango, peixe e ovos'} de uma vez: <b>${DOW[pi.combo.d]} no ${esc(pi.combo.m.name)}</b>${pi.worst > pi.combo.total ? `, em média <b>${brl(pi.worst - pi.combo.total)}</b> a menos que no pior dia da semana lá` : ''}.</p>` : ''}
    <div class="prot" role="table" aria-label="Preço médio por dia da semana">
      <div class="prot__row prot__head" role="row"><span role="columnheader">Produto</span>${DOW_SHORT.map((d, i) => `<span role="columnheader" class="${i === today ? 'is-today' : ''}">${d}</span>`).join('')}</div>
      ${pi.perProduct.map((x) => `<div class="prot__row" role="row">
        <span role="rowheader" class="prot__name">${esc(x.p.name)}<small>${DOW_SHORT[x.best.dow].toLowerCase()} no ${esc(S.markets.get(x.best.market_id)?.name || '')}, ${brl(x.best.avg_price)}</small></span>
        ${x.byDow.map((c, d) => {
          if (!c) return '<span role="cell" class="prot__c is-na">–</span>';
          const t = x.max > x.min ? (c.avg_price - x.min) / (x.max - x.min) : 0.5;
          return `<span role="cell" class="prot__c ${c.avg_price === x.min ? 'is-best' : ''} ${d === today ? 'is-today' : ''}" style="--t:${t.toFixed(2)}" title="${DOW[d]}: ${brl(c.avg_price)} no ${esc(S.markets.get(c.market_id)?.name || '')}">${logo(S.markets.get(c.market_id), 'xs')}</span>`;
        }).join('')}
      </div>`).join('')}
    </div>
    <p class="muted small" style="margin-top:8px">${!pi.fromList ? 'Sua lista não tem proteínas; estes são os mais buscados. ' : ''}Média das últimas semanas; quanto mais verde, menor o preço.</p>`;
}

/** "Onde você comprou?": alimenta a página Você e as métricas dos mercados */
function boughtBox(r, m) {
  if (m.status !== 'concluida') return `<p class="small muted">Conclua a lista para registrar onde você comprou e acompanhar quanto economiza mês a mês.</p>`;
  if (m.bought) {
    const bm = S.markets.get(m.bought);
    return `<div class="bought__done">${logo(bm, 'md')}<span style="flex:1">Você comprou no <b>${esc(bm.name)}</b>${m.spent ? ` e gastou <b>${brl(m.spent)}</b>` : ''}. Economia registrada: <b class="down">${brl(m.savings || 0)}</b>.</span><button class="btn btn--text btn--sm" data-rancho="unbought">Alterar</button></div>`;
  }
  return `<h3 style="font-size:1rem">Já fez as compras? Onde comprou?</h3>
    <p class="muted small">Registre para ver sua economia na página Você. Leva 2 segundos.</p>
    <div class="bought__row">${r.ranked.map((x) => `<button class="chip" data-bought="${x.m.id}">${logo(x.m, 'xs')} ${esc(x.m.name)}</button>`).join('')}</div>
    <label class="rep__cost">Quanto gastou? (opcional)<span>R$ <input id="spentValue" inputmode="decimal" placeholder="0,00" /></span></label>`;
}

// ---------------------------------------------------------------- busca para adicionar
function suggest(q) {
  const n = (s) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const t = n(q.trim()); const ul = $('#ranchoSug');
  if (!t) { ul.hidden = true; return; }
  const res = S.products.filter((p) => n(`${p.name} ${p.brand || ''} ${p.category_name}`).includes(t)).slice(0, 7);
  ul.innerHTML = res.length ? res.map((p, i) => `<li role="option" id="sug${i}"><button data-sug="${p.id}">${p.emoji || '🛒'} <span><b>${esc(p.name)}</b> <small>${esc([p.brand, p.unit].filter(Boolean).join(', '))}</small></span><em>${S.list.has(p.id) ? 'na lista' : brl(p.prices[0].price)}</em></button></li>`).join('')
    : `<li class="muted small sug__none">Nada encontrado para “${esc(q)}”.</li>`;
  ul.hidden = false;
}

// ---------------------------------------------------------------- eventos
document.addEventListener('input', (e) => {
  if (e.target.id === 'ranchoSearch') suggest(e.target.value);
  if (e.target.id === 'ranchoName') { meta().name = e.target.value.trim() || meta().name; persist(); }
  if (e.target.id === 'tripValue') {
    const v = parseFloat(e.target.value.replace(',', '.'));
    if (v >= 0) { S.transport.value = v; api.store.set('tb.transport', S.transport); clearTimeout(e.target._t); e.target._t = setTimeout(() => { renderReport(false); render(); }, 500); }
  }
});
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'ranchoSearch' && e.key === 'Enter') { e.preventDefault(); $('#ranchoSug button')?.click(); }
});
document.addEventListener('change', (e) => {
  const id = e.target.dataset?.check; if (!id) return;
  const m = meta(); const pid = Number(id);
  m.checked = e.target.checked ? [...new Set([...m.checked, pid])] : m.checked.filter((x) => x !== pid);
  persist();
  e.target.closest('.rx-item')?.classList.toggle('is-checked', e.target.checked);
  clearTimeout(e.target._t); e.target._t = setTimeout(render, 380);
  if (m.checked.length === S.list.size && S.list.size > 2) hooks.toast?.('Tudo no carrinho. Boas compras!');
});
// lembra quais categorias ficaram recolhidas
document.addEventListener('toggle', (e) => {
  const g = e.target.dataset?.group; if (!g) return;
  const st = api.store.get('tb.rgroups', {}); st[g] = e.target.open; api.store.set('tb.rgroups', st);
}, true);
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, a'); if (!t) {
    if (!e.target.closest('.rx-add')) $('#ranchoSug')?.setAttribute('hidden', '');
    return;
  }
  const d = t.dataset;
  if (d.sug) {
    const pid = Number(d.sug);
    hooks.setQty(pid, (S.list.get(pid) || 0) + (S.list.has(pid) ? 0 : 1));
    $('#ranchoSearch').value = ''; $('#ranchoSug').hidden = true; $('#ranchoSearch').focus();
    hooks.toast?.(`${S.products.find((p) => p.id === pid).name} no rancho.`);
    return;
  }
  if (d.mode) {
    S.transport = { mode: d.mode, value: MODES[d.mode].value }; api.store.set('tb.transport', S.transport);
    if (S.user) api.updateProfile({ transport: d.mode }).catch(() => {});
    renderReport(false); render(); return;
  }
  if (d.rmode) { mode = d.rmode; api.store.set('tb.rmode', mode); render(); return; }
  if (d.bought) {
    const m = meta(); const v = parseFloat(($('#spentValue')?.value || '').replace(/\./g, '').replace(',', '.'));
    m.bought = Number(d.bought); m.spent = v > 0 ? Math.round(v * 100) / 100 : null;
    track('bought', { market_id: m.bought, value: m.spent });
    renderReport(false); hooks.toast?.('Compra registrada. Veja sua economia em Você.');
    return;
  }
  switch (d.rancho) {
    case 'unbought': { const m = meta(); m.bought = null; m.spent = null; persist(); renderReport(false); break; }
    case 'repeat': {
      const h = history()[d.month]; let n = 0;
      for (const [pid, q] of h?.items || []) if (!S.list.has(pid) && S.products.some((p) => p.id === pid)) { S.list.set(pid, q); n++; }
      onListChange(); hooks.afterListLoad?.(); hooks.toast?.(`${n} itens de ${monthName(d.month)} adicionados.`); break;
    }
    case 'favs': {
      let n = 0;
      for (const pid of S.favs) if (!S.list.has(pid) && S.products.some((p) => p.id === pid)) { S.list.set(pid, 1); n++; }
      onListChange(); hooks.afterListLoad?.(); hooks.toast?.(`${n} favoritos adicionados.`); break;
    }
    case 'basic': {
      let n = 0;
      for (const name of BASIC) { const p = S.products.find((x) => x.name === name); if (p && !S.list.has(p.id)) { S.list.set(p.id, 1); n++; } }
      onListChange(); hooks.afterListLoad?.(); hooks.toast?.(`${n} itens da cesta básica adicionados.`); break;
    }
    case 'finish': {
      if (!['home', 'profile'].includes(homePos()?.source)) { hooks.openHome?.(() => finish()); return; }
      finish(); break;
    }
    case 'reopen': meta().status = 'aberta'; persist(); render(); $('#ranchoView').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }); break;
    case 'report': renderReport(true); break;
    case 'sethome': hooks.openHome?.(() => { renderReport(false); render(); }); break;
    case 'clear':
      if (!confirm('Tirar todos os itens do rancho?')) return;
      S.list.clear(); meta().checked = []; meta().status = 'aberta'; onListChange(); hooks.afterListLoad?.(); break;
    case 'newmonth': {
      const cur = monthKey();
      S.rancho = { name: `Rancho de ${monthName(cur)}`, month: cur, status: 'aberta', checked: [] }; // bought/spent zerados
      persist(); render(); hooks.toast?.(`Rancho de ${monthName(cur)} criado com os mesmos itens.`); break;
    }
    case 'share': shareText(listText()); break;
    case 'sharereport': {
      const r = computeReport(); if (!r) return;
      shareText(`${meta().name}: ${r.qty} itens.\nMais barato no ${r.best.m.name}: ${brl(r.best.total)}${r.base && r.base !== r.best ? `, ${brl(r.savings)} a menos que no ${r.base.m.name}` : ''}.\n\nCalcule o seu no Tá Barato Mesmo? ${location.origin}${location.pathname}`);
      break;
    }
  }
});

function finish() {
  const m = meta(); m.status = 'concluida'; m.completedAt = new Date().toISOString();
  const r = computeReport();
  if (r) track('rancho_done', { market_id: r.best.m.id, value: Math.round(r.best.total * 100) / 100 });
  persist(); render(); renderReport(true);
}

function listText() {
  return `${meta().name}\n\n` + items().map(({ p, qty }) => `${meta().checked.includes(p.id) ? '☑' : '☐'} ${qty}x ${p.name} ${p.brand || ''} (${p.unit})`).join('\n')
    + `\n\n${location.origin}${location.pathname}`;
}
async function shareText(text) {
  try {
    if (navigator.share) await navigator.share({ title: meta().name, text });
    else { await navigator.clipboard.writeText(text); hooks.toast?.('Copiado.'); }
  } catch {}
}
