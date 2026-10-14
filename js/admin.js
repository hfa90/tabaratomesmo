// Administração master: acessos dos supermercados, usuários, métricas, relatórios e configurações.
import * as api from './api.js';
import * as A from './admin-api.js';
import { lineChart } from './chart.js';
import { $, $$, esc, brl, logo, reduceMotion } from './core.js';
import { hbars, kpi, heatmap, fmtN, downloadCSV } from './viz.js';
import * as adsUI from './ads.js';

const st = { user: null, days: 30, usersQ: '', usersFilter: 'all', usersPage: 0, repStatus: 'pendente', modTab: 'precos', prodQ: '', overview: null, markets: null, adStatus: 'pendente', ads: null };
const PAGE = 50;
const SITE = new URL('./', location.href).href;
const dateBR = (d, opt = { day: '2-digit', month: 'short' }) => (d ? new Date(d).toLocaleDateString('pt-BR', opt).replace('.', '') : '–');
const dateTime = (d) => (d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).replace('.', '') : 'nunca');
const GENDER = { feminino: 'Mulheres', masculino: 'Homens', outro: 'Outro', nao_informar: 'Prefere não informar', 'sem dado': 'Sem dado' };
const sw = (attrs, on, label) => `<label class="switch" title="${esc(label)}"><input type="checkbox" ${attrs} ${on ? 'checked' : ''} aria-label="${esc(label)}" /><i></i></label>`;

// ---------------------------------------------------------------- interface comum
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
const banner = () => A.MODE === 'demo' ? '<p class="note pt-demo">Modo demonstração: dados simulados, guardados só neste aparelho. Nada aqui altera o site real.</p>' : '';
const head = (title, sub, actions = '') => `${banner()}<header class="pt-head"><div><h1>${title}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}</div>${actions}</header>`;
async function run(fn, ok) { try { await fn(); if (ok) toast(ok); return true; } catch (e) { toast(e.message || 'Não foi possível concluir.', 'warn'); return false; } }

// ---------------------------------------------------------------- acesso
function renderLogin(msg = '') {
  $('#ptNav').hidden = true; $('#logoutBtn').hidden = true; $('#whoAmI').textContent = '';
  const pending = A.MODE === 'pending';
  $('#ptMain').innerHTML = `<section class="pt-auth">
    <div class="pt-auth__intro"><h1>Administração</h1>
      <p class="muted">Área restrita ao administrador master do Tá Barato Mesmo?: acessos dos supermercados, usuários, métricas, relatórios e configurações do site.</p></div>
    <div class="pt-auth__card">
      ${pending ? `<p class="note">O banco ainda não tem as funções de administração. Rode o <b>supabase/schema.sql</b> atualizado no SQL Editor do Supabase.</p>
        <button class="btn btn--ghost btn--block" data-demo style="margin-top:12px">Ver demonstração</button>`
      : A.MODE === 'demo' ? `<p class="note">O banco não respondeu. Entre na demonstração para conhecer a página.</p><button class="btn btn--primary btn--block" data-demo style="margin-top:12px">Entrar na demonstração</button>`
      : `<h2>Entrar</h2>
        <form class="form" id="admLogin">
          <label>E-mail<input name="email" type="email" autocomplete="email" required /></label>
          <label>Senha<input name="password" type="password" autocomplete="current-password" required /></label>
          <p class="form__err" role="alert">${esc(msg)}</p>
          <button class="btn btn--primary btn--block">Entrar</button>
        </form>
        <p class="small muted" style="margin-top:12px">Use a mesma conta do site. Ainda não tem? <a class="linkish" href="./#conta">Crie no site</a> com o e-mail de administrador.</p>`}
    </div></section>`;
}

async function enter() {
  let ok = false;
  try { ok = await A.amIMaster(); } catch (e) { return renderLogin(e.message); }
  if (!ok) {
    $('#ptNav').hidden = true; $('#logoutBtn').hidden = false;
    $('#ptMain').innerHTML = `<section class="pt-auth"><div class="pt-auth__card" style="margin:0 auto"><h2>Sem permissão</h2>
      <p class="muted">A conta ${esc(st.user?.email || '')} não é administradora master.</p></div></section>`;
    return;
  }
  $('#ptNav').hidden = false; $('#logoutBtn').hidden = false;
  $('#whoAmI').textContent = A.MODE === 'demo' ? 'demonstração' : st.user?.email || '';
  route();
}

function route() {
  const v = (location.hash || '#geral').slice(1);
  const views = { geral: renderOverview, mercados: renderMarkets, usuarios: renderUsers, moderacao: renderModeration, publicidade: renderAdsAdmin, produtos: renderProducts, promocoes: renderPromos, relatorios: renderReports, config: renderConfig };
  const view = views[v] ? v : 'geral';
  $$('[data-pt]').forEach((a) => a.classList.toggle('is-active', a.dataset.pt === view));
  views[view]();
  window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', () => { if (!$('#ptNav').hidden) route(); });

// ================================================================ VISÃO GERAL
async function renderOverview() {
  $('#ptMain').innerHTML = head('Visão geral', 'Toda a plataforma: público, regiões, buscas e desempenho de cada supermercado.',
    `<div class="row-actions"><div class="seg" role="radiogroup" aria-label="Período">${[[1, 'Hoje'], [7, '7 dias'], [30, '30 dias'], [90, '90 dias'], [365, '12 meses']].map(([d, l]) => `<button role="radio" aria-checked="${st.days === d}" data-days="${d}">${l}</button>`).join('')}</div></div>`)
    + '<div id="ov"><div class="skeleton" style="height:420px"></div></div>';
  let D;
  try { D = await A.overview(st.days); st.overview = D; } catch (e) { $('#ov').innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
  const K = D.kpis;
  const days = D.daily || [];
  const t = (x) => new Date(x.d + 'T12:00').getTime();
  const series = days.length > 1 ? [
    { id: 1, name: 'Visitantes', color: '#2a78d6', points: days.map((x) => ({ t: t(x), v: x.visitors })) },
    { id: 2, name: 'Buscas', color: '#eb6834', points: days.map((x) => ({ t: t(x), v: x.searches })) },
    { id: 3, name: 'Ranchos concluídos', color: '#1baf7a', points: days.map((x) => ({ t: t(x), v: x.ranchos })) },
    { id: 4, name: 'Novos cadastros', color: '#6250d6', points: days.map((x) => ({ t: t(x), v: x.signups })) },
  ] : [];
  const gT = (D.gender || []).reduce((s, g) => s + g.users, 0) || 1;
  const gc = ['#2a78d6', '#eb6834', '#1baf7a', '#9aa59f'];
  $('#ov').innerHTML = `
    <section class="kpis">
      ${kpi('Usuários cadastrados', K.users, { hint: `${fmtN(K.users_complete)} com cadastro completo` })}
      ${kpi('Novos cadastros', K.users_new, { prev: K.users_new_prev })}
      ${kpi('Visitantes', K.visitors, { prev: K.visitors_prev })}
      ${kpi('Buscas', K.searches, { prev: K.searches_prev })}
      ${kpi('Ranchos concluídos', K.ranchos, { hint: `${fmtN(K.lists)} listas movimentadas` })}
      ${kpi('Compras confirmadas', K.bought, { hint: K.spent ? `${brl(Number(K.spent))} declarados` : 'clientes que marcaram onde compraram' })}
      ${kpi('Economia gerada', Number(K.savings), { fmt: (v) => brl(v), hint: `${brl(Number(K.savings_all))} desde o início`, accent: true })}
      ${kpi('Preços enviados', K.reports, { hint: `${fmtN(K.reports_pending)} aguardando moderação` })}
    </section>
    <div class="chips" style="margin:-4px 0 2px">
      <span class="pill pill--soft">${fmtN(K.markets)} mercados ativos</span><span class="pill pill--soft">${fmtN(K.members)} acessos ao portal</span>
      <span class="pill pill--soft">${fmtN(K.products)} produtos</span><span class="pill pill--soft">${fmtN(K.promos_live)} promoções no ar</span>
      <span class="pill pill--soft">${fmtN(K.users_active)} usuários entraram no período</span>${K.users_blocked ? `<span class="pill pill--warn">${fmtN(K.users_blocked)} bloqueados</span>` : ''}
    </div>

    ${series.length ? `<section class="panel"><div class="panel__head"><h2>Movimento por dia</h2><span class="muted small">toque nas legendas para esconder uma linha</span></div>
      ${lineChart(series, { format: (v) => fmtN(Math.round(v)), label: 'Visitantes, buscas, ranchos e cadastros por dia' })}</section>` : ''}

    <section class="panel"><div class="panel__head"><h2>Supermercados</h2><span class="muted small">preferência de compra no período</span></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Supermercado</th><th class="r">Compras</th><th class="r">Valor declarado</th><th class="r">Ranchos mais baratos</th><th class="r">Rotas</th><th class="r">Interesse</th><th class="r">Produtos</th><th class="r">Promoções</th><th>Último preço</th><th>Status</th></tr></thead>
      <tbody>${(D.markets || []).map((m, i) => `<tr class="${m.active ? '' : 'is-off'}"><td>${i + 1}º</td><td><span class="cell-m">${logo(m, 'xs')} ${esc(m.name)}</span></td>
        <td class="r">${fmtN(m.bought)}</td><td class="r">${brl(Number(m.spent || 0))}</td><td class="r">${fmtN(m.rancho_wins)}</td><td class="r">${fmtN(m.routes)}</td><td class="r">${fmtN(m.interest)}</td>
        <td class="r">${fmtN(m.products)}</td><td class="r">${fmtN(m.promos)}</td><td>${dateBR(m.last_price)}</td>
        <td>${!m.active ? '<span class="pill pill--warn">Desativado</span>' : !m.portal_enabled ? '<span class="pill pill--warn">Portal suspenso</span>' : '<span class="pill pill--ok">Ativo</span>'}</td></tr>`).join('')}</tbody></table></div></section>

    <div class="pt-grid">
      <section class="panel"><div class="panel__head"><h2>Usuários por região</h2><span class="muted small">zonas de Manaus</span></div>
        ${hbars(D.zones || [], { label: (r) => esc(r.zone), value: (r) => r.users, note: (r) => `${fmtN(r.visitors)} visitantes · ${fmtN(r.searches)} buscas · ${fmtN(r.ranchos)} ranchos` })}</section>
      <section class="panel"><div class="panel__head"><h2>Bairros</h2><span class="muted small">usuários cadastrados</span></div>
        <div class="tbl-wrap"><table class="tbl tbl--sm"><thead><tr><th>Bairro</th><th>Zona</th><th class="r">Usuários</th><th class="r">Completos</th></tr></thead>
        <tbody>${(D.neighborhoods || []).map((n) => `<tr><td>${esc(n.neighborhood)}</td><td class="muted">${esc(n.zone || '–')}</td><td class="r">${fmtN(n.users)}</td><td class="r">${fmtN(n.complete)}</td></tr>`).join('')}</tbody></table></div></section>
    </div>

    <div class="pt-grid">
      <section class="panel"><div class="panel__head"><h2>Público por sexo</h2></div>
        <div class="stack" role="img" aria-label="Usuários por sexo">${(D.gender || []).map((g, i) => `<span style="--w:${(g.users / gT) * 100}%;--c:${gc[i] || '#999'}" title="${GENDER[g.gender] || g.gender}: ${fmtN(g.users)}"></span>`).join('')}</div>
        <ul class="legend legend--row">${(D.gender || []).map((g, i) => `<li><span class="dot" style="--c:${gc[i] || '#999'}"></span><span>${GENDER[g.gender] || esc(g.gender)}<br/><small>${fmtN(g.users)} usuários · ${fmtN(g.ranchos)} ranchos no período</small></span><b>${Math.round((g.users / gT) * 100)}%</b></li>`).join('')}</ul></section>
      <section class="panel"><div class="panel__head"><h2>Faixa etária</h2></div>
        ${hbars(D.age || [], { label: (r) => r.age_band === 'sem dado' ? 'Sem dado' : `${esc(r.age_band)} anos`, value: (r) => r.users, color: '#6250d6' })}</section>
    </div>

    <div class="pt-grid">
      <section class="panel"><div class="panel__head"><h2>Mais buscados</h2></div>
        ${hbars((D.top_searches || []).slice(0, 12), { label: (r) => esc(r.query), value: (r) => r.n, note: (r) => `${fmtN(r.people)} pessoas` })}</section>
      <section class="panel"><div class="panel__head"><h2>Buscas sem resultado</h2><span class="muted small">produtos para incluir no catálogo</span></div>
        ${hbars(D.no_results || [], { label: (r) => esc(r.query), value: (r) => r.n, color: '#eda100' })}</section>
    </div>

    <div class="pt-grid">
      <section class="panel"><div class="panel__head"><h2>Produtos mais vistos</h2></div>
        ${hbars((D.top_products || []).slice(0, 12), { label: (r) => `${r.emoji || ''} ${esc(r.name)}`, value: (r) => r.views, note: (r) => `${fmtN(r.adds)} adições ao rancho` })}</section>
      <section class="panel"><div class="panel__head"><h2>Horários de pico</h2><span class="muted small">horário de Manaus</span></div>${heatmap(D.hours)}</section>
    </div>
    ${D.demo ? '<p class="muted small">Métricas simuladas (demonstração).</p>' : ''}`;
}

// ================================================================ SUPERMERCADOS E ACESSOS
async function renderMarkets() {
  $('#ptMain').innerHTML = head('Supermercados', 'Ative ou desative cada mercado no site e no portal, gere acessos e cuide das lojas.',
    '<button class="btn btn--primary" data-mk-new>+ Novo supermercado</button>') + '<div id="mk"><div class="skeleton" style="height:300px"></div></div>';
  try { st.markets = await A.markets(); } catch (e) { $('#mk').innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
  $('#mk').innerHTML = `<div class="mk-cards">${st.markets.map((m) => `
    <article class="panel mk-card ${m.active ? '' : 'is-off'}">
      <div class="mk-card__top">${logo(m, 'lg')}<div><h2>${esc(m.name)}</h2><small class="muted">${esc(m.slug || '')} · ${fmtN(m.stores_count)} lojas</small></div></div>
      <div class="mk-card__flags">
        <span>${sw(`data-mk-flag="active" data-id="${m.id}"`, m.active, 'Mercado aparece no site')} Aparece no site</span>
        <span>${sw(`data-mk-flag="portal_enabled" data-id="${m.id}"`, m.portal_enabled, 'Acesso ao portal')} Acesso ao portal</span>
      </div>
      <p class="small">${fmtN(m.members)} ${m.members === 1 ? 'acesso' : 'acessos'}${m.members_suspended ? ` (${m.members_suspended} suspenso${m.members_suspended > 1 ? 's' : ''})` : ''} · ${fmtN(m.invites)} ${m.invites === 1 ? 'convite válido' : 'convites válidos'}</p>
      <div class="row-actions">
        <button class="btn btn--primary btn--sm" data-mk-access="${m.id}">Acessos e convites</button>
        <button class="btn btn--ghost btn--sm" data-mk-stores="${m.id}">Lojas</button>
        <button class="btn btn--ghost btn--sm" data-mk-edit="${m.id}">Editar</button>
        <button class="btn btn--text btn--sm" data-mk-del="${m.id}">Excluir</button>
      </div>
    </article>`).join('')}</div>`;
}

function marketForm(m = {}) {
  openSheet(`<h2 class="sheet__title" id="ptSheetTitle">${m.id ? 'Editar supermercado' : 'Novo supermercado'}</h2>
    <form class="form" id="mkForm"><input type="hidden" name="mid" value="${m.id || ''}" />
      <label>Nome<input name="mname" required value="${esc(m.name || '')}" /></label>
      <div class="form__row"><label>Identificador (slug)<input name="slug" value="${esc(m.slug || '')}" placeholder="gerado do nome" /></label>
        <label>Cor da marca<input name="color" type="color" value="${esc(m.color || '#0F5A3E')}" style="padding:4px;height:48px" /></label></div>
      <label>Logomarca (URL ou caminho, ex.: assets/logos/coema.png)<input name="logo_url" value="${esc(m.logo_url || '')}" /></label>
      <label>Site<input name="website" value="${esc(m.website || '')}" placeholder="https://" /></label>
      <p class="form__err" role="alert"></p><button class="btn btn--primary btn--block">Salvar</button></form>`);
}

async function accessSheet(id) {
  const m = st.markets.find((x) => x.id === id);
  openSheet(`<h2 class="sheet__title" id="ptSheetTitle">${logo(m, 'sm')} Acessos do ${esc(m.name)}</h2><div id="accBody"><div class="skeleton" style="height:200px"></div></div>`);
  let D;
  try { D = await A.access(id); } catch (e) { $('#accBody').innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
  const link = new URL('parceiros.html', SITE).href;
  $('#accBody').innerHTML = `
    <h3 class="pd__h" style="margin-top:8px">Pessoas com acesso</h3>
    ${D.members.length ? `<div class="tbl-wrap"><table class="tbl tbl--sm"><thead><tr><th>Pessoa</th><th>Papel</th><th>Último acesso</th><th>Ativo</th><th></th></tr></thead><tbody>
      ${D.members.map((u) => `<tr class="${u.suspended ? 'is-off' : ''}"><td><b>${esc(u.full_name || '–')}</b><small class="muted">${esc(u.email)}</small></td>
        <td><select class="input sel sel--sm" data-mem-role="${u.user_id}" data-mk="${id}"><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Gerente</option><option value="editor" ${u.role === 'editor' ? 'selected' : ''}>Editor</option></select></td>
        <td class="nowrap">${dateTime(u.last_sign_in_at)}</td>
        <td>${sw(`data-mem-susp="${u.user_id}" data-mk="${id}"`, !u.suspended, 'Acesso ativo')}</td>
        <td class="r"><button class="btn btn--text btn--sm" data-mem-del="${u.user_id}" data-mk="${id}">Excluir</button></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted small">Ninguém tem acesso ainda.</p>'}
    <form class="form form--inline" id="memAdd" data-mk="${id}"><label>Dar acesso a uma conta existente<input name="email" type="email" placeholder="email@mercado.com.br" required /></label>
      <select class="input sel" name="role"><option value="admin">Gerente</option><option value="editor">Editor</option></select><button class="btn btn--ghost">Adicionar</button></form>

    <h3 class="pd__h" style="margin-top:22px">Códigos de convite</h3>
    <form class="form form--inline" id="invNew" data-mk="${id}">
      <label>Papel<select class="input sel" name="role"><option value="admin">Gerente</option><option value="editor">Editor</option></select></label>
      <label>Usos<input name="uses" type="number" min="1" max="100" value="3" style="width:90px" /></label>
      <label>Validade (dias)<input name="days" type="number" min="1" max="365" value="30" style="width:110px" /></label>
      <button class="btn btn--primary">Gerar novo acesso</button></form>
    <div id="invNewOut"></div>
    ${D.invites.length ? `<div class="tbl-wrap"><table class="tbl tbl--sm"><thead><tr><th>Código</th><th>Papel</th><th class="r">Usos restantes</th><th>Expira</th><th>Status</th><th></th></tr></thead><tbody>
      ${D.invites.map((i) => `<tr class="${i.valid ? '' : 'is-off'}"><td><code class="code-big">${esc(i.code)}</code></td><td>${i.role === 'editor' ? 'Editor' : 'Gerente'}</td><td class="r">${i.uses_left}</td><td>${dateBR(i.expires_at)}</td>
        <td>${i.valid ? '<span class="pill pill--ok">Válido</span>' : '<span class="pill pill--soft">Expirado</span>'}</td>
        <td class="r nowrap"><button class="btn btn--ghost btn--sm" data-inv-copy="${esc(i.code)}" data-mkname="${esc(m.name)}">Copiar mensagem</button> <button class="btn btn--text btn--sm" data-inv-del="${esc(i.code)}" data-mk="${id}">Excluir</button></td></tr>`).join('')}
    </tbody></table></div>` : ''}
    <p class="muted small" style="margin-top:10px">O responsável abre <a href="${link}" target="_blank" rel="noopener">${link}</a>, toca em “Criar conta com código de convite” e entra direto no portal do ${esc(m.name)}.</p>`;
}

async function storesSheet(id) {
  const m = st.markets.find((x) => x.id === id);
  openSheet(`<h2 class="sheet__title" id="ptSheetTitle">${logo(m, 'sm')} Lojas do ${esc(m.name)}</h2><div id="stBody"><div class="skeleton" style="height:200px"></div></div>`);
  const D = await A.access(id).catch((e) => ({ error: e }));
  if (D.error) { $('#stBody').innerHTML = `<p class="note">${esc(D.error.message)}</p>`; return; }
  $('#stBody').innerHTML = `
    <div class="tbl-wrap"><table class="tbl tbl--sm"><thead><tr><th>Loja</th><th>Bairro</th><th>Coordenadas</th><th></th></tr></thead><tbody>
      ${D.stores.map((s) => `<tr><td><b>${esc(s.name)}</b>${s.address ? `<small class="muted">${esc(s.address)}</small>` : ''}</td><td>${esc(s.neighborhood || '–')}</td>
        <td class="nowrap"><a href="https://www.google.com/maps?q=${s.lat},${s.lng}" target="_blank" rel="noopener">${Number(s.lat).toFixed(4)}, ${Number(s.lng).toFixed(4)}</a>${s.approx ? ' <span class="pill pill--soft">aprox.</span>' : ''}</td>
        <td class="r nowrap"><button class="btn btn--ghost btn--sm" data-st-edit="${s.id}" data-mk="${id}">Editar</button> <button class="btn btn--text btn--sm" data-st-del="${s.id}" data-mk="${id}">Excluir</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nenhuma loja.</td></tr>'}
    </tbody></table></div>
    <form class="form" id="stForm" data-mk="${id}"><input type="hidden" name="sid" />
      <h3 class="pd__h" style="margin:8px 0 0" id="stFormTitle">Nova loja</h3>
      <div class="form__row"><label>Nome<input name="sname" required placeholder="Ex.: Coema Cidade Nova" /></label><label>Bairro<input name="neighborhood" /></label></div>
      <label>Endereço<input name="address" /></label>
      <div class="form__row"><label>Latitude<input name="lat" inputmode="decimal" required placeholder="-3.0700" /></label><label>Longitude<input name="lng" inputmode="decimal" required placeholder="-60.0200" /></label></div>
      <label class="check"><input type="checkbox" name="approx" /> Posição aproximada</label>
      <p class="muted small">Dica: no Google Maps, clique com o botão direito no local e copie as coordenadas.</p>
      <p class="form__err" role="alert"></p><button class="btn btn--primary">Salvar loja</button></form>`;
  $('#stBody')._stores = D.stores;
}

// ================================================================ USUÁRIOS
async function renderUsers() {
  $('#ptMain').innerHTML = head('Usuários', 'Busque, bloqueie ou libere contas. Contas bloqueadas não comparam preços, não enviam preços e não entram nas métricas.',
    '<button class="btn btn--ghost" data-csv="usuarios">Exportar CSV</button>') + `
    <div class="pt-tools"><label class="search search--sm"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 3a7.5 7.5 0 1 0 4.6 13.4l4.7 4.7 1.4-1.4-4.7-4.7A7.5 7.5 0 0 0 10.5 3zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z" fill="currentColor"/></svg>
      <input id="uQ" type="search" placeholder="Nome, e-mail ou bairro" value="${esc(st.usersQ)}" /></label></div>
    <div class="chips" style="margin-bottom:12px">${[['all', 'Todos'], ['complete', 'Cadastro completo'], ['quick', 'Cadastro rápido'], ['markets', 'Equipe de mercado'], ['blocked', 'Bloqueados']].map(([k, l]) => `<button class="chip ${st.usersFilter === k ? 'is-on' : ''}" data-ufilter="${k}">${l}</button>`).join('')}</div>
    <div id="uList"><div class="skeleton" style="height:300px"></div></div>`;
  loadUsers();
}
async function loadUsers() {
  let R;
  try { R = await A.users(st.usersQ, st.usersFilter, PAGE, st.usersPage * PAGE); } catch (e) { $('#uList').innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
  st.usersRows = R.rows;
  const pages = Math.ceil(R.total / PAGE);
  $('#uList').innerHTML = `<div class="tbl-wrap panel" style="padding:0"><table class="tbl"><thead><tr><th>Usuário</th><th>Região</th><th>Sexo</th><th>Cadastro</th><th>Último acesso</th><th class="r">Ranchos</th><th class="r">Economia</th><th class="r">Preços</th><th>Ativo</th><th></th></tr></thead><tbody>
    ${R.rows.map((u) => `<tr class="${u.blocked ? 'is-off' : ''}"><td><b>${esc(u.full_name || '–')}</b>${u.is_admin ? ' <span class="pill pill--excl">admin</span>' : ''}<small class="muted">${esc(u.email)}${u.markets ? ` · equipe ${esc(u.markets)}` : ''}</small></td>
      <td>${esc(u.neighborhood || '–')}<small class="muted">${esc(u.zone || '')}</small></td><td>${GENDER[u.gender] || '–'}</td>
      <td>${u.completed_at ? '<span class="pill pill--ok">Completo</span>' : '<span class="pill pill--soft">Rápido</span>'}<small class="muted">desde ${dateBR(u.created_at, { day: '2-digit', month: 'short', year: '2-digit' })}</small></td>
      <td class="nowrap">${dateTime(u.last_sign_in_at)}</td><td class="r">${fmtN(u.lists)}</td><td class="r">${brl(Number(u.savings || 0))}</td><td class="r">${fmtN(u.reports)}</td>
      <td>${u.is_admin ? '' : sw(`data-u-block="${u.id}"`, !u.blocked, 'Conta ativa')}</td>
      <td class="r"><button class="btn btn--text btn--sm" data-u-reset="${u.id}" title="Zerar o contador de comparações">Zerar comparações</button></td></tr>`).join('') || '<tr><td colspan="10" class="muted center" style="padding:24px">Nenhum usuário.</td></tr>'}
  </tbody></table></div>
  <div class="pager"><span class="muted small">${fmtN(R.total)} usuários</span>${pages > 1 ? `<button class="btn btn--ghost btn--sm" data-upage="-1" ${st.usersPage ? '' : 'disabled'}>Anterior</button><span class="small">${st.usersPage + 1} de ${pages}</span><button class="btn btn--ghost btn--sm" data-upage="1" ${st.usersPage + 1 < pages ? '' : 'disabled'}>Próxima</button>` : ''}</div>`;
}

// ================================================================ MODERAÇÃO
async function renderModeration() {
  if (st.modTab === 'fotos') return renderPhotos();
  $('#ptMain').innerHTML = head('Moderação', 'Preços enviados pelos usuários. Os confirmados por duas pessoas entram sozinhos; aqui você aprova ou recusa o resto.')
    + modTabs() + `<div class="chips" style="margin-bottom:12px">${[['pendente', 'Aguardando'], ['aprovado', 'Aprovados'], ['rejeitado', 'Recusados'], ['all', 'Todos']].map(([k, l]) => `<button class="chip ${st.repStatus === k ? 'is-on' : ''}" data-rstatus="${k}">${l}</button>`).join('')}</div>
    <div id="rList"><div class="skeleton" style="height:240px"></div></div>`;
  let R;
  try { R = await A.reports(st.repStatus); } catch (e) { $('#rList').innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
  $('#rList').innerHTML = `<div class="tbl-wrap panel" style="padding:0"><table class="tbl"><thead><tr><th>Quando</th><th>Produto</th><th>Mercado</th><th class="r">Enviado</th><th class="r">Atual</th><th>Quem</th><th>Status</th><th></th></tr></thead><tbody>
    ${R.map((r) => { const diff = r.current_price ? (r.price / r.current_price - 1) * 100 : null; return `<tr><td class="nowrap">${dateTime(r.created_at)}</td>
      <td>${r.emoji || ''} ${esc(r.product)}<small class="muted">${esc([r.brand, r.unit].filter(Boolean).join(' · '))}</small></td><td>${esc(r.market)}</td>
      <td class="r"><b>${brl(Number(r.price))}</b>${diff != null && Math.abs(diff) >= 1 ? `<small class="${diff < 0 ? 'down' : 'up'}">${diff > 0 ? '+' : ''}${diff.toFixed(0)}%</small>` : ''}</td>
      <td class="r">${r.current_price ? brl(Number(r.current_price)) : '–'}</td><td><small>${esc(r.email || '–')}</small>${r.at_store ? '<span class="pill pill--ok">na loja</span>' : ''}</td>
      <td>${{ pendente: '<span class="pill pill--soft">Aguardando</span>', aprovado: '<span class="pill pill--ok">Aprovado</span>', rejeitado: '<span class="pill pill--warn">Recusado</span>' }[r.status]}</td>
      <td class="r nowrap">${r.status !== 'aprovado' ? `<button class="btn btn--primary btn--sm" data-rev="${r.id}" data-ok="1">Aprovar</button>` : ''} ${r.status !== 'rejeitado' ? `<button class="btn btn--ghost btn--sm" data-rev="${r.id}" data-ok="0">Recusar</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="8" class="muted center" style="padding:24px">Nada por aqui.</td></tr>'}
  </tbody></table></div>`;
}

const modTabs = () => `<div class="tabs" role="tablist" style="margin-bottom:12px"><button role="tab" aria-selected="${st.modTab === 'precos'}" data-modtab="precos">Preços enviados</button><button role="tab" aria-selected="${st.modTab === 'fotos'}" data-modtab="fotos">Fotos de etiqueta</button></div>`;

async function renderPhotos() {
  $('#ptMain').innerHTML = head('Moderação', 'Fotos tiradas no carrinho quando o preço falado não bate com o do site ou o produto ainda não existe. Aprovar publica o preço quando o produto já está no catálogo.')
    + modTabs() + `<div class="chips" style="margin-bottom:12px">${[['pendente', 'Aguardando'], ['aprovada', 'Aprovadas'], ['recusada', 'Recusadas'], ['all', 'Todas']].map(([k, l]) => `<button class="chip ${st.repStatus === k ? 'is-on' : ''}" data-pstatus="${k}">${l}</button>`).join('')}</div>
    <div id="phList"><div class="skeleton" style="height:240px"></div></div>`;
  let R;
  const status = ['pendente', 'aprovada', 'recusada', 'all'].includes(st.repStatus) ? st.repStatus : 'pendente';
  try { R = await A.shelfPhotos(status); } catch (e) { $('#phList').innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
  $('#phList').innerHTML = R.length ? `<div class="photo-grid">${R.map((f) => `<article class="panel photo-card">
      <a href="${esc(f.photo_url)}" target="_blank" rel="noopener" class="photo-card__img"><img src="${esc(f.photo_url)}" alt="Foto da etiqueta" loading="lazy" /></a>
      <div><b>${esc(f.product ? `${f.product} ${f.unit || ''}` : f.name || 'Produto')}</b>${f.product ? '' : ' <span class="pill pill--soft">novo</span>'}
        <small class="muted">“${esc(f.spoken || '')}”</small>
        <p class="small">${esc(f.market || '')} · falou <b>${f.price != null ? brl(Number(f.price)) : '–'}</b>${f.site_price != null ? ` · site ${brl(Number(f.site_price))}` : ''}</p>
        <small class="muted">${dateTime(f.created_at)} · ${esc(f.email || '')}</small></div>
      <div class="row-actions">${f.status === 'pendente' ? `<button class="btn btn--primary btn--sm" data-phrev="${f.id}" data-ok="1">${f.product ? 'Aprovar e publicar preço' : 'Marcar como conferida'}</button><button class="btn btn--ghost btn--sm" data-phrev="${f.id}" data-ok="0">Recusar</button>`
        : `<span class="pill ${f.status === 'aprovada' ? 'pill--ok' : 'pill--warn'}">${f.status === 'aprovada' ? 'Aprovada' : 'Recusada'}</span>`}</div>
    </article>`).join('')}</div>` : '<p class="muted small">Nenhuma foto por aqui.</p>';
}

// ================================================================ PUBLICIDADE
async function renderAdsAdmin() {
  $('#ptMain').innerHTML = head('Publicidade', 'Pedidos dos supermercados, campanhas no ar, pagamentos, planos e espaços.') + '<div id="adm-ads"><div class="skeleton" style="height:320px"></div></div>';
  let D;
  try { D = await A.adsAdmin(st.adStatus); st.ads = D; } catch (e) { $('#adm-ads').innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
  const R = D.revenue; const now = Date.now();
  $('#adm-ads').innerHTML = `
    <section class="kpis">
      ${kpi('Recebido no mês', Number(R.paid_month), { fmt: brl, accent: true })}${kpi('Recebido no total', Number(R.paid_total), { fmt: brl })}
      ${kpi('Aprovado, a receber', Number(R.to_receive), { fmt: brl })}${kpi('No ar agora', R.live, { hint: `${fmtN(R.pending)} aguardando aprovação` })}
    </section>
    <div class="chips">${[['pendente', 'Aguardando'], ['live', 'No ar'], ['aprovada', 'Aprovadas'], ['recusada', 'Recusadas'], ['all', 'Todas']].map(([k, l]) => `<button class="chip ${st.adStatus === k ? 'is-on' : ''}" data-adstatus="${k}">${l}</button>`).join('')}</div>
    <div class="ad-admin-list">${D.campaigns.map((a) => { const live = a.status === 'aprovada' && a.paid && new Date(a.starts_at) <= now && new Date(a.ends_at) > now;
      return `<article class="panel ad-admin">
        <div class="ad-admin__prev">${adsUI.html({ ...a, id: 0 }, { preview: true })}</div>
        <div class="ad-admin__info">
          <p><span class="cell-m">${logo({ name: a.market, color: a.color, logo_url: a.logo_url }, 'xs')} <b>${esc(a.market)}</b></span> · ${esc(a.slot_name || a.slot)} · ${esc(a.plan_name || '')}</p>
          <p class="small">${new Date(a.starts_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} até ${new Date(a.ends_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</p>
          <p><b>${brl(Number(a.price))}</b> ${a.paid ? '<span class="pill pill--ok">Pago</span>' : '<span class="pill pill--warn">A pagar</span>'} ${live ? '<span class="pill pill--ok">No ar</span>' : `<span class="pill pill--soft">${esc(a.status)}</span>`}</p>
          ${a.target_type !== 'none' ? `<p class="small muted">Botão leva para: ${a.target_type === 'product' ? 'produto' : a.target_type === 'store' ? 'rota até a loja' : esc(a.target_value || '')}</p>` : ''}
          ${a.reject_reason ? `<p class="small up">Motivo: ${esc(a.reject_reason)}</p>` : ''}
          <p class="small muted">${fmtN(a.views)} vistos · ${fmtN(a.reveals)} abertos · ${fmtN(a.clicks)} cliques${a.views ? ` (${((a.clicks / a.views) * 100).toFixed(1).replace('.', ',')}%)` : ''}</p>
          <div class="row-actions">
            ${a.status === 'pendente' ? `<button class="btn btn--primary btn--sm" data-adact="aprovar" data-id="${a.id}">Aprovar</button><button class="btn btn--ghost btn--sm" data-adact="recusar" data-id="${a.id}">Recusar</button>` : ''}
            ${['pendente', 'aprovada', 'pausada'].includes(a.status) ? (a.paid ? `<button class="btn btn--text btn--sm" data-adact="nao_pago" data-id="${a.id}">Desmarcar pago</button>` : `<button class="btn btn--ghost btn--sm" data-adact="pago" data-id="${a.id}">Marcar como pago</button>`) : ''}
            ${a.status === 'aprovada' ? `<button class="btn btn--ghost btn--sm" data-adact="pausar" data-id="${a.id}">Pausar</button>` : ''}${a.status === 'pausada' ? `<button class="btn btn--ghost btn--sm" data-adact="retomar" data-id="${a.id}">Retomar</button>` : ''}
            <button class="btn btn--text btn--sm" data-adact="excluir" data-id="${a.id}">Excluir</button>
          </div>
        </div></article>`; }).join('') || '<p class="muted small" style="padding:12px 0">Nenhuma campanha aqui.</p>'}</div>

    <div class="pt-grid">
      <section class="panel"><div class="panel__head"><h2>Planos</h2><span class="muted small">preço base, multiplicado pelo espaço</span></div>
        <div class="tbl-wrap"><table class="tbl tbl--sm"><thead><tr><th>Plano</th><th class="r">Horas</th><th class="r">Preço (R$)</th><th>Ativo</th><th></th></tr></thead><tbody>
        ${D.plans.map((p) => `<tr><td><input class="input sel--sm" data-plan-f="name" data-id="${p.id}" value="${esc(p.name)}" /></td><td class="r"><input class="input sel--sm num-in" type="number" min="1" data-plan-f="hours" data-id="${p.id}" value="${p.hours}" /></td>
          <td class="r"><input class="input sel--sm num-in" type="number" min="0" step="1" data-plan-f="price" data-id="${p.id}" value="${Number(p.price)}" /></td><td>${sw(`data-plan-active="${p.id}"`, p.active, 'Plano ativo')}</td>
          <td><button class="btn btn--ghost btn--sm" data-plan-save="${p.id}">Salvar</button></td></tr>`).join('')}</tbody></table></div>
        <form class="form form--inline" id="planNew"><label>Novo plano<input name="name" required placeholder="Ex.: Quinzenal" /></label><label>Horas<input name="hours" type="number" min="1" required value="360" style="width:90px" /></label><label>Preço<input name="price" type="number" min="0" required value="690" style="width:100px" /></label><button class="btn btn--ghost">Adicionar</button></form></section>
      <section class="panel"><div class="panel__head"><h2>Espaços no site</h2><span class="muted small">multiplicador do preço e quantos anúncios ao mesmo tempo</span></div>
        <div class="tbl-wrap"><table class="tbl tbl--sm"><thead><tr><th>Espaço</th><th class="r">×</th><th class="r">Vagas</th><th>Ativo</th><th></th></tr></thead><tbody>
        ${D.slots.map((x) => `<tr><td><b>${esc(x.name)}</b><small class="muted">${esc(x.description || '')}</small></td><td class="r"><input class="input sel--sm num-in" type="number" min="0.1" step="0.1" data-slot-f="multiplier" data-key="${x.key}" value="${Number(x.multiplier)}" /></td>
          <td class="r"><input class="input sel--sm num-in" type="number" min="1" max="10" data-slot-f="max_concurrent" data-key="${x.key}" value="${x.max_concurrent}" /></td><td>${sw(`data-slot-active="${x.key}"`, x.active, 'Espaço ativo')}</td>
          <td><button class="btn btn--ghost btn--sm" data-slot-save="${x.key}">Salvar</button></td></tr>`).join('')}</tbody></table></div>
        <p class="muted small">Exemplo: Diário (${brl(Number(D.plans.find((p) => p.hours === 24)?.price || 89))}) no destaque da página inicial (×${String(D.slots.find((x) => x.key === 'home')?.multiplier || 1.5).replace('.', ',')}) = ${brl(Math.round(Number(D.plans.find((p) => p.hours === 24)?.price || 89) * Number(D.slots.find((x) => x.key === 'home')?.multiplier || 1.5)))}.</p></section>
    </div>`;
}

// ================================================================ PRODUTOS E PROMOÇÕES
async function renderProducts() {
  $('#ptMain').innerHTML = head('Produtos', 'Desative um produto para tirá-lo do site inteiro (de todos os mercados).') + `
    <div class="pt-tools"><label class="search search--sm"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 3a7.5 7.5 0 1 0 4.6 13.4l4.7 4.7 1.4-1.4-4.7-4.7A7.5 7.5 0 0 0 10.5 3zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z" fill="currentColor"/></svg>
      <input id="pQ" type="search" placeholder="Nome, marca ou EAN" value="${esc(st.prodQ)}" /></label></div><div id="pList"><div class="skeleton" style="height:300px"></div></div>`;
  loadProducts();
}
async function loadProducts() {
  let R;
  try { R = await A.products(st.prodQ); } catch (e) { $('#pList').innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
  $('#pList').innerHTML = `<div class="tbl-wrap panel" style="padding:0"><table class="tbl"><thead><tr><th>Produto</th><th>Categoria</th><th>Criado por</th><th class="r">Mercados</th><th>Último preço</th><th>Ativo</th></tr></thead><tbody>
    ${R.map((p) => `<tr class="${p.active ? '' : 'is-off'}"><td><span class="cell-m">${p.image_url ? `<img src="${esc(p.image_url)}" alt="" class="mini-photo" />` : p.emoji || '🛒'} <span>${esc(p.name)}<small class="muted">${esc([p.brand, p.unit, p.ean].filter(Boolean).join(' · '))}</small></span></span></td>
      <td>${esc(p.category || '–')}</td><td>${esc(p.created_by || 'catálogo')}</td><td class="r">${fmtN(p.markets)}</td><td>${dateBR(p.last_price)}</td>
      <td>${sw(`data-p-active="${p.id}"`, p.active, 'Produto ativo no site')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted center">Nenhum produto.</td></tr>'}
  </tbody></table></div>`;
}

async function renderPromos() {
  $('#ptMain').innerHTML = head('Promoções', 'Todas as promoções criadas pelos supermercados. Desligue qualquer uma para tirá-la do site.') + '<div id="prList"><div class="skeleton" style="height:240px"></div></div>';
  let R;
  try { R = await A.promotions(); } catch (e) { $('#prList').innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
  const now = Date.now();
  $('#prList').innerHTML = `<div class="tbl-wrap panel" style="padding:0"><table class="tbl"><thead><tr><th>Produto</th><th>Mercado</th><th>Tipo</th><th class="r">Preço</th><th>Período</th><th>Situação</th><th>Ativa</th></tr></thead><tbody>
    ${R.map((p) => { const live = p.active && new Date(p.starts_at) <= now && new Date(p.ends_at) > now; return `<tr class="${p.active ? '' : 'is-off'}"><td>${p.emoji || ''} ${esc(p.product)}</td><td>${esc(p.market)}</td>
      <td>${p.kind === 'exclusiva' ? `<span class="pill pill--excl">Exclusiva</span> <code>${esc(p.code || '')}</code>` : '<span class="pill pill--promo">Geral</span>'}</td>
      <td class="r">${brl(Number(p.promo_price))}</td><td class="nowrap">${dateBR(p.starts_at)} – ${dateBR(p.ends_at)}</td>
      <td>${live ? '<span class="pill pill--ok">No ar</span>' : new Date(p.ends_at) <= now ? '<span class="pill pill--soft">Encerrada</span>' : p.active ? '<span class="pill pill--soft">Agendada</span>' : '<span class="pill pill--warn">Desligada</span>'}</td>
      <td>${sw(`data-pr-active="${p.id}"`, p.active, 'Promoção ativa')}</td></tr>`; }).join('') || '<tr><td colspan="7" class="muted center" style="padding:24px">Nenhuma promoção criada ainda.</td></tr>'}
  </tbody></table></div>`;
}

// ================================================================ RELATÓRIOS
function renderReports() {
  const items = [
    ['usuarios', 'Usuários', 'Todos os cadastros: bairro, zona, sexo, cadastro, último acesso, ranchos, economia e preços enviados.'],
    ['mercados', 'Desempenho dos supermercados', 'Compras confirmadas, valor declarado, ranchos mais baratos, rotas, interesse, produtos e promoções no período escolhido.'],
    ['regioes', 'Regiões e bairros', 'Usuários, visitantes, buscas e ranchos por zona de Manaus, e usuários por bairro.'],
    ['buscas', 'Buscas', 'Termos mais buscados e buscas sem resultado no período.'],
    ['produtos', 'Produtos mais vistos', 'Visualizações e adições ao rancho por produto.'],
    ['diario', 'Movimento diário', 'Visitantes, buscas, ranchos e cadastros por dia.'],
    ['publico', 'Público', 'Usuários por sexo e por faixa etária.'],
  ];
  $('#ptMain').innerHTML = head('Relatórios', 'Planilhas em CSV (abrem no Excel). Os relatórios de métricas usam o período escolhido.',
    `<div class="seg" role="radiogroup" aria-label="Período">${[[7, '7 dias'], [30, '30 dias'], [90, '90 dias'], [365, '12 meses']].map(([d, l]) => `<button role="radio" aria-checked="${st.days === d}" data-rdays="${d}">${l}</button>`).join('')}</div>`)
    + `<div class="rep-list">${items.map(([k, t, d]) => `<section class="panel rep-item"><div><h2>${t}</h2><p class="muted small">${d}</p></div><button class="btn btn--ghost" data-csv="${k}">Baixar CSV</button></section>`).join('')}
      <section class="panel rep-item"><div><h2>Resumo para imprimir</h2><p class="muted small">Abre a visão geral pronta para imprimir ou salvar em PDF.</p></div><button class="btn btn--ghost" data-print>Imprimir</button></section></div>`;
}

async function exportCSV(kind) {
  const stamp = new Date().toISOString().slice(0, 10);
  const ov = async () => (st.overview && st.overview._days === st.days ? st.overview : Object.assign(await A.overview(st.days), { _days: st.days }));
  if (kind === 'usuarios') {
    const all = []; let off = 0, total = 1;
    while (off < total && off < 20000) { const R = await A.users(st.usersQ, st.usersFilter, 500, off); total = R.total; all.push(...R.rows); off += 500; if (!R.rows.length) break; }
    return downloadCSV(`usuarios-${stamp}.csv`, all, [['full_name', 'Nome'], ['email', 'E-mail'], ['phone', 'Celular'], ['neighborhood', 'Bairro'], ['zone', 'Zona'], [(r) => GENDER[r.gender] || '', 'Sexo'],
      [(r) => (r.completed_at ? 'Completo' : 'Rápido'), 'Cadastro'], [(r) => dateBR(r.created_at, { dateStyle: 'short' }), 'Criado em'], [(r) => (r.last_sign_in_at ? new Date(r.last_sign_in_at).toLocaleString('pt-BR') : ''), 'Último acesso'],
      ['lists', 'Ranchos'], [(r) => Number(r.savings || 0), 'Economia (R$)'], ['reports', 'Preços enviados'], ['points', 'Pontos'], ['comparisons_used', 'Comparações'], ['markets', 'Equipe de mercado'], [(r) => (r.blocked ? 'Sim' : 'Não'), 'Bloqueado']]);
  }
  const D = await ov();
  if (kind === 'mercados') return downloadCSV(`mercados-${st.days}d-${stamp}.csv`, D.markets, [['name', 'Supermercado'], [(r) => (r.active ? 'Sim' : 'Não'), 'Ativo'], [(r) => (r.portal_enabled ? 'Sim' : 'Não'), 'Portal'], ['bought', 'Compras confirmadas'], [(r) => Number(r.spent || 0), 'Valor declarado (R$)'], ['rancho_wins', 'Ranchos mais baratos'], ['routes', 'Rotas'], ['interest', 'Interesse (vistos + adições)'], ['products', 'Produtos'], ['promos', 'Promoções no ar'], ['score', 'Pontos']]);
  if (kind === 'regioes') {
    downloadCSV(`zonas-${st.days}d-${stamp}.csv`, D.zones, [['zone', 'Zona'], ['users', 'Usuários'], ['visitors', 'Visitantes'], ['searches', 'Buscas'], ['adds', 'Itens no rancho'], ['ranchos', 'Ranchos concluídos']]);
    return downloadCSV(`bairros-${stamp}.csv`, D.neighborhoods, [['neighborhood', 'Bairro'], ['zone', 'Zona'], ['users', 'Usuários'], ['complete', 'Cadastro completo']]);
  }
  if (kind === 'buscas') {
    downloadCSV(`buscas-${st.days}d-${stamp}.csv`, D.top_searches, [['query', 'Busca'], ['n', 'Vezes'], ['people', 'Pessoas']]);
    return downloadCSV(`buscas-sem-resultado-${st.days}d-${stamp}.csv`, D.no_results, [['query', 'Busca'], ['n', 'Vezes']]);
  }
  if (kind === 'produtos') return downloadCSV(`produtos-mais-vistos-${st.days}d-${stamp}.csv`, D.top_products, [['name', 'Produto'], ['brand', 'Marca'], ['views', 'Visualizações'], ['adds', 'Adições ao rancho']]);
  if (kind === 'diario') return downloadCSV(`movimento-diario-${st.days}d-${stamp}.csv`, D.daily, [['d', 'Dia'], ['visitors', 'Visitantes'], ['searches', 'Buscas'], ['ranchos', 'Ranchos'], ['signups', 'Cadastros']]);
  if (kind === 'publico') {
    downloadCSV(`publico-sexo-${stamp}.csv`, D.gender, [[(r) => GENDER[r.gender] || r.gender, 'Sexo'], ['users', 'Usuários'], ['ranchos', 'Ranchos no período']]);
    return downloadCSV(`publico-idade-${stamp}.csv`, D.age, [['age_band', 'Faixa etária'], ['users', 'Usuários']]);
  }
}

// ================================================================ CONFIGURAÇÕES
async function renderConfig() {
  $('#ptMain').innerHTML = head('Configurações', 'Ligue e desligue partes do site. As mudanças valem na hora para todo mundo.') + '<div id="cfg"><div class="skeleton" style="height:300px"></div></div>';
  let S, ad, lg;
  try { [S, ad, lg] = await Promise.all([A.settings(), A.admins(), A.log()]); } catch (e) { $('#cfg').innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
  const val = (k) => S.find((x) => x.key === k)?.value;
  const toggles = [
    ['collab_enabled', 'Usuários podem informar preços', 'Desligado: some o “Viu outro preço?” e o banco recusa novos envios.'],
    ['promos_enabled', 'Promoções aparecem no site', 'Desligado: o site mostra só o preço normal de todos os mercados.'],
    ['portal_enabled', 'Área do supermercado liberada', 'Desligado: nenhum mercado consegue entrar no portal.'],
    ['tracking_enabled', 'Coleta de métricas de uso', 'Desligado: buscas, visualizações e rotas deixam de ser registradas.'],
    ['ads_enabled', 'Publicidade aparece no site', 'Desligado: nenhum anúncio é mostrado, mesmo os pagos e aprovados.'],
  ];
  $('#cfg').innerHTML = `
    <section class="panel"><div class="panel__head"><h2>Funções do site</h2></div>
      <ul class="cfg-list">${toggles.map(([k, t, d]) => `<li><span><b>${t}</b><small class="muted">${d}</small></span>${sw(`data-set="${k}"`, val(k) !== false, t)}</li>`).join('')}</ul></section>
    <div class="pt-grid">
      <section class="panel"><div class="panel__head"><h2>Limites de comparação</h2></div>
        <form class="form" id="cfgLimits">
          <label>Sem cadastro<input name="anon" type="number" min="0" max="999" value="${Number(val('anon_comparisons') ?? 3)}" /></label>
          <label>Com cadastro rápido<input name="quick" type="number" min="0" max="9999" value="${Number(val('quick_comparisons') ?? 15)}" /></label>
          <p class="muted small">Cadastro completo é sempre sem limite. Cada preço informado libera +2 comparações.</p>
          <button class="btn btn--primary">Salvar limites</button></form></section>
      <section class="panel"><div class="panel__head"><h2>Aviso no topo do site</h2></div>
        <form class="form" id="cfgBanner"><label>Mensagem<textarea name="banner" maxlength="200" placeholder="Ex.: Semana do rancho: promoções exclusivas até domingo!">${esc(val('banner') || '')}</textarea></label>
          <div class="row-actions"><button class="btn btn--primary">Publicar aviso</button><button class="btn btn--ghost" type="button" data-banner-clear>Tirar aviso</button></div></form></section>
    </div>
    <section class="panel"><div class="panel__head"><h2>Administradores master</h2></div>
      <ul class="cfg-list">${ad.map((a) => `<li><span><b>${esc(a.email)}</b><small class="muted">${a.has_account ? 'conta criada' : 'ainda sem conta no site'} · incluído por ${esc(a.added_by || '–')} em ${dateBR(a.created_at)}</small></span>
        ${a.email === 'haydenfernandes.ti@gmail.com' || a.email === st.user?.email ? '<span class="pill pill--excl">você</span>' : `<button class="btn btn--text btn--sm" data-adm-del="${esc(a.email)}">Remover</button>`}</li>`).join('')}</ul>
      <form class="form form--inline" id="admAdd"><label>Novo administrador (e-mail)<input name="email" type="email" required /></label><button class="btn btn--ghost">Adicionar</button></form>
      <p class="muted small">A pessoa entra em admin.html com a conta do site desse e-mail.</p></section>
    <section class="panel"><div class="panel__head"><h2>Registro de atividades</h2><span class="muted small">últimas ações na administração</span></div>
      ${lg.length ? `<div class="tbl-wrap"><table class="tbl tbl--sm"><thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Detalhe</th></tr></thead><tbody>
        ${lg.map((l) => `<tr><td class="nowrap">${dateTime(l.created_at)}</td><td><small>${esc(l.admin || '')}</small></td><td>${esc(l.action)}</td><td><small class="muted">${esc(JSON.stringify(l.detail || {})).slice(0, 140)}</small></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted small">Nenhuma ação registrada ainda.</p>'}</section>
    ${A.MODE === 'demo' ? '<button class="btn btn--text" data-demo-reset>Recomeçar a demonstração</button>' : ''}`;
}

// ================================================================ eventos
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, a'); if (!t) return;
  const d = t.dataset;
  if (d.demo !== undefined) { A.useDemo(); st.user = { email: 'haydenfernandes.ti@gmail.com' }; return enter(); }
  if (d.days) { st.days = Number(d.days); return renderOverview(); }
  if (d.rdays) { st.days = Number(d.rdays); st.overview = null; return renderReports(); }
  if (d.mkNew !== undefined) return marketForm();
  if (d.mkEdit) return marketForm(st.markets.find((m) => m.id === Number(d.mkEdit)));
  if (d.mkAccess) return accessSheet(Number(d.mkAccess));
  if (d.mkStores) return storesSheet(Number(d.mkStores));
  if (d.mkDel) {
    const m = st.markets.find((x) => x.id === Number(d.mkDel));
    const typed = prompt(`Excluir o ${m.name} apaga TODOS os preços, lojas, acessos e promoções dele, sem volta.\nPara só tirar do site, use a chave “Aparece no site”.\n\nDigite ${m.slug} para confirmar:`);
    if (typed == null) return;
    if (await run(() => A.deleteMarket(m.id, typed.trim()), 'Supermercado excluído.')) renderMarkets();
    return;
  }
  if (d.memDel) {
    if (!confirm('Excluir o acesso desta pessoa ao portal?')) return;
    if (await run(() => A.removeMember(d.memDel, Number(d.mk)), 'Acesso excluído.')) { accessSheet(Number(d.mk)); refreshMarketsSoon(); }
    return;
  }
  if (d.invDel) {
    if (!confirm(`Excluir o código ${d.invDel}? Ele deixa de funcionar na hora.`)) return;
    if (await run(() => A.deleteInvite(d.invDel), 'Código excluído.')) { accessSheet(Number(d.mk)); refreshMarketsSoon(); }
    return;
  }
  if (d.invCopy) {
    const msg = `Olá! Seu acesso à Área do supermercado do Tá Barato Mesmo? (${d.mkname}) está liberado.\n\n1. Abra ${new URL('parceiros.html', SITE).href}\n2. Toque em "Criar conta com código de convite"\n3. Use o código: ${d.invCopy}`;
    try { await navigator.clipboard.writeText(msg); toast('Mensagem copiada. É só colar no WhatsApp ou e-mail.'); } catch { prompt('Copie a mensagem:', msg); }
    return;
  }
  if (d.stEdit) {
    const s = $('#stBody')._stores.find((x) => x.id === Number(d.stEdit)); const f = $('#stForm');
    f.sid.value = s.id; f.sname.value = s.name; f.neighborhood.value = s.neighborhood || ''; f.address.value = s.address || '';
    f.lat.value = s.lat; f.lng.value = s.lng; f.approx.checked = !!s.approx; $('#stFormTitle').textContent = `Editando ${s.name}`; f.sname.focus();
    return;
  }
  if (d.stDel) {
    if (!confirm('Excluir esta loja do mapa?')) return;
    if (await run(() => A.deleteStore(Number(d.stDel)), 'Loja excluída.')) { storesSheet(Number(d.mk)); refreshMarketsSoon(); }
    return;
  }
  if (d.ufilter) { st.usersFilter = d.ufilter; st.usersPage = 0; $$('[data-ufilter]').forEach((b) => b.classList.toggle('is-on', b === t)); return loadUsers(); }
  if (d.upage) { st.usersPage += Number(d.upage); return loadUsers(); }
  if (d.uReset) { if (await run(() => A.setUser(d.uReset, null, true), 'Comparações zeradas.')) loadUsers(); return; }
  if (d.rstatus) { st.repStatus = d.rstatus; return renderModeration(); }
  if (d.modtab) { st.modTab = d.modtab; st.repStatus = 'pendente'; return renderModeration(); }
  if (d.pstatus) { st.repStatus = d.pstatus; return renderPhotos(); }
  if (d.phrev) { if (await run(() => A.reviewPhoto(Number(d.phrev), d.ok === '1'), d.ok === '1' ? 'Foto aprovada.' : 'Foto recusada.')) renderPhotos(); return; }
  if (d.adstatus) { st.adStatus = d.adstatus; return renderAdsAdmin(); }
  if (d.adact) {
    let reason = null;
    if (d.adact === 'recusar') { reason = prompt('Motivo da recusa (o supermercado vê esta mensagem):', 'Imagem com muito texto. Use uma foto real do produto.'); if (reason == null) return; }
    if (d.adact === 'excluir' && !confirm('Excluir esta campanha?')) return;
    if (await run(() => A.adSet(Number(d.id), d.adact, reason), 'Feito.')) renderAdsAdmin();
    return;
  }
  if (d.planSave) {
    const id = d.planSave; const v = (f) => $(`[data-plan-f="${f}"][data-id="${id}"]`).value;
    if (await run(() => A.savePlan({ id, name: v('name'), hours: Number(v('hours')), price: Number(v('price')) }), 'Plano salvo.')) renderAdsAdmin();
    return;
  }
  if (d.slotSave) {
    const k = d.slotSave; const v = (f) => $(`[data-slot-f="${f}"][data-key="${k}"]`).value;
    if (await run(() => A.saveSlot({ key: k, multiplier: Number(v('multiplier')), max_concurrent: Number(v('max_concurrent')) }), 'Espaço salvo.')) renderAdsAdmin();
    return;
  }
  if (d.rev) { if (await run(() => A.reviewReport(Number(d.rev), d.ok === '1'), d.ok === '1' ? 'Preço aprovado e publicado.' : 'Preço recusado.')) renderModeration(); return; }
  if (d.csv) { t.disabled = true; await run(() => exportCSV(d.csv)); t.disabled = false; return; }
  if (d.print !== undefined) { location.hash = '#geral'; setTimeout(() => window.print(), 1800); return; }
  if (d.admDel) { if (!confirm(`Remover ${d.admDel} dos administradores?`)) return; if (await run(() => A.removeAdmin(d.admDel), 'Administrador removido.')) renderConfig(); return; }
  if (d.bannerClear !== undefined) { if (await run(() => A.setSetting('banner', ''), 'Aviso retirado.')) renderConfig(); return; }
  if (d.demoReset !== undefined) { A.resetDemo(); toast('Demonstração recomeçada.'); return renderConfig(); }
  if (t.id === 'logoutBtn') { await api.signOut().catch(() => {}); st.user = null; location.hash = ''; return renderLogin(); }
});

let refreshT;
function refreshMarketsSoon() { clearTimeout(refreshT); refreshT = setTimeout(() => { if (location.hash === '#mercados') renderMarkets(); }, 300); }

document.addEventListener('change', async (e) => {
  const t = e.target; const d = t.dataset;
  const revert = () => { if (t.type === 'checkbox') t.checked = !t.checked; };
  if (d.mkFlag) { if (!(await run(() => A.setMarketFlag(Number(d.id), d.mkFlag, t.checked), t.checked ? 'Ativado.' : 'Desativado.'))) revert(); else refreshMarketsSoon(); return; }
  if (d.memSusp) { if (!(await run(() => A.setMember(d.memSusp, Number(d.mk), null, !t.checked), t.checked ? 'Acesso reativado.' : 'Acesso suspenso.'))) revert(); else { t.closest('tr').classList.toggle('is-off', !t.checked); refreshMarketsSoon(); } return; }
  if (d.memRole) { await run(() => A.setMember(d.memRole, Number(d.mk), t.value, null), 'Papel alterado.'); return; }
  if (d.uBlock) { if (!(await run(() => A.setUser(d.uBlock, !t.checked, false), t.checked ? 'Conta liberada.' : 'Conta bloqueada.'))) revert(); else t.closest('tr').classList.toggle('is-off', !t.checked); return; }
  if (d.pActive) { if (!(await run(() => A.setProduct(Number(d.pActive), t.checked), t.checked ? 'Produto ativado.' : 'Produto tirado do site.'))) revert(); else t.closest('tr').classList.toggle('is-off', !t.checked); return; }
  if (d.prActive) { if (!(await run(() => A.setPromotion(Number(d.prActive), t.checked), t.checked ? 'Promoção ligada.' : 'Promoção desligada.'))) revert(); return; }
  if (d.set) { if (!(await run(() => A.setSetting(d.set, t.checked), 'Configuração salva.'))) revert(); }
  if (d.planActive) { if (!(await run(() => A.savePlan({ id: d.planActive, active: t.checked }), t.checked ? 'Plano ativado.' : 'Plano desativado.'))) revert(); }
  if (d.slotActive) { if (!(await run(() => A.saveSlot({ key: d.slotActive, active: t.checked }), t.checked ? 'Espaço ativado.' : 'Espaço desativado.'))) revert(); }
});

let qT;
document.addEventListener('input', (e) => {
  if (e.target.id === 'uQ') { clearTimeout(qT); qT = setTimeout(() => { st.usersQ = e.target.value; st.usersPage = 0; loadUsers(); }, 350); }
  if (e.target.id === 'pQ') { clearTimeout(qT); qT = setTimeout(() => { st.prodQ = e.target.value; loadProducts(); }, 350); }
});

document.addEventListener('submit', async (e) => {
  const f = e.target; e.preventDefault();
  const fid = f.getAttribute('id');
  const err = (m) => { const el = $('.form__err', f); if (el) el.textContent = m; else toast(m, 'warn'); };
  const btn = $('button:not([type=button])', f); if (btn) btn.disabled = true;
  try {
    if (fid === 'admLogin') {
      await api.signIn({ email: f.email.value.trim(), password: f.password.value });
    } else if (fid === 'mkForm') {
      await A.saveMarket({ id: f.mid.value || null, name: f.mname.value.trim(), slug: f.slug.value.trim(), color: f.color.value, logo_url: f.logo_url.value.trim(), website: f.website.value.trim() });
      closeSheet(); toast('Supermercado salvo.'); renderMarkets();
    } else if (fid === 'memAdd') {
      await A.addMember(f.email.value.trim(), Number(f.dataset.mk), f.role.value); toast('Acesso liberado.'); accessSheet(Number(f.dataset.mk)); refreshMarketsSoon();
    } else if (fid === 'invNew') {
      const mk = Number(f.dataset.mk);
      const code = await A.createInvite(mk, f.role.value, Number(f.uses.value) || 3, Number(f.days.value) || 30);
      await accessSheet(mk);
      const m = st.markets.find((x) => x.id === mk);
      $('#invNewOut').innerHTML = `<div class="ok-box" style="margin:10px 0"><p>Novo código: <code class="code-big">${esc(code)}</code></p>
        <button class="btn btn--primary btn--sm" style="margin-top:8px" data-inv-copy="${esc(code)}" data-mkname="${esc(m.name)}">Copiar mensagem para enviar</button></div>`;
      refreshMarketsSoon();
    } else if (fid === 'stForm') {
      const lat = parseFloat(String(f.lat.value).replace(',', '.')), lng = parseFloat(String(f.lng.value).replace(',', '.'));
      if (!(lat < 0 && lat > -4) || !(lng < -59 && lng > -61)) throw new Error('As coordenadas não parecem ser de Manaus (latitude perto de -3, longitude perto de -60).');
      await A.saveStore({ id: f.sid.value || null, supermarket_id: Number(f.dataset.mk), name: f.sname.value.trim(), neighborhood: f.neighborhood.value.trim(), address: f.address.value.trim(), lat, lng, approx: f.approx.checked });
      toast('Loja salva.'); storesSheet(Number(f.dataset.mk)); refreshMarketsSoon();
    } else if (fid === 'cfgLimits') {
      await A.setSetting('anon_comparisons', Math.max(0, Number(f.anon.value) || 0));
      await A.setSetting('quick_comparisons', Math.max(0, Number(f.quick.value) || 0)); toast('Limites salvos.');
    } else if (fid === 'cfgBanner') {
      await A.setSetting('banner', f.banner.value.trim()); toast(f.banner.value.trim() ? 'Aviso publicado no site.' : 'Aviso retirado.');
    } else if (fid === 'planNew') {
      await A.savePlan({ name: f.name.value.trim(), hours: Number(f.hours.value), price: Number(f.price.value) }); toast('Plano criado.'); renderAdsAdmin();
    } else if (fid === 'admAdd') {
      await A.addAdmin(f.email.value.trim()); toast('Administrador adicionado.'); renderConfig();
    }
  } catch (ex) { err(ex.message || 'Algo deu errado.'); } finally { if (btn) btn.disabled = false; }
});

// ================================================================ início
async function boot() {
  await api.loadCatalog().catch(() => {});
  await A.init().catch(() => {});
  if (A.MODE !== 'live') return renderLogin();
  api.onAuth((user) => { st.user = user; if (!user) return renderLogin(); enter(); });
  await api.initAuth();
}
boot();
