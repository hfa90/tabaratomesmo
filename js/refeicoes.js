// 🍲 Planejar refeições: a pessoa diz o que quer comer ("arroz com feijão e bife"), para quantas pessoas
// e quantas vezes por semana ou por mês. O site soma os ingredientes de todas as refeições do plano
// (g, kg, ml, L, unidades), mostra quantos pacotes comprar, quanto custa no mercado mais barato e
// põe tudo no Rancho do mês com um toque. Pratos que a base não conhece podem ser calculados com IA.
import * as api from './api.js';
import { S, $, $$, esc, brl, hooks, isOn } from './core.js';
import { parse, match } from './voice.js';
import { sizeOf } from './unitprice.js';
import { RECEITAS, COMBOS } from './receitas-data.js';

const KEY = 'tb.mealPlan', KEY_CUSTOM = 'tb.customRecipes';
const WEEKS = 4.33; // semanas num mês
const strip = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const uid = () => Math.random().toString(36).slice(2, 9);

// peso médio de 1 unidade, para converter quando o mercado vende por kg (ou por maço/unidade)
const UN_G = { banana: 120, 'banana pacova': 160, limao: 60, laranja: 180, ovos: 50, ovo: 50, 'pao frances': 50, 'pao de forma': 25, tomate: 100, cebola: 120, batata: 150, cenoura: 120,
  couve: 200, alface: 300, 'cheiro verde': 100, coentro: 50, jambu: 150, mamao: 900, abobrinha: 250, chuchu: 300, pimentao: 150, alho: 40 };

let plan = api.store.get(KEY, null) || { periodo: 'semana', meals: [] };
let custom = api.store.get(KEY_CUSTOM, []);
let draft = { pratos: [], pessoas: plan.lastPessoas || 2, vezes: 1, por: 'semana', unknown: [] };
let buy = new Map(); // ingrediente → comprar? (desmarcar o que já tem em casa)
const save = () => { api.store.set(KEY, plan); api.store.set(KEY_CUSTOM, custom); };

const all = () => [...RECEITAS, ...custom];
const byId = (id) => all().find((r) => r.id === id);

// ---------------------------------------------------------------- entender o que a pessoa digitou
function bestRecipe(text) {
  const t = strip(text); if (t.length < 2) return null;
  let best = null, bs = 0;
  for (const r of all()) {
    for (const a of [r.nome, ...(r.alias || [])].map(strip)) {
      let s = 0;
      if (a === t) s = 10;
      else if (a.startsWith(t) || t.startsWith(a)) s = 6 + Math.min(a.length, t.length) / Math.max(a.length, t.length);
      else {
        const tw = t.split(/\s+/).filter((w) => w.length > 2), aw = a.split(/\s+/).filter((w) => w.length > 2);
        const hit = tw.filter((w) => aw.some((x) => x.startsWith(w.slice(0, 5)) || w.startsWith(x.slice(0, 5)))).length;
        s = tw.length ? (hit / Math.max(tw.length, aw.length)) * 5 : 0;
      }
      if (s > bs) { bs = s; best = r; }
    }
  }
  return bs >= 2.5 ? best : null;
}

/** "arroz com feijão e bife" → [arroz, feijão, bife] (+ partes que não reconheci) */
function understand(text) {
  const whole = bestRecipe(text);
  if (whole && strip(text).split(/\s+/).length <= 4 && (whole.alias || []).map(strip).includes(strip(text))) return { ids: [whole.id], unknown: [] };
  const parts = text.split(/,|\+|\s+e\s+|\s+com\s+|\s+mais\s+|\s+acompanhado de\s+/i).map((x) => x.trim()).filter(Boolean);
  const ids = [], unknown = [];
  for (const p of parts) { const r = bestRecipe(p); if (r) { if (!ids.includes(r.id)) ids.push(r.id); } else unknown.push(p); }
  if (!ids.length && whole) return { ids: [whole.id], unknown: [] };
  return { ids, unknown };
}

// ---------------------------------------------------------------- contas
const timesIn = (m, periodo) => (m.por === periodo ? m.vezes : m.por === 'semana' ? m.vezes * WEEKS : m.vezes / WEEKS);
function totals(periodo) {
  const map = new Map();
  for (const m of plan.meals) {
    const portions = m.pessoas * timesIn(m, periodo);
    for (const id of m.pratos) {
      const r = byId(id); if (!r) continue;
      for (const it of r.itens) {
        const k = strip(it.n) + '|' + it.u;
        const cur = map.get(k) || { n: it.n, u: it.u, b: it.b, q: 0, from: new Set() };
        cur.q += it.q * portions; cur.from.add(r.nome); map.set(k, cur);
      }
    }
  }
  return [...map.values()].map((x) => ({ ...x, key: strip(x.n) + '|' + x.u, buy: product(x) })).sort((a, b) => (b.buy?.cost || 0) - (a.buy?.cost || 0));
}

function fmtQ(q, u) {
  if (u === 'un') return `${Math.ceil(q - 0.05)} un`;
  const big = u === 'g' ? 'kg' : 'L';
  if (q >= 1000) { const v = q / 1000; return `${v.toLocaleString('pt-BR', { maximumFractionDigits: v < 10 ? 2 : 1 })} ${big}`; }
  const r = q >= 100 ? Math.round(q / 10) * 10 : q >= 20 ? Math.round(q / 5) * 5 : Math.max(1, Math.round(q));
  return `${r} ${u}`;
}

const cheapest = (p) => p.prices.filter((x) => isOn(x.market_id))[0] || p.prices[0];
/** produto do catálogo que atende o ingrediente com menor custo, e quantos pacotes */
function product(x) {
  if (!S.products?.length) return null;
  const cands = match(parse(x.b), S.products, { limit: 6 }).filter((c) => c.id >= 0.6).map((c) => c.p);
  let best = null;
  for (const p of cands) {
    const s = sizeOf(p.unit); const pr = cheapest(p); if (!s || !pr) continue;
    // quanto precisa na unidade do produto (kg, L ou un)
    let need = null;
    const wUn = UN_G[strip(x.b)] ?? UN_G[strip(x.n)] ?? UN_G[strip(x.b).split(' ')[0]];
    if (s.kind === 'kg' && x.u === 'g') need = x.q / 1000;
    else if (s.kind === 'L' && x.u === 'ml') need = x.q / 1000;
    else if (s.kind === 'L' && x.u === 'g') need = x.q / 1000; // líquidos medidos em g (creme de leite, molhos)
    else if (s.kind === 'kg' && x.u === 'ml') need = x.q / 1000;
    else if (s.kind === 'un' && x.u === 'un') need = x.q;
    else if (s.kind === 'kg' && x.u === 'un' && wUn) need = (x.q * wUn) / 1000;
    else if (s.kind === 'un' && x.u === 'g' && wUn) need = x.q / wUn;
    if (need == null) continue;
    const byWeight = ['carnes', 'hortifruti'].includes(p.category_slug) && s.kind === 'kg' && s.qty <= 1.001;
    const packs = byWeight ? need / s.qty : Math.max(1, Math.ceil(need / s.qty - 0.03));
    const cost = packs * pr.price;
    const pantry = !byWeight && need < s.qty * 0.15 && ['mercearia', 'bebidas'].includes(p.category_slug); // uso pequeno: deve ter em casa
    if (!best || cost < best.cost) best = { p, packs, byWeight, need, size: s, cost, price: pr.price, market: pr.market_id, pantry, rancho: Math.max(1, Math.ceil(packs - 0.001)) };
  }
  return best;
}

// ---------------------------------------------------------------- tela
const PER = { semana: 'semana', mes: 'mês' };
export function render() {
  const el = $('#refeicoesView'); if (!el) return;
  const T = totals(plan.periodo);
  for (const t of T) if (!buy.has(t.key)) buy.set(t.key, !(t.buy?.pantry));
  const sel = T.filter((t) => t.buy && buy.get(t.key));
  const cost = sel.reduce((s, t) => s + t.buy.cost, 0);
  const portions = plan.meals.reduce((s, m) => s + m.pessoas * timesIn(m, plan.periodo), 0);
  const ids = draft.pratos;
  el.innerHTML = `
  <header class="page-head"><h1>🍲 Planejar refeições</h1>
    <p class="muted">Diga o que você quer comer e quantas vezes. A gente calcula cada ingrediente, quantos pacotes comprar e quanto custa.</p></header>

  <section class="panel ml-add">
    <form id="mlForm" autocomplete="off">
      <label class="ml-q"><span>O que você quer comer?</span>
        <input id="mlText" placeholder="Ex.: arroz com feijão e bife" enterkeyhint="done" aria-label="Refeição" /></label>
      <div class="ml-sug" id="mlSug"></div>
    </form>
    <div class="chips ml-combos" aria-label="Atalhos">${COMBOS.map((c, i) => `<button class="chip" data-ml-combo="${i}">${esc(c.nome)}</button>`).join('')}</div>
    ${ids.length || draft.unknown.length ? `<div class="ml-picked">${ids.map((id) => `<span class="ml-chip">${esc(byId(id)?.nome || id)}<button data-ml-rm="${id}" aria-label="Tirar">✕</button></span>`).join('')}
      ${draft.unknown.map((u) => `<span class="ml-chip is-unknown">❔ ${esc(u)}<button data-ml-ia="${esc(u)}">🤖 calcular com IA</button><button data-ml-rmu="${esc(u)}" aria-label="Tirar">✕</button></span>`).join('')}</div>` : ''}
    <div class="ml-row">
      <div class="ml-f"><span>Pessoas</span><span class="stepper"><button data-ml="p-" aria-label="Menos pessoas">−</button><output>${draft.pessoas}</output><button data-ml="p+" aria-label="Mais pessoas">+</button></span></div>
      <div class="ml-f"><span>Quantas vezes</span><span class="stepper"><button data-ml="v-" aria-label="Menos vezes">−</button><output>${draft.vezes}</output><button data-ml="v+" aria-label="Mais vezes">+</button></span></div>
      <div class="ml-f"><span>por</span><div class="seg" role="radiogroup">${['semana', 'mes'].map((k) => `<button role="radio" aria-checked="${draft.por === k}" data-ml-por="${k}">${PER[k]}</button>`).join('')}</div></div>
    </div>
    ${ids.length ? `<p class="ml-explain">${draft.pessoas} ${draft.pessoas === 1 ? 'pessoa' : 'pessoas'} × ${draft.vezes} ${draft.vezes === 1 ? 'vez' : 'vezes'} por ${PER[draft.por]} = <b>${draft.pessoas * draft.vezes} porções</b> por ${PER[draft.por]}${draft.por === 'semana' ? ` (≈ ${Math.round(draft.pessoas * draft.vezes * WEEKS)} no mês)` : ''}.</p>` : ''}
    <button class="btn btn--primary btn--block" data-ml="add" ${ids.length ? '' : 'disabled'}>＋ Pôr no meu plano</button>
  </section>

  ${plan.meals.length ? `
  <section class="panel ml-plan"><div class="panel__head"><h2>Meu plano</h2><button class="btn btn--text btn--sm" data-ml="clear">Limpar plano</button></div>
    <ul>${plan.meals.map((m) => `<li><div><b>${esc(m.pratos.map((id) => byId(id)?.nome || id).join(' + '))}</b>
      <small>${m.pessoas} ${m.pessoas === 1 ? 'pessoa' : 'pessoas'} · ${m.vezes}× por ${PER[m.por]}</small>
      <details><summary>Ver 1 porção</summary>${m.pratos.map((id) => { const r = byId(id); return r ? `<p><b>${esc(r.nome)}:</b> ${r.itens.map((i) => `${esc(i.n)} ${fmtQ(i.q, i.u)}`).join(', ')}</p>` : ''; }).join('')}</details></div>
      <button class="calc-ic" data-ml-del="${m.id}" aria-label="Tirar do plano">🗑️</button></li>`).join('')}</ul></section>

  <section class="panel ml-res">
    <div class="panel__head"><h2>O que comprar</h2>
      <div class="seg" role="radiogroup" aria-label="Período">${['semana', 'mes'].map((k) => `<button role="radio" aria-checked="${plan.periodo === k}" data-ml-per="${k}">1 ${PER[k]}</button>`).join('')}</div></div>
    <div class="ml-kpis"><div><small>Custo estimado (${PER[plan.periodo]})</small><b>${brl(cost)}</b></div><div><small>Porções</small><b>${Math.round(portions)}</b></div><div><small>Por porção</small><b>${portions ? brl(cost / portions) : '–'}</b></div></div>
    <p class="muted small">Desmarque o que você já tem em casa. Itens de uso pequeno (sal, óleo, temperos) já vêm desmarcados.</p>
    <ul class="ml-list">${T.map((t) => { const b = t.buy; const m = b && S.markets.get(b.market); return `<li class="${buy.get(t.key) ? '' : 'is-off'}">
      <label class="tick"><input type="checkbox" data-ml-buy="${esc(t.key)}" ${buy.get(t.key) ? 'checked' : ''} ${b ? '' : 'disabled'} /><span></span></label>
      <div class="ml-i"><b>${esc(t.n)}</b><small>${fmtQ(t.q, t.u)} · ${esc([...t.from].slice(0, 3).join(', '))}</small>
        ${b ? `<small class="ml-buy">🛒 ${b.byWeight ? `${b.need.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg de` : `${b.packs} ×`} ${esc([b.p.name, b.p.brand, b.byWeight ? '' : b.p.unit].filter(Boolean).join(' '))}${b.pantry ? ' · <i>deve ter em casa</i>' : ''}</small>` : '<small class="muted">não achei no catálogo</small>'}</div>
      <span class="ml-v">${b ? `<b>${brl(b.cost)}</b><small>${esc(m?.name || '')}</small>` : ''}</span></li>`; }).join('')}</ul>
    <div class="row-actions ml-go"><button class="btn btn--primary" data-ml="rancho">🛒 Pôr no Rancho do mês</button><button class="btn btn--ghost" data-ml="share">📋 Copiar lista</button></div>
  </section>` : `<div class="notas-empty"><span aria-hidden="true">🍽️</span><p><b>Comece pelo que você mais come.</b> Toque num atalho acima ou escreva, por exemplo, “feijoada”, “tapioca” ou “arroz com feijão e frango”.</p></div>`}`;
  bindInput();
}

function bindInput() {
  const inp = $('#mlText'), sug = $('#mlSug'); if (!inp) return;
  const show = () => {
    const q = strip(inp.value);
    if (q.length < 2) { sug.innerHTML = ''; return; }
    const list = all().filter((r) => [r.nome, ...(r.alias || [])].some((a) => strip(a).includes(q))).slice(0, 6);
    sug.innerHTML = list.map((r) => `<button type="button" class="chip" data-ml-pick="${r.id}">${esc(r.nome)}</button>`).join('')
      + (q.length > 3 ? `<button type="button" class="chip chip--ok" data-ml-parse>Entender “${esc(inp.value.trim())}”</button>` : '');
  };
  inp.addEventListener('input', show);
  $('#mlForm').addEventListener('submit', (e) => { e.preventDefault(); takeText(inp.value); });
}

function takeText(text) {
  if (!text.trim()) return;
  const { ids, unknown } = understand(text);
  ids.forEach((id) => { if (!draft.pratos.includes(id)) draft.pratos.push(id); });
  unknown.forEach((u) => { if (!draft.unknown.includes(u)) draft.unknown.push(u); });
  render();
  if (unknown.length && !ids.length) hooks.toast?.(`Não conheço “${unknown.join(', ')}” ainda. Toque em “calcular com IA” ou escolha um atalho.`);
}

// ---------------------------------------------------------------- IA para pratos desconhecidos
async function askIA(text) {
  if (api.MODE === 'live' && !S.user) return hooks.openAuth('signup', 'Crie sua conta para calcular pratos novos com IA.');
  hooks.toast?.(`🤖 Calculando os ingredientes de “${text}”…`);
  try {
    const ia = await import('./ia.js');
    const out = await ia.iaRead('receita', [], { text });
    const r = out.result || {};
    if (!r.ingredientes?.length) throw new Error('Não consegui montar essa receita. Tente escrever de outro jeito.');
    const rec = { id: 'c-' + uid(), nome: r.nome || text, alias: [text], tipo: 'prato', ia: true,
      itens: r.ingredientes.filter((i) => i.quantidade > 0 && ['g', 'ml', 'un'].includes(i.unidade)).map((i) => ({ n: i.nome, q: Number(i.quantidade), u: i.unidade, b: i.busca || i.nome })) };
    custom.push(rec); save();
    draft.unknown = draft.unknown.filter((u) => u !== text); draft.pratos.push(rec.id);
    render(); hooks.toast?.(`✓ ${rec.nome}: ${rec.itens.length} ingredientes por pessoa.`);
  } catch (e) { hooks.toast?.(e.message || 'Não consegui calcular agora.', 'warn'); }
}

// ---------------------------------------------------------------- eventos
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-ml], [data-ml-combo], [data-ml-rm], [data-ml-rmu], [data-ml-pick], [data-ml-parse], [data-ml-por], [data-ml-per], [data-ml-del], [data-ml-ia]'); if (!t) return;
  const d = t.dataset;
  if (d.mlCombo) { draft.pratos = [...COMBOS[Number(d.mlCombo)].pratos]; draft.unknown = []; return render(); }
  if (d.mlPick) { if (!draft.pratos.includes(d.mlPick)) draft.pratos.push(d.mlPick); return render(); }
  if (d.mlParse !== undefined) return takeText($('#mlText').value);
  if (d.mlRm) { draft.pratos = draft.pratos.filter((x) => x !== d.mlRm); return render(); }
  if (d.mlRmu) { draft.unknown = draft.unknown.filter((x) => x !== d.mlRmu); return render(); }
  if (d.mlIa) return askIA(d.mlIa);
  if (d.mlPor) { draft.por = d.mlPor; return render(); }
  if (d.mlPer) { plan.periodo = d.mlPer; save(); return render(); }
  if (d.mlDel) { plan.meals = plan.meals.filter((m) => m.id !== d.mlDel); save(); return render(); }
  const k = d.ml;
  if (k === 'p+') draft.pessoas = Math.min(30, draft.pessoas + 1);
  else if (k === 'p-') draft.pessoas = Math.max(1, draft.pessoas - 1);
  else if (k === 'v+') draft.vezes = Math.min(draft.por === 'semana' ? 21 : 90, draft.vezes + 1);
  else if (k === 'v-') draft.vezes = Math.max(1, draft.vezes - 1);
  else if (k === 'add') {
    if (!draft.pratos.length) return;
    plan.meals.push({ id: uid(), pratos: [...draft.pratos], pessoas: draft.pessoas, vezes: draft.vezes, por: draft.por });
    plan.lastPessoas = draft.pessoas; save();
    draft = { pratos: [], pessoas: draft.pessoas, vezes: 1, por: draft.por, unknown: [] };
    hooks.toast?.('Refeição no plano. A lista de compras foi atualizada.');
    render(); setTimeout(() => $('.ml-res')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80); return;
  }
  else if (k === 'clear') { if (!confirm('Limpar todo o plano de refeições?')) return; plan.meals = []; buy.clear(); save(); }
  else if (k === 'rancho') return toRancho();
  else if (k === 'share') return share();
  render();
});
document.addEventListener('change', (e) => { const k = e.target.dataset?.mlBuy; if (k) { buy.set(k, e.target.checked); render(); } });

function toRancho() {
  const T = totals(plan.periodo).filter((t) => t.buy && buy.get(t.key));
  if (!T.length) return hooks.toast?.('Marque pelo menos um ingrediente para comprar.');
  // soma por produto (dois ingredientes podem cair no mesmo produto)
  const by = new Map();
  for (const t of T) by.set(t.buy.p.id, (by.get(t.buy.p.id) || 0) + t.buy.rancho);
  for (const [pid, q] of by) hooks.setQty(pid, Math.max(q, S.list.get(pid) || 0));
  hooks.toast?.(`🛒 ${by.size} produtos no Rancho do mês. Lá você vê em qual mercado sai mais barato.`);
  setTimeout(() => { location.hash = '#lista'; }, 700);
}

async function share() {
  const T = totals(plan.periodo).filter((t) => buy.get(t.key));
  const txt = `Lista de compras (${PER[plan.periodo]}) — Tá Barato Mesmo?\n` + T.map((t) => `• ${t.n}: ${fmtQ(t.q, t.u)}${t.buy ? ` (${t.buy.byWeight ? `${t.buy.need.toFixed(2).replace('.', ',')} kg` : `${t.buy.packs} × ${t.buy.p.unit || ''}`})` : ''}`).join('\n');
  try { if (navigator.share) await navigator.share({ text: txt }); else { await navigator.clipboard.writeText(txt); hooks.toast?.('Lista copiada. Cole no WhatsApp ou nas notas.'); } } catch {}
}
