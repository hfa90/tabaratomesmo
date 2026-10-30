// 🐷 Cofrinho: o que a pessoa ganha a cada nota que manda (tudo garantido, sem sorteio).
//  • Economia da compra: quanto a nota saiu mais barata que a média dos outros mercados hoje.
//  • Pontos da nota + bônus: primeira nota do dia (+10), semanas seguidas (+10 por semana, até +50)
//    e 3 desafios da semana.
//  • Níveis: Bronze, Prata (500), Ouro (1.500) e Diamante (4.000 pontos ganhos).
//  • Troca de pontos: recompensas que cada supermercado oferece (e paga) no portal. O código vale no
//    caixa e é dado como usado sozinho quando a nota daquele mercado chega.
// Com conta: tudo vem do banco (my_cofrinho, receipt_rewards). Na demonstração: calculado no aparelho.
import * as api from './api.js';
import { ic } from './icons.js';
import { S, $, esc, brl, logo, hooks } from './core.js';
import { haptic, bump } from './fx.js';

const DEMO_KEY = 'tb.demoCofre';
const nf = (n) => Number(n || 0).toLocaleString('pt-BR');
const money = (v) => (Number.isInteger(Number(v)) ? `R$ ${Number(v)}` : brl(Number(v)));
const dShort = (d) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
let data = null;     // último my_cofrinho
let loading = null;

const live = () => api.MODE === 'live' && !!S.user;
const demoMode = () => api.MODE !== 'live';

// ================================================================ demonstração (no aparelho)
const dState = () => api.store.get(DEMO_KEY, { ledger: [], codes: [] });
const dSave = (s) => api.store.set(DEMO_KEY, s);
const weekStart = (d = new Date()) => { const x = new Date(d); const k = (x.getDay() + 6) % 7; x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - k); return x; };
const dayKey = (d = new Date()) => new Date(d).toLocaleDateString('sv-SE');
const sentReceipts = () => api.store.get('tb.receipts', []).filter((r) => r.sent && !r.sent.dup);

function level(e) {
  if (e >= 4000) return { name: 'Diamante', min: 4000, next: null, next_name: null };
  if (e >= 1500) return { name: 'Ouro', min: 1500, next: 4000, next_name: 'Diamante' };
  if (e >= 500) return { name: 'Prata', min: 500, next: 1500, next_name: 'Ouro' };
  return { name: 'Bronze', min: 0, next: 500, next_name: 'Prata' };
}
function demoSavings(r) {
  let s = 0;
  for (const it of r.items || []) {
    const p = it.pid ? S.products.find((x) => x.id === it.pid) : null; if (!p) continue;
    const others = p.prices.filter((x) => x.market_id !== r.mid).map((x) => x.price);
    if (!others.length || !(it.unit_price > 0)) continue;
    const avg = others.reduce((a, b) => a + b, 0) / others.length;
    if (it.unit_price < avg * 3) s += (avg - it.unit_price) * (it.qty || 1);
  }
  return Math.max(0, Math.round(s * 100) / 100);
}
const partnerIds = () => [...S.markets.keys()].slice(0, 3);
function demoMissions(list = sentReceipts()) {
  const w0 = weekStart(); const st = dState();
  const wk = list.filter((r) => new Date(r.at || r.savedAt) >= w0);
  const paid = (code) => st.ledger.some((l) => l.kind === 'desafio' && l.ref === `${dayKey(w0)}:${code}`);
  return [
    { code: 'duas_notas', title: 'Mande 2 notas nesta semana', goal: 2, points: 30, progress: Math.min(2, wk.length) },
    { code: 'parceiro', title: 'Compre num mercado parceiro', goal: 1, points: 20, progress: Math.min(1, wk.filter((r) => partnerIds().includes(r.mid)).length) },
    { code: 'rancho', title: 'Uma nota com 15 itens ou mais', goal: 1, points: 20, progress: Math.min(1, wk.filter((r) => (r.items || []).length >= 15).length) },
  ].map((m) => ({ ...m, done: m.progress >= m.goal, paid: paid(m.code) }));
}
function demoStreak(list = sentReceipts()) {
  const weeks = new Set(list.map((r) => dayKey(weekStart(r.at || r.savedAt))));
  let w = weekStart(); if (!weeks.has(dayKey(w))) w.setDate(w.getDate() - 7);
  let n = 0; while (weeks.has(dayKey(w)) && n < 104) { n++; w.setDate(w.getDate() - 7); }
  return n;
}
function demoRewards() {
  const st = dState();
  return partnerIds().flatMap((mid, i) => {
    const m = S.markets.get(mid); if (!m) return [];
    return [
      { id: 900 + i * 2, supermarket_id: mid, market: m.name, slug: m.slug, logo_url: m.logo_url, color: m.color, title: 'R$ 3 de desconto', value: 3, min_spend: 60, cost_points: 150, valid_days: 7, stock_left: 40 },
      { id: 901 + i * 2, supermarket_id: mid, market: m.name, slug: m.slug, logo_url: m.logo_url, color: m.color, title: 'R$ 10 de desconto no rancho', value: 10, min_spend: 200, cost_points: 900, valid_days: 7, stock_left: 15 },
    ];
  }).map((w) => ({ ...w, have: st.codes.some((c) => c.reward_id === w.id && c.status === 'ativo' && new Date(c.expires_at) > Date.now()) }));
}
function demoCofrinho() {
  const st = dState(); const list = sentReceipts();
  const earned = list.reduce((s, r) => s + (r.sent.points || 0), 0) + st.ledger.filter((l) => l.delta > 0).reduce((s, l) => s + l.delta, 0);
  const spent = st.ledger.filter((l) => l.delta < 0).reduce((s, l) => s + l.delta, 0);
  const now = new Date(); const ms = new Date(now.getFullYear(), now.getMonth(), 1); const ys = new Date(now.getFullYear(), 0, 1);
  const inM = list.filter((r) => new Date(r.at || r.savedAt) >= ms);
  return {
    demo: true, enabled: true, balance: earned + spent, earned, level: level(earned), streak: demoStreak(list), missions: demoMissions(list),
    month_points: inM.reduce((s, r) => s + (r.sent.points || 0), 0) + st.ledger.filter((l) => l.delta > 0 && new Date(l.at) >= ms).reduce((s, l) => s + l.delta, 0),
    savings: { month: inM.reduce((s, r) => s + demoSavings(r), 0), year: list.filter((r) => new Date(r.at || r.savedAt) >= ys).reduce((s, r) => s + demoSavings(r), 0), receipts_month: inM.length },
    ledger: st.ledger.slice(0, 15), codes: st.codes.map((c) => ({ ...c, status: c.status === 'ativo' && new Date(c.expires_at) < Date.now() ? 'vencido' : c.status })),
    rewards: demoRewards(),
  };
}
/** na demonstração, os bônus de uma nota recém-enviada são dados aqui */
function demoAward(r) {
  const st = dState(); const add = (delta, kind, ref, note) => {
    if (st.ledger.some((l) => l.kind === kind && l.ref === ref)) return;
    st.ledger.unshift({ delta, kind, ref, note, at: new Date().toISOString(), rkey: r.key });
  };
  add(10, 'dia', dayKey(), 'Primeira nota do dia');
  dSave(st);
  const s = demoStreak(); if (s >= 2) add(Math.min(50, 10 * (s - 1)), 'sequencia', dayKey(weekStart()), `${s} semanas seguidas`);
  for (const m of demoMissions()) if (m.done) add(m.points, 'desafio', `${dayKey(weekStart())}:${m.code}`, `Desafio: ${m.title}`);
  dSave(st);
  const c = demoCofrinho();
  return { demo: true, enabled: true, points: r.sent?.points || 0, fresh: true, savings: demoSavings(r), bonuses: st.ledger.filter((l) => l.rkey === r.key && l.delta > 0),
    balance: c.balance, earned: c.earned, level: c.level, streak: c.streak, missions: c.missions, next_reward: nextReward(c.rewards, c.balance) };
}
function nextReward(rewards, bal) {
  const ok = (rewards || []).filter((w) => !w.have && (w.stock_left == null || w.stock_left > 0));
  const can = ok.filter((w) => w.cost_points <= bal).sort((a, b) => b.value - a.value)[0];
  const x = can || ok.sort((a, b) => a.cost_points - b.cost_points)[0];
  return x ? { ...x, missing: Math.max(0, x.cost_points - bal) } : null;
}

// ================================================================ dados
async function load(force = false) {
  if (!force && data) return data;
  if (loading) return loading;
  const p = (async () => {
    try {
      if (demoMode()) return demoCofrinho();
      if (live()) return await api.myCofrinho();
    } catch { /* sem dados agora */ }
    return null;
  })();
  loading = p;
  try { data = await p; return data; } finally { if (loading === p) loading = null; }
}

// ================================================================ painel (topo de "Minhas notas")
export function panel() {
  queueMicrotask(() => paint());
  return '<section class="cofre" id="cofre" aria-label="Seu cofrinho"><div class="skeleton" style="height:180px"></div></section>';
}

function levelBar(c) {
  const L = c.level || level(c.earned || 0);
  const pct = L.next ? Math.max(4, Math.min(100, ((c.earned - L.min) / (L.next - L.min)) * 100)) : 100;
  return `<div class="cofre__lvl"><span class="lvl lvl--${L.name.toLowerCase()}">${ic('crown')} ${L.name}</span>
    <span class="cofre__bar" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></span>
    <small>${L.next ? `faltam ${nf(L.next - c.earned)} pontos para ${L.next_name}` : 'nível máximo'}</small></div>`;
}
function missionsHTML(ms) {
  return `<ul class="cofre__ms">${(ms || []).map((m) => `<li class="${m.done ? 'is-done' : ''}">
      <span class="ms__ic" aria-hidden="true">${m.done ? ic('check') : `${m.progress}/${m.goal}`}</span>
      <span class="ms__t"><b>${esc(m.title)}</b><span class="ms__bar"><i style="width:${(m.progress / m.goal) * 100}%"></i></span></span>
      <em>${m.done ? 'feito!' : `+${m.points}`}</em></li>`).join('')}</ul>`;
}

async function paint(force = false) {
  const el = $('#cofre'); if (!el) return;
  if (api.MODE === 'live' && !S.user) {
    el.innerHTML = `<div class="cofre__head"><span class="cofre__pig" aria-hidden="true">${ic('piggy')}</span>
      <div><small>Cofrinho</small><b class="cofre__t">Cada nota vale pontos, desconto e mostra quanto você economizou</b></div></div>
      <button class="btn btn--primary btn--block" data-cofre="entrar">Criar conta e começar a juntar</button>`;
    return;
  }
  const c = await load(force); if (!$('#cofre')) return;
  if (!c) { el.remove(); return; }
  const active = (c.codes || []).filter((x) => x.status === 'ativo');
  const mes = MES[new Date().getMonth()];
  $('#cofre').innerHTML = `
    <div class="cofre__head"><span class="cofre__pig" aria-hidden="true">${ic('piggy')}</span>
      <div><small>Seu cofrinho</small><b class="cofre__pts" data-cofre-pts>${nf(c.balance)} <i>pontos</i></b></div>
      <button class="btn btn--primary btn--sm" data-cofre="trocar">${ic('ticket')} Trocar pontos</button></div>
    ${levelBar(c)}
    <div class="cofre__stats">
      <div><span aria-hidden="true">${ic('flame')}</span><b>${c.streak || 0} ${c.streak === 1 ? 'semana' : 'semanas'}</b><small>${c.streak === 1 ? 'com nota' : 'seguidas com nota'}</small></div>
      <div><span aria-hidden="true">${ic('coins')}</span><b>${brl(Number(c.savings?.month || 0))}</b><small>economizados em ${mes}</small></div>
      <div><span aria-hidden="true">${ic('star')}</span><b>${nf(c.month_points)}</b><small>pontos ganhos no mês</small></div>
    </div>
    <div class="cofre__sec"><h3>Desafios da semana <small>renovam toda segunda</small></h3>${missionsHTML(c.missions)}</div>
    ${active.length ? `<div class="cofre__sec"><h3>Seus códigos de desconto</h3><div class="cofre__codes">${active.map((x) => `<button class="code-chip" data-cofre-code="${x.id}">
        ${ic('ticket')}<span><b>${esc(x.title)}</b><small>${esc(x.market)} · vale até ${dShort(x.expires_at)}</small></span><code>${esc(x.code)}</code></button>`).join('')}</div></div>` : ''}
    ${!c.enabled ? '<p class="note small">A troca de pontos está pausada no momento. Seus pontos continuam guardados.</p>' : ''}
    <button class="btn btn--text btn--sm" data-cofre="como">Como ganhar pontos ${ic('down')}</button>`;
}

// ================================================================ telas (folha)
function openSheet(html) {
  $('#toolSheet').dataset.tool = 'cofre';
  $('#toolBody').innerHTML = html;
  if ($('#toolSheet').hidden) hooks.openSheet('#toolSheet');
}

async function catalog() {
  const c = await load(true); if (!c) return;
  const rs = c.rewards || [];
  const byM = new Map(); for (const w of rs) { if (!byM.has(w.supermarket_id)) byM.set(w.supermarket_id, []); byM.get(w.supermarket_id).push(w); }
  openSheet(`<div class="tool cofre-cat"><h2 class="sheet__title" id="toolTitle">${ic('ticket')} Trocar pontos</h2>
    <p class="cofre-cat__bal">Você tem <b>${nf(c.balance)} pontos</b></p>
    ${!rs.length ? `<div class="notas-empty"><span aria-hidden="true">${ic('piggy')}</span><p><b>Os supermercados parceiros estão preparando as recompensas.</b> Seus pontos ficam guardados no cofrinho e você é avisado quando a primeira chegar.</p></div>`
      : [...byM].map(([mid, ws]) => { const m = S.markets.get(mid) || { name: ws[0].market, color: ws[0].color, logo_url: ws[0].logo_url, slug: ws[0].slug };
        return `<section class="cat-m"><h3>${logo(m, 'sm')} ${esc(m.name)}</h3><ul>${ws.map((w) => {
          const falta = Math.max(0, w.cost_points - c.balance); const out = w.stock_left === 0;
          return `<li class="cat-r ${falta || out || w.have ? '' : 'is-ok'}"><span class="cat-r__v">${money(w.value)}</span>
            <span class="cat-r__t"><b>${esc(w.title)}</b><small>${Number(w.min_spend) ? `em compras acima de ${brl(Number(w.min_spend))} · ` : ''}vale ${w.valid_days} dias${w.stock_left != null && w.stock_left <= 20 ? ` · restam ${w.stock_left} este mês` : ''}</small></span>
            ${w.have ? '<span class="pill pill--ok">Você já tem</span>' : out ? '<span class="pill">Esgotado</span>'
              : falta ? `<span class="cat-r__need"><b>${nf(w.cost_points)}</b><small>faltam ${nf(falta)}</small></span>`
              : `<button class="btn btn--primary btn--sm" data-cofre-redeem="${w.id}">${nf(w.cost_points)} pts</button>`}</li>`; }).join('')}</ul></section>`; }).join('')}
    <p class="muted small">O desconto é pago pelo supermercado. Mostre o código no caixa ou só mande a nota da compra: o código é usado sozinho. Se não usar até a data, o código vence e os pontos não voltam (antes disso, dá para desistir e receber os pontos de volta).</p>
    <div class="tool__actions"><button class="btn btn--ghost btn--block" data-cofre="extrato">${ic('list')} Extrato de pontos</button><button class="btn btn--text" data-close>Fechar</button></div></div>`);
}

function codeView(x) {
  openSheet(`<div class="tool cofre-code"><h2 class="sheet__title" id="toolTitle">${ic('ticket')} ${esc(x.title)}</h2>
    <p class="muted">${esc(x.market)}${Number(x.min_spend) ? ` · em compras acima de ${brl(Number(x.min_spend))}` : ''}</p>
    <div class="big-code" aria-label="Código ${esc(x.code)}">${esc(x.code).replace(/(.{4})/, '$1 ')}</div>
    <p class="center"><b>Vale até ${new Date(x.expires_at).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</b></p>
    <ol class="cofre-steps"><li>Mostre este código no caixa do ${esc(x.market)}.</li><li>Ou pague normalmente e mande a nota aqui: o desconto da próxima compra é comprovado pela nota e o código é dado como usado.</li></ol>
    <div class="tool__actions"><button class="btn btn--primary btn--xl" data-close>Pronto</button>
      ${x.status === 'ativo' ? `<button class="btn btn--text" data-cofre-cancel="${x.id}">Desistir e devolver ${nf(x.cost_points)} pontos</button>` : ''}</div></div>`);
}

async function extrato() {
  const c = await load(true); if (!c) return;
  const name = { dia: 'Primeira nota do dia', sequencia: 'Semanas seguidas', desafio: 'Desafio', troca: 'Troca', estorno: 'Pontos devolvidos', ajuste: 'Ajuste' };
  const codes = (c.codes || []).filter((x) => x.status !== 'ativo');
  openSheet(`<div class="tool"><h2 class="sheet__title" id="toolTitle">${ic('list')} Extrato de pontos</h2>
    <p class="muted small">Os pontos de cada nota aparecem em Minhas notas. Aqui ficam os bônus e as trocas.</p>
    <ul class="cofre-ext">${(c.ledger || []).map((l) => `<li><span><b>${esc(l.note || name[l.kind] || l.kind)}</b><small>${new Date(l.at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</small></span><em class="${l.delta < 0 ? 'is-neg' : ''}">${l.delta > 0 ? '+' : ''}${nf(l.delta)}</em></li>`).join('') || '<li class="muted">Nenhum bônus ainda. Mande a próxima nota!</li>'}</ul>
    ${codes.length ? `<h3>Códigos anteriores</h3><ul class="cofre-ext">${codes.map((x) => `<li><span><b>${esc(x.title)}</b><small>${esc(x.market)} · ${x.status === 'usado' ? `usado em ${dShort(x.used_at)}` : x.status}</small></span><code>${esc(x.code)}</code></li>`).join('')}</ul>` : ''}
    <div class="tool__actions"><button class="btn btn--ghost btn--block" data-cofre="trocar">Voltar</button></div></div>`);
}

function como() {
  openSheet(`<div class="tool"><h2 class="sheet__title" id="toolTitle">${ic('piggy')} Como ganhar pontos</h2>
    <ul class="cofre-how">
      <li><b>20 a 150 pontos</b><span>por nota enviada (o dobro em mercado parceiro)</span></li>
      <li><b>+10</b><span>na primeira nota de cada dia</span></li>
      <li><b>+10 a +50</b><span>a cada semana seguida com pelo menos uma nota</span></li>
      <li><b>+20 a +30</b><span>por desafio da semana cumprido</span></li>
    </ul>
    <p class="muted small">Vale para notas enviadas em até 3 dias depois da compra. Os níveis (Prata, Ouro e Diamante) contam todos os pontos que você já ganhou. Os pontos viram descontos oferecidos pelos supermercados em Trocar pontos. Nada aqui é sorteio: o que está escrito é o que você ganha.</p>
    <div class="tool__actions"><button class="btn btn--primary btn--xl" data-close>Entendi</button></div></div>`);
}

// ================================================================ comemoração depois de mandar a nota
export async function celebrate(sv, rec) {
  const box = $('#notaRewards'); if (!box) return;
  let R = null;
  try {
    if (demoMode()) R = demoAward(rec);
    else if (live() && sv.receipt_id) R = await api.receiptRewards(sv.receipt_id);
  } catch { R = null; }
  if (!R || !$('#notaRewards')) { box.remove(); return; }
  const bonus = (R.bonuses || []).reduce((s, b) => s + b.delta, 0);
  const pts = $('.fx-done__pts'); if (pts && bonus) { pts.textContent = `+${nf((R.points || 0) + bonus)} pts`; bump(pts, 'fx-pop'); }
  const nx = R.next_reward;
  box.innerHTML = `
    ${Number(R.savings) >= 0.5 ? `<div class="rw-save"><span aria-hidden="true">${ic('coins')}</span><div><small>Nesta compra você economizou</small><b>${brl(Number(R.savings))}</b><small>comparado com a média dos outros mercados hoje</small></div></div>` : ''}
    ${(R.bonuses || []).length ? `<ul class="rw-bonus">${R.bonuses.map((b) => `<li><b>+${nf(b.delta)}</b> ${esc(b.note || '')}</li>`).join('')}</ul>` : ''}
    <div class="rw-row"><span>${ic('flame')} <b>${R.streak || 0}</b> ${R.streak === 1 ? 'semana seguida' : 'semanas seguidas'}</span><span>${ic('piggy')} <b>${nf(R.balance)}</b> pontos no cofrinho</span></div>
    ${R.reward_used ? `<p class="rw-used">${ic('ticket')} Seu código <b>${esc(R.reward_used.code)}</b> (${brl(Number(R.reward_used.value))}) foi comprovado por esta nota.</p>` : ''}
    ${nx ? (nx.missing ? `<p class="rw-next">Faltam <b>${nf(nx.missing)} pontos</b> para trocar por <b>${esc(nx.title)}</b> no ${esc(nx.market)}.</p>`
      : `<button class="btn btn--primary btn--block rw-can" data-cofre-redeem="${nx.id}">${ic('ticket')} Já dá para trocar: ${esc(nx.title)} no ${esc(nx.market)}</button>`) : ''}
    ${R.missions ? `<details class="rw-ms"><summary>Desafios da semana</summary>${missionsHTML(R.missions)}</details>` : ''}`;
  if (bonus || Number(R.savings) >= 0.5) haptic('success');
  data = null; paint(true); // o painel recarrega
}

// ================================================================ ações
async function redeem(id, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Trocando…'; }
  try {
    let out;
    if (demoMode()) {
      const w = demoRewards().find((x) => x.id === id); const c = demoCofrinho();
      if (!w) throw new Error('Esta recompensa não está mais disponível.');
      if (w.have) throw new Error('Você já tem um código desta recompensa. Use-o antes de trocar de novo.');
      if (c.balance < w.cost_points) throw new Error(`Faltam ${nf(w.cost_points - c.balance)} pontos para esta troca.`);
      const st = dState(); const exp = new Date(); exp.setDate(exp.getDate() + w.valid_days); exp.setHours(23, 59, 59, 0);
      out = { id: Date.now(), reward_id: w.id, code: 'TB' + Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[01OIL]/g, 'X'), title: w.title, value: w.value,
        min_spend: w.min_spend, market: w.market, supermarket_id: w.supermarket_id, cost_points: w.cost_points, created_at: new Date().toISOString(), expires_at: exp.toISOString(), status: 'ativo' };
      st.codes.unshift(out); st.ledger.unshift({ delta: -w.cost_points, kind: 'troca', ref: String(out.id), note: w.title, at: out.created_at }); dSave(st);
    } else {
      out = { ...(await api.redeemReward(id)), status: 'ativo' };
    }
    haptic('success'); data = null;
    codeView(out);
    paint(true);
  } catch (e) {
    hooks.toast?.(e.message || 'Não deu para trocar agora.', 'warn');
    if (btn) { btn.disabled = false; btn.textContent = 'Tentar de novo'; }
  }
}

async function cancel(id) {
  if (!confirm('Desistir deste código? Os pontos voltam para o seu cofrinho.')) return;
  try {
    if (demoMode()) {
      const st = dState(); const x = st.codes.find((c) => c.id === id); if (!x || x.status !== 'ativo') throw new Error('Este código não pode mais ser cancelado.');
      x.status = 'cancelado'; st.ledger.unshift({ delta: x.cost_points, kind: 'estorno', ref: String(id), note: `Troca cancelada: ${x.title}`, at: new Date().toISOString() }); dSave(st);
    } else await api.cancelReward(id);
    hooks.toast?.('Pontos devolvidos ao cofrinho.');
    data = null; hooks.closeSheet('#toolSheet'); paint(true);
  } catch (e) { hooks.toast?.(e.message || 'Não deu para cancelar agora.', 'warn'); }
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-cofre], [data-cofre-redeem], [data-cofre-code], [data-cofre-cancel]'); if (!t) return;
  const d = t.dataset;
  if (d.cofre === 'entrar') return hooks.openAuth?.('signup', 'Crie sua conta para juntar pontos com as suas notas e trocar por descontos.');
  if (d.cofre === 'trocar') return catalog();
  if (d.cofre === 'extrato') return extrato();
  if (d.cofre === 'como') return como();
  if (d.cofreRedeem) return redeem(Number(d.cofreRedeem), t);
  if (d.cofreCancel) return cancel(Number(d.cofreCancel));
  if (d.cofreCode) { const c = await load(); const x = (c?.codes || []).find((y) => String(y.id) === d.cofreCode); if (x) codeView(x); }
});

/** depois de entrar/sair da conta ou zerar o histórico */
export function reset() { data = null; }
