// Dados do portal dos supermercados.
// Ao vivo: funções market_* do schema.sql + Storage "produtos".
// Demonstração: grava no aparelho (tb.portalDemo) e o site público lê de lá também.
import * as api from './api.js';
import { BAIRROS, ZONE_NAMES } from './config.js';

export let MODE = 'live'; // 'live' | 'demo' | 'pending' (banco sem as funções do portal)
const ls = api.store;
const DEMO_MARKET = 5; // Coema
const isMissingFn = (e) => /PGRST202|could not find the function|does not exist/i.test(`${e?.code} ${e?.message}`);

export async function init() {
  if (api.MODE === 'demo') { MODE = 'demo'; return; }
  const c = await api.sbClient();
  const { error } = await c.rpc('my_markets');
  MODE = error && isMissingFn(error) ? 'pending' : 'live';
}
export function useDemo() { MODE = 'demo'; }

// ---------------------------------------------------------------- acesso
export async function myMarkets() {
  if (MODE === 'demo') {
    const { DEMO } = await import('./demo-data.js');
    return DEMO.supermarkets.filter((m) => m.id === DEMO_MARKET).map((m) => ({ ...m, role: 'admin' }));
  }
  const c = await api.sbClient();
  const { data, error } = await c.rpc('my_markets');
  if (error) throw error;
  return data;
}

export async function joinMarket(code) {
  if (MODE === 'demo') return { supermarket_id: DEMO_MARKET };
  const c = await api.sbClient();
  const { data, error } = await c.rpc('join_market', { p_code: code });
  if (error) throw new Error(error.message);
  return data;
}

// ---------------------------------------------------------------- estado de demonstração
const demoState = () => ls.get('tb.portalDemo', { listings: {}, newProducts: [], promos: [], nextId: 900, nextPromo: 1 });
const saveDemo = (d) => ls.set('tb.portalDemo', d);

async function demoCatalog(mid) {
  const { DEMO } = await import('./demo-data.js');
  const d = demoState();
  const cats = new Map(DEMO.categories.map((c) => [c.id, c.slug]));
  const latest = new Map();
  for (const [pid, m, price, days] of DEMO.prices) {
    const k = `${m}:${pid}`; const cur = latest.get(k);
    if (!cur || days < cur.days) latest.set(k, { price, days });
  }
  for (const [k, v] of Object.entries(d.listings)) if (v.price != null) latest.set(k, { price: v.price, days: 0, at: v.at });
  const products = [...DEMO.products.map((p) => ({ ...p, category_slug: p.category_slug || cats.get(p.category_id) })), ...d.newProducts];
  const rows = [];
  for (const p of products) {
    const mine = latest.get(`${mid}:${p.id}`); if (!mine) continue;
    const L = d.listings[`${mid}:${p.id}`] || {};
    const others = DEMO.supermarkets.filter((m) => m.id !== mid).map((m) => {
      const x = latest.get(`${m.id}:${p.id}`); const off = d.listings[`${m.id}:${p.id}`]?.active === false;
      return x && !off ? x.price : null;
    }).filter((v) => v != null);
    const all = [mine.price, ...others].sort((a, b) => a - b);
    const promo = d.promos.find((x) => x.product_id === p.id && x.supermarket_id === mid && x.active && new Date(x.ends_at) > Date.now());
    rows.push({
      product_id: p.id, name: p.name, brand: p.brand, unit: p.unit, category: p.category_slug, emoji: p.emoji, ean: p.ean || L.ean || null,
      sku: L.sku || null, image_url: L.photo || p.photo || null, own: !!p.own, price: mine.price,
      price_at: mine.at || new Date(Date.now() - mine.days * 864e5).toISOString(),
      min_other: others.length ? Math.min(...others) : null, avg_other: others.length ? others.reduce((s, v) => s + v, 0) / others.length : null,
      rank: all.indexOf(mine.price) + 1, n_markets: all.length, active: L.active !== false,
      promo_id: promo?.id ?? null, promo_price: promo?.promo_price ?? null, promo_kind: promo?.kind ?? null, promo_ends: promo?.ends_at ?? null,
    });
  }
  return rows.sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- produtos
export async function catalog(mid) {
  if (MODE === 'demo') return demoCatalog(mid);
  const c = await api.sbClient();
  const { data, error } = await c.rpc('market_catalog', { p_market: mid });
  if (error) throw error;
  return data.map((r) => ({ ...r, price: Number(r.price), min_other: r.min_other == null ? null : Number(r.min_other),
    avg_other: r.avg_other == null ? null : Number(r.avg_other), promo_price: r.promo_price == null ? null : Number(r.promo_price) }));
}

/** f: { product_id?, name, brand, unit, category, ean, emoji, price, image_url, sku } */
export async function saveProduct(mid, f) {
  if (MODE === 'demo') {
    const d = demoState();
    let pid = f.product_id; let created = false;
    if (!pid) {
      const { DEMO } = await import('./demo-data.js');
      const n = (s) => (s || '').trim().toLowerCase();
      const found = [...DEMO.products, ...d.newProducts].find((p) => (f.ean && p.ean === f.ean) || (n(p.name) === n(f.name) && n(p.brand) === n(f.brand) && n(p.unit) === n(f.unit)));
      if (found) pid = found.id;
      else {
        const cat = DEMO.categories.find((c) => c.slug === f.category || n(c.name) === n(f.category));
        if (!cat) throw new Error(`Categoria "${f.category || ''}" não existe.`);
        pid = d.nextId++; created = true;
        d.newProducts.push({ id: pid, name: f.name.trim(), brand: f.brand || null, unit: f.unit || null, emoji: f.emoji || '🛒', ean: f.ean || null,
          category_slug: cat.slug, category_name: cat.name, own: true, photo: f.image_url || null });
      }
    } else {
      const np = d.newProducts.find((p) => p.id === pid);
      if (np) Object.assign(np, { name: f.name, brand: f.brand, unit: f.unit, emoji: f.emoji || np.emoji, ean: f.ean || np.ean });
    }
    const k = `${mid}:${pid}`;
    d.listings[k] = { ...d.listings[k], active: true, sku: f.sku || d.listings[k]?.sku, ean: f.ean || d.listings[k]?.ean,
      ...(f.price != null ? { price: Number(f.price), at: new Date().toISOString() } : {}), ...(f.image_url ? { photo: f.image_url } : {}) };
    saveDemo(d);
    return { product_id: pid, created };
  }
  const c = await api.sbClient();
  const { data, error } = await c.rpc('market_save_product', {
    p_market: mid, p_product_id: f.product_id || null, p_name: f.name, p_brand: f.brand || null, p_unit: f.unit || null,
    p_category: f.category || null, p_ean: f.ean || null, p_emoji: f.emoji || null, p_price: f.price ?? null,
    p_image_url: f.image_url || null, p_sku: f.sku || null,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function removeProduct(mid, pid) {
  if (MODE === 'demo') {
    const d = demoState(); d.listings[`${mid}:${pid}`] = { ...d.listings[`${mid}:${pid}`], active: false };
    d.promos.forEach((p) => { if (p.product_id === pid && p.supermarket_id === mid) p.active = false; });
    saveDemo(d); return;
  }
  const c = await api.sbClient();
  const { error } = await c.rpc('market_remove_product', { p_market: mid, p_product: pid });
  if (error) throw new Error(error.message);
}

export async function importRows(mid, rows) {
  if (MODE === 'demo') {
    let ok = 0, created = 0, promos = 0; const errors = [];
    for (const r of rows) {
      try {
        const res = await saveProduct(mid, { name: r.nome, brand: r.marca, unit: r.unidade, category: r.categoria, ean: r.ean, emoji: r.emoji,
          price: r.preco === '' || r.preco == null ? null : Number(r.preco), image_url: r.foto_url, sku: r.sku });
        ok++; if (res.created) created++;
        if (r.preco_promo) {
          await savePromo({ supermarket_id: mid, product_id: res.product_id, kind: /exclusiv/i.test(r.tipo_promo || '') ? 'exclusiva' : 'geral',
            promo_price: Number(r.preco_promo), starts_at: r.inicio_promo || new Date().toISOString(), ends_at: r.fim_promo ? r.fim_promo + 'T23:59:00' : new Date(Date.now() + 7 * 864e5).toISOString() });
          promos++;
        }
      } catch (e) { errors.push({ linha: r._linha, erro: e.message }); }
    }
    return { total: rows.length, ok, created, promos, errors };
  }
  const c = await api.sbClient();
  const { data, error } = await c.rpc('market_import', { p_market: mid, p_rows: rows });
  if (error) throw new Error(error.message);
  return data;
}

// ---------------------------------------------------------------- fotos
/** reduz para no máximo `max` px e converte para WebP (fotos de celular têm 3–8 MB) */
export function compress(file, max = 900, q = 0.82) {
  return new Promise((res, rej) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const cv = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      cv.toBlob((b) => (b ? res(b) : rej(new Error('Não foi possível ler a imagem.'))), 'image/webp', q);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error(`“${file.name}” não é uma imagem válida.`)); };
    img.src = url;
  });
}

export async function uploadPhoto(mid, file, key = 'foto') {
  if (MODE === 'demo') {
    const blob = await compress(file, 360, 0.7);
    return await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  }
  const blob = await compress(file);
  const c = await api.sbClient();
  const safe = String(key).normalize('NFD').replace(/[^\w-]+/g, '-').slice(0, 40) || 'foto';
  const path = `${mid}/${safe}-${Date.now().toString(36)}.webp`;
  const { error } = await c.storage.from('produtos').upload(path, blob, { contentType: 'image/webp', upsert: false, cacheControl: '31536000' });
  if (error) throw new Error(error.message);
  return c.storage.from('produtos').getPublicUrl(path).data.publicUrl;
}

// ---------------------------------------------------------------- promoções
export async function promos(mid) {
  if (MODE === 'demo') return demoState().promos.filter((p) => p.supermarket_id === mid).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const c = await api.sbClient();
  const { data, error } = await c.from('promotions').select('*').eq('supermarket_id', mid).order('created_at', { ascending: false }).limit(300);
  if (error) throw error;
  return data.map((p) => ({ ...p, promo_price: Number(p.promo_price) }));
}

// ---------------------------------------------------------------- unidades (lojas) da rede
export async function stores(mid) {
  if (MODE === 'demo') {
    const { DEMO } = await import('./demo-data.js');
    const d = demoState();
    return [...DEMO.stores.filter((s) => s.supermarket_id === mid && !(d.storeEdits || {})[s.id]?.deleted).map((s) => ({ ...s, ...(d.storeEdits || {})[s.id] })),
      ...(d.newStores || []).filter((s) => s.supermarket_id === mid)];
  }
  const c = await api.sbClient();
  const { data, error } = await c.from('stores').select('*').eq('supermarket_id', mid).order('name');
  if (error) throw error;
  return data || [];
}
/** cadastra ou corrige uma unidade da própria rede (o banco recusa as de outra) */
export async function saveStore(p) {
  if (MODE === 'demo') {
    const d = demoState(); d.newStores ||= []; d.storeEdits ||= {};
    const row = { ...p, lat: Number(p.lat), lng: Number(p.lng), supermarket_id: Number(p.supermarket_id) };
    if (p.id && d.newStores.some((s) => s.id === Number(p.id))) Object.assign(d.newStores.find((s) => s.id === Number(p.id)), row, { id: Number(p.id) });
    else if (p.id) d.storeEdits[p.id] = { ...(d.storeEdits[p.id] || {}), ...row, id: Number(p.id) };
    else d.newStores.push({ ...row, id: 9000 + d.newStores.length });
    saveDemo(d); return;
  }
  const c = await api.sbClient();
  const { data, error } = await c.rpc('market_save_store', { p });
  if (error) throw new Error(/market_save_store|PGRST202/i.test(error.message + error.code) ? 'Falta rodar a atualização do banco (atualizacao-2026-10-promo-unidade.sql).' : error.message);
  return data;
}

export async function savePromo(p) {
  if (MODE === 'demo') {
    const d = demoState();
    if (p.id) Object.assign(d.promos.find((x) => x.id === p.id) || {}, p);
    else {
      d.promos.filter((x) => x.product_id === p.product_id && x.supermarket_id === p.supermarket_id && x.active && (x.store_id ?? null) === (p.store_id ?? null)).forEach((x) => { x.active = false; });
      d.promos.push({ active: true, created_at: new Date().toISOString(), ...p, id: d.nextPromo++,
        code: p.kind === 'exclusiva' ? (p.code || 'TB' + Math.random().toString(36).slice(2, 7).toUpperCase()) : null });
    }
    saveDemo(d); return;
  }
  const c = await api.sbClient();
  const row = { supermarket_id: p.supermarket_id, product_id: p.product_id, kind: p.kind, promo_price: p.promo_price, title: p.title || null,
    code: p.code || null, max_per_client: p.max_per_client || null, starts_at: p.starts_at, ends_at: p.ends_at, active: p.active ?? true };
  if (p.store_id || p.id) row.store_id = p.store_id || null; // ao editar, pode voltar a valer em todas as unidades
  const noCol = (e) => e && /store_id/.test(`${e.message} ${e.details || ''}`);
  if (!p.id) {
    // uma promoção ativa por produto em cada lugar (rede toda, ou cada unidade): encerra a anterior do mesmo lugar
    const base = () => c.from('promotions').update({ active: false }).eq('supermarket_id', p.supermarket_id).eq('product_id', p.product_id).eq('active', true);
    let { error: e0 } = await (p.store_id ? base().eq('store_id', p.store_id) : base().is('store_id', null));
    if (noCol(e0)) {
      // banco ainda sem a promoção por unidade: a de "todas as unidades" funciona como antes
      if (p.store_id) throw new Error('Promoção numa unidade só ainda não está ativada no banco (atualizacao-2026-10-promo-unidade.sql). Escolha "Todas as unidades".');
      ({ error: e0 } = await base());
    }
    if (e0) throw new Error(e0.message);
  }
  const save = () => (p.id ? c.from('promotions').update(row).eq('id', p.id) : c.from('promotions').insert(row));
  let { error } = await save();
  if (noCol(error) && !p.store_id) { delete row.store_id; ({ error } = await save()); } // banco sem a coluna ainda
  if (error) throw new Error(error.message);
}

export async function endPromo(id) {
  if (MODE === 'demo') { const d = demoState(); const x = d.promos.find((p) => p.id === id); if (x) x.active = false; saveDemo(d); return; }
  const c = await api.sbClient();
  const { error } = await c.from('promotions').update({ active: false }).eq('id', id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------- dias de desconto (market_deals)
export async function deals(mid) {
  if (MODE === 'demo') return (demoState().deals || []).filter((x) => x.supermarket_id === mid);
  const c = await api.sbClient();
  const { data, error } = await c.from('market_deals').select('*').eq('supermarket_id', mid).order('created_at', { ascending: false }).limit(100);
  if (error) throw new Error(/market_deals|does not exist|PGRST205/i.test(error.message + error.code) ? 'Rode de novo o supabase/schema.sql para ativar os dias de desconto.' : error.message);
  return data.map((x) => ({ ...x, discount_pct: Number(x.discount_pct) }));
}
export async function saveDeal(x) {
  const row = { supermarket_id: x.supermarket_id, title: x.title || null, weekdays: x.weekdays, category_slug: x.category_slug || null,
    payment: x.payment || null, discount_pct: x.discount_pct, note: x.note || null, starts_on: x.starts_on, ends_on: x.ends_on || null, active: x.active ?? true };
  if (MODE === 'demo') {
    const d = demoState(); d.deals ||= []; d.nextDeal ||= 1;
    if (x.id) Object.assign(d.deals.find((y) => y.id === x.id) || {}, row);
    else d.deals.push({ ...row, id: 1000 + d.nextDeal++, created_at: new Date().toISOString() });
    saveDemo(d); return;
  }
  const c = await api.sbClient();
  const { error } = x.id ? await c.from('market_deals').update(row).eq('id', x.id) : await c.from('market_deals').insert(row);
  if (error) throw new Error(error.message);
}
export async function endDeal(id) {
  if (MODE === 'demo') { const d = demoState(); const y = (d.deals || []).find((z) => z.id === id); if (y) y.active = false; saveDemo(d); return; }
  const c = await api.sbClient();
  const { error } = await c.from('market_deals').update({ active: false }).eq('id', id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------- métricas
export async function dashboard(mid, days) {
  if (MODE === 'demo') return demoDashboard(mid, days);
  const c = await api.sbClient();
  const { data, error } = await c.rpc('market_dashboard', { p_market: mid, p_days: days });
  if (error) throw new Error(error.message);
  return data;
}

// Painel simulado (determinístico) para o modo demonstração
async function demoDashboard(mid, days) {
  const { DEMO } = await import('./demo-data.js');
  let seed = 7 + mid * 13 + days;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const k = days / 30;
  const cat = await demoCatalog(mid);
  const prods = DEMO.products;
  const pick = (arr, n) => [...arr].sort(() => rnd() - 0.5).slice(0, n);
  const searchTerms = ['picanha', 'arroz', 'frango', 'café', 'leite', 'óleo', 'feijão', 'tambaqui', 'açúcar', 'ovos', 'cerveja', 'sabão em pó', 'papel higiênico', 'carne moída', 'farinha'];
  const top_searches = searchTerms.map((q, i) => ({ query: q, n: Math.round((420 - i * 24) * k * (0.8 + rnd() * 0.4)), people: Math.round((300 - i * 17) * k), results: 1 + Math.round(rnd() * 3) }));
  const no_results = ['azeite', 'fralda', 'whey', 'ração de gato', 'pão de forma', 'manteiga sem sal', 'tucumã'].map((q, i) => ({ query: q, n: Math.round((90 - i * 11) * k) }));
  const top_products = pick(prods, 15).map((p, i) => {
    const mine = cat.find((r) => r.product_id === p.id);
    return { id: p.id, name: p.name, brand: p.brand, unit: p.unit, emoji: p.emoji, views: Math.round((380 - i * 21) * k), adds: Math.round((140 - i * 8) * k),
      my_price: mine?.price ?? null, best: mine ? Math.min(mine.price, mine.min_other ?? Infinity) : null, is_best: mine ? mine.rank === 1 : null };
  });
  const brands = [...new Set(prods.map((p) => p.brand).filter((b) => b && b !== 'Granel'))];
  const top_brands = pick(brands, 10).map((b, i) => ({ brand: b, n: Math.round((260 - i * 22) * k), adds: Math.round((90 - i * 7) * k) })).sort((a, b) => b.n - a.n);
  const top_categories = DEMO.categories.map((c) => ({ name: c.name, icon: c.icon, n: Math.round((200 + rnd() * 900) * k) })).sort((a, b) => b.n - a.n);
  const ranking = DEMO.supermarkets.map((m) => {
    const w = m.id === mid ? 1.15 : 0.6 + rnd() * 0.7;
    const r = (base) => Math.round(base * w);
    return { id: m.id, name: m.name, color: m.color, bought_d: r(6), bought_w: r(38), bought_m: r(150), best_d: r(9), best_w: r(55), best_m: r(210), route_d: r(14), route_w: r(90), route_m: r(360), spent_m: r(150) * 310 };
  }).sort((a, b) => (b.bought_m * 3 + b.best_m * 2 + b.route_m) - (a.bought_m * 3 + a.best_m * 2 + a.route_m));
  const zones = ZONE_NAMES.map((z) => ({ zone: z, searches: Math.round((300 + rnd() * 1200) * k), adds: Math.round((80 + rnd() * 400) * k),
    ranchos: Math.round((20 + rnd() * 120) * k), routes_me: Math.round((5 + rnd() * 60) * k), people: Math.round((60 + rnd() * 300) * k) })).sort((a, b) => b.searches - a.searches);
  const neighborhoods = pick(BAIRROS, 12).map((b) => ({ neighborhood: b.name, zone: b.zone, searches: Math.round((40 + rnd() * 300) * k), ranchos: Math.round((5 + rnd() * 50) * k), people: Math.round((10 + rnd() * 80) * k) })).sort((a, b) => b.searches - a.searches);
  const gender = [{ gender: 'feminino', people: Math.round(620 * k), ranchos: Math.round(168 * k), adds: Math.round(2210 * k) },
    { gender: 'masculino', people: Math.round(410 * k), ranchos: Math.round(92 * k), adds: Math.round(1180 * k) },
    { gender: 'outro', people: Math.round(18 * k), ranchos: Math.round(4 * k), adds: Math.round(60 * k) }].filter((g) => g.people >= 5);
  const age = [['18-24', 140], ['25-34', 390], ['35-44', 330], ['45-59', 210], ['60+', 70]].map(([a, n]) => ({ age_band: a, people: Math.round(n * k), ranchos: Math.round(n * 0.3 * k) }));
  const hours = [];
  for (let d = 0; d < 7; d++) for (let h = 6; h < 24; h++) {
    const peak = Math.exp(-((h - 19) ** 2) / 8) * 1.0 + Math.exp(-((h - 11) ** 2) / 6) * 0.55 + (d === 0 || d === 6 ? 0.35 : 0);
    hours.push({ dow: d, h, n: Math.round(peak * 60 * k * (0.7 + rnd() * 0.6)) });
  }
  const daily = [];
  for (let i = days - 1; i >= 0; i--) {
    const dt = new Date(Date.now() - i * 864e5); const wk = [0, 6].includes(dt.getDay()) ? 1.35 : 1;
    const g = 1 + (days - i) / days * 0.25;
    daily.push({ d: dt.toISOString().slice(0, 10), searches: Math.round(150 * wk * g * (0.8 + rnd() * 0.4)), views: Math.round(70 * wk * g * (0.8 + rnd() * 0.4)),
      adds: Math.round(26 * wk * g * (0.8 + rnd() * 0.4)), routes: Math.round(9 * wk * g * (0.7 + rnd() * 0.6)) });
  }
  const sum = (key) => daily.reduce((s, x) => s + x[key], 0);
  const opportunities = cat.filter((r) => r.min_other != null && r.price > r.min_other).map((r) => ({ id: r.product_id, name: r.name, brand: r.brand, unit: r.unit, emoji: r.emoji,
    my_price: r.price, best: r.min_other, gap: Math.round((r.price - r.min_other) * 100) / 100, demand: Math.round((20 + rnd() * 160) * k) }))
    .sort((a, b) => b.demand - a.demand).slice(0, 12);
  const pr = demoState().promos.filter((p) => p.supermarket_id === mid && p.active && new Date(p.ends_at) > Date.now()).map((p) => {
    const prod = [...DEMO.products, ...demoState().newProducts].find((x) => x.id === p.product_id);
    return { ...p, name: prod?.name, emoji: prod?.emoji, views: Math.round(40 + rnd() * 200), adds: Math.round(10 + rnd() * 60) };
  });
  const ranchos = Math.round(640 * k);
  const myBest = ranking.find((r) => r.id === mid);
  return {
    period_days: days, demo: true,
    kpis: { searches: sum('searches'), searches_prev: Math.round(sum('searches') * 0.86), people: Math.round(1080 * k), people_prev: Math.round(950 * k),
      views: sum('views'), adds: sum('adds'), routes: sum('routes'), routes_prev: Math.round(sum('routes') * 0.8), ranchos,
      rancho_wins: Math.round(ranchos * 0.31), visits: Math.round(310 * k), bought: Math.round((myBest?.bought_m || 100) * k), products: cat.length,
      cheapest: cat.filter((r) => r.rank === 1).length, price_index: Math.round(cat.reduce((s, r) => s + (r.avg_other ? r.price / r.avg_other : 1), 0) / Math.max(cat.length, 1) * 1000) / 10,
      promos_live: pr.length },
    top_searches, no_results, top_products, top_brands, top_categories, ranking, zones, neighborhoods, gender, age, hours, daily, opportunities, promos: pr,
  };
}

// ---------------------------------------------------------------- publicidade
export const DEMO_PLANS = [
  { id: 1, name: 'Relâmpago', hours: 6, price: 39, blurb: '6 horas seguidas, ideal para a oferta do dia', active: true, sort: 1 },
  { id: 2, name: 'Diário', hours: 24, price: 89, blurb: '24 horas no ar', active: true, sort: 2 },
  { id: 3, name: 'Fim de semana', hours: 72, price: 199, blurb: '3 dias, de sexta a domingo', active: true, sort: 3 },
  { id: 4, name: 'Semanal', hours: 168, price: 389, blurb: '7 dias no ar', active: true, sort: 4 },
  { id: 5, name: 'Mensal', hours: 720, price: 1190, blurb: '30 dias no ar, o melhor custo por dia', active: true, sort: 5 },
];
export const DEMO_SLOTS = [
  { key: 'home', name: 'Destaque da página inicial', description: 'Logo abaixo da busca, a primeira coisa que as pessoas veem.', multiplier: 1.5, max_concurrent: 1, active: true, sort: 1 },
  { key: 'grid', name: 'Entre os produtos', description: 'Um card de curiosidade no meio da lista de ofertas.', multiplier: 1, max_concurrent: 2, active: true, sort: 2 },
  { key: 'rancho', name: 'Rancho do mês', description: 'No resumo de quem está montando a lista do mês.', multiplier: 1.2, max_concurrent: 1, active: true, sort: 3 },
  { key: 'carrinho', name: 'Carrinho', description: 'Na tela de quem está comprando agora, dentro da loja.', multiplier: 1.3, max_concurrent: 1, active: true, sort: 4 },
  { key: 'fila', name: 'Fila do caixa', description: 'No modo fila, enquanto a pessoa espera para pagar.', multiplier: 0.8, max_concurrent: 2, active: true, sort: 5 },
  { key: 'busca', name: 'Busca patrocinada', description: 'Seu produto no topo quando alguém procura por ele, pela marca, pela categoria ou pelas palavras que você escolher.', multiplier: 1.4, max_concurrent: 3, active: true, sort: 6, smart: true },
  { key: 'troca', name: 'Sugestão na lista', description: 'Quem põe na lista um produto parecido recebe a sugestão de trocar pelo seu, com o seu preço.', multiplier: 1.3, max_concurrent: 2, active: true, sort: 7, smart: true },
  { key: 'recompra', name: 'Hora de repor', description: 'Para quem já comprou esse produto ou um parecido, quando costuma estar acabando. A conta é feita no celular da pessoa.', multiplier: 1.1, max_concurrent: 3, active: true, sort: 8, smart: true },
];
const demoAdState = () => ls.get('tb.adminDemo', null)?.adPlans ? ls.get('tb.adminDemo') : null;

export async function adCatalog() {
  if (MODE === 'demo') { const d = demoAdState(); return { plans: d?.adPlans || DEMO_PLANS, slots: d?.adSlots || DEMO_SLOTS }; }
  const c = await api.sbClient();
  const [p, s] = await Promise.all([c.from('ad_plans').select('*').eq('active', true).order('sort'), c.from('ad_slots').select('*').eq('active', true).order('sort')]);
  if (p.error || s.error) throw new Error((p.error || s.error).message);
  return { plans: p.data.map((x) => ({ ...x, price: Number(x.price) })), slots: s.data.map((x) => ({ ...x, multiplier: Number(x.multiplier) })) };
}

export async function adAvailability(slot, start, end) {
  if (MODE === 'demo') {
    const taken = (demoState().ads || []).filter((a) => a.slot === slot && ['aprovada', 'pendente'].includes(a.status) && new Date(a.starts_at) < end && new Date(a.ends_at) > start).length;
    return { max: (DEMO_SLOTS.find((s) => s.key === slot) || {}).max_concurrent || 1, taken };
  }
  const c = await api.sbClient();
  const { data, error } = await c.rpc('ad_availability', { p_slot: slot, p_start: start.toISOString(), p_end: end.toISOString() });
  if (error) throw new Error(error.message);
  return data;
}

export async function marketAds(mid) {
  if (MODE === 'demo') {
    return (demoState().ads || []).filter((a) => a.supermarket_id === mid).map((a) => ({ ...a, plan_name: DEMO_PLANS.find((p) => p.id === a.plan_id)?.name, slot_name: DEMO_SLOTS.find((s) => s.key === a.slot)?.name,
      views: a.status === 'aprovada' ? 420 : 0, reveals: a.status === 'aprovada' ? 96 : 0, clicks: a.status === 'aprovada' ? 31 : 0, adds: a.status === 'aprovada' && a.target_type === 'product' ? 18 : 0,
      smart: !!DEMO_SLOTS.find((s) => s.key === a.slot)?.smart }));
  }
  const c = await api.sbClient();
  const { data, error } = await c.rpc('market_ads', { p_market: mid });
  if (error) throw new Error(error.message);
  return data;
}

export async function requestAd(p) {
  if (MODE === 'demo') {
    const d = demoState(); d.ads ||= [];
    const { plans, slots } = await adCatalog();
    const plan = plans.find((x) => x.id === p.plan_id); const slot = slots.find((x) => x.key === p.slot);
    const start = new Date(p.starts_at); const end = new Date(start.getTime() + plan.hours * 36e5);
    const av = await adAvailability(p.slot, start, end);
    if (av.taken >= av.max) throw new Error(`O espaço “${slot.name}” já está reservado nesse período. Escolha outro horário ou outro espaço.`);
    d.ads.unshift({ ...p, id: (d.nextAd = (d.nextAd || 100) + 1), starts_at: start.toISOString(), ends_at: end.toISOString(), price: Math.round(plan.price * slot.multiplier),
      status: 'pendente', paid: false, created_at: new Date().toISOString() });
    saveDemo(d); return;
  }
  const c = await api.sbClient();
  const { error } = await c.rpc('market_ad_request', { p });
  if (error) throw new Error(error.message);
}

export async function cancelAd(id) {
  if (MODE === 'demo') { const d = demoState(); const a = (d.ads || []).find((x) => x.id === id); if (a) a.status = 'cancelada'; saveDemo(d); return; }
  const c = await api.sbClient();
  const { error } = await c.rpc('market_ad_cancel', { p_id: id });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------- encarte lido pela IA
export async function encarteApply(mid, rows, starts, ends, file) {
  if (MODE === 'demo') return { total: rows.length, prices: rows.filter((r) => !r.preco_de).length, promos: rows.filter((r) => r.preco_de).length, created: rows.filter((r) => !r.product_id).length, errors: [] };
  const c = await api.sbClient();
  const { data, error } = await c.rpc('encarte_apply', { p_market: mid, p_rows: rows, p_starts: starts, p_ends: ends, p_file: file });
  if (error) throw new Error(error.message);
  return data;
}

// ---------------------------------------------------------------- clientes: de onde vêm, loja mais perto, dias (market_customers)
export async function customers(mid, days = 90) {
  if (MODE === 'demo') return demoCustomers(mid, days);
  const c = await api.sbClient();
  const { data, error } = await c.rpc('market_customers', { p_market: mid, p_days: days });
  if (error) { const e = new Error(isMissingFn(error) ? 'Esta análise ainda não foi ativada no banco (rode supabase/atualizacoes/atualizacao-2026-10-sync-clientes-campanhas.sql).' : error.message); e.code = isMissingFn(error) ? 'sem_funcao' : error.code; throw e; }
  return data;
}
async function demoCustomers(mid, days) {
  const { DEMO } = await import('./demo-data.js');
  let seed = 11 + mid * 7 + days;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const stores = DEMO.stores.filter((s) => s.supermarket_id === mid);
  const scale = days / 30;
  const bairros = BAIRROS.map((b) => {
    const near = stores.length ? Math.min(...stores.map((s) => Math.hypot(s.lat - b.lat, s.lng - b.lng))) : 0.1;
    const v = Math.round((40 / (1 + near * 60)) * (0.6 + rnd()) * scale);
    return { name: b.name, zone: b.zone, lat: b.lat, lng: b.lng, visits: v, people: Math.max(0, Math.round(v * 0.55)) };
  }).filter((b) => b.people >= 3).sort((a, b) => b.visits - a.visits);
  const zones = ZONE_NAMES.map((z) => { const xs = bairros.filter((b) => b.zone === z); return { zone: z, visits: xs.reduce((s, b) => s + b.visits, 0), people: xs.reduce((s, b) => s + b.people, 0) }; })
    .filter((z) => z.visits).sort((a, b) => b.visits - a.visits);
  const visits = bairros.reduce((s, b) => s + b.visits, 0);
  const wk = [0.9, 0.55, 0.6, 0.7, 0.75, 1.05, 1.35];
  const weekday = wk.map((w, dow) => ({ dow, visits: Math.round((visits / 6.0) * w * (0.9 + rnd() * 0.2)) }));
  const monthday = Array.from({ length: 31 }, (_, i) => { const d = i + 1; const pay = (d >= 5 && d <= 10) ? 1.7 : (d >= 20 && d <= 22) ? 1.3 : d >= 28 ? 0.7 : 1; return { day: d, visits: Math.round((visits / 31) * pay * (0.8 + rnd() * 0.4)) }; });
  const hours = Array.from({ length: 15 }, (_, i) => { const h = i + 7; const k = h >= 17 && h <= 19 ? 1.8 : h >= 10 && h <= 12 ? 1.2 : 0.6; return { h, visits: Math.round((visits / 15) * k * (0.85 + rnd() * 0.3)) }; });
  const known = Math.round(visits * 0.62);
  return {
    visits, people: Math.round(visits * 0.48), fans: Math.round(visits * 0.3),
    bairros, zones, weekday, monthday, hours,
    nearest: { known, own_nearest: Math.round(known * 0.58), any_nearest: Math.round(known * 0.41), avg_km: Math.round((2.2 + rnd() * 2.5) * 10) / 10, passed_other: Math.round(known * 0.36) },
    stores: stores.map((s, i) => ({ ...s, visits: Math.round(visits * (i === 0 ? 0.45 : 0.55 / Math.max(1, stores.length - 1))) })),
  };
}

// ---------------------------------------------------------------- campanhas (aviso no celular, janela, vitrine)
export async function campaigns(mid) {
  if (MODE === 'demo') return (demoState().campaigns || []).filter((c) => c.supermarket_id === mid);
  const c = await api.sbClient();
  const { data, error } = await c.rpc('campaigns_list', { p_market: mid });
  if (error) { const e = new Error(isMissingFn(error) ? 'As campanhas ainda não foram ativadas no banco (rode supabase/atualizacoes/atualizacao-2026-10-sync-clientes-campanhas.sql).' : error.message); e.code = isMissingFn(error) ? 'sem_funcao' : error.code; throw e; }
  return data;
}
export async function saveCampaign(p) {
  if (MODE === 'demo') {
    const d = demoState(); d.campaigns ||= [];
    const live = d.campaigns.filter((c) => c.supermarket_id === p.supermarket_id && c.status === 'ativa' && new Date(c.ends_at) > new Date());
    if (!p.id && live.length >= 3) throw new Error('Você já tem 3 campanhas ativas. Pause ou encerre uma para criar outra.');
    if (p.id) { const i = d.campaigns.findIndex((c) => c.id === p.id); if (i >= 0) d.campaigns[i] = { ...d.campaigns[i], ...p, updated_at: new Date().toISOString() }; }
    else d.campaigns.unshift({ ...p, id: (d.nextCamp = (d.nextCamp || 500) + 1), status: 'ativa', created_at: new Date().toISOString(), views: 0, clicks: 0, notified: 0, people: 0 });
    saveDemo(d); return p.id || d.nextCamp;
  }
  const c = await api.sbClient();
  const { data, error } = await c.rpc('campaign_save', { p });
  if (error) throw new Error(error.message);
  return data;
}
export async function campaignStatus(id, status) {
  if (MODE === 'demo') {
    const d = demoState(); const x = (d.campaigns || []).find((c) => c.id === id);
    if (status === 'ativa' && (d.campaigns || []).filter((c) => c.supermarket_id === x?.supermarket_id && c.status === 'ativa' && c.id !== id).length >= 3) throw new Error('Já há 3 campanhas ativas. Pause outra antes.');
    if (x) x.status = status; saveDemo(d); return;
  }
  const c = await api.sbClient();
  const { error } = await c.rpc('campaign_status', { p_id: id, p_status: status });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------- datas especiais: o mercado escolhe os produtos
function demoEvents() {
  const d = demoState();
  if (!d.events) {
    const now = new Date(); const y = now.getFullYear();
    d.events = [
      { slug: `halloween-${y}`, theme: 'halloween', title: 'Halloween do Tá Barato', subtitle: 'Doces, fantasias e festa com preço que não assusta.', banner_text: 'Halloween: doces com preço que não assusta', starts_at: new Date(Date.now() - 2 * 864e5).toISOString(), ends_at: new Date(Date.now() + 6 * 864e5).toISOString(), active: true },
      { slug: `blackfriday-${y}`, theme: 'blackfriday', title: 'Black Friday do Tá Barato', subtitle: 'Os maiores descontos do ano.', banner_text: 'Black Friday: descontos de verdade', starts_at: new Date(y, 10, 20).toISOString(), ends_at: new Date(y, 10, 30, 23, 59).toISOString(), active: true },
    ];
    d.eventProducts = [];
    saveDemo(d);
  }
  return d;
}
export async function marketEvents(mid) {
  if (MODE === 'demo') {
    const d = demoEvents();
    return d.events.filter((e) => e.active && new Date(e.ends_at) > new Date()).map((e) => ({ ...e, items: d.eventProducts.filter((x) => x.event_slug === e.slug && x.supermarket_id === mid).map((x) => ({ product_id: x.product_id, special_price: x.special_price })) }));
  }
  const c = await api.sbClient();
  const { data, error } = await c.rpc('market_events', { p_market: mid });
  if (error) { const e = new Error(isMissingFn(error) ? 'As datas especiais ainda não foram ativadas no banco (rode supabase/atualizacoes/atualizacao-2026-10-datas-especiais.sql).' : error.message); e.code = isMissingFn(error) ? 'sem_funcao' : error.code; throw e; }
  return data;
}
export async function setEventProducts(slug, mid, items) {
  if (MODE === 'demo') {
    const d = demoEvents();
    d.eventProducts = d.eventProducts.filter((x) => !(x.event_slug === slug && x.supermarket_id === mid))
      .concat(items.map((x, i) => ({ event_slug: slug, supermarket_id: mid, product_id: x.product_id, special_price: x.special_price ?? null, sort: i })));
    saveDemo(d); return items.length;
  }
  const c = await api.sbClient();
  const { data, error } = await c.rpc('market_event_products_set', { p_slug: slug, p_market: mid, p_items: items });
  if (error) throw new Error(error.message);
  return data;
}

// ---------------------------------------------------------------- loja online do mercado ("comprar esta lista")
export async function setShopUrl(mid, url) {
  if (MODE === 'demo') { const d = demoState(); d.shopUrls ||= {}; d.shopUrls[mid] = url || null; saveDemo(d); return url; }
  const c = await api.sbClient();
  const { data, error } = await c.rpc('market_set_shop_url', { p_market: mid, p_url: url });
  if (error) throw new Error(isMissingFn(error) ? 'Falta a administração atualizar o banco (atualizacao-2026-10-push-uso-lgpd.sql).' : error.message);
  return data;
}

// ================================================================ VENDAS COMPROVADAS, CUBRA A DIFERENÇA, DEMANDA E QUEIMA
const ATUALIZAR = 'Falta a administração atualizar o banco (supabase/atualizacoes/atualizacao-2026-10-parceiros-vendas.sql).';
async function rpcP(fn, args) {
  const c = await api.sbClient();
  const { data, error } = await c.rpc(fn, args);
  if (error) { const e = new Error(isMissingFn(error) ? ATUALIZAR : error.message); e.code = isMissingFn(error) ? 'sem_funcao' : error.code; throw e; }
  return data;
}
// números simulados estáveis (mesmo resultado a cada abertura da demonstração)
const seeded = (seed) => () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

// ---------------------------------------------------------------- vendas comprovadas com nota
export async function salesProof(mid, days = 30, win = 7) {
  if (MODE !== 'demo') return rpcP('market_sales_proof', { p_market: mid, p_days: days, p_window: win });
  const R = seeded(mid * 31 + days); const k = days / 30;
  const src = [['campanha', 1840, 0.16], ['promocao', 2650, 0.11], ['rota', 610, 0.34], ['publicidade', 980, 0.06], ['cubra', 74, 0.58], ['queima', 260, 0.21]];
  const by = src.map(([s, people, conv]) => {
    const logged = Math.round(people * k * 0.62); const buyers = Math.round(logged * conv); const receipts = Math.round(buyers * 1.25);
    const ticket = s === 'cubra' ? 262 : s === 'queima' ? 96 : 150 + R() * 70; const revenue = Math.round(receipts * ticket * 100) / 100;
    return { src: s, people: Math.round(people * k), logged, buyers, receipts, revenue: buyers < 3 ? null : revenue, ticket: buyers < 3 ? null : Math.round(ticket * 100) / 100 };
  });
  const buyers = by.reduce((s, x) => s + x.buyers, 0), receipts = by.reduce((s, x) => s + x.receipts, 0), revenue = by.reduce((s, x) => s + (x.revenue || 0), 0);
  const logged = by.reduce((s, x) => s + x.logged, 0);
  const camps = (demoState().campaigns || []).filter((c) => c.supermarket_id === mid);
  const names = camps.length ? camps : [{ id: 1, title: 'Terça do hortifrúti', kind: 'aviso' }, { id: 2, title: 'Semana da carne', kind: 'janela' }, { id: 3, title: 'Vitrine de limpeza', kind: 'vitrine' }];
  const campaigns = names.slice(0, 5).map((c, i) => {
    const people = Math.round((312 - i * 70) * Math.max(k, 0.4)); const b = Math.round(people * (0.15 - i * 0.025)); const rc = Math.round(b * 1.1);
    return { id: c.id, title: c.title, kind: c.kind, starts_at: c.starts_at || new Date(Date.now() - (6 + i * 7) * 864e5).toISOString(), ends_at: c.ends_at || new Date(Date.now() - i * 7 * 864e5).toISOString(),
      people, logged: Math.round(people * 0.6), buyers: b, receipts: rc, revenue: b < 3 ? null : Math.round(rc * 190.2 * 100) / 100, ticket: b < 3 ? null : 190.2 };
  });
  const daily = Array.from({ length: Math.min(days, 30) }, (_, i) => { const d = new Date(Date.now() - (Math.min(days, 30) - 1 - i) * 864e5); const r = Math.round(receipts / Math.min(days, 30) * (0.6 + R() * 0.8));
    return { d: d.toISOString().slice(0, 10), receipts: r, revenue: Math.round(r * (revenue / Math.max(receipts, 1)) * 100) / 100 }; });
  const promos = [{ promo_id: 1, kind: 'exclusiva', code: 'TABARATO', product: 'Óleo de soja Soya 900 ml', receipts: 58, buyers: 51, units: 96, value: 691.2 },
    { promo_id: 2, kind: 'geral', code: null, product: 'Arroz Tio João 5 kg', receipts: 41, buyers: 39, units: 44, value: 1183.6 },
    { promo_id: 3, kind: 'exclusiva', code: 'TABARATO', product: 'Café Três Corações 500 g', receipts: 23, buyers: 21, units: 31, value: 495.69 }];
  return { days, window: win, hidden: false, demo: true,
    totals: { people: by.reduce((s, x) => s + x.people, 0), logged, buyers, receipts, revenue, ticket: Math.round(revenue / Math.max(receipts, 1) * 100) / 100,
      conv: Math.round(buyers / Math.max(logged, 1) * 1000) / 10, ctrl_conv: 4.8, all_receipts: Math.round(receipts * 2.6), all_revenue: Math.round(revenue * 2.4) },
    by_source: by.sort((a, b) => (b.revenue || 0) - (a.revenue || 0)), campaigns, promos, daily };
}

// ---------------------------------------------------------------- cubra a diferença
const COVER_DEFAULT = { active: false, max_diff: 20, min_total: 150, budget_month: 500, extra: 1, valid_days: 4, min_spend_pct: 80 };
export async function coverGet(mid) {
  if (MODE !== 'demo') return rpcP('market_cover_get', { p_market: mid });
  const d = demoState(); const rules = { supermarket_id: mid, ...COVER_DEFAULT, ...(d.cover?.[mid] || {}) };
  const R = seeded(mid + 7); const coupons = (d.coverCoupons ||= Array.from({ length: 14 }, (_, i) => {
    const diff = Math.round((3 + R() * 16) * 100) / 100; const st = i < 5 ? 'usado' : i < 8 ? 'aceito' : i < 10 ? 'expirado' : 'oferta';
    return { id: 700 + i, code: ['usado', 'aceito'].includes(st) ? 'TB' + (4821 + i * 37).toString(36).toUpperCase().padStart(6, '7') : null, value: Math.ceil(diff) + 1, diff,
      my_total: Math.round((210 + R() * 180) * 100) / 100, min_spend: 0, status: st, created_at: new Date(Date.now() - i * 1.7 * 864e5).toISOString(),
      expires_at: new Date(Date.now() + (3 - i) * 864e5).toISOString(), used_at: st === 'usado' ? new Date(Date.now() - i * 864e5).toISOString() : null, used_via: st === 'usado' ? (i % 2 ? 'nota' : 'caixa') : null,
      best_name: ['Nova Era', 'Supermercados DB', 'Veneza'][i % 3] };
  }));
  coupons.forEach((c) => { c.min_spend = Math.round(c.my_total * (rules.min_spend_pct / 100) * 100) / 100; });
  saveDemo(d);
  const used = coupons.filter((c) => c.status === 'usado'); const acc = coupons.filter((c) => ['usado', 'aceito'].includes(c.status));
  return { enabled: true, partner: true, rules, spent: acc.reduce((s, c) => s + c.value, 0), recent: coupons, demo: true,
    month: { offers: coupons.length, accepted: acc.length, used: used.length, used_value: used.reduce((s, c) => s + c.value, 0),
      pending_value: coupons.filter((c) => c.status === 'aceito').reduce((s, c) => s + c.value, 0),
      receipts_value: used.reduce((s, c) => s + c.my_total * 1.04, 0), ranchos_value: used.reduce((s, c) => s + c.my_total, 0),
      avg_diff: Math.round(coupons.reduce((s, c) => s + c.diff, 0) / coupons.length * 100) / 100 } };
}
export async function coverSave(mid, rules) {
  if (MODE !== 'demo') return rpcP('market_cover_save', { p_market: mid, p: rules });
  const d = demoState(); d.cover ||= {}; d.cover[mid] = { ...COVER_DEFAULT, ...rules }; saveDemo(d); return d.cover[mid];
}
export async function coverRedeem(mid, code, total) {
  if (MODE !== 'demo') return rpcP('market_cover_redeem', { p_market: mid, p_code: code, p_total: total ?? null });
  const d = demoState(); const c = (d.coverCoupons || []).find((x) => x.code === String(code).trim().toUpperCase());
  if (!c) throw new Error('Cupom não encontrado para o seu supermercado.');
  if (c.status === 'usado') throw new Error('Este cupom já foi usado.');
  if (c.status !== 'aceito') throw new Error('Este cupom não foi ativado pela pessoa.');
  if (total != null && total < c.min_spend) throw new Error(`A compra mínima para este cupom é ${c.min_spend.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`);
  Object.assign(c, { status: 'usado', used_at: new Date().toISOString(), used_via: 'caixa' }); saveDemo(d);
  return { value: c.value, code: c.code, min_spend: c.min_spend };
}

// ---------------------------------------------------------------- previsão de demanda
export async function demand(mid) {
  if (MODE !== 'demo') return rpcP('market_demand', { p_market: mid, p_limit: 40 });
  const cat = await demoCatalog(mid); const R = seeded(mid * 13);
  const products = cat.filter((p) => p.active).slice(0, 60).map((p) => {
    const n = Math.round(40 + R() * 1160); const considered = Math.round(n * (0.7 + R() * 0.25));
    const others = p.min_other ?? p.price * (0.95 + R() * 0.1);
    // preço a bater de cada lista: em volta do menor preço dos outros (cada pessoa compara mercados diferentes)
    const steps = [-0.4, -0.2, -0.1, 0, 0.1, 0.25, 0.5].map((dx) => Math.max(0.5, Math.round((others + dx) * 100) / 100));
    const w = [0.08, 0.14, 0.2, 0.26, 0.14, 0.1, 0.08]; const free = Math.round(considered * 0.04);
    const beats = steps.map((b, i) => [b, Math.round((considered - free) * w[i])]).filter((x) => x[1] > 0).sort((a, b) => b[0] - a[0]);
    const wins = free + beats.filter(([b]) => p.price <= b).reduce((s, [, c]) => s + c, 0);
    return { product_id: p.product_id, name: p.name, brand: p.brand, unit: p.unit, emoji: p.emoji, image_url: p.image_url, my_price: p.price, min_other: p.min_other,
      min_other_name: p.min_other != null ? 'Nova Era' : null, n_lists: n, units: Math.round(n * 1.4), n_considered: considered, wins, free, n_watch: Math.round(n * 0.18), beats };
  }).sort((a, b) => b.n_lists + b.n_watch - (a.n_lists + a.n_watch)).slice(0, 40);
  return { lists: 1840, products, missing: [{ product_id: 0, name: 'Leite condensado Moça', brand: 'Nestlé', unit: '395 g', n_lists: 212 }], demo: true };
}

// ---------------------------------------------------------------- queima de perecíveis
export async function clearanceList(mid) {
  if (MODE !== 'demo') return rpcP('market_clearance_list', { p_market: mid });
  const d = demoState();
  d.clearance ||= [{ id: 1, supermarket_id: mid, store_id: null, product_id: null, category_slug: 'laticinios', title: 'Iogurte natural 170 g', note: 'Gôndola de refrigerados, perto do caixa 3',
    regular_price: 4.29, price: 2.49, qty: 60, expires_on: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10), ends_at: new Date(Date.now() + 2 * 864e5).toISOString(),
    radius_km: 2, status: 'ativa', claims: 37, notified: 412, created_at: new Date(Date.now() - 864e5).toISOString(), views: 655, proven_units: 41 },
    { id: 2, supermarket_id: mid, store_id: null, product_id: null, category_slug: 'hortifruti', title: 'Banana prata (kg)', note: null, regular_price: 6.99, price: 3.49, qty: 80,
    expires_on: new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10), ends_at: new Date(Date.now() - 3 * 864e5).toISOString(), radius_km: 3, status: 'esgotada', claims: 58, notified: 530,
    created_at: new Date(Date.now() - 5 * 864e5).toISOString(), views: 890, proven_units: 74 }];
  saveDemo(d);
  return d.clearance.filter((c) => c.supermarket_id === mid || c.supermarket_id == null).map((c) => ({ ...c, live: c.status === 'ativa' && new Date(c.ends_at) > Date.now(),
    pct: Math.round(100 * (1 - c.price / c.regular_price)) }));
}
export async function clearanceSave(p) {
  if (MODE !== 'demo') return rpcP('market_clearance_save', { p });
  if (!(Number(p.price) < Number(p.regular_price))) throw new Error('O preço da queima tem que ser menor que o normal.');
  const d = demoState(); d.clearance ||= [];
  const ends = p.ends_at || `${p.expires_on}T21:00:00-04:00`;
  if (p.id) { const x = d.clearance.find((c) => c.id === p.id); Object.assign(x, p, { ends_at: ends }); }
  else d.clearance.unshift({ ...p, id: (d.nextClear = (d.nextClear || 100) + 1), ends_at: ends, status: 'ativa', claims: 0, notified: 0, views: 0, proven_units: 0, created_at: new Date().toISOString() });
  saveDemo(d); return p.id || d.nextClear;
}
export async function clearanceStatus(id, status) {
  if (MODE !== 'demo') return rpcP('market_clearance_status', { p_id: id, p_status: status });
  const d = demoState(); const x = (d.clearance || []).find((c) => c.id === id); if (x) x.status = status; saveDemo(d);
}
