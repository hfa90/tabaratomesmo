// Portal dos supermercados: painel de métricas, produtos (com fotos), promoções e importação em massa.
import * as api from './api.js';
import * as P from './portal-api.js';
import { lineChart } from './chart.js';
import { $, $$, esc, brl, logo, reduceMotion } from './core.js';
import { hbars, kpi, heatmap, fmtN, pctTxt, DOW } from './viz.js';

const st = {
  user: null, markets: [], mid: null, categories: [],
  catalog: null, promos: null, dash: null, days: 30, rankPeriod: 'm',
  q: '', filter: 'all', cat: 'all', importRows: null, importPhotos: new Map(),
};
const market = () => st.markets.find((m) => m.id === st.mid);
const dateBR = (d) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
const GENDER = { feminino: 'Mulheres', masculino: 'Homens', outro: 'Outro' };

// ---------------------------------------------------------------- utilidades de interface
function toast(msg, kind = '') {
  const wrap = $('#toasts');
  while (wrap.children.length >= 2) wrap.firstElementChild.remove();
  const t = document.createElement('div'); t.className = `toast ${kind ? 'toast--' + kind : ''}`; t.textContent = msg;
  wrap.append(t); requestAnimationFrame(() => t.classList.add('is-in'));
  setTimeout(() => { t.classList.remove('is-in'); setTimeout(() => t.remove(), 300); }, 4200);
}
function openSheet(html) {
  $('#ptSheetBody').innerHTML = html;
  const el = $('#ptSheet'); el.hidden = false; document.body.classList.add('no-scroll');
  requestAnimationFrame(() => el.classList.add('is-open'));
  setTimeout(() => $('#ptSheetBody input:not([type=hidden]), #ptSheetBody select')?.focus({ preventScroll: true }), 80);
}
function closeSheet() {
  const el = $('#ptSheet'); if (el.hidden) return;
  el.classList.remove('is-open');
  setTimeout(() => { el.hidden = true; document.body.classList.remove('no-scroll'); }, reduceMotion ? 0 : 250);
}
let downOut = false;
document.addEventListener('pointerdown', (e) => { downOut = e.target.classList?.contains('sheet__backdrop') || e.target.classList?.contains('sheet'); });
document.addEventListener('click', (e) => {
  if (downOut && (e.target.classList.contains('sheet__backdrop') || e.target.classList.contains('sheet'))) closeSheet();
  if (e.target.closest('[data-close]')) closeSheet();
  downOut = false;
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
const parseMoney = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  const n = parseFloat(String(v).replace(/\s|R\$/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};
const banner = () => P.MODE === 'demo'
  ? `<p class="note pt-demo">Modo demonstração: as alterações ficam só neste aparelho e as métricas são simuladas. ${api.MODE === 'live' ? '' : 'O banco ainda não respondeu.'}</p>` : '';

// ---------------------------------------------------------------- acesso
function renderLogin(mode = 'login', msg = '') {
  $('#ptNav').hidden = true; $('#logoutBtn').hidden = true; $('#marketPicker').innerHTML = '';
  const pending = P.MODE === 'pending';
  $('#ptMain').innerHTML = `
    <section class="pt-auth">
      <div class="pt-auth__intro">
        <h1>Área do supermercado</h1>
        <p class="muted">Cadastre e atualize seus produtos e fotos, crie promoções só para quem vem pelo Tá Barato Mesmo? e veja o que o público de Manaus está procurando.</p>
        <ul class="pt-bullets">
          <li><b>Métricas</b> de buscas, marcas, regiões, público e horários de pico</li>
          <li><b>Promoções</b> exclusivas do site ou gerais da loja</li>
          <li><b>Importação</b> de centenas de produtos de uma vez pela planilha</li>
        </ul>
      </div>
      <div class="pt-auth__card">
        ${pending ? `<p class="note">O banco ainda não tem as funções do portal. Rode o <b>supabase/schema.sql</b> atualizado no SQL Editor do Supabase.</p>
          <button class="btn btn--ghost btn--block" data-demo style="margin-top:12px">Ver demonstração do portal</button>` : ''}
        ${!pending && P.MODE === 'demo' ? `<p class="note">Modo demonstração: o banco não respondeu. Entre para conhecer o portal com dados simulados do Coema.</p>
          <button class="btn btn--primary btn--block" data-demo style="margin-top:12px">Entrar na demonstração</button>` : ''}
        ${!pending && P.MODE === 'live' ? (mode === 'login' ? `
          <h2>Entrar</h2>
          <form class="form" id="ptLogin">
            <label>E-mail<input name="email" type="email" autocomplete="email" required /></label>
            <label>Senha<input name="password" type="password" autocomplete="current-password" required /></label>
            <p class="form__err" role="alert">${esc(msg)}</p>
            <button class="btn btn--primary btn--block">Entrar</button>
          </form>
          <p class="small center" style="margin-top:14px">Primeiro acesso? <button class="linkish" data-ptauth="signup">Criar conta com código de convite</button></p>`
        : `
          <h2>Primeiro acesso</h2>
          <p class="muted small">O código de convite é enviado pela equipe do Tá Barato Mesmo? ao responsável pelo supermercado.</p>
          <form class="form" id="ptSignup">
            <label>Seu nome<input name="name" autocomplete="name" required minlength="2" /></label>
            <label>E-mail de trabalho<input name="email" type="email" autocomplete="email" required /></label>
            <label>Senha<input name="password" type="password" autocomplete="new-password" required minlength="6" placeholder="Mínimo 6 caracteres" /></label>
            <label>Código de convite<input name="code" required autocapitalize="characters" placeholder="Ex.: 7F3A9C21" /></label>
            <p class="form__err" role="alert">${esc(msg)}</p>
            <button class="btn btn--primary btn--block">Criar acesso</button>
          </form>
          <p class="small center" style="margin-top:14px">Já tem acesso? <button class="linkish" data-ptauth="login">Entrar</button></p>`) : ''}
      </div>
    </section>`;
}

function renderJoin(msg = '') {
  $('#ptNav').hidden = true; $('#logoutBtn').hidden = false;
  $('#ptMain').innerHTML = `<section class="pt-auth"><div class="pt-auth__card" style="margin:0 auto">
    <h2>Vincular seu supermercado</h2>
    <p class="muted small">Sua conta (${esc(st.user?.email || '')}) ainda não está ligada a nenhum supermercado. Digite o código de convite que você recebeu.</p>
    <form class="form" id="ptJoin"><label>Código de convite<input name="code" required autocapitalize="characters" /></label>
      <p class="form__err" role="alert">${esc(msg)}</p><button class="btn btn--primary btn--block">Vincular</button></form>
    <p class="small muted" style="margin-top:14px">Não tem código? Fale com a equipe do Tá Barato Mesmo?.</p>
  </div></section>`;
}

async function enter() {
  try { st.markets = await P.myMarkets(); } catch (e) { return renderLogin('login', e.message); }
  if (!st.markets.length) return renderJoin();
  const usable = st.markets.filter((m) => !m.blocked);
  if (!usable.length) {
    $('#ptNav').hidden = true; $('#logoutBtn').hidden = false;
    $('#ptMain').innerHTML = `<section class="pt-auth"><div class="pt-auth__card" style="margin:0 auto"><h2>Acesso indisponível</h2><p class="muted">${esc(st.markets[0].blocked)}</p><p class="small muted" style="margin-top:12px">Fale com a equipe do Tá Barato Mesmo? se precisar de ajuda.</p></div></section>`;
    return;
  }
  st.markets = usable;
  const saved = api.store.get('tb.ptMarket');
  st.mid = st.markets.some((m) => m.id === saved) ? saved : st.markets[0].id;
  st.catalog = st.promos = st.dash = null;
  $('#ptNav').hidden = false; $('#logoutBtn').hidden = false;
  renderPicker();
  route();
}

function renderPicker() {
  const m = market();
  $('#marketPicker').innerHTML = st.markets.length > 1
    ? `<label class="pt-picker">${logo(m, 'sm')}<select id="mkSelect" aria-label="Supermercado">${st.markets.map((x) => `<option value="${x.id}" ${x.id === st.mid ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>`
    : `<span class="pt-picker">${logo(m, 'sm')}<b>${esc(m.name)}</b></span>`;
}

// ---------------------------------------------------------------- rotas
function route() {
  if (!st.mid) return;
  const v = (location.hash || '#painel').slice(1);
  const view = ['painel', 'produtos', 'promocoes', 'importar'].includes(v) ? v : 'painel';
  $$('[data-pt]').forEach((a) => a.classList.toggle('is-active', a.dataset.pt === view));
  ({ painel: renderDashboard, produtos: renderProducts, promocoes: renderPromos, importar: renderImport })[view]();
  window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', route);

// ================================================================ PAINEL
async function renderDashboard() {
  const main = $('#ptMain');
  const m = market();
  main.innerHTML = `${banner()}
    <header class="pt-head">
      <div><h1>Painel</h1><p class="muted">Como o público do Tá Barato Mesmo? se comporta e onde o ${esc(m.name)} está ganhando ou perdendo.</p></div>
      <div class="seg" role="radiogroup" aria-label="Período">${[[1, 'Hoje'], [7, '7 dias'], [30, '30 dias'], [90, '90 dias']].map(([d, l]) => `<button role="radio" aria-checked="${st.days === d}" data-days="${d}">${l}</button>`).join('')}</div>
    </header>
    <div id="dash"><div class="skeleton" style="height:420px"></div></div>`;
  let D;
  try { D = st.dash?.days === st.days && st.dash.mid === st.mid ? st.dash.data : await P.dashboard(st.mid, st.days); }
  catch (e) { $('#dash').innerHTML = `<p class="note">Não foi possível carregar as métricas: ${esc(e.message)}</p>`; return; }
  st.dash = { days: st.days, mid: st.mid, data: D };
  const K = D.kpis;
  const share = K.ranchos ? Math.round((K.rancho_wins / K.ranchos) * 100) : 0;
  const per = { d: 'Hoje', w: '7 dias', m: '30 dias' }[st.rankPeriod];
  const rk = (D.ranking || []).map((r) => ({ ...r, b: r['bought_' + st.rankPeriod], w: r['best_' + st.rankPeriod], r: r['route_' + st.rankPeriod] }))
    .map((r) => ({ ...r, score: r.b * 3 + r.w * 2 + r.r })).sort((a, b) => b.score - a.score);
  const myPos = rk.findIndex((r) => r.id === st.mid) + 1;
  const daily = D.daily || [];
  const series = daily.length > 1 ? [
    { id: 1, name: 'Buscas no site', color: '#2a78d6', points: daily.map((x) => ({ t: new Date(x.d + 'T12:00').getTime(), v: x.searches })) },
    { id: 2, name: 'Seus produtos vistos', color: '#eb6834', points: daily.map((x) => ({ t: new Date(x.d + 'T12:00').getTime(), v: x.views })) },
    { id: 3, name: 'Adicionados ao rancho', color: '#1baf7a', points: daily.map((x) => ({ t: new Date(x.d + 'T12:00').getTime(), v: x.adds })) },
  ] : [];
  const gTotal = (D.gender || []).reduce((s, g) => s + g.ranchos, 0) || 1;

  $('#dash').innerHTML = `
    <section class="kpis">
      ${kpi('Pessoas no site', K.people, { prev: K.people_prev })}
      ${kpi('Buscas', K.searches, { prev: K.searches_prev })}
      ${kpi('Seus produtos vistos', K.views, { hint: 'aberturas do detalhe' })}
      ${kpi('No rancho das pessoas', K.adds, { hint: 'seus produtos adicionados' })}
      ${kpi('Rotas até suas lojas', K.routes, { prev: K.routes_prev })}
      ${kpi('Ranchos mais baratos aqui', K.rancho_wins, { hint: `${share}% dos ${fmtN(K.ranchos)} ranchos concluídos`, accent: true })}
      ${kpi('Compras confirmadas', K.bought, { hint: 'clientes que marcaram que compraram aqui' })}
      ${kpi('Índice de preço', K.price_index ?? 100, { fmt: (v) => String(v).replace('.', ','), hint: `100 = média dos concorrentes · ${K.cheapest} de ${K.products} produtos com menor preço` })}
    </section>

    <section class="panel">
      <div class="panel__head"><h2>Quem está vendendo mais</h2>
        <div class="seg seg--sm" role="radiogroup" aria-label="Período do ranking">${[['d', 'Dia'], ['w', 'Semana'], ['m', 'Mês']].map(([k, l]) => `<button role="radio" aria-checked="${st.rankPeriod === k}" data-rank="${k}">${l}</button>`).join('')}</div></div>
      <p class="muted small">Preferência de compra pelo site (${per}): compras confirmadas pelos clientes valem 3 pontos, ranchos que saem mais baratos no mercado valem 2, rotas abertas até a loja valem 1. ${myPos ? `O ${esc(m.name)} está em <b>${myPos}º</b>.` : ''}</p>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>#</th><th>Supermercado</th><th class="r">Compras</th><th class="r">Ranchos mais baratos</th><th class="r">Rotas</th><th class="tbl__bar">Pontos</th></tr></thead>
        <tbody>${rk.map((r, i) => `<tr class="${r.id === st.mid ? 'is-me' : ''}"><td>${i + 1}º</td><td><span class="cell-m">${logo(r, 'xs')} ${esc(r.name)}</span></td>
          <td class="r">${fmtN(r.b)}</td><td class="r">${fmtN(r.w)}</td><td class="r">${fmtN(r.r)}</td>
          <td class="tbl__bar"><span class="mini-bar"><span style="--w:${rk[0].score ? (r.score / rk[0].score) * 100 : 0}%;--c:${r.id === st.mid ? 'var(--brand)' : 'var(--line-2)'}"></span></span><small>${fmtN(r.score)}</small></td></tr>`).join('')}</tbody>
      </table></div>
    </section>

    ${series.length ? `<section class="panel"><div class="panel__head"><h2>Movimento por dia</h2><span class="muted small">toque nas legendas para esconder uma linha</span></div>
      ${lineChart(series, { format: (v) => fmtN(Math.round(v)), label: 'Buscas, produtos vistos e adições por dia' })}</section>` : ''}

    <div class="pt-grid">
      <section class="panel"><div class="panel__head"><h2>O que mais procuram</h2><span class="muted small">buscas no site</span></div>
        ${hbars((D.top_searches || []).slice(0, 10), { label: (r) => esc(r.query), value: (r) => r.n, note: (r) => `${fmtN(r.people)} pessoas` })}</section>
      <section class="panel"><div class="panel__head"><h2>Procuram e não encontram</h2><span class="muted small">oportunidade de cadastro</span></div>
        <p class="muted small">Buscas sem nenhum resultado no site. Quem cadastrar primeiro aparece sozinho.</p>
        ${hbars(D.no_results || [], { label: (r) => esc(r.query), value: (r) => r.n, color: '#eda100' })}
        <a class="btn btn--ghost btn--sm" href="#produtos" data-newprod style="margin-top:12px">Cadastrar produto</a></section>
    </div>

    <section class="panel"><div class="panel__head"><h2>Produtos mais vistos</h2><span class="muted small">e como está o seu preço</span></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Produto</th><th class="r">Vistos</th><th class="r">No rancho</th><th class="r">Seu preço</th><th>Situação</th></tr></thead>
        <tbody>${(D.top_products || []).slice(0, 12).map((p) => `<tr><td><span class="cell-m">${p.emoji || '🛒'} <span>${esc(p.name)}<small class="muted"> ${esc([p.brand, p.unit].filter(Boolean).join(' · '))}</small></span></span></td>
          <td class="r">${fmtN(p.views)}</td><td class="r">${fmtN(p.adds)}</td><td class="r">${p.my_price != null ? brl(Number(p.my_price)) : '–'}</td>
          <td>${p.my_price == null ? '<span class="pill pill--soft">Você não vende</span>' : p.is_best ? '<span class="pill pill--ok">Menor preço</span>' : `<span class="pill pill--warn">+${brl(Number(p.my_price) - Number(p.best))}</span>`}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Sem dados no período.</td></tr>'}</tbody>
      </table></div></section>

    <div class="pt-grid">
      <section class="panel"><div class="panel__head"><h2>Marcas mais procuradas</h2></div>
        ${hbars(D.top_brands || [], { label: (r) => esc(r.brand), value: (r) => r.n, note: (r) => `${fmtN(r.adds)} no rancho` })}</section>
      <section class="panel"><div class="panel__head"><h2>Categorias</h2></div>
        ${hbars(D.top_categories || [], { label: (r) => `${r.icon || ''} ${esc(r.name)}`, value: (r) => r.n })}</section>
    </div>

    <div class="pt-grid">
      <section class="panel"><div class="panel__head"><h2>Regiões que mais consultam</h2><span class="muted small">zonas de Manaus</span></div>
        ${hbars(D.zones || [], { label: (r) => esc(r.zone), value: (r) => r.searches, note: (r) => `${fmtN(r.ranchos)} ranchos · ${fmtN(r.adds)} itens no rancho · ${fmtN(r.routes_me)} rotas para você` })}</section>
      <section class="panel"><div class="panel__head"><h2>Bairros com mais rancho</h2></div>
        ${(D.neighborhoods || []).length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Bairro</th><th>Zona</th><th class="r">Buscas</th><th class="r">Ranchos</th></tr></thead>
          <tbody>${[...D.neighborhoods].sort((a, b) => b.ranchos - a.ranchos).map((n) => `<tr><td>${esc(n.neighborhood)}</td><td class="muted">${esc(n.zone || '')}</td><td class="r">${fmtN(n.searches)}</td><td class="r">${fmtN(n.ranchos)}</td></tr>`).join('')}</tbody></table></div>`
          : '<p class="muted small">Aparece quando um bairro tiver pelo menos 5 pessoas no período.</p>'}</section>
    </div>

    <div class="pt-grid">
      <section class="panel"><div class="panel__head"><h2>Quem faz o rancho</h2><span class="muted small">por sexo, cadastro completo</span></div>
        ${(D.gender || []).length ? `<div class="stack" role="img" aria-label="Divisão dos ranchos por sexo">${D.gender.map((g, i) => `<span style="--w:${(g.ranchos / gTotal) * 100}%;--c:${['#2a78d6', '#eb6834', '#1baf7a'][i] || '#888'}" title="${GENDER[g.gender] || g.gender}: ${fmtN(g.ranchos)} ranchos"></span>`).join('')}</div>
          <ul class="legend legend--row">${D.gender.map((g, i) => `<li><span class="dot" style="--c:${['#2a78d6', '#eb6834', '#1baf7a'][i] || '#888'}"></span><span>${GENDER[g.gender] || esc(g.gender)}<br/><small>${fmtN(g.people)} pessoas · ${fmtN(g.adds)} itens no rancho</small></span><b>${Math.round((g.ranchos / gTotal) * 100)}%</b></li>`).join('')}</ul>`
          : '<p class="muted small">Aparece quando houver pelo menos 5 pessoas por grupo com cadastro completo.</p>'}
      </section>
      <section class="panel"><div class="panel__head"><h2>Faixa etária</h2></div>
        ${hbars(D.age || [], { label: (r) => `${esc(r.age_band)} anos`, value: (r) => r.people, note: (r) => `${fmtN(r.ranchos)} ranchos e itens`, color: '#6250d6' })}</section>
    </div>

    <section class="panel"><div class="panel__head"><h2>Horários de pico</h2><span class="muted small">buscas, produtos vistos e adições (horário de Manaus)</span></div>
      ${heatmap(D.hours)}</section>

    <section class="panel"><div class="panel__head"><h2>Onde você está perdendo clientes</h2><span class="muted small">produtos procurados em que outro mercado está mais barato</span></div>
      ${(D.opportunities || []).length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Produto</th><th class="r">Procura</th><th class="r">Seu preço</th><th class="r">Menor</th><th class="r">Diferença</th><th></th></tr></thead>
        <tbody>${D.opportunities.map((o) => `<tr><td><span class="cell-m">${o.emoji || '🛒'} ${esc(o.name)}</span></td><td class="r">${fmtN(o.demand)}</td><td class="r">${brl(Number(o.my_price))}</td><td class="r">${brl(Number(o.best))}</td>
          <td class="r up">+${brl(Number(o.gap))}</td><td class="r"><button class="btn btn--ghost btn--sm" data-edit="${o.id}">Ajustar</button></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted small">Nenhum produto procurado está mais caro que a concorrência. Ótimo!</p>'}</section>

    <section class="panel"><div class="panel__head"><h2>Promoções no ar</h2><a class="linkish small" href="#promocoes">Gerenciar</a></div>
      ${(D.promos || []).length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Produto</th><th>Tipo</th><th class="r">Preço</th><th class="r">Vistos</th><th class="r">No rancho</th><th>Até</th></tr></thead>
        <tbody>${D.promos.map((p) => `<tr><td>${p.emoji || ''} ${esc(p.name || '')}</td><td>${p.kind === 'exclusiva' ? `<span class="pill pill--excl">Exclusiva</span> <code>${esc(p.code || '')}</code>` : '<span class="pill pill--promo">Geral</span>'}</td>
          <td class="r">${brl(Number(p.promo_price))}</td><td class="r">${fmtN(p.views)}</td><td class="r">${fmtN(p.adds)}</td><td>${dateBR(p.ends_at)}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted small">Nenhuma promoção no ar. Promoções exclusivas aparecem em destaque no topo do site.</p>'}</section>

    <p class="muted small">Privacidade: os números são agregados e anônimos. Dados de bairro, sexo e idade só aparecem em grupos de 5 pessoas ou mais.${D.demo ? ' Métricas simuladas (demonstração).' : ''}</p>`;
}

// ================================================================ PRODUTOS
async function loadCatalog(force = false) {
  if (!st.catalog || force) st.catalog = await P.catalog(st.mid);
  if (!st.categories.length) {
    const data = await api.loadCatalog().catch(() => null);
    st.categories = data?.categories || [];
  }
  return st.catalog;
}

function productRow(r) {
  const pos = r.rank === 1 ? `<span class="pill pill--ok">Menor preço${r.n_markets > 1 ? ` de ${r.n_markets}` : ''}</span>`
    : r.min_other != null ? `<span class="pill pill--warn">${r.rank}º · +${brl(r.price - r.min_other)}</span>` : '';
  return `<tr class="${r.active ? '' : 'is-off'}" data-row="${r.product_id}">
    <td><button class="thumb" data-photo="${r.product_id}" title="Trocar foto" aria-label="Trocar foto de ${esc(r.name)}">${r.image_url ? `<img src="${esc(r.image_url)}" alt="" loading="lazy" />` : `<span>${r.emoji || '🛒'}</span><i>+ foto</i>`}</button></td>
    <td><b>${esc(r.name)}</b><small class="muted">${esc([r.brand, r.unit].filter(Boolean).join(' · '))}${r.ean ? ` · EAN ${esc(r.ean)}` : ''}${r.sku ? ` · ${esc(r.sku)}` : ''}</small></td>
    <td class="r"><label class="price-in"><span>R$</span><input inputmode="decimal" value="${r.price.toFixed(2).replace('.', ',')}" data-price="${r.product_id}" aria-label="Preço de ${esc(r.name)}" ${r.active ? '' : 'disabled'} /></label>
      <small class="muted">${dateBR(r.price_at)}</small></td>
    <td>${r.active ? pos : '<span class="pill pill--soft">Removido</span>'} ${r.promo_price ? `<span class="pill ${r.promo_kind === 'exclusiva' ? 'pill--excl' : 'pill--promo'}">${brl(r.promo_price)}</span>` : ''}</td>
    <td class="r nowrap">
      ${r.active ? `<button class="btn btn--ghost btn--sm" data-promo-for="${r.product_id}">Promoção</button>
      <button class="icon-btn" data-edit="${r.product_id}" aria-label="Editar" title="Editar"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg></button>
      <button class="icon-btn" data-remove="${r.product_id}" aria-label="Remover" title="Remover do site"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg></button>`
      : `<button class="btn btn--ghost btn--sm" data-restore="${r.product_id}">Reativar</button>`}
    </td>
  </tr>`;
}

function filteredCatalog() {
  const n = (s) => (s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const q = n(st.q);
  return (st.catalog || []).filter((r) => {
    if (q && !n(`${r.name} ${r.brand} ${r.ean} ${r.sku}`).includes(q)) return false;
    if (st.cat !== 'all' && r.category !== st.cat) return false;
    switch (st.filter) {
      case 'best': return r.active && r.rank === 1;
      case 'worse': return r.active && r.rank > 1;
      case 'nophoto': return r.active && !r.image_url;
      case 'promo': return r.active && r.promo_price;
      case 'off': return !r.active;
      default: return true;
    }
  });
}

function renderProductRows() {
  const rows = filteredCatalog();
  $('#prodBody').innerHTML = rows.map(productRow).join('') || `<tr><td colspan="5" class="muted center" style="padding:28px">Nenhum produto com esses filtros.</td></tr>`;
  $('#prodCount').textContent = `${rows.length} de ${st.catalog.length}`;
}

async function renderProducts() {
  const main = $('#ptMain');
  main.innerHTML = `${banner()}<header class="pt-head"><div><h1>Produtos</h1><p class="muted">Edite o preço direto na tabela (salva ao sair do campo). Toque na foto para trocar.</p></div>
    <div class="row-actions"><button class="btn btn--ghost" data-bulkphotos>Fotos em massa</button><button class="btn btn--primary" data-newprod>+ Novo produto</button></div></header>
    <div id="prodWrap"><div class="skeleton" style="height:300px"></div></div>`;
  try { await loadCatalog(); } catch (e) { $('#prodWrap').innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
  const c = st.catalog;
  const cnt = { best: c.filter((r) => r.active && r.rank === 1).length, worse: c.filter((r) => r.active && r.rank > 1).length,
    nophoto: c.filter((r) => r.active && !r.image_url).length, promo: c.filter((r) => r.active && r.promo_price).length, off: c.filter((r) => !r.active).length };
  $('#prodWrap').innerHTML = `
    <div class="pt-tools">
      <label class="search search--sm"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 3a7.5 7.5 0 1 0 4.6 13.4l4.7 4.7 1.4-1.4-4.7-4.7A7.5 7.5 0 0 0 10.5 3zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z" fill="currentColor"/></svg>
        <input id="prodSearch" type="search" placeholder="Buscar por nome, marca, EAN ou código" value="${esc(st.q)}" /></label>
      <select class="input sel" id="prodCat" aria-label="Categoria"><option value="all">Todas as categorias</option>${st.categories.map((x) => `<option value="${x.slug}" ${st.cat === x.slug ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
    </div>
    <div class="chips" style="margin-bottom:12px">${[['all', 'Todos', c.length], ['best', 'Menor preço', cnt.best], ['worse', 'Mais caros', cnt.worse], ['nophoto', 'Sem foto', cnt.nophoto], ['promo', 'Em promoção', cnt.promo], ['off', 'Removidos', cnt.off]]
      .map(([k, l, n]) => `<button class="chip ${st.filter === k ? 'is-on' : ''}" data-pfilter="${k}">${l} <small>${n}</small></button>`).join('')}</div>
    <div class="tbl-wrap panel" style="padding:0"><table class="tbl tbl--prod">
      <thead><tr><th style="width:64px">Foto</th><th>Produto</th><th class="r">Seu preço</th><th>Posição</th><th></th></tr></thead>
      <tbody id="prodBody"></tbody></table></div>
    <p class="muted small" id="prodCount" style="margin-top:8px"></p>
    <input type="file" id="photoInput" accept="image/*" hidden />
    <input type="file" id="bulkPhotoInput" accept="image/*" multiple hidden />`;
  renderProductRows();
}

function productForm(r = {}) {
  const isNew = !r.product_id;
  const editable = isNew || r.own;
  openSheet(`<h2 class="sheet__title" id="ptSheetTitle">${isNew ? 'Novo produto' : 'Editar produto'}</h2>
    ${!editable ? '<p class="muted small">Este produto é do catálogo comum do site: você altera preço, foto e código interno. Nome e marca são mantidos pela equipe.</p>' : ''}
    <form class="form" id="prodForm">
      <input type="hidden" name="product_id" value="${r.product_id || ''}" />
      <div class="photo-pick">
        <button type="button" class="thumb thumb--lg" data-pickphoto>${r.image_url ? `<img src="${esc(r.image_url)}" alt="" />` : `<span>${r.emoji || '📷'}</span><i>Adicionar foto</i>`}</button>
        <p class="muted small">Foto real do produto, fundo claro. JPG, PNG ou WebP. Reduzimos o tamanho automaticamente.</p>
        <input type="file" name="photo" accept="image/*" hidden />
        <input type="hidden" name="image_url" value="${esc(r.image_url || '')}" />
      </div>
      <label>Nome do produto<input name="name" required value="${esc(r.name || '')}" ${editable ? '' : 'readonly'} placeholder="Ex.: Arroz tipo 1" /></label>
      <div class="form__row">
        <label>Marca<input name="brand" value="${esc(r.brand || '')}" ${editable ? '' : 'readonly'} placeholder="Ex.: Tio João" /></label>
        <label>Tamanho<input name="unit" value="${esc(r.unit || '')}" ${editable ? '' : 'readonly'} placeholder="Ex.: 5 kg" /></label>
      </div>
      <div class="form__row">
        <label>Categoria<select name="category" ${editable ? '' : 'disabled'}>${st.categories.map((x) => `<option value="${x.slug}" ${r.category === x.slug ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label>Preço (R$)<input name="price" inputmode="decimal" required value="${r.price != null ? r.price.toFixed(2).replace('.', ',') : ''}" placeholder="0,00" /></label>
      </div>
      <div class="form__row">
        <label>Código de barras (EAN)<input name="ean" inputmode="numeric" value="${esc(r.ean || '')}" ${editable ? '' : 'readonly'} /></label>
        <label>Código interno (SKU)<input name="sku" value="${esc(r.sku || '')}" /></label>
      </div>
      <label>Emoji (aparece quando não há foto)<input name="emoji" maxlength="4" value="${esc(r.emoji || '')}" ${editable ? '' : 'readonly'} placeholder="🛒" /></label>
      <p class="form__err" role="alert"></p>
      <button class="btn btn--primary btn--block">${isNew ? 'Cadastrar produto' : 'Salvar alterações'}</button>
    </form>`);
}

function promoForm(r, existing = null) {
  const now = new Date(); const end = new Date(Date.now() + 7 * 864e5);
  const d = (x) => new Date(x).toISOString().slice(0, 10);
  const p = existing || {};
  openSheet(`<h2 class="sheet__title" id="ptSheetTitle">${p.id ? 'Editar promoção' : 'Nova promoção'}</h2>
    <form class="form" id="promoForm">
      <input type="hidden" name="promo_id" value="${p.id || ''}" />
      ${r ? `<input type="hidden" name="product_id" value="${r.product_id}" /><div class="fx-prod"><span>${r.emoji || '🛒'}</span><div><b>${esc(r.name)}</b><small class="muted">${esc([r.brand, r.unit].filter(Boolean).join(' · '))} · preço atual ${brl(r.price)}</small></div></div>`
        : `<label>Produto<select name="product_id" required>${(st.catalog || []).filter((x) => x.active).map((x) => `<option value="${x.product_id}" ${p.product_id === x.product_id ? 'selected' : ''}>${esc(x.name)} ${esc(x.brand || '')} ${esc(x.unit || '')} · ${brl(x.price)}</option>`).join('')}</select></label>`}
      <fieldset class="pick"><legend>Tipo de promoção</legend>
        <label class="pick__i"><input type="radio" name="kind" value="exclusiva" ${p.kind !== 'geral' ? 'checked' : ''} /><span><b>Exclusiva do Tá Barato Mesmo?</b><br/><small class="muted">Só para quem vem pelo site. O cliente mostra o código no caixa. Aparece em destaque.</small></span></label>
        <label class="pick__i"><input type="radio" name="kind" value="geral" ${p.kind === 'geral' ? 'checked' : ''} /><span><b>Geral da loja</b><br/><small class="muted">Vale para todo mundo, dentro e fora do site (encarte, loja física).</small></span></label>
      </fieldset>
      <div class="form__row">
        <label>Preço promocional (R$)<input name="promo_price" inputmode="decimal" required value="${p.promo_price ? Number(p.promo_price).toFixed(2).replace('.', ',') : ''}" placeholder="0,00" /></label>
        <label>Limite por cliente<input name="max_per_client" inputmode="numeric" value="${p.max_per_client || ''}" placeholder="Sem limite" /></label>
      </div>
      <div class="form__row">
        <label>Começa em<input name="starts_at" type="date" required value="${d(p.starts_at || now)}" /></label>
        <label>Termina em<input name="ends_at" type="date" required value="${d(p.ends_at || end)}" /></label>
      </div>
      <label class="excl-only">Código para o caixa (opcional)<input name="code" maxlength="16" value="${esc(p.code || '')}" placeholder="Gerado automaticamente" autocapitalize="characters" /></label>
      <label>Título (opcional)<input name="title" maxlength="60" value="${esc(p.title || '')}" placeholder="Ex.: Semana da carne" /></label>
      <p class="form__err" role="alert"></p>
      <button class="btn btn--primary btn--block">${p.id ? 'Salvar promoção' : 'Publicar promoção'}</button>
    </form>`);
}

// ================================================================ PROMOÇÕES
async function renderPromos() {
  const main = $('#ptMain');
  main.innerHTML = `${banner()}<header class="pt-head"><div><h1>Promoções</h1><p class="muted">Exclusivas aparecem em destaque no site com um código para o caixa. Gerais mostram o preço de oferta para todo mundo.</p></div>
    <button class="btn btn--primary" data-newpromo>+ Nova promoção</button></header><div id="promoWrap"><div class="skeleton" style="height:240px"></div></div>`;
  try { await loadCatalog(); st.promos = await P.promos(st.mid); } catch (e) { $('#promoWrap').innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
  const name = (pid) => st.catalog.find((x) => x.product_id === pid) || { name: `Produto ${pid}` };
  const now = Date.now();
  const groups = [
    ['No ar', st.promos.filter((p) => p.active && new Date(p.starts_at) <= now && new Date(p.ends_at) > now)],
    ['Agendadas', st.promos.filter((p) => p.active && new Date(p.starts_at) > now)],
    ['Encerradas', st.promos.filter((p) => !p.active || new Date(p.ends_at) <= now).slice(0, 30)],
  ];
  $('#promoWrap').innerHTML = groups.map(([t, arr]) => `<section class="panel" style="margin-bottom:14px"><div class="panel__head"><h2>${t}</h2><span class="muted small">${arr.length}</span></div>
    ${arr.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Produto</th><th>Tipo</th><th class="r">De</th><th class="r">Por</th><th>Período</th><th></th></tr></thead><tbody>
    ${arr.map((p) => { const r = name(p.product_id); return `<tr><td><span class="cell-m">${r.emoji || '🛒'} <span>${esc(r.name)}${p.title ? `<small class="muted"> · ${esc(p.title)}</small>` : ''}</span></span></td>
      <td>${p.kind === 'exclusiva' ? `<span class="pill pill--excl">Exclusiva</span> <code>${esc(p.code || '')}</code>` : '<span class="pill pill--promo">Geral</span>'}</td>
      <td class="r muted">${r.price ? brl(r.price) : '–'}</td><td class="r"><b>${brl(Number(p.promo_price))}</b></td>
      <td class="nowrap">${dateBR(p.starts_at)} – ${dateBR(p.ends_at)}</td>
      <td class="r nowrap">${t !== 'Encerradas' ? `<button class="btn btn--ghost btn--sm" data-editpromo="${p.id}">Editar</button> <button class="btn btn--text btn--sm" data-endpromo="${p.id}">Encerrar</button>` : ''}</td></tr>`; }).join('')}
    </tbody></table></div>` : '<p class="muted small">Nada por aqui.</p>'}</section>`).join('');
}

// ================================================================ IMPORTAÇÃO
const COLS = { // cabeçalho da planilha (normalizado) → campo
  ean: 'ean', 'codigo de barras': 'ean', 'codigo de barras (ean)': 'ean', 'ean (codigo de barras)': 'ean',
  sku: 'sku', 'codigo interno': 'sku', 'codigo interno (sku)': 'sku',
  nome: 'nome', 'nome do produto': 'nome', produto: 'nome', marca: 'marca',
  unidade: 'unidade', tamanho: 'unidade', 'tamanho / unidade': 'unidade', 'unidade / tamanho': 'unidade', embalagem: 'unidade',
  categoria: 'categoria', preco: 'preco', 'preco (r$)': 'preco', 'preco normal (r$)': 'preco',
  'preco promocional': 'preco_promo', 'preco promocional (r$)': 'preco_promo', 'tipo de promocao': 'tipo_promo',
  'inicio da promocao': 'inicio_promo', 'fim da promocao': 'fim_promo', 'url da foto': 'foto_url', foto: 'foto_url', emoji: 'emoji',
};
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
const toISODate = (v) => {
  if (v == null || v === '') return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10); // data serial do Excel
  const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : 'invalida';
};

async function loadXLSX() {
  if (window.XLSX) return window.XLSX;
  await new Promise((res, rej) => {
    const s = Object.assign(document.createElement('script'), { src: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', onload: res, onerror: () => rej(new Error('Não foi possível carregar o leitor de planilhas. Verifique a conexão.')) });
    document.head.append(s);
  });
  return window.XLSX;
}

async function parseSheet(file) {
  const X = await loadXLSX();
  const wb = X.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const ws = wb.Sheets['Produtos'] || wb.Sheets[wb.SheetNames[0]];
  const grid = X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  const hi = grid.findIndex((row) => row.some((c) => COLS[norm(c)] === 'nome'));
  if (hi < 0) throw new Error('Não encontrei a coluna “Nome do produto”. Use o modelo da planilha.');
  const map = grid[hi].map((c) => COLS[norm(c)] || null);
  const cats = new Map(st.categories.flatMap((c) => [[norm(c.slug), c.slug], [norm(c.name), c.slug]]));
  const rows = [];
  for (let i = hi + 1; i < grid.length; i++) {
    const r = { _linha: i + 1 }; let any = false;
    map.forEach((k, j) => { if (k) { r[k] = grid[i][j]; if (String(grid[i][j]).trim() !== '') any = true; } });
    if (!any) continue;
    const errs = [];
    r.nome = String(r.nome || '').trim(); r.marca = String(r.marca || '').trim(); r.unidade = String(r.unidade || '').trim();
    r.ean = String(r.ean || '').replace(/\D/g, ''); r.sku = String(r.sku || '').trim();
    if (!r.nome) errs.push('sem nome');
    const cat = cats.get(norm(r.categoria)); if (r.categoria && !cat) errs.push(`categoria “${r.categoria}” não existe`); r.categoria = cat || '';
    if (!r.categoria) errs.push('sem categoria');
    const pr = parseMoney(r.preco); if (pr == null || Number.isNaN(pr) || pr <= 0) errs.push('preço inválido'); r.preco = pr;
    const pp = parseMoney(r.preco_promo); if (Number.isNaN(pp) || (pp != null && pp <= 0)) errs.push('preço promocional inválido');
    if (pp != null && pr && pp >= pr) errs.push('promoção não é menor que o preço');
    r.preco_promo = pp ?? '';
    r.inicio_promo = toISODate(r.inicio_promo); r.fim_promo = toISODate(r.fim_promo);
    if (r.inicio_promo === 'invalida' || r.fim_promo === 'invalida') errs.push('data inválida (use dd/mm/aaaa)');
    r.tipo_promo = /exclusiv|tá barato|ta barato|site/i.test(String(r.tipo_promo || '')) ? 'exclusiva' : 'geral';
    r.foto_url = String(r.foto_url || '').trim(); r.emoji = String(r.emoji || '').trim();
    if (r.ean && ![8, 12, 13, 14].includes(r.ean.length)) errs.push('EAN com tamanho incomum');
    r._errs = errs; rows.push(r);
  }
  return rows;
}

function renderImport() {
  const main = $('#ptMain');
  main.innerHTML = `${banner()}<header class="pt-head"><div><h1>Importar produtos em massa</h1><p class="muted">Cadastre ou atualize centenas de produtos de uma vez. Se o produto já existe (mesmo EAN, ou mesmo nome, marca e tamanho), só o preço e a foto são atualizados.</p></div></header>
    <ol class="steps">
      <li class="panel"><span class="steps__n">1</span><div><h2>Baixe o modelo</h2>
        <p class="muted small">A planilha tem as colunas certas, a lista de categorias e um exemplo preenchido. Mantenha os nomes das colunas.</p>
        <div class="row-actions"><a class="btn btn--primary" href="assets/modelo-importacao-tabaratomesmo.xlsx" download>Baixar modelo (.xlsx)</a>
        <button class="btn btn--ghost" data-export>Baixar meus produtos atuais</button></div></div></li>
      <li class="panel"><span class="steps__n">2</span><div><h2>Envie a planilha preenchida</h2>
        <label class="drop" id="dropSheet"><input type="file" id="sheetInput" accept=".xlsx,.xls,.csv" hidden />
          <b>Arraste a planilha aqui</b><span class="muted small">ou clique para escolher (.xlsx ou .csv)</span></label>
        <div id="importPreview"></div></div></li>
      <li class="panel"><span class="steps__n">3</span><div><h2>Fotos (opcional)</h2>
        <p class="muted small">Selecione várias fotos de uma vez. O nome de cada arquivo deve ser o <b>EAN</b> ou o <b>código interno</b> do produto (ex.: <code>7896006716112.jpg</code>). Também dá para usar a coluna “URL da foto”.</p>
        <label class="drop drop--sm"><input type="file" id="sheetPhotos" accept="image/*" multiple hidden /><b>Escolher fotos</b><span class="muted small" id="photoCount">${st.importPhotos.size ? `${st.importPhotos.size} fotos selecionadas` : 'nenhuma foto'}</span></label></div></li>
      <li class="panel"><span class="steps__n">4</span><div><h2>Publicar</h2><p class="muted small" id="importSummary">Envie a planilha para conferir antes de publicar.</p>
        <button class="btn btn--primary" id="importGo" disabled>Publicar produtos</button><div id="importResult"></div></div></li>
    </ol>`;
  if (!st.categories.length) loadCatalog().catch(() => {});
  if (st.importRows) showPreview();
}

function showPreview() {
  const rows = st.importRows || [];
  const bad = rows.filter((r) => r._errs.length);
  const photos = rows.filter((r) => st.importPhotos.has(r.ean) || st.importPhotos.has(norm(r.sku))).length;
  $('#importPreview').innerHTML = `
    <div class="imp-sum"><span class="pill pill--ok">${rows.length - bad.length} prontos</span>${bad.length ? `<span class="pill pill--warn">${bad.length} com problema</span>` : ''}
      <span class="pill pill--soft">${rows.filter((r) => r.preco_promo).length} com promoção</span>${photos ? `<span class="pill pill--soft">${photos} com foto</span>` : ''}</div>
    <div class="tbl-wrap"><table class="tbl tbl--sm"><thead><tr><th>Linha</th><th>Produto</th><th>Categoria</th><th class="r">Preço</th><th class="r">Promo</th><th>Situação</th></tr></thead><tbody>
      ${[...bad, ...rows.filter((r) => !r._errs.length)].slice(0, 60).map((r) => `<tr class="${r._errs.length ? 'is-bad' : ''}"><td>${r._linha}</td><td>${esc(r.nome)} <small class="muted">${esc([r.marca, r.unidade].filter(Boolean).join(' · '))}</small></td>
        <td>${esc(r.categoria)}</td><td class="r">${r.preco ? brl(r.preco) : '–'}</td><td class="r">${r.preco_promo ? brl(r.preco_promo) + (r.tipo_promo === 'exclusiva' ? ' ★' : '') : ''}</td>
        <td>${r._errs.length ? `<span class="up small">${esc(r._errs.join(', '))}</span>` : '<span class="down small">ok</span>'}</td></tr>`).join('')}
    </tbody></table></div>${rows.length > 60 ? `<p class="muted small">Mostrando 60 de ${rows.length} linhas (as com problema primeiro).</p>` : ''}`;
  $('#importSummary').textContent = bad.length
    ? `${rows.length - bad.length} linhas serão publicadas. As ${bad.length} com problema ficam de fora; corrija na planilha e envie de novo.`
    : `${rows.length} linhas prontas para publicar.`;
  $('#importGo').disabled = rows.length - bad.length === 0;
}

async function runImport() {
  const ok = st.importRows.filter((r) => !r._errs.length);
  const btn = $('#importGo'); btn.disabled = true;
  const out = $('#importResult');
  const tot = { total: 0, ok: 0, created: 0, promos: 0, errors: [] };
  try {
    // 1) fotos
    let i = 0;
    for (const r of ok) {
      const f = st.importPhotos.get(r.ean) || st.importPhotos.get(norm(r.sku));
      if (f && !r.foto_url) { out.innerHTML = `<p class="small">Enviando fotos… ${++i}</p>`; r.foto_url = await P.uploadPhoto(st.mid, f, r.ean || r.sku || r.nome); }
    }
    // 2) produtos em lotes
    for (let k = 0; k < ok.length; k += 250) {
      out.innerHTML = `<p class="small">Publicando produtos… ${Math.min(k + 250, ok.length)} de ${ok.length}</p><div class="lvl__bar"><span style="--w:${Math.round((Math.min(k + 250, ok.length) / ok.length) * 100)}%"></span></div>`;
      const batch = ok.slice(k, k + 250).map(({ _errs, ...r }) => ({ ...r, preco: r.preco == null ? '' : String(r.preco), preco_promo: r.preco_promo === '' ? '' : String(r.preco_promo) }));
      const res = await P.importRows(st.mid, batch);
      tot.total += res.total; tot.ok += res.ok; tot.created += res.created; tot.promos += res.promos; tot.errors.push(...(res.errors || []));
    }
    out.innerHTML = `<div class="ok-box" style="margin-top:12px"><b>${tot.ok} produtos publicados</b> (${tot.created} novos no site, ${tot.ok - tot.created} atualizados${tot.promos ? `, ${tot.promos} promoções` : ''}).</div>
      ${tot.errors.length ? `<p class="note" style="margin-top:8px">${tot.errors.length} linhas não entraram: ${tot.errors.slice(0, 8).map((e) => `linha ${e.linha} (${esc(e.erro)})`).join('; ')}${tot.errors.length > 8 ? '…' : ''}</p>` : ''}
      <a class="btn btn--ghost btn--sm" href="#produtos" style="margin-top:10px">Ver produtos</a>`;
    st.catalog = null; st.dash = null; st.importRows = null; st.importPhotos.clear();
    toast(`${tot.ok} produtos publicados.`);
  } catch (e) { out.innerHTML = `<p class="note">${esc(e.message)}</p>`; btn.disabled = false; }
}

async function exportCatalog() {
  const X = await loadXLSX();
  await loadCatalog();
  const catName = new Map(st.categories.map((c) => [c.slug, c.name]));
  const rows = st.catalog.filter((r) => r.active).map((r) => ({
    'EAN (código de barras)': r.ean || '', 'Código interno (SKU)': r.sku || '', 'Nome do produto*': r.name, 'Marca': r.brand || '',
    'Unidade / tamanho*': r.unit || '', 'Categoria*': catName.get(r.category) || r.category, 'Preço normal (R$)*': r.price,
    'Preço promocional (R$)': '', 'Tipo de promoção': '', 'Início da promoção': '', 'Fim da promoção': '', 'URL da foto': r.image_url && !r.image_url.startsWith('data:') ? r.image_url : '', 'Emoji': r.emoji || '',
  }));
  const ws = X.utils.json_to_sheet(rows); ws['!cols'] = [16, 14, 32, 16, 14, 18, 14, 14, 18, 14, 14, 30, 8].map((w) => ({ wch: w }));
  const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, 'Produtos');
  X.writeFile(wb, `produtos-${market().slug || st.mid}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ================================================================ eventos
let photoTarget = null;
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, a'); if (!t) return;
  const d = t.dataset;
  if (d.demo !== undefined) { P.useDemo(); st.user = { email: 'demonstracao@coema' }; return enter(); }
  if (d.ptauth) return renderLogin(d.ptauth);
  if (d.days) { st.days = Number(d.days); return renderDashboard(); }
  if (d.rank) { st.rankPeriod = d.rank; return renderDashboard(); }
  if (d.pfilter) { st.filter = d.pfilter; $$('[data-pfilter]').forEach((b) => b.classList.toggle('is-on', b === t)); return renderProductRows(); }
  if (d.newprod !== undefined) { e.preventDefault(); await loadCatalog().catch(() => {}); return productForm({}); }
  if (d.edit) { await loadCatalog().catch(() => {}); const r = st.catalog.find((x) => x.product_id === Number(d.edit)); return r && productForm(r); }
  if (d.photo) { photoTarget = Number(d.photo); return $('#photoInput').click(); }
  if (d.pickphoto !== undefined) return $('#prodForm [name=photo]').click();
  if (d.bulkphotos !== undefined) return $('#bulkPhotoInput').click();
  if (d.remove) {
    const r = st.catalog.find((x) => x.product_id === Number(d.remove));
    if (!confirm(`Tirar “${r.name}” do site? O histórico de preços fica guardado e você pode reativar depois.`)) return;
    try { await P.removeProduct(st.mid, r.product_id); r.active = false; renderProductRows(); toast('Produto removido do site.'); } catch (err) { toast(err.message, 'warn'); }
    return;
  }
  if (d.restore) {
    const r = st.catalog.find((x) => x.product_id === Number(d.restore));
    try { await P.saveProduct(st.mid, { product_id: r.product_id, name: r.name, brand: r.brand, unit: r.unit, category: r.category, price: null }); st.catalog = null; renderProducts(); toast('Produto reativado.'); } catch (err) { toast(err.message, 'warn'); }
    return;
  }
  if (d.promoFor) { const r = st.catalog.find((x) => x.product_id === Number(d.promoFor)); return promoForm(r); }
  if (d.newpromo !== undefined) { await loadCatalog(); return promoForm(null); }
  if (d.editpromo) { const p = st.promos.find((x) => x.id === Number(d.editpromo)); return promoForm(null, p); }
  if (d.endpromo) { try { await P.endPromo(Number(d.endpromo)); st.catalog = null; renderPromos(); toast('Promoção encerrada.'); } catch (err) { toast(err.message, 'warn'); } return; }
  if (d.export !== undefined) { try { await exportCatalog(); } catch (err) { toast(err.message, 'warn'); } return; }
  if (t.id === 'importGo') return runImport();
  if (t.id === 'logoutBtn') { await api.signOut().catch(() => {}); st.user = null; st.mid = null; st.markets = []; location.hash = ''; return renderLogin(); }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.id === 'mkSelect') { st.mid = Number(t.value); api.store.set('tb.ptMarket', st.mid); st.catalog = st.promos = st.dash = null; renderPicker(); return route(); }
  if (t.id === 'prodCat') { st.cat = t.value; return renderProductRows(); }
  if (t.dataset.price) {
    const r = st.catalog.find((x) => x.product_id === Number(t.dataset.price));
    const v = parseMoney(t.value);
    if (!(v > 0)) { t.value = r.price.toFixed(2).replace('.', ','); return toast('Preço inválido.', 'warn'); }
    if (v === r.price) return;
    if (r.price && (v < r.price * 0.4 || v > r.price * 2.5) && !confirm(`O preço mudou de ${brl(r.price)} para ${brl(v)}. Confirma?`)) { t.value = r.price.toFixed(2).replace('.', ','); return; }
    t.disabled = true;
    try { await P.saveProduct(st.mid, { product_id: r.product_id, name: r.name, brand: r.brand, unit: r.unit, category: r.category, price: v }); r.price = v; r.price_at = new Date().toISOString(); toast(`${r.name}: ${brl(v)} publicado.`); st.dash = null; }
    catch (err) { toast(err.message, 'warn'); t.value = r.price.toFixed(2).replace('.', ','); }
    t.disabled = false; return;
  }
  if (t.id === 'photoInput' && t.files[0]) {
    const r = st.catalog.find((x) => x.product_id === photoTarget); const f = t.files[0]; t.value = '';
    toast('Enviando foto…');
    try {
      const url = await P.uploadPhoto(st.mid, f, r.ean || r.sku || r.name);
      await P.saveProduct(st.mid, { product_id: r.product_id, name: r.name, brand: r.brand, unit: r.unit, category: r.category, price: null, image_url: url });
      r.image_url = url; renderProductRows(); toast('Foto atualizada.');
    } catch (err) { toast(err.message, 'warn'); }
    return;
  }
  if (t.id === 'bulkPhotoInput' && t.files.length) {
    const files = [...t.files]; t.value = '';
    const key = (f) => norm(f.name.replace(/\.[^.]+$/, ''));
    let n = 0, miss = 0;
    for (const f of files) {
      const k = key(f); const r = st.catalog.find((x) => (x.ean && x.ean === k.replace(/\D/g, '')) || (x.sku && norm(x.sku) === k));
      if (!r) { miss++; continue; }
      try { const url = await P.uploadPhoto(st.mid, f, k); await P.saveProduct(st.mid, { product_id: r.product_id, name: r.name, brand: r.brand, unit: r.unit, category: r.category, price: null, image_url: url }); r.image_url = url; n++; } catch { miss++; }
      toast(`Fotos: ${n} de ${files.length}`);
    }
    renderProductRows(); toast(`${n} fotos aplicadas${miss ? `, ${miss} sem produto com esse EAN ou código` : ''}.`);
    return;
  }
  if (t.name === 'photo' && t.files?.[0]) {
    const f = t.files[0]; const btn = $('[data-pickphoto]');
    btn.innerHTML = `<img src="${URL.createObjectURL(f)}" alt="" />`; btn._file = f; return;
  }
  if (t.id === 'sheetInput' && t.files[0]) return handleSheet(t.files[0]);
  if (t.id === 'sheetPhotos' && t.files.length) {
    for (const f of t.files) { const k = norm(f.name.replace(/\.[^.]+$/, '')); st.importPhotos.set(/^\d+$/.test(k) ? k : k, f); }
    $('#photoCount').textContent = `${st.importPhotos.size} fotos selecionadas`; t.value = '';
    if (st.importRows) showPreview();
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'prodSearch') { st.q = e.target.value; renderProductRows(); }
});

async function handleSheet(file) {
  $('#importPreview').innerHTML = '<div class="skeleton" style="height:120px;margin-top:12px"></div>';
  try {
    if (!st.categories.length) await loadCatalog();
    st.importRows = await parseSheet(file);
    if (!st.importRows.length) throw new Error('A planilha está vazia.');
    showPreview();
  } catch (err) { $('#importPreview').innerHTML = `<p class="note" style="margin-top:12px">${esc(err.message)}</p>`; }
}
document.addEventListener('dragover', (e) => { if (e.target.closest('#dropSheet')) { e.preventDefault(); e.target.closest('#dropSheet').classList.add('is-over'); } });
document.addEventListener('dragleave', (e) => { e.target.closest?.('#dropSheet')?.classList.remove('is-over'); });
document.addEventListener('drop', (e) => {
  const z = e.target.closest('#dropSheet'); if (!z) return;
  e.preventDefault(); z.classList.remove('is-over');
  if (e.dataTransfer.files[0]) handleSheet(e.dataTransfer.files[0]);
});

document.addEventListener('submit', async (e) => {
  const f = e.target; e.preventDefault();
  const fid = f.getAttribute('id');
  const err = (m) => { const el = $('.form__err', f); if (el) el.textContent = m; };
  const btn = $('button:not([type=button])', f);
  const busy = (on) => { if (btn) { btn.disabled = on; } };
  try {
    if (fid === 'ptLogin') {
      busy(true); await api.signIn({ email: f.email.value.trim(), password: f.password.value });
    } else if (fid === 'ptSignup') {
      busy(true);
      const r = await api.signUp({ name: f.name.value.trim(), email: f.email.value.trim(), password: f.password.value });
      api.store.set('tb.ptInvite', f.code.value.trim());
      if (r.needsConfirm) { $('#ptMain').innerHTML = `<section class="pt-auth"><div class="pt-auth__card" style="margin:0 auto"><h2>Confirme seu e-mail</h2><p>Enviamos um link para <b>${esc(f.email.value)}</b>. Depois de confirmar, entre aqui de novo: o código de convite será aplicado.</p></div></section>`; }
    } else if (fid === 'ptJoin') {
      busy(true); await P.joinMarket(f.code.value.trim()); toast('Supermercado vinculado.'); await enter();
    } else if (fid === 'prodForm') {
      const price = parseMoney(f.price.value);
      if (!f.name.value.trim()) return err('Informe o nome do produto.');
      if (!(price > 0)) return err('Informe um preço válido.');
      busy(true);
      let image_url = f.image_url.value || null;
      const file = $('[data-pickphoto]')._file;
      if (file) image_url = await P.uploadPhoto(st.mid, file, f.ean.value || f.sku.value || f.name.value);
      await P.saveProduct(st.mid, { product_id: Number(f.product_id.value) || null, name: f.name.value.trim(), brand: f.brand.value.trim(), unit: f.unit.value.trim(),
        category: f.category.value, ean: f.ean.value.replace(/\D/g, ''), sku: f.sku.value.trim(), emoji: f.emoji.value.trim(), price, image_url });
      closeSheet(); st.catalog = null; st.dash = null; toast('Produto salvo e publicado.');
      if (location.hash !== '#produtos') location.hash = '#produtos'; else renderProducts();
    } else if (fid === 'promoForm') {
      const pid = Number(f.product_id.value); const r = st.catalog.find((x) => x.product_id === pid);
      const pp = parseMoney(f.promo_price.value);
      if (!(pp > 0)) return err('Informe o preço promocional.');
      if (r && pp >= r.price) return err(`O preço promocional precisa ser menor que o atual (${brl(r.price)}).`);
      if (f.ends_at.value < f.starts_at.value) return err('A data de fim é antes do início.');
      busy(true);
      await P.savePromo({ id: Number(f.promo_id.value) || null, supermarket_id: st.mid, product_id: pid, kind: f.kind.value, promo_price: pp,
        max_per_client: Number(f.max_per_client.value) || null, code: f.code.value.trim().toUpperCase() || null, title: f.title.value.trim() || null,
        starts_at: new Date(f.starts_at.value + 'T00:00:00').toISOString(), ends_at: new Date(f.ends_at.value + 'T23:59:00').toISOString() });
      closeSheet(); st.catalog = null; st.promos = null; st.dash = null; toast('Promoção publicada.');
      if (location.hash === '#promocoes') renderPromos(); else if (location.hash === '#produtos') renderProducts(); else location.hash = '#promocoes';
    }
  } catch (ex) { err(ex.message || 'Algo deu errado.'); } finally { busy(false); }
});
// mostra o campo de código só para promoções exclusivas
document.addEventListener('change', (e) => {
  if (e.target.name === 'kind') $('#promoForm .excl-only').hidden = e.target.value !== 'exclusiva';
});

// ================================================================ início
async function boot() {
  await api.loadCatalog().then((d) => { st.categories = d.categories; }).catch(() => {});
  await P.init().catch(() => {});
  if (P.MODE !== 'live') return renderLogin();
  api.onAuth(async (user) => {
    st.user = user;
    if (!user) return renderLogin();
    const code = api.store.get('tb.ptInvite');
    if (code) { api.store.set('tb.ptInvite', null); await P.joinMarket(code).catch((e) => toast(e.message, 'warn')); }
    enter();
  });
  await api.initAuth();
}
boot();
