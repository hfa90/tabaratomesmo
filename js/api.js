// Camada de dados: Supabase (produção) com fallback para dados de demonstração.
import { CONFIG } from './config.js';
import * as off from './offline.js';

let sb = null;
export let MODE = 'live'; // 'live' | 'demo' | 'offline' (sem internet, usando a cópia salva no aparelho)

async function client() {
  if (sb) return sb;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
  sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return sb;
}

const withTimeout = (p, ms = 8000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

// ---------------------------------------------------------------- catálogo
export async function loadCatalog() {
  // sem internet: usa na hora a última cópia salva, sem esperar o tempo limite
  if (!navigator.onLine) { const saved = await fromSaved(); if (saved) return saved; }
  try {
    const c = await withTimeout(client());
    const [m, s, cat, p] = await withTimeout(Promise.all([
      c.from('supermarkets').select('*').eq('active', true).order('id'),
      c.from('stores').select('*').order('id'),
      c.from('categories').select('*').order('sort'),
      c.from('v_products').select('*'),
    ]));
    const err = m.error || s.error || cat.error || p.error;
    if (err) throw err;
    if (!p.data.length) throw new Error('sem produtos');
    MODE = 'live';
    const active = new Set(m.data.map((x) => x.id));
    const out = { supermarkets: m.data, stores: s.data.filter((x) => active.has(x.supermarket_id)), categories: cat.data, products: p.data.map(normalize) };
    off.save('catalog', out); off.setSavedAt(new Date().toISOString());
    return out;
  } catch (e) {
    const saved = await fromSaved(); if (saved) return saved;
    if (!CONFIG.DEMO_FALLBACK) throw e;
    console.warn('[TáBarato] usando dados de demonstração:', e.message || e);
    MODE = 'demo';
    const { DEMO } = await import('./demo-data.js');
    return { ...DEMO, products: applyPortalDemo(buildDemoProducts(DEMO)) };
  }
}

async function fromSaved() {
  const r = await off.read('catalog');
  if (!r?.value?.products?.length) return null;
  MODE = 'offline'; off.setSavedAt(r.at, true);
  console.warn('[TáBarato] sem conexão: usando os preços salvos em', r.at);
  return r.value;
}

function normalize(p) {
  return {
    ...p,
    min_price: Number(p.min_price),
    max_price: Number(p.max_price),
    change_pct: p.change_pct == null ? null : Number(p.change_pct),
    prices: (p.prices || [])
      .map((x) => ({ market_id: x.market_id, price: Number(x.price), regular: x.regular == null ? null : Number(x.regular), prev: x.prev == null ? null : Number(x.prev), at: x.at, src: x.src, promo: x.promo || null }))
      .sort((a, b) => a.price - b.price),
  };
}

// Em modo demonstração, o portal dos mercados grava no aparelho (tb.portalDemo);
// aplicamos aqui para o site refletir produtos, fotos e promoções criados lá.
function applyPortalDemo(products) {
  const d = ls.get('tb.portalDemo', null);
  if (!d) return products;
  const now = Date.now();
  for (const np of d.newProducts || []) if (!products.some((p) => p.id === np.id)) products.push({ ...np, prices: [] });
  for (const p of products) {
    for (const [k, v] of Object.entries(d.listings || {})) {
      const [mid, pid] = k.split(':').map(Number);
      if (pid !== p.id) continue;
      let x = p.prices.find((y) => y.market_id === mid);
      if (v.active === false) { p.prices = p.prices.filter((y) => y.market_id !== mid); continue; }
      if (v.price != null) { if (!x) { x = { market_id: mid, prev: null }; p.prices.push(x); } x.price = v.price; x.at = v.at || new Date().toISOString(); }
      if (v.photo) p.photo = v.photo;
    }
    for (const pr of d.promos || []) {
      if (pr.product_id !== p.id || !pr.active || new Date(pr.ends_at) < now || new Date(pr.starts_at) > now) continue;
      const x = p.prices.find((y) => y.market_id === pr.supermarket_id);
      if (x && pr.promo_price < x.price) { x.regular = x.price; x.price = pr.promo_price; x.promo = { kind: pr.kind, code: pr.code, ends: pr.ends_at }; }
    }
    p.prices.sort((a, b) => a.price - b.price);
    if (p.prices.length) { p.min_price = p.prices[0].price; p.max_price = p.prices[p.prices.length - 1].price; p.updated_at ||= p.prices[0].at; }
  }
  return products.filter((p) => p.prices.length);
}

// Reproduz a view v_products em JS
function buildDemoProducts(D) {
  const byKey = new Map();
  for (const [pid, mid, price, days] of D.prices) {
    const k = pid + ':' + mid;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push({ price, days });
  }
  const now = Date.now();
  return D.products.map((p) => {
    const prices = [];
    for (const m of D.supermarkets) {
      const rows = byKey.get(p.id + ':' + m.id);
      if (!rows) continue;
      rows.sort((a, b) => a.days - b.days);
      const latest = rows[0];
      const past = rows.find((r) => r.days >= 7);
      prices.push({ market_id: m.id, price: latest.price, prev: past ? past.price : null, at: new Date(now - latest.days * 864e5).toISOString() });
    }
    prices.sort((a, b) => a.price - b.price);
    const withPrev = prices.filter((x) => x.prev != null);
    const avg = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
    const change = withPrev.length ? Math.round((avg(withPrev.map((x) => x.price)) / avg(withPrev.map((x) => x.prev)) - 1) * 1000) / 10 : null;
    return {
      ...p,
      min_price: prices[0].price,
      max_price: prices[prices.length - 1].price,
      updated_at: prices[0].at,
      change_pct: change,
      prices,
    };
  });
}

export async function priceHistory(productId, days = 30) {
  if (MODE === 'demo') {
    const { DEMO } = await import('./demo-data.js');
    return DEMO.prices
      .filter((r) => r[0] === productId && r[3] <= days)
      .map(([, mid, price, d]) => ({ market_id: mid, price, t: Date.now() - d * 864e5 }));
  }
  const c = await client();
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const { data, error } = await c.from('prices').select('supermarket_id, price, collected_at')
    .eq('product_id', productId).gte('collected_at', since).order('collected_at');
  if (error) throw error;
  return data.map((r) => ({ market_id: r.supermarket_id, price: Number(r.price), t: new Date(r.collected_at).getTime() }));
}

export async function onNewPrice(cb) {
  if (MODE !== 'live') return;
  const c = await client();
  c.channel('prices-feed')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'prices' }, (payload) => cb(payload.new))
    .subscribe();
}

// ---------------------------------------------------------------- autenticação
// Em modo demonstração, a conta fica só no navegador para permitir testar o fluxo.
const DEMO_KEY = 'tb.demoUser';
// toda gravação passa por aqui: o sync.js é avisado para levar a mudança aos outros aparelhos da conta
let writeHook = null;
export function onStoreWrite(fn) { writeHook = fn; }
const ls = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} writeHook?.(k, v); },
  del(k) { try { localStorage.removeItem(k); } catch {} writeHook?.(k, null); },
};
export const store = ls;

const authListeners = new Set();
export function onAuth(cb) { authListeners.add(cb); }
const emitAuth = (u) => authListeners.forEach((cb) => cb(u));

export async function initAuth() {
  if (MODE === 'demo') { emitAuth(ls.get(DEMO_KEY)); return; }
  try {
    const c = await client();
    const { data } = await c.auth.getSession();
    emitAuth(data.session?.user ?? null);
    c.auth.onAuthStateChange((_e, session) => emitAuth(session?.user ?? null));
  } catch (e) { console.warn('[TáBarato] conta indisponível agora', e); emitAuth(null); }
}

/** página que recebe os links dos e-mails (auth.html), no mesmo endereço do site */
export const authPage = (flow) => new URL(`auth.html?flow=${flow}`, location.href.split('#')[0]).href;

export async function signUp({ name, email, password }) {
  if (MODE === 'demo') {
    const u = { id: 'demo', email, user_metadata: { full_name: name } };
    ls.set(DEMO_KEY, u);
    ls.set('tb.demoProfile', { id: 'demo', full_name: name, comparisons_used: 0, completed_at: null });
    emitAuth(u);
    return { user: u, needsConfirm: false };
  }
  const c = await client();
  const { data, error } = await c.auth.signUp({
    email, password,
    options: { data: { full_name: name }, emailRedirectTo: authPage('signup') },
  });
  if (error) throw error;
  return { user: data.user, needsConfirm: !data.session };
}

export async function signIn({ email, password }) {
  if (MODE === 'demo') {
    const u = ls.get(DEMO_KEY);
    if (!u || u.email !== email) throw new Error('Conta não encontrada neste aparelho (modo demonstração).');
    emitAuth(u); return u;
  }
  const c = await client();
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

export async function resetPassword(email) {
  if (MODE === 'demo') return;
  const c = await client();
  const { error } = await c.auth.resetPasswordForEmail(email, { redirectTo: authPage('recovery') });
  if (error) throw error;
}

/** código de 8 números do e-mail de redefinição: abre a conta e manda para a tela de nova senha */
export async function verifyRecoveryCode(email, code) {
  const c = await client();
  const { error } = await c.auth.verifyOtp({ email, token: code, type: 'recovery' });
  if (error) throw error;
}

export async function signOut() {
  if (MODE === 'demo') { ls.del(DEMO_KEY); ls.del('tb.demoProfile'); emitAuth(null); return; }
  const c = await client();
  await c.auth.signOut();
}

export async function getProfile() {
  if (MODE === 'demo') return ls.get('tb.demoProfile');
  const c = await client();
  const { data, error } = await c.from('profiles').select('*').maybeSingle();
  if (error) throw error;
  return data;
}

export async function completeProfile(f) {
  if (MODE === 'demo') {
    const p = { ...ls.get('tb.demoProfile'), ...f, completed_at: new Date().toISOString() };
    ls.set('tb.demoProfile', p); return p;
  }
  const c = await client();
  const args = {
    p_full_name: f.full_name, p_phone: f.phone, p_birth_date: f.birth_date,
    p_neighborhood: f.neighborhood, p_cep: f.cep || null,
    p_preferred_markets: f.preferred_markets || [], p_accepts_offers: !!f.accepts_offers,
  };
  let { data, error } = await c.rpc('complete_profile', { ...args, p_gender: f.gender || null });
  // banco ainda sem a versão nova da função (sem p_gender): tenta a antiga
  if (error && /p_gender|PGRST202|function/i.test(error.message + error.code)) ({ data, error } = await c.rpc('complete_profile', args));
  if (error) throw error;
  return data;
}

export async function registerComparison() {
  if (MODE === 'demo') {
    const p = ls.get('tb.demoProfile');
    if (p.completed_at) return { allowed: true, completed: true };
    const limit = CONFIG.QUICK_COMPARISONS + 2 * ls.get('tb.demoReports', []).length;
    if (p.comparisons_used >= limit) return { allowed: false, completed: false, used: p.comparisons_used, limit };
    p.comparisons_used++; ls.set('tb.demoProfile', p);
    return { allowed: true, completed: false, used: p.comparisons_used, limit };
  }
  const c = await client();
  const { data, error } = await c.rpc('register_comparison');
  if (error) throw error;
  return data;
}

export async function reportPrice({ product_id, supermarket_id, price, note, lat, lng }) {
  if (MODE === 'demo') {
    const reps = ls.get('tb.demoReports', []);
    const { DEMO } = await import('./demo-data.js');
    const near = lat != null && DEMO.stores.some((s) => s.supermarket_id === supermarket_id && kmBetween(lat, lng, s.lat, s.lng) <= 0.5);
    const last = DEMO.prices.filter((r) => r[0] === product_id && r[1] === supermarket_id).sort((a, b) => a[3] - b[3])[0];
    if (last && (price < last[2] * 0.4 || price > last[2] * 2.5)) throw new Error(`Esse valor está muito diferente do último preço registrado (R$ ${last[2].toFixed(2).replace('.', ',')}). Confira e tente de novo.`);
    const points = 10 + (near ? 5 : 0) + (!last || last[3] > 3 ? 5 : 0) + (!last ? 10 : 0);
    const row = { product_id, supermarket_id, price, at_store: near, points, status: 'pendente', created_at: new Date().toISOString() };
    reps.push(row); ls.set('tb.demoReports', reps);
    return row;
  }
  const row = { product_id, supermarket_id, price, note: note || null, lat: lat ?? null, lng: lng ?? null };
  const queued = { status: 'fila', points: 0, at_store: false, queued: true };
  if (MODE === 'offline' || !navigator.onLine) { await off.queue('report', row); return queued; }
  try { return await reportLive(row); }
  catch (e) { if (off.isNetworkError(e)) { await off.queue('report', row); return queued; } throw e; }
}
async function reportLive(row) {
  const c = await client();
  const { data, error } = await c.from('price_reports').insert(row).select('status, points, at_store').single();
  if (error) throw error;
  return data;
}

const kmBetween = (lat1, lng1, lat2, lng2) => {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

// ---------------------------------------------------------------- colaboração
export async function reportTargets(marketId, limit = 6) {
  if (MODE === 'demo') {
    const { DEMO } = await import('./demo-data.js');
    const mine = new Set(ls.get('tb.demoReports', []).filter((r) => r.supermarket_id === marketId).map((r) => r.product_id));
    return DEMO.products.filter((p) => !mine.has(p.id)).map((p) => {
      const last = DEMO.prices.filter((r) => r[0] === p.id && r[1] === marketId).sort((a, b) => a[3] - b[3])[0];
      return { product_id: p.id, last_price: last ? last[2] : null, last_at: last ? new Date(Date.now() - last[3] * 864e5).toISOString() : null, demand: 0, age: last ? last[3] : 999 };
    }).sort((a, b) => b.age - a.age || Math.random() - 0.5).slice(0, limit);
  }
  const c = await client();
  const { data, error } = await c.rpc('report_targets', { p_market: marketId, p_limit: limit });
  if (error) throw error;
  return data.map((r) => ({ ...r, last_price: r.last_price == null ? null : Number(r.last_price) }));
}

export async function myImpact() {
  if (MODE === 'demo') {
    const reps = ls.get('tb.demoReports', []);
    const pts = reps.reduce((s, r) => s + r.points, 0);
    return { reports: reps.length, approved: 0, points: pts, month_points: pts, helped: 0, rank: 1 };
  }
  const c = await client();
  const { data, error } = await c.rpc('my_impact');
  if (error) throw error;
  return data;
}

export async function leaderboard(neighborhood = null) {
  if (MODE === 'demo') {
    const reps = ls.get('tb.demoReports', []);
    const p = ls.get('tb.demoProfile');
    if (!reps.length || !p) return [];
    const [a, b] = (p.full_name || 'Você').split(' ');
    return [{ name: `${a} ${b ? b[0] + '.' : ''}`.trim(), neighborhood: p.neighborhood || '', points: reps.reduce((s, r) => s + r.points, 0), reports: reps.length, is_me: true }];
  }
  const c = await client();
  const { data, error } = await c.rpc('leaderboard', { p_neighborhood: neighborhood, p_limit: 10 });
  if (error) throw error;
  return data;
}

export async function communityStats() {
  if (MODE === 'demo') return { reports_7d: ls.get('tb.demoReports', []).length, contributors_30d: ls.get('tb.demoReports', []).length ? 1 : 0, community_prices: 0 };
  const c = await client();
  const { data, error } = await c.rpc('community_stats');
  if (error) throw error;
  return data;
}

// Preço médio das proteínas por dia da semana
export async function proteinWeekday() {
  if (MODE === 'demo') {
    const { DEMO } = await import('./demo-data.js');
    const carnes = new Set(DEMO.products.filter((p) => p.category_slug === 'carnes').map((p) => p.id));
    const groups = new Map(), means = new Map();
    for (const [pid, mid, price, days] of DEMO.prices) {
      if (!carnes.has(pid)) continue;
      const dow = new Date(Date.now() - days * 864e5 - 3 * 36e5).getDay();
      const k = `${pid}:${mid}:${dow}`, km_ = `${pid}:${mid}`;
      (groups.get(k) || groups.set(k, []).get(k)).push(price);
      (means.get(km_) || means.set(km_, []).get(km_)).push(price);
    }
    const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    return [...groups].map(([k, arr]) => {
      const [pid, mid, dow] = k.split(':').map(Number);
      const a = avg(arr), m = avg(means.get(`${pid}:${mid}`));
      return { product_id: pid, market_id: mid, dow, avg_price: Math.round(a * 100) / 100, idx: Math.round((a / m - 1) * 1000) / 10, samples: arr.length };
    });
  }
  const c = await client();
  const { data, error } = await c.from('v_protein_weekday').select('*');
  if (error) throw error;
  return data.map((r) => ({ product_id: r.product_id, market_id: r.supermarket_id, dow: r.dow, avg_price: Number(r.avg_price), idx: Number(r.idx), samples: r.samples }));
}

// ---------------------------------------------------------------- rancho (lista mensal)
// geração das listas: muda quando a pessoa zera o histórico (supabase/atualizacao-2026-10-zerar-historico.sql).
// null = banco sem a coluna ainda (comportamento antigo)
let listGen = null;
export function setListGen(g) { listGen = Number.isFinite(Number(g)) ? Number(g) : null; }

export async function loadRancho(month) {
  if (MODE === 'demo') return null;
  const c = await client();
  let q = c.from('shopping_lists')
    .select('id, name, month, status, completed_at, shopping_list_items(product_id, qty, checked)')
    .eq('month', month + '-01');
  if (listGen != null) q = q.eq('gen', listGen);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveRancho(meta, items) {
  if (MODE === 'demo') return;
  const c = await client();
  const row = {
    month: meta.month + '-01', name: meta.name, status: meta.status,
    completed_at: meta.completedAt || null, best_market: meta.bestMarket || null,
    best_total: meta.bestTotal || null, savings: meta.savings ?? null, updated_at: new Date().toISOString(),
  };
  const extra = { base_total: meta.baseTotal ?? null, items_count: items.length, bought_market: meta.bought ?? null, spent: meta.spent ?? null };
  if (listGen != null) row.gen = listGen;
  const conflict = listGen != null ? 'user_id,month,gen' : 'user_id,month';
  let { data: list, error } = await c.from('shopping_lists').upsert({ ...row, ...extra }, { onConflict: conflict }).select('id').single();
  // banco sem as colunas novas: grava só o básico
  if (error && /column|PGRST204/i.test(error.message + error.code)) ({ data: list, error } = await c.from('shopping_lists').upsert(row, { onConflict: conflict }).select('id').single());
  if (error) throw error;
  await c.from('shopping_list_items').delete().eq('list_id', list.id);
  if (items.length) {
    const { error: e2 } = await c.from('shopping_list_items')
      .insert(items.map((i) => ({ list_id: list.id, product_id: i.product_id, qty: i.qty, checked: !!i.checked })));
    if (e2) throw e2;
  }
}

export async function updateProfile(fields) {
  if (MODE === 'demo') { ls.set('tb.demoProfile', { ...ls.get('tb.demoProfile'), ...fields }); return; }
  const c = await client();
  const { data: u } = await c.auth.getUser();
  if (!u.user) return;
  const { error } = await c.from('profiles').update(fields).eq('id', u.user.id);
  if (error) throw error;
}

export async function loadFavorites() {
  if (MODE === 'demo') return ls.get('tb.favs', []);
  const c = await client();
  const { data, error } = await c.from('favorites').select('product_id');
  if (error) return [];
  return data.map((r) => r.product_id);
}

export async function toggleFavorite(userId, productId, on) {
  if (MODE === 'demo') {
    const f = new Set(ls.get('tb.favs', []));
    on ? f.add(productId) : f.delete(productId);
    ls.set('tb.favs', [...f]); return;
  }
  const c = await client();
  if (on) await c.from('favorites').insert({ user_id: userId, product_id: productId });
  else await c.from('favorites').delete().eq('product_id', productId);
}

// ---------------------------------------------------------------- métricas de uso (anônimas)
export async function track(events) {
  if (MODE === 'demo' || !events.length) return;
  if (MODE === 'offline' || !navigator.onLine) { off.queue('track', events); return; }
  try { await trackLive(events); } catch (e) { if (off.isNetworkError(e)) off.queue('track', events); }
}
async function trackLive(events) {
  const c = await client();
  const { error } = await c.rpc('track', { p_events: events });
  if (error) throw error;
}

// histórico de ranchos do usuário (para a página "Você")
export async function myRanchos() {
  if (MODE === 'demo') return [];
  const c = await client();
  const { data, error } = await c.from('shopping_lists')
    .select('month, name, status, completed_at, best_market, best_total, savings, base_total, bought_market, spent, items_count')
    .match(listGen != null ? { gen: listGen } : {})
    .order('month', { ascending: false }).limit(24);
  if (error) throw error;
  return data;
}

export async function setRanchoBought(month, fields) {
  if (MODE === 'demo') return;
  const c = await client();
  const { error } = await c.from('shopping_lists').update(fields).match({ month: month + '-01', ...(listGen != null ? { gen: listGen } : {}) });
  if (error) throw error;
}

export const sbClient = client;

// ---------------------------------------------------------------- configurações do administrador
export async function loadSettings() {
  if (MODE === 'demo') return ls.get('tb.adminDemo', null)?.settings || {};
  if (MODE === 'offline') return (await off.read('settings'))?.value || {};
  try {
    const c = await client();
    const { data, error } = await c.from('app_settings').select('key, value');
    if (error) return {};
    const out = Object.fromEntries(data.map((r) => [r.key, r.value]));
    off.save('settings', out);
    return out;
  } catch { return (await off.read('settings'))?.value || {}; }
}

export async function amIMaster() {
  if (MODE === 'demo') return false;
  const c = await client();
  const { data, error } = await c.rpc('am_i_master');
  return !error && !!data;
}

// ---------------------------------------------------------------- publicidade
export async function adsLive() {
  if (MODE === 'demo') {
    // anúncios de exemplo só na demonstração, para ver como aparecem
    const now = Date.now();
    return [
      { id: -1, slot: 'home', title: 'Qual carne baixou 18% hoje?', teaser: 'Só quem abrir descobre.', body: 'Picanha bovina com preço de atacado até domingo no Baratão da Carne.', image_url: 'assets/logos/baratao-da-carne.png', cta: 'Ver oferta', target_type: 'product', target_value: '15', supermarket_id: 4, market: 'Baratão da Carne', ends_at: new Date(now + 864e5).toISOString() },
      { id: -2, slot: 'grid', title: 'O café da manhã ficou mais barato', teaser: 'Adivinha onde?', body: 'Café, leite e pão com 10% de desconto pelo Tá Barato Mesmo? no Coema.', image_url: 'assets/logos/coema.png', cta: 'Conhecer', target_type: 'store', target_value: '5', supermarket_id: 5, market: 'Coema', ends_at: new Date(now + 864e5).toISOString() },
      { id: -3, slot: 'fila', title: 'Já pensou no jantar de hoje?', teaser: 'Tem surpresa no Nova Era.', body: 'Tambaqui fresco a R$ 19,90 o quilo até as 22h.', image_url: 'assets/logos/nova-era.png', cta: 'Ver oferta', target_type: 'product', target_value: '21', supermarket_id: 1, market: 'Nova Era', ends_at: new Date(now + 864e5).toISOString() },
      { id: -4, slot: 'carrinho', title: 'Esqueceu alguma coisa?', teaser: 'A gente lembra pra você.', body: 'Leve 3 detergentes Ypê e pague 2 no Veneza.', image_url: 'assets/logos/veneza.png', cta: 'Ver oferta', target_type: 'product', target_value: '40', supermarket_id: 3, market: 'Veneza', ends_at: new Date(now + 864e5).toISOString() },
      { id: -5, slot: 'rancho', title: 'Seu rancho pode sair mais leve', teaser: 'Quer saber como?', body: 'Frete grátis para ranchos acima de R$ 300 no Supermercados DB.', image_url: 'assets/logos/db.png', cta: 'Conhecer', target_type: 'store', target_value: '2', supermarket_id: 2, market: 'Supermercados DB', ends_at: new Date(now + 864e5).toISOString() },
    ];
  }
  try {
    const c = await client();
    const { data, error } = await c.rpc('ads_live');
    return error ? [] : data;
  } catch { return []; }
}

// ---------------------------------------------------------------- dias de desconto (market_deals)
// Exemplos só do modo demonstração, para a tela não ficar vazia.
const DEMO_DEALS = [
  { id: -1, supermarket_id: 1, title: 'Terça do Hortifrúti', weekdays: [2], category_slug: 'hortifruti', payment: null, discount_pct: 15 },
  { id: -2, supermarket_id: 4, title: 'Quinta da Carne', weekdays: [4], category_slug: 'carnes', payment: null, discount_pct: 10 },
  { id: -3, supermarket_id: 5, title: 'Quarta Verde', weekdays: [3], category_slug: 'hortifruti', payment: null, discount_pct: 12 },
  { id: -4, supermarket_id: 5, title: '5% no Pix', weekdays: [], category_slug: null, payment: 'pix', discount_pct: 5 },
  { id: -5, supermarket_id: 2, title: 'Sábado do cartão DB', weekdays: [6], category_slug: null, payment: 'cartao_loja', discount_pct: 8 },
  { id: -6, supermarket_id: 3, title: 'Segunda da Limpeza', weekdays: [1], category_slug: 'limpeza', payment: null, discount_pct: 10 },
];
const normDeal = (d) => ({ ...d, discount_pct: Number(d.discount_pct), weekdays: (d.weekdays || []).map(Number) });
export async function loadDeals() {
  if (MODE === 'offline') return ((await off.read('deals'))?.value || []).map(normDeal);
  if (MODE !== 'live') {
    const mine = ls.get('tb.portalDemo', null)?.deals || [];
    return [...DEMO_DEALS, ...mine].filter((d) => d.active !== false).map(normDeal);
  }
  const c = await client();
  const { data, error } = await c.from('market_deals').select('*').eq('active', true);
  if (error) { if (/market_deals|does not exist|PGRST205/i.test(error.message + error.code)) return []; throw error; }
  off.save('deals', data);
  return data.map(normDeal);
}

// ---------------------------------------------------------------- leitor de código: código ensinado pelo usuário
export async function suggestEan(ean, product_id) {
  if (MODE === 'demo') return;
  if (MODE === 'offline' || !navigator.onLine) { off.queue('ean', { ean, product_id }); return; }
  return eanLive({ ean, product_id });
}
async function eanLive({ ean, product_id }) {
  const c = await client();
  const { data: u } = await c.auth.getUser();
  if (!u.user) return; // sem conta, fica só no aparelho
  const { error } = await c.from('ean_suggestions').insert({ ean, product_id });
  if (error && error.code !== '23505') throw error;
}

// ---------------------------------------------------------------- carrinho: foto da etiqueta
export async function sendShelfPhoto(blob, row) {
  if (MODE === 'demo') { const l = ls.get('tb.demoPhotos', []); l.push({ ...row, at: new Date().toISOString() }); ls.set('tb.demoPhotos', l); return; }
  if (MODE === 'offline' || !navigator.onLine) { await off.queue('photo', { blob, row }); return { queued: true }; }
  try { return await photoLive({ blob, row }); }
  catch (e) { if (off.isNetworkError(e)) { await off.queue('photo', { blob, row }); return { queued: true }; } throw e; }
}
async function photoLive({ blob, row }) {
  const c = await client();
  const { data: u } = await c.auth.getUser();
  if (!u.user) throw new Error('Entre na sua conta para enviar a foto.');
  const path = `${u.user.id}/${Date.now().toString(36)}.webp`;
  const up = await c.storage.from('etiquetas').upload(path, blob, { contentType: 'image/webp', cacheControl: '31536000' });
  if (up.error) throw new Error(up.error.message);
  const photo_url = c.storage.from('etiquetas').getPublicUrl(path).data.publicUrl;
  const { error } = await c.from('shelf_photos').insert({ ...row, photo_url });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------- cupom fiscal (NFC-e)
// O navegador não pode ler a página da Sefaz direto; a função "nfce" do Supabase busca e devolve os itens.
export async function readNfce(url) {
  if (!navigator.onLine) { const e = new Error('offline'); e.code = 'offline'; throw e; }
  const c = await client();
  const { data, error } = await c.functions.invoke('nfce', { body: { url } });
  if (error) {
    let msg = error.message; let code = 'erro';
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; if (j?.code) code = j.code; } catch {}
    if (error.context?.status === 404) code = 'sem_funcao';
    const e = new Error(msg); e.code = code; throw e;
  }
  return data;
}

/** grava a nota no servidor: a função lê a Sefaz de novo e grava os preços (receipt_ingest) */
export async function saveNfce(url, matches, supermarket_id) {
  if (MODE === 'demo') return { saved: { demo: true, points: 20 + 2 * matches.length, prices_added: matches.length, matched: matches.length, market_confirmed: true, supermarket_id } };
  const c = await client();
  const { data, error } = await c.functions.invoke('nfce', { body: { url, save: true, matches, supermarket_id } });
  if (error) {
    let msg = error.message, code = 'erro';
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; if (j?.code) code = j.code; } catch {}
    if (error.context?.status === 404) code = 'sem_funcao';
    throw Object.assign(new Error(msg), { code });
  }
  return data;
}

/** notas enviadas pela pessoa (com os itens) */
export async function myReceipts() {
  if (MODE !== 'live') return [];
  const c = await client();
  const { data, error } = await c.rpc('my_receipts', { p_limit: 100 });
  if (error) { if (/my_receipts|PGRST202|does not exist/i.test(error.message + error.code)) return []; throw error; }
  return data || [];
}

/** preço da prateleira com a foto lida pela IA como prova */
export async function reportPriceWithPhoto(row) {
  if (MODE === 'demo') return reportPrice(row);
  if (MODE === 'offline' || !navigator.onLine) return reportPrice(row);
  const c = await client();
  const { data, error } = await c.from('price_reports').insert(row).select('id, status, points, at_store').single();
  if (error && /ia_reading_id|photo_url|PGRST204/i.test(error.message + error.code)) {
    const { ia_reading_id, photo_url, ...rest } = row; return reportPrice(rest);
  }
  if (error) throw error;
  // a aprovação automática acontece depois da gravação: relê o status
  const { data: now } = await c.from('price_reports').select('status, points').eq('id', data.id).maybeSingle();
  return { ...data, ...(now || {}) };
}

// ---------------------------------------------------------------- fila offline: como reenviar cada coisa
off.handle('report', reportLive);
off.handle('track', trackLive);
off.handle('ean', eanLive);
off.handle('photo', photoLive);

// ---------------------------------------------------------------- lista da família (supabase/atualizacao-2026-10-lista-familia.sql)
const famErr = (error) => { const e = new Error(error.message); e.code = /function|PGRST202|42883/i.test(`${error.code} ${error.message}`) ? 'sem_funcao' : error.code; return e; };
const famRpc = async (fn, args) => {
  if (MODE === 'demo') { const e = new Error('demo'); e.code = 'sem_funcao'; throw e; }
  const c = await client();
  const { data, error } = await withTimeout(c.rpc(fn, args));
  if (error) throw famErr(error);
  return data;
};
export const familyCreate = (name, month, items, checked, by) => famRpc('shared_list_create', { p_name: name, p_month: month, p_items: items, p_checked: checked, p_by: by });
export const familyGet = (code) => famRpc('shared_list_get', { p_code: code });
export const familyJoin = (code) => famRpc('shared_list_join', { p_code: code });
export const familyPut = (code, name, month, items, checked, by) => famRpc('shared_list_put', { p_code: code, p_name: name, p_month: month, p_items: items, p_checked: checked, p_by: by });
/** canal ao vivo (Realtime Broadcast): avisa quem está com a mesma lista aberta */
export async function familyChannel(code, onMsg) {
  if (MODE !== 'live') return null;
  const c = await client();
  const ch = c.channel(`familia-${code}`, { config: { broadcast: { self: false } } });
  ch.on('broadcast', { event: 'sync' }, ({ payload }) => onMsg(payload)).subscribe();
  return { send: (payload) => ch.send({ type: 'broadcast', event: 'sync', payload }), close: () => c.removeChannel(ch) };
}

// ---------------------------------------------------------------- zerar o histórico da pessoa (o banco guarda tudo para os painéis)
export async function resetHistory() {
  if (MODE === 'demo') return { gen: null };
  const c = await client();
  const { data, error } = await withTimeout(c.rpc('reset_my_history'));
  if (error) {
    const e = new Error(error.message);
    e.code = /function|PGRST202|42883/i.test(`${error.code} ${error.message}`) ? 'sem_funcao' : error.code;
    throw e;
  }
  return data;
}

// ---------------------------------------------------------------- sincronizar a conta entre aparelhos (user_state)
export async function stateLoad() {
  if (MODE !== 'live') return null;
  const c = await client();
  const { data, error } = await withTimeout(c.from('user_state').select('key, value, device, updated_at'));
  if (error) { const e = new Error(error.message); e.code = /relation|PGRST205|42P01|does not exist/i.test(`${error.code} ${error.message}`) ? 'sem_tabela' : error.code; throw e; }
  return data;
}
export async function statePush(rows) {
  if (MODE !== 'live' || !rows.length) return;
  const c = await client();
  const { data: { user } } = await c.auth.getUser();
  if (!user) return;
  const { error } = await c.from('user_state').upsert(rows.map((r) => ({ ...r, user_id: user.id })), { onConflict: 'user_id,key' });
  if (error) throw error;
}
export async function stateChannel(userId, onRow) {
  if (MODE !== 'live') return null;
  const c = await client();
  const ch = c.channel(`state-${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'user_state', filter: `user_id=eq.${userId}` }, (p) => onRow(p.new && Object.keys(p.new).length ? p.new : null))
    .subscribe();
  return () => c.removeChannel(ch);
}

// ---------------------------------------------------------------- campanhas dos supermercados (só as que estão no ar)
export async function loadCampaigns() {
  if (MODE === 'demo') {
    const now = Date.now();
    const mine = (ls.get('tb.portalDemo', null)?.campaigns || []).filter((c) => c.status === 'ativa' && new Date(c.starts_at) <= now && new Date(c.ends_at) >= now);
    const until = new Date(now + 5 * 864e5).toISOString(), since = new Date(now - 864e5).toISOString();
    return mine.length ? mine : [
      { id: 9001, supermarket_id: 1, kind: 'janela', title: 'Semana da carne no Nova Era', body: 'Picanha, frango e linguiça com preço de atacado até domingo.', product_ids: [], cta: 'ofertas', audience: 'todos', radius_km: 2, starts_at: since, ends_at: until, demo: true },
      { id: 9002, supermarket_id: 5, kind: 'vitrine', title: 'Ofertas da semana do Coema', body: '', product_ids: [], cta: 'produtos', audience: 'todos', radius_km: 2, starts_at: since, ends_at: until, demo: true },
      { id: 9003, supermarket_id: 3, kind: 'aviso', title: 'Você está perto do Veneza', body: 'Hoje tem hortifrúti com 15% off. Passa aqui!', product_ids: [], cta: 'rota', audience: 'perto', radius_km: 2, starts_at: since, ends_at: until, demo: true },
    ];
  }
  if (MODE !== 'live') return [];
  try {
    const c = await client();
    const { data, error } = await withTimeout(c.from('market_campaigns').select('id, supermarket_id, kind, title, body, image_url, product_ids, cta, audience, radius_km, starts_at, ends_at'));
    return error ? [] : data;
  } catch { return []; }
}
