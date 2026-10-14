// Camada de dados: Supabase (produção) com fallback para dados de demonstração.
import { CONFIG } from './config.js';

let sb = null;
export let MODE = 'live'; // 'live' | 'demo'

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
    return { supermarkets: m.data, stores: s.data, categories: cat.data, products: p.data.map(normalize) };
  } catch (e) {
    if (!CONFIG.DEMO_FALLBACK) throw e;
    console.warn('[TáBarato] usando dados de demonstração:', e.message || e);
    MODE = 'demo';
    const { DEMO } = await import('./demo-data.js');
    return { ...DEMO, products: buildDemoProducts(DEMO) };
  }
}

function normalize(p) {
  return {
    ...p,
    min_price: Number(p.min_price),
    max_price: Number(p.max_price),
    change_pct: p.change_pct == null ? null : Number(p.change_pct),
    prices: (p.prices || [])
      .map((x) => ({ market_id: x.market_id, price: Number(x.price), prev: x.prev == null ? null : Number(x.prev), at: x.at }))
      .sort((a, b) => a.price - b.price),
  };
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
const ls = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
export const store = ls;

const authListeners = new Set();
export function onAuth(cb) { authListeners.add(cb); }
const emitAuth = (u) => authListeners.forEach((cb) => cb(u));

export async function initAuth() {
  if (MODE === 'demo') { emitAuth(ls.get(DEMO_KEY)); return; }
  const c = await client();
  const { data } = await c.auth.getSession();
  emitAuth(data.session?.user ?? null);
  c.auth.onAuthStateChange((_e, session) => emitAuth(session?.user ?? null));
}

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
    options: { data: { full_name: name }, emailRedirectTo: location.origin + location.pathname },
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
  const { error } = await c.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
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
  const { data, error } = await c.rpc('complete_profile', {
    p_full_name: f.full_name, p_phone: f.phone, p_birth_date: f.birth_date,
    p_neighborhood: f.neighborhood, p_cep: f.cep || null,
    p_preferred_markets: f.preferred_markets || [], p_accepts_offers: !!f.accepts_offers,
  });
  if (error) throw error;
  return data;
}

export async function registerComparison() {
  if (MODE === 'demo') {
    const p = ls.get('tb.demoProfile');
    if (p.completed_at) return { allowed: true, completed: true };
    if (p.comparisons_used >= CONFIG.QUICK_COMPARISONS) return { allowed: false, completed: false, used: p.comparisons_used, limit: CONFIG.QUICK_COMPARISONS };
    p.comparisons_used++; ls.set('tb.demoProfile', p);
    return { allowed: true, completed: false, used: p.comparisons_used, limit: CONFIG.QUICK_COMPARISONS };
  }
  const c = await client();
  const { data, error } = await c.rpc('register_comparison');
  if (error) throw error;
  return data;
}

export async function reportPrice({ product_id, supermarket_id, price, note }) {
  if (MODE === 'demo') return;
  const c = await client();
  const { error } = await c.from('price_reports').insert({ product_id, supermarket_id, price, note });
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
