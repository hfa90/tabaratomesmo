// Dados da página do administrador master.
// Ao vivo: funções admin_* do schema.sql (todas conferem is_master() no banco).
// Demonstração: dados simulados guardados no aparelho, para conhecer a página.
import * as api from './api.js';
import { BAIRROS, ZONE_NAMES } from './config.js';

export let MODE = 'live'; // 'live' | 'demo' | 'pending'
const ls = api.store;
const isMissingFn = (e) => /PGRST202|could not find the function|does not exist/i.test(`${e?.code} ${e?.message}`);

async function rpc(name, args = {}) {
  const c = await api.sbClient();
  const { data, error } = await c.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

export async function init() {
  if (api.MODE === 'demo') { MODE = 'demo'; return; }
  const c = await api.sbClient();
  const { error } = await c.rpc('am_i_master');
  MODE = error && isMissingFn(error) ? 'pending' : 'live';
}
export function useDemo() { MODE = 'demo'; }

export async function amIMaster() {
  if (MODE === 'demo') return true;
  return !!(await rpc('am_i_master'));
}

// ---------------------------------------------------------------- estado de demonstração
let D = null;
async function demo() {
  if (D) return D;
  const { DEMO } = await import('./demo-data.js');
  const saved = ls.get('tb.adminDemo', null);
  if (saved) return (D = saved);
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const first = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elaine', 'Fábio', 'Gisele', 'Hugo', 'Iara', 'João', 'Kátia', 'Lucas', 'Marta', 'Nilton', 'Olga', 'Paulo', 'Raissa', 'Sérgio', 'Tainá', 'Vitor'];
  const last = ['Silva', 'Souza', 'Lima', 'Costa', 'Melo', 'Rocha', 'Alves', 'Nunes'];
  const users = Array.from({ length: 40 }, (_, i) => {
    const b = BAIRROS[Math.floor(rnd() * BAIRROS.length)];
    const name = `${first[i % first.length]} ${last[Math.floor(rnd() * last.length)]}`;
    const complete = rnd() > 0.35;
    return { id: 'u' + i, email: name.toLowerCase().normalize('NFD').replace(/[^\w ]/g, '').replace(' ', '.') + '@email.com', full_name: name,
      neighborhood: complete ? b.name : null, zone: complete ? b.zone : null, gender: complete ? (rnd() > 0.42 ? 'feminino' : 'masculino') : null,
      completed_at: complete ? new Date(Date.now() - rnd() * 60 * 864e5).toISOString() : null, blocked: false, comparisons_used: Math.round(rnd() * 40),
      created_at: new Date(Date.now() - rnd() * 90 * 864e5).toISOString(), last_sign_in_at: new Date(Date.now() - rnd() * 20 * 864e5).toISOString(),
      reports: Math.round(rnd() * 12), points: Math.round(rnd() * 200), lists: Math.round(rnd() * 4), savings: Math.round(rnd() * 25000) / 100, markets: null, is_admin: false };
  });
  users.unshift({ id: 'me', email: 'haydenfernandes.ti@gmail.com', full_name: 'Hayden Fernandes', neighborhood: 'Flores', zone: 'Centro-Sul', gender: 'masculino',
    completed_at: new Date().toISOString(), blocked: false, comparisons_used: 12, created_at: new Date(Date.now() - 20 * 864e5).toISOString(), last_sign_in_at: new Date().toISOString(),
    reports: 3, points: 55, lists: 2, savings: 74.3, markets: null, is_admin: true });
  users[3].markets = 'Coema'; users[7].markets = 'Nova Era';
  D = {
    markets: DEMO.supermarkets.map((m) => ({ ...m, active: true, portal_enabled: true, website: null })),
    stores: DEMO.stores.map((s) => ({ ...s })),
    members: [{ user_id: 'u3', supermarket_id: 5, email: users[4].email, full_name: users[4].full_name, role: 'admin', suspended: false, created_at: new Date(Date.now() - 9 * 864e5).toISOString(), last_sign_in_at: new Date().toISOString() },
      { user_id: 'u7', supermarket_id: 1, email: users[8].email, full_name: users[8].full_name, role: 'admin', suspended: false, created_at: new Date(Date.now() - 4 * 864e5).toISOString(), last_sign_in_at: null }],
    invites: [{ code: 'A1B2C3D4', supermarket_id: 2, role: 'admin', uses_left: 5, expires_at: new Date(Date.now() + 20 * 864e5).toISOString(), created_at: new Date().toISOString() }],
    users, settings: { anon_comparisons: 3, quick_comparisons: 15, collab_enabled: true, promos_enabled: true, portal_enabled: true, tracking_enabled: true, ads_enabled: true, welcome_enabled: true, welcome_radius: 150, banner: '' },
    admins: [{ email: 'haydenfernandes.ti@gmail.com', added_by: 'instalação', created_at: new Date().toISOString(), has_account: true }],
    log: [], productsOff: [], promoOff: [],
    reports: Array.from({ length: 14 }, (_, i) => {
      const p = DEMO.products[Math.floor(rnd() * DEMO.products.length)]; const m = DEMO.supermarkets[Math.floor(rnd() * 5)];
      const cur = DEMO.prices.find((r) => r[0] === p.id && r[1] === m.id)?.[2] ?? null;
      return { id: i + 1, created_at: new Date(Date.now() - rnd() * 3 * 864e5).toISOString(), price: cur ? Math.round(cur * (0.9 + rnd() * 0.2) * 100) / 100 : 9.99,
        status: i < 8 ? 'pendente' : i < 12 ? 'aprovado' : 'rejeitado', at_store: rnd() > 0.5, points: 15, email: users[Math.floor(rnd() * users.length)].email,
        product: p.name, brand: p.brand, unit: p.unit, emoji: p.emoji, market: m.name, current_price: cur };
    }),
  };
  return D;
}
const saveDemo = () => ls.set('tb.adminDemo', D);
const note = (action, detail) => { D.log.unshift({ id: Date.now(), created_at: new Date().toISOString(), admin: 'haydenfernandes.ti@gmail.com', action, detail }); D.log = D.log.slice(0, 200); };

// ---------------------------------------------------------------- visão geral
export async function overview(days) {
  if (MODE !== 'demo') return rpc('admin_overview', { p_days: days });
  const d = await demo();
  let seed = 3 + days; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const k = days / 30;
  const daily = [];
  for (let i = days - 1; i >= 0; i--) {
    const dt = new Date(Date.now() - i * 864e5); const wk = [0, 6].includes(dt.getDay()) ? 1.3 : 1; const g = 1 + (days - i) / days * 0.3;
    daily.push({ d: dt.toISOString().slice(0, 10), signups: Math.round(14 * g * (0.6 + rnd() * 0.8)), visitors: Math.round(420 * wk * g * (0.85 + rnd() * 0.3)),
      searches: Math.round(900 * wk * g * (0.85 + rnd() * 0.3)), ranchos: Math.round(40 * wk * g * (0.7 + rnd() * 0.6)) });
  }
  const sum = (key) => daily.reduce((s, x) => s + x[key], 0);
  const { DEMO } = await import('./demo-data.js');
  const terms = ['picanha', 'arroz', 'frango', 'café', 'leite', 'óleo', 'feijão', 'tambaqui', 'açúcar', 'ovos', 'cerveja', 'sabão em pó', 'papel higiênico', 'carne moída', 'farinha', 'jaraqui', 'banana', 'refrigerante', 'detergente', 'manteiga'];
  const hours = [];
  for (let dw = 0; dw < 7; dw++) for (let h = 6; h < 24; h++) hours.push({ dow: dw, h, n: Math.round((Math.exp(-((h - 19) ** 2) / 8) + 0.55 * Math.exp(-((h - 11) ** 2) / 6) + (dw === 0 || dw === 6 ? 0.35 : 0)) * 300 * k * (0.7 + rnd() * 0.6)) });
  const markets = d.markets.map((m) => {
    const w = 0.6 + rnd() * 0.8; const bought = Math.round(160 * w * k), wins = Math.round(220 * w * k), routes = Math.round(380 * w * k);
    return { id: m.id, name: m.name, color: m.color, logo_url: m.logo_url, active: m.active, portal_enabled: m.portal_enabled, bought, spent: bought * 310, rancho_wins: wins, routes,
      interest: Math.round(2400 * w * k), products: DEMO.prices.filter((r) => r[1] === m.id && r[3] === 0).length || 40, promos: Math.round(rnd() * 6),
      last_price: new Date(Date.now() - rnd() * 2 * 864e5).toISOString(), score: bought * 3 + wins * 2 + routes };
  }).sort((a, b) => b.score - a.score);
  const users = d.users.length * 37;
  return {
    demo: true,
    kpis: { users, users_new: sum('signups'), users_new_prev: Math.round(sum('signups') * 0.8), users_complete: Math.round(users * 0.62), users_active: Math.round(users * 0.41 * Math.min(1, k + 0.3)),
      users_blocked: d.users.filter((u) => u.blocked).length, visitors: Math.round(sum('visitors') * 0.32), visitors_prev: Math.round(sum('visitors') * 0.27),
      searches: sum('searches'), searches_prev: Math.round(sum('searches') * 0.84), views: Math.round(sum('searches') * 0.55), adds: Math.round(sum('searches') * 0.21),
      ranchos: sum('ranchos'), bought: Math.round(sum('ranchos') * 0.58), spent: Math.round(sum('ranchos') * 0.58 * 312), routes: Math.round(sum('ranchos') * 1.7),
      savings: Math.round(sum('ranchos') * 0.7 * 31), savings_all: Math.round(sum('ranchos') * 2.4 * 31), lists: Math.round(sum('ranchos') * 1.4),
      reports: Math.round(380 * k), reports_pending: d.reports.filter((r) => r.status === 'pendente').length, products: DEMO.products.length - d.productsOff.length,
      markets: d.markets.filter((m) => m.active).length, members: d.members.filter((m) => !m.suspended).length, promos_live: 7 },
    daily,
    zones: ZONE_NAMES.map((z) => ({ zone: z, users: Math.round((150 + rnd() * 450) * 1), searches: Math.round((2000 + rnd() * 9000) * k), ranchos: Math.round((80 + rnd() * 400) * k),
      adds: Math.round((600 + rnd() * 3000) * k), visitors: Math.round((300 + rnd() * 1500) * k) })).sort((a, b) => b.users - a.users),
    neighborhoods: BAIRROS.map((b) => ({ neighborhood: b.name, zone: b.zone, users: Math.round(20 + rnd() * 160), complete: 0 })).map((n) => ({ ...n, complete: Math.round(n.users * 0.6) })).sort((a, b) => b.users - a.users).slice(0, 20),
    gender: [{ gender: 'feminino', users: Math.round(users * 0.54), ranchos: Math.round(sum('ranchos') * 0.6) }, { gender: 'masculino', users: Math.round(users * 0.33), ranchos: Math.round(sum('ranchos') * 0.33) },
      { gender: 'outro', users: Math.round(users * 0.01), ranchos: Math.round(sum('ranchos') * 0.01) }, { gender: 'sem dado', users: Math.round(users * 0.12), ranchos: 0 }],
    age: [['18-24', 0.12], ['25-34', 0.31], ['35-44', 0.26], ['45-59', 0.17], ['60+', 0.05], ['sem dado', 0.09]].map(([a, f]) => ({ age_band: a, users: Math.round(users * f) })),
    top_searches: terms.map((q, i) => ({ query: q, n: Math.round((3200 - i * 140) * k * (0.85 + rnd() * 0.3)), people: Math.round((2100 - i * 90) * k) })).sort((a, b) => b.n - a.n),
    no_results: ['azeite', 'fralda', 'whey', 'ração de gato', 'pão de forma', 'tucumã', 'pupunha', 'leite sem lactose'].map((q, i) => ({ query: q, n: Math.round((600 - i * 60) * k) })),
    top_products: [...DEMO.products].sort(() => rnd() - 0.5).slice(0, 15).map((p, i) => ({ id: p.id, name: p.name, brand: p.brand, emoji: p.emoji, views: Math.round((2600 - i * 130) * k), adds: Math.round((900 - i * 45) * k) })),
    hours, markets,
    reports_by_status: { pendente: d.reports.filter((r) => r.status === 'pendente').length, aprovado: 211, rejeitado: 18 },
  };
}

// ---------------------------------------------------------------- supermercados e acessos
export async function markets() {
  if (MODE !== 'demo') return rpc('admin_markets');
  const d = await demo();
  return d.markets.map((m) => ({ ...m, members: d.members.filter((x) => x.supermarket_id === m.id).length, members_suspended: d.members.filter((x) => x.supermarket_id === m.id && x.suspended).length,
    invites: d.invites.filter((i) => i.supermarket_id === m.id && i.uses_left > 0 && new Date(i.expires_at) > Date.now()).length, stores_count: d.stores.filter((s) => s.supermarket_id === m.id).length }));
}
export async function saveMarket(p) {
  if (MODE !== 'demo') return rpc('admin_save_market', { p });
  const d = await demo();
  if (p.id) Object.assign(d.markets.find((m) => m.id === Number(p.id)), p, { id: Number(p.id) });
  else d.markets.push({ ...p, id: Math.max(...d.markets.map((m) => m.id)) + 1, slug: p.slug || p.name.toLowerCase().normalize('NFD').replace(/[^\w]+/g, '-'), active: true, portal_enabled: true });
  note('salvar mercado', { name: p.name }); saveDemo();
}
export async function setMarketFlag(id, flag, on) {
  if (MODE !== 'demo') return rpc('admin_set_market_flag', { p_market: id, p_flag: flag, p_on: on });
  const d = await demo(); d.markets.find((m) => m.id === id)[flag] = on; note('mercado ' + flag, { market: id, on }); saveDemo();
}
export async function deleteMarket(id, confirm) {
  if (MODE !== 'demo') return rpc('admin_delete_market', { p_market: id, p_confirm: confirm });
  const d = await demo(); const m = d.markets.find((x) => x.id === id);
  if (confirm !== m.slug) throw new Error(`Digite ${m.slug} para confirmar.`);
  d.markets = d.markets.filter((x) => x.id !== id); note('excluir mercado', { market: id }); saveDemo();
}
export async function access(id) {
  if (MODE !== 'demo') return rpc('admin_market_access', { p_market: id });
  const d = await demo();
  return { members: d.members.filter((m) => m.supermarket_id === id), stores: d.stores.filter((s) => s.supermarket_id === id),
    invites: d.invites.filter((i) => i.supermarket_id === id).map((i) => ({ ...i, valid: i.uses_left > 0 && new Date(i.expires_at) > Date.now() })) };
}
export async function createInvite(id, role, uses, days) {
  if (MODE !== 'demo') return rpc('admin_create_invite', { p_market: id, p_role: role, p_uses: uses, p_days: days });
  const d = await demo(); const code = Math.random().toString(16).slice(2, 10).toUpperCase();
  d.invites.unshift({ code, supermarket_id: id, role, uses_left: uses, expires_at: new Date(Date.now() + days * 864e5).toISOString(), created_at: new Date().toISOString() });
  note('gerar convite', { market: id, code }); saveDemo(); return code;
}
export async function deleteInvite(code) {
  if (MODE !== 'demo') return rpc('admin_delete_invite', { p_code: code });
  const d = await demo(); d.invites = d.invites.filter((i) => i.code !== code); note('excluir convite', { code }); saveDemo();
}
export async function setMember(user, market, role, suspended) {
  if (MODE !== 'demo') return rpc('admin_set_member', { p_user: user, p_market: market, p_role: role, p_suspended: suspended });
  const d = await demo(); const m = d.members.find((x) => x.user_id === user && x.supermarket_id === market);
  if (role) m.role = role; if (suspended != null) m.suspended = suspended; note('alterar acesso', { user, market }); saveDemo();
}
export async function removeMember(user, market) {
  if (MODE !== 'demo') return rpc('admin_remove_member', { p_user: user, p_market: market });
  const d = await demo(); d.members = d.members.filter((x) => !(x.user_id === user && x.supermarket_id === market)); note('remover acesso', { user, market }); saveDemo();
}
export async function addMember(email, market, role) {
  if (MODE !== 'demo') return rpc('admin_add_member', { p_email: email, p_market: market, p_role: role });
  const d = await demo(); const u = d.users.find((x) => x.email === email.toLowerCase().trim());
  if (!u) throw new Error(`Nenhuma conta com o e-mail ${email}. Gere um código de convite e envie para a pessoa.`);
  d.members.push({ user_id: u.id, supermarket_id: market, email: u.email, full_name: u.full_name, role, suspended: false, created_at: new Date().toISOString(), last_sign_in_at: u.last_sign_in_at });
  note('adicionar acesso', { email, market }); saveDemo();
}
export async function saveStore(p) {
  if (MODE !== 'demo') return rpc('admin_save_store', { p });
  const d = await demo();
  if (p.id) Object.assign(d.stores.find((s) => s.id === Number(p.id)), { ...p, id: Number(p.id), lat: Number(p.lat), lng: Number(p.lng) });
  else d.stores.push({ ...p, id: Math.max(0, ...d.stores.map((s) => s.id)) + 1, supermarket_id: Number(p.supermarket_id), lat: Number(p.lat), lng: Number(p.lng) });
  note('salvar loja', { name: p.name }); saveDemo();
}
export async function deleteStore(id) {
  if (MODE !== 'demo') return rpc('admin_delete_store', { p_store: id });
  const d = await demo(); d.stores = d.stores.filter((s) => s.id !== id); note('excluir loja', { store: id }); saveDemo();
}

// ---------------------------------------------------------------- usuários
export async function users(q, filter, limit, offset) {
  if (MODE !== 'demo') return rpc('admin_users', { p_q: q || null, p_filter: filter, p_limit: limit, p_offset: offset });
  const d = await demo(); const n = (s) => (s || '').toLowerCase();
  const rows = d.users.filter((u) => (!q || n(u.email + u.full_name + u.neighborhood).includes(n(q)))
    && (filter === 'all' || (filter === 'blocked' && u.blocked) || (filter === 'complete' && u.completed_at) || (filter === 'quick' && !u.completed_at) || (filter === 'markets' && u.markets)));
  return { total: rows.length, rows: rows.slice(offset, offset + limit) };
}
export async function setUser(id, blocked, reset) {
  if (MODE !== 'demo') return rpc('admin_set_user', { p_user: id, p_blocked: blocked, p_reset_comparisons: !!reset });
  const d = await demo(); const u = d.users.find((x) => x.id === id);
  if (blocked != null) u.blocked = blocked; if (reset) u.comparisons_used = 0; note('alterar usuário', { user: id, blocked, reset }); saveDemo();
}

// ---------------------------------------------------------------- moderação, produtos, promoções
export async function reports(status) {
  if (MODE !== 'demo') return rpc('admin_reports', { p_status: status, p_limit: 200 });
  const d = await demo(); return d.reports.filter((r) => status === 'all' || r.status === status);
}
export async function reviewReport(id, approve) {
  if (MODE !== 'demo') return rpc('admin_review_report', { p_id: id, p_approve: approve });
  const d = await demo(); d.reports.find((r) => r.id === id).status = approve ? 'aprovado' : 'rejeitado'; note(approve ? 'aprovar preço' : 'rejeitar preço', { id }); saveDemo();
}
export async function products(q) {
  if (MODE !== 'demo') return rpc('admin_products', { p_q: q || null });
  const d = await demo(); const { DEMO } = await import('./demo-data.js'); const n = (s) => (s || '').toLowerCase();
  return DEMO.products.filter((p) => !q || n(p.name + p.brand).includes(n(q))).map((p) => ({ ...p, category: p.category_name, active: !d.productsOff.includes(p.id),
    markets: new Set(DEMO.prices.filter((r) => r[0] === p.id).map((r) => r[1])).size, last_price: new Date().toISOString() }));
}
export async function setProduct(id, on) {
  if (MODE !== 'demo') return rpc('admin_set_product', { p_id: id, p_active: on });
  const d = await demo(); d.productsOff = on ? d.productsOff.filter((x) => x !== id) : [...d.productsOff, id]; note('produto ativo', { id, on }); saveDemo();
}
export async function promotions() {
  if (MODE !== 'demo') return rpc('admin_promotions');
  const d = await demo(); const { DEMO } = await import('./demo-data.js');
  const pd = ls.get('tb.portalDemo', { promos: [] });
  return (pd.promos || []).map((p) => ({ ...p, active: p.active && !d.promoOff.includes(p.id), product: DEMO.products.find((x) => x.id === p.product_id)?.name || 'Produto', market: DEMO.supermarkets.find((m) => m.id === p.supermarket_id)?.name }));
}
export async function setPromotion(id, on) {
  if (MODE !== 'demo') return rpc('admin_set_promotion', { p_id: id, p_active: on });
  const d = await demo(); d.promoOff = on ? d.promoOff.filter((x) => x !== id) : [...d.promoOff, id]; saveDemo();
}

// ---------------------------------------------------------------- configurações e administradores
export async function settings() {
  if (MODE !== 'demo') {
    const c = await api.sbClient();
    const { data, error } = await c.from('app_settings').select('key, value, label, updated_at').order('key');
    if (error) throw new Error(error.message);
    return data;
  }
  const d = await demo();
  const labels = { anon_comparisons: 'Comparações sem cadastro', quick_comparisons: 'Comparações com cadastro rápido', collab_enabled: 'Usuários podem informar preços',
    promos_enabled: 'Promoções dos mercados aparecem no site', portal_enabled: 'Área do supermercado liberada', tracking_enabled: 'Coleta de métricas de uso', ads_enabled: 'Publicidade aparece no site', banner: 'Aviso no topo do site (vazio = sem aviso)' };
  return Object.entries(d.settings).map(([key, value]) => ({ key, value, label: labels[key] }));
}
export async function setSetting(key, value) {
  if (MODE !== 'demo') return rpc('admin_set_setting', { p_key: key, p_value: value });
  const d = await demo(); d.settings[key] = value; note('configuração', { key, value }); saveDemo();
}
export async function admins() {
  if (MODE !== 'demo') return rpc('admin_admins');
  return (await demo()).admins;
}
export async function addAdmin(email) {
  if (MODE !== 'demo') return rpc('admin_add_admin', { p_email: email });
  const d = await demo(); d.admins.push({ email: email.toLowerCase(), added_by: 'haydenfernandes.ti@gmail.com', created_at: new Date().toISOString(), has_account: false }); saveDemo();
}
export async function removeAdmin(email) {
  if (MODE !== 'demo') return rpc('admin_remove_admin', { p_email: email });
  const d = await demo();
  if (email === 'haydenfernandes.ti@gmail.com') throw new Error('Você não pode remover a si mesmo.');
  d.admins = d.admins.filter((a) => a.email !== email); saveDemo();
}
export async function log() {
  if (MODE !== 'demo') return rpc('admin_log_list', { p_limit: 150 });
  return (await demo()).log;
}
export function resetDemo() { ls.set('tb.adminDemo', null); D = null; }

// ---------------------------------------------------------------- publicidade
import { DEMO_PLANS, DEMO_SLOTS } from './portal-api.js';
export async function adsAdmin(status) {
  if (MODE !== 'demo') return rpc('admin_ads', { p_status: status });
  const d = await demo(); d.adPlans ||= DEMO_PLANS.map((x) => ({ ...x })); d.adSlots ||= DEMO_SLOTS.map((x) => ({ ...x }));
  const pd = ls.get('tb.portalDemo', {}); const { DEMO } = await import('./demo-data.js');
  const all = (pd.ads || []).map((a) => ({ ...a, market: DEMO.supermarkets.find((m) => m.id === a.supermarket_id)?.name, color: DEMO.supermarkets.find((m) => m.id === a.supermarket_id)?.color,
    plan_name: d.adPlans.find((p) => p.id === a.plan_id)?.name, slot_name: d.adSlots.find((s) => s.key === a.slot)?.name, views: a.status === 'aprovada' ? 420 : 0, reveals: a.status === 'aprovada' ? 96 : 0, clicks: a.status === 'aprovada' ? 31 : 0 }));
  const now = Date.now(); const live = (a) => a.status === 'aprovada' && new Date(a.starts_at) <= now && new Date(a.ends_at) > now;
  return { campaigns: all.filter((a) => status === 'all' || a.status === status || (status === 'live' && live(a))),
    revenue: { paid_month: all.filter((a) => a.paid).reduce((s, a) => s + a.price, 0), paid_total: all.filter((a) => a.paid).reduce((s, a) => s + a.price, 0),
      to_receive: all.filter((a) => a.status === 'aprovada' && !a.paid).reduce((s, a) => s + a.price, 0), pending: all.filter((a) => a.status === 'pendente').length, live: all.filter((a) => live(a) && a.paid).length },
    plans: d.adPlans, slots: d.adSlots };
}
export async function adSet(id, action, reason) {
  if (MODE !== 'demo') return rpc('admin_ad_set', { p_id: id, p_action: action, p_reason: reason || null });
  const pd = ls.get('tb.portalDemo', {}); const a = (pd.ads || []).find((x) => x.id === id); if (!a) return;
  if (action === 'aprovar') { a.status = 'aprovada'; a.reject_reason = null; } else if (action === 'recusar') { a.status = 'recusada'; a.reject_reason = reason; }
  else if (action === 'pausar') a.status = 'pausada'; else if (action === 'retomar') a.status = 'aprovada'; else if (action === 'pago') a.paid = true; else if (action === 'nao_pago') a.paid = false;
  else if (action === 'excluir') pd.ads = pd.ads.filter((x) => x.id !== id);
  ls.set('tb.portalDemo', pd);
}
export async function savePlan(p) {
  if (MODE !== 'demo') return rpc('admin_save_ad_plan', { p });
  const d = await demo(); d.adPlans ||= DEMO_PLANS.map((x) => ({ ...x }));
  if (p.id) Object.assign(d.adPlans.find((x) => x.id === Number(p.id)), { ...p, id: Number(p.id), hours: Number(p.hours ?? d.adPlans.find((x) => x.id === Number(p.id)).hours), price: Number(p.price ?? d.adPlans.find((x) => x.id === Number(p.id)).price) });
  else d.adPlans.push({ ...p, id: Math.max(...d.adPlans.map((x) => x.id)) + 1, hours: Number(p.hours), price: Number(p.price), active: true, sort: 99 });
  saveDemo();
}
export async function saveSlot(p) {
  if (MODE !== 'demo') return rpc('admin_save_ad_slot', { p });
  const d = await demo(); d.adSlots ||= DEMO_SLOTS.map((x) => ({ ...x }));
  Object.assign(d.adSlots.find((x) => x.key === p.key), p); saveDemo();
}

// ---------------------------------------------------------------- fotos de etiqueta (carrinho)
export async function shelfPhotos(status) {
  if (MODE !== 'demo') return rpc('admin_shelf_photos', { p_status: status });
  const { DEMO } = await import('./demo-data.js');
  return ls.get('tb.demoPhotos', []).map((f, i) => ({ id: i + 1, created_at: f.at, status: f.status || 'pendente', spoken: f.spoken, name: f.name, price: f.price, site_price: f.site_price,
    photo_url: 'assets/icon.svg', market: DEMO.supermarkets.find((m) => m.id === f.supermarket_id)?.name, product: DEMO.products.find((p) => p.id === f.product_id)?.name, email: 'voce@demonstracao' }))
    .filter((f) => status === 'all' || f.status === status);
}
export async function reviewPhoto(id, approve) {
  if (MODE !== 'demo') return rpc('admin_review_photo', { p_id: id, p_approve: approve });
  const l = ls.get('tb.demoPhotos', []); if (l[id - 1]) l[id - 1].status = approve ? 'aprovada' : 'recusada'; ls.set('tb.demoPhotos', l);
}

// ---------------------------------------------------------------- encartes e notas fiscais
export async function receiptsOverview() {
  if (MODE === 'demo') return { total: 0, last_7d: 0, users_30d: 0, prices_added: 0, unknown_cnpj: [], unmatched: [], encartes: [] };
  return rpc('admin_receipts_overview');
}
export async function setCnpj(market, raiz) { return rpc('admin_set_cnpj', { p_market: market, p_raiz: raiz }); }
export async function encarteApply(market, rows, starts, ends, file) {
  if (MODE === 'demo') return { total: rows.length, prices: rows.filter((r) => !r.preco_de).length, promos: rows.filter((r) => r.preco_de).length, created: rows.filter((r) => !r.product_id).length, errors: [] };
  return rpc('encarte_apply', { p_market: market, p_rows: rows, p_starts: starts, p_ends: ends, p_file: file });
}
