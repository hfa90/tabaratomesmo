// Página "Você": quanto a pessoa já economizou, onde mais compra, histórico,
// conquistas, colaboração e dados da conta.
import * as api from './api.js';
import { ic } from './icons.js';
import { CONFIG } from './config.js';
import { S, $, $$, esc, brl, logo, hooks, initials } from './core.js';
import * as rancho from './rancho.js';
import * as fiscal from './fiscal.js';

let tab = 'resumo';
let remote = null;        // ranchos salvos na conta
let remoteFor = null;     // id do usuário dono do cache
let projMonths = 12;

const monthLabel = (k, opt = { month: 'short' }) => new Date(k.slice(0, 7) + '-15T12:00:00').toLocaleDateString('pt-BR', opt).replace('.', '');

/** junta o histórico do aparelho com o da conta (mesmo mês: o do aparelho tem mais detalhes) */
function entries() {
  const map = new Map();
  for (const r of remote || []) {
    if (r.status !== 'concluida') continue;
    const k = r.month.slice(0, 7);
    map.set(k, { month: k, name: r.name, best: r.best_market, bestTotal: Number(r.best_total) || 0, baseTotal: Number(r.base_total) || null,
      savings: Number(r.savings) || 0, bought: r.bought_market, spent: r.spent == null ? null : Number(r.spent), itemsCount: r.items_count });
  }
  for (const h of Object.values(rancho.history())) map.set(h.month, { ...map.get(h.month), ...h, itemsCount: h.items?.length });
  return [...map.values()].sort((a, b) => b.month.localeCompare(a.month));
}

/** dados do cartão "meu mês" (resumo.js) */
export function monthData() {
  const st = stats(); const k = new Date().toISOString().slice(0, 7);
  const month = st.es.filter((e) => e.month === k).reduce((s, e) => s + (e.savings || 0), 0);
  return { total: st.total, month, top: st.markets[0] || null, ranchos: st.es.length };
}

/** resumo para a faixa de economia da página de ofertas */
export function savingsSummary() {
  const es = entries();
  const k = new Date().toISOString().slice(0, 7);
  return { total: es.reduce((s, e) => s + (e.savings || 0), 0), month: es.filter((e) => e.month === k).reduce((s, e) => s + (e.savings || 0), 0), n: es.length };
}

function stats() {
  const es = entries();
  const total = es.reduce((s, e) => s + (e.savings || 0), 0);
  const byMarket = new Map();
  for (const e of es) {
    const mid = e.bought || e.best; if (!mid) continue;
    const r = byMarket.get(mid) || { n: 0, spent: 0, confirmed: 0 };
    r.n++; r.spent += e.spent || (e.bought ? e.totals?.[e.bought] : e.bestTotal) || 0; if (e.bought) r.confirmed++;
    byMarket.set(mid, r);
  }
  // compras registradas no Carrinho (dentro da loja) também contam
  for (const pu of api.store.get('tb.purchases', [])) {
    const r = byMarket.get(pu.market) || { n: 0, spent: 0, confirmed: 0 };
    r.n++; r.spent += pu.total || 0; r.confirmed++; byMarket.set(pu.market, r);
  }
  const markets = [...byMarket].map(([id, r]) => ({ m: S.markets.get(id), ...r })).filter((x) => x.m).sort((a, b) => b.n - a.n || b.spent - a.spent);
  // últimos 6 meses (inclusive os sem rancho)
  const months = [];
  const d = new Date(); d.setDate(15);
  for (let i = 5; i >= 0; i--) {
    const k = new Date(d.getFullYear(), d.getMonth() - i, 15).toISOString().slice(0, 7);
    months.push({ k, v: es.find((e) => e.month === k)?.savings || 0 });
  }
  const avg = es.length ? total / es.length : 0;
  return { es, total, markets, months, avg };
}

// ---------------------------------------------------------------- partes
function saveHero(st) {
  const cur = rancho.meta();
  const r = S.list.size && cur.status !== 'concluida' ? rancho.computeReport() : null;
  const max = Math.max(...st.months.map((m) => m.v), 1);
  return `<section class="save-hero" aria-label="Sua economia">
    <div>
      <p class="save-hero__k">Você já economizou com o Tá Barato Mesmo?</p>
      <p class="save-hero__v" id="saveTotal" data-v="${st.total}">${brl(st.total)}</p>
      <p class="save-hero__sub">${st.es.length ? `em ${st.es.length} ${st.es.length > 1 ? 'ranchos' : 'rancho'} desde ${monthLabel(st.es[st.es.length - 1].month, { month: 'long', year: 'numeric' })}` : 'Conclua seu primeiro rancho para começar a contar.'}
        ${r && r.savings > 0 ? `<br/>O rancho em aberto pode render mais <b>${brl(r.savings)}</b>.` : ''}</p>
    </div>
    ${st.es.length ? `<div class="proj">
      <label for="projRange">Mantendo a média de ${brl(st.avg)} por mês, em <b id="projM">${projMonths} meses</b> são <b id="projV">${brl(st.avg * projMonths)}</b>.</label>
      <input type="range" id="projRange" min="1" max="24" value="${projMonths}" aria-label="Meses" />
    </div>` : `<div class="row-actions"><a class="btn btn--tag btn--sm" href="#lista">Montar meu rancho</a></div>`}
    <button class="save-hero__share" data-resumo>${ic('sparkle')} Compartilhar meu mês</button>
  </section>
  ${st.es.length ? '' : '<!--'}<section class="panel">
    <div class="panel__head"><h2>Economia por mês</h2><span class="muted small" id="mbarsInfo">Toque num mês</span></div>
    <div class="mbars" role="list">${st.months.map((m) => `<button role="listitem" data-mbar="${m.k}" data-v="${m.v}" aria-label="${monthLabel(m.k, { month: 'long' })}: ${brl(m.v)}">
      <i style="--h:${Math.round((m.v / max) * 100)}%"><em>${m.v ? brl(m.v) : '–'}</em></i>${monthLabel(m.k)}</button>`).join('')}</div>
  </section>${st.es.length ? '' : '-->'}`;
}

function donut(markets) {
  const total = markets.reduce((s, x) => s + x.n, 0) || 1;
  const R = 46, C = 2 * Math.PI * R; let off = 0;
  const arcs = markets.map((x) => {
    const len = (x.n / total) * C;
    const a = `<circle r="${R}" cx="60" cy="60" stroke="${esc(x.m.color)}" stroke-dasharray="${Math.max(len - 2, 1)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)"/>`;
    off += len; return a;
  }).join('');
  return `<svg class="donut" viewBox="0 0 120 120" role="img" aria-label="Divisão das compras por mercado">
    <circle r="${R}" cx="60" cy="60" stroke="var(--surface-2)"/>${arcs}
    <text x="60" y="58" text-anchor="middle" font-weight="700" font-size="22" fill="currentColor">${total}</text>
    <text x="60" y="76" text-anchor="middle" font-size="10" fill="var(--muted)">ranchos</text></svg>`;
}

function favMarket(st) {
  if (!st.markets.length) return `<section class="panel"><div class="panel__head"><h2>Seu supermercado</h2></div>
    <p class="muted small">Conclua um rancho para ver onde você mais compra e quanto gasta em cada mercado.</p></section>`;
  const top = st.markets[0];
  return `<section class="panel">
    <div class="panel__head"><h2>Seu supermercado</h2><span class="muted small">${top.confirmed ? 'pelas compras que você registrou' : 'pelos ranchos concluídos'}</span></div>
    <div style="display:flex;align-items:center;gap:12px">${logo(top.m, 'lg')}<p>Você mais compra no <b>${esc(top.m.name)}</b>: ${top.n} de ${st.markets.reduce((s, x) => s + x.n, 0)} compras.</p></div>
    <div class="fav-market">${donut(st.markets)}
      <ul class="legend">${st.markets.map((x) => `<li><span class="logo logo--xs" style="--c:${esc(x.m.color)}"></span><span>${esc(x.m.name)}<br/><small>${x.n} ${x.n > 1 ? 'vezes' : 'vez'}${x.spent ? `, ${brl(x.spent)}` : ''}</small></span><b>${Math.round((x.n / st.markets.reduce((s, y) => s + y.n, 0)) * 100)}%</b></li>`).join('')}</ul>
    </div>
  </section>`;
}

function badges(st, imp) {
  const list = [
    [ic('basket'), 'Primeiro rancho', 'Concluiu um rancho', st.es.length >= 1],
    [ic('calendar'), 'Três meses', '3 ranchos concluídos', st.es.length >= 3],
    [ic('coins'), 'R$ 100 no bolso', 'Economizou R$ 100', st.total >= 100],
    [ic('trophy'), 'R$ 500 no bolso', 'Economizou R$ 500', st.total >= 500],
    [ic('compass'), 'Explorador', 'Comprou em 3 mercados', st.markets.length >= 3],
    [ic('search'), 'Fiscal', 'Informou um preço', (imp?.reports || 0) >= 1],
    [ic('home'), 'Casa definida', 'Calcula o deslocamento', rancho.homePos()?.source === 'home'],
    [ic('good'), 'Cadastro completo', 'Comparações sem limite', !!S.profile?.completed_at],
  ];
  return `<section class="panel"><div class="panel__head"><h2>Conquistas</h2><span class="muted small">${list.filter((b) => b[3]).length} de ${list.length}</span></div>
    <div class="badges">${list.map(([i, t, d, on]) => `<div class="bdg ${on ? 'is-on' : ''}"><span aria-hidden="true">${i}</span><b>${t}</b>${d}</div>`).join('')}</div></section>`;
}

function historyList(st) {
  if (!st.es.length) return `<section class="panel"><p class="muted">Nenhum rancho concluído ainda. Monte a lista do mês e toque em “Concluir”.</p><a class="btn btn--primary" href="#lista">Ir para o rancho</a></section>`;
  return `<section class="panel"><div class="panel__head"><h2>Seus ranchos</h2><span class="muted small">economia em relação ao mercado mais perto</span></div>
    <ul class="hist">${st.es.map((e) => {
      const bm = S.markets.get(e.bought || e.best);
      return `<li><span><b>${esc(e.name || 'Rancho de ' + monthLabel(e.month, { month: 'long' }))}</b>
        <small>${bm ? `${logo(bm, 'xs')} ${e.bought ? 'comprou no' : 'mais barato no'} ${esc(bm.name)}` : ''}${e.spent ? ` · gastou ${brl(e.spent)}` : e.bestTotal ? ` · ${brl(e.bestTotal)}` : ''}${e.itemsCount ? ` · ${e.itemsCount} itens` : ''}</small></span>
        <span class="sv">${e.savings ? '+' + brl(e.savings) : '–'}</span></li>`;
    }).join('')}</ul></section>`;
}

function dataPanel() {
  const p = S.profile || {};
  const done = !!p.completed_at;
  const pref = (p.preferred_markets || []).map((id) => S.markets.get(id)).filter(Boolean);
  const g = { feminino: 'Feminino', masculino: 'Masculino', outro: 'Outro', nao_informar: 'Prefiro não informar' }[p.gender] || '–';
  return `<section class="panel">
    <div class="panel__head"><h2>Seus dados</h2></div>
    ${done ? `<dl class="acc-dl">
      <div><dt>E-mail</dt><dd>${esc(S.user.email || '')}</dd></div>
      <div><dt>Celular</dt><dd>${esc(p.phone || '')}</dd></div>
      <div><dt>Bairro</dt><dd>${esc(p.neighborhood || '')}</dd></div>
      <div><dt>Sexo</dt><dd>${g}</dd></div>
      <div><dt>Mercados</dt><dd>${pref.length ? pref.map((m) => logo(m, 'xs')).join('') : 'Todos'}</dd></div>
    </dl><button class="btn btn--ghost" data-open="complete">Editar dados</button>`
    : `<p class="muted small">Cadastro rápido: ${Math.max(CONFIG.QUICK_COMPARISONS - (p.comparisons_used || 0), 0)} comparações restantes.</p><button class="btn btn--primary" data-open="complete">Completar cadastro</button>`}
  </section>
  <section class="panel">
    <div class="panel__head"><h2>Casa e deslocamento</h2></div>
    <p class="small">${rancho.homePos()?.source === 'home' ? `Sua casa: <b>${esc(rancho.homePos().label || 'definida')}</b>` : 'Defina sua casa para calcular a distância e o custo de ida até cada mercado.'}</p>
    <div class="row-actions"><button class="btn btn--ghost btn--sm" data-open="home">${rancho.homePos()?.source === 'home' ? 'Alterar casa' : 'Definir minha casa'}</button></div>
  </section>
  <div id="adminLink"></div>
  ${api.MODE === 'demo' ? '<p class="note">Modo demonstração: o banco ainda não respondeu, então a conta fica só neste aparelho.</p>' : ''}
  <button class="btn btn--text" id="logout">Sair da conta</button>`;
}

// ---------------------------------------------------------------- render
export async function render() {
  const link = $('#accountLink');
  const el = $('#accountBody'); if (!el) return;
  const st = stats();

  if (!S.user) {
    link.textContent = 'Entrar';
    el.innerHTML = `<div class="me">
      <header class="page-head"><h1>Você</h1><p class="muted">Sua economia e suas conquistas, num lugar só.</p></header>
      ${saveHero(st)}
      <div class="me-grid">${favMarket(st)}
        <section class="panel"><div class="panel__head"><h2>Crie sua conta grátis</h2></div>
          <p class="small">Sem conta, tudo fica só neste celular. Com conta, você não perde nada e usa em qualquer aparelho.</p>
          <div class="acc-steps">
            <div><b>1. Cadastro rápido</b><span>Nome, e-mail e senha. Libera ${CONFIG.QUICK_COMPARISONS} comparações.</span></div>
            <div><b>2. Cadastro completo</b><span>Celular, bairro e mercados preferidos. Comparações sem limite.</span></div>
          </div>
          <div class="row-actions"><button class="btn btn--primary" data-auth="signup">Criar conta</button><button class="btn btn--ghost" data-auth="login">Já tenho conta</button></div>
        </section></div>
      ${prefsPanel()}
    </div>`;
    return;
  }

  const p = S.profile || {};
  const name = p.full_name || S.user.user_metadata?.full_name || S.user.email;
  link.textContent = name.split(' ')[0];
  if (remoteFor !== S.user.id) { remoteFor = S.user.id; remote = null; api.myRanchos().then((r) => { remote = r; if (location.hash === '#conta') render(); }).catch(() => { remote = []; }); }

  el.innerHTML = `<div class="me">
    <header class="me-hero">
      <div class="avatar" aria-hidden="true">${esc(initials(name))}</div>
      <div class="me-hero__txt"><h1>Olá, ${esc(name.split(' ')[0])}</h1>
        <span class="status ${p.completed_at ? 'status--ok' : ''}">${p.completed_at ? 'Cadastro completo' : 'Cadastro rápido'} <span id="lvlName"></span></span></div>
    </header>
    <div class="tabs" role="tablist">
      ${[['resumo', 'Resumo'], ['historico', 'Histórico'], ['fiscal', 'Fiscal do preço'], ['dados', 'Conta']].map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" data-acctab="${k}">${l}</button>`).join('')}
    </div>
    <div id="accTab"></div>
  </div>`;

  const box = $('#accTab');
  if (tab === 'resumo') {
    const favs = S.products.filter((x) => S.favs.has(x.id));
    box.innerHTML = `<div class="me">
      ${saveHero(st)}
      <div class="tiles">
        <button class="tile" data-acctab="historico"><b>${st.es.length}</b><small>ranchos concluídos</small></button>
        <a class="tile" href="#lista" style="text-decoration:none"><b>${S.list.size}</b><small>itens no rancho atual</small></a>
        <button class="tile" data-acctab="fiscal"><b id="tileReports">–</b><small>preços informados</small></button>
        <div class="tile"><b>${p.comparisons_used || 0}</b><small>comparações feitas</small></div>
      </div>
      <div class="me-grid">${favMarket(st)}<div id="badgesBox">${badges(st, null)}</div></div>
      <section class="panel"><div class="panel__head"><h2>Favoritos</h2><span class="muted small">${favs.length ? `${favs.length} produtos` : ''}</span></div>
        ${favs.length ? `<div class="grid">${favs.map((x, i) => hooks.card(x, i)).join('')}</div>` : '<p class="muted small">Toque no coração de um produto para acompanhar o preço dele aqui.</p>'}</section>
    </div>`;
    api.myImpact().then((imp) => {
      const t = $('#tileReports'); if (t) t.textContent = imp.reports;
      const b = $('#badgesBox'); if (b) b.innerHTML = badges(st, imp);
      const l = $('#lvlName'); if (l) l.textContent = `· ${fiscal.level(imp.points).name}`;
    }).catch(() => {});
    countUp($('#saveTotal'));
  } else if (tab === 'historico') {
    box.innerHTML = `<div class="me">${historyList(st)}</div>`;
  } else if (tab === 'fiscal') {
    box.innerHTML = `<div class="me"><div id="mysteryBox"></div><section class="panel"><div id="fiscalAcc"><div class="skeleton" style="height:120px"></div></div></section></div>`;
    fiscal.renderHome(); fiscal.renderAccount($('#fiscalAcc'));
  } else {
    box.innerHTML = `<div class="me">${dataPanel()}${prefsPanel()}</div>`;
    api.amIMaster().then((ok) => { const el = $('#adminLink'); if (ok && el) el.innerHTML = `<section class="panel"><div class="panel__head"><h2>Administração</h2></div><p class="small muted">Sua conta é administradora master.</p><div class="row-actions"><a class="btn btn--primary" href="admin.html">Abrir a administração</a><a class="btn btn--ghost" href="parceiros.html">Área do supermercado</a></div></section>`; }).catch(() => {});
  }
}

/** preferências do aparelho: vibração ao tocar e avisos de preço */
function prefsPanel() {
  let hap = true; try { hap = localStorage.getItem('tb.haptics') !== 'false'; } catch {}
  const canN = 'Notification' in window;
  const notif = canN && Notification.permission === 'granted' && api.store.get('tb.notify', true) !== false;
  const row = (k, t, d, on, dis = false) => `<li><span><b>${t}</b><small class="muted">${d}</small></span>
    <span class="switch"><input type="checkbox" data-pref="${k}" ${on ? 'checked' : ''} ${dis ? 'disabled' : ''} aria-label="${t}" /><i></i></span></li>`;
  return `<section class="panel"><div class="panel__head"><h2>Preferências</h2></div><ul class="pref-list">
    ${row('haptics', 'Vibrar ao tocar', 'Uma vibração curta confirma cada ação (no Android).', hap)}
    ${row('notify', 'Avisos de preço', canN ? (Notification.permission === 'denied' ? 'Bloqueado no navegador: libere nas permissões do site.' : 'Avisamos no celular quando um favorito baixar.') : 'Este navegador não mostra avisos.', notif, !canN || Notification.permission === 'denied')}
  </ul>
  <div class="pref-reset"><span><b>Zerar meu histórico</b><small class="muted">Recomeçar do zero, como se fosse a primeira vez.</small></span>
    <button class="btn btn--danger btn--sm" data-zerar="open">Zerar</button></div></section>`;
}
document.addEventListener('change', async (e) => {
  const k = e.target.dataset?.pref; if (!k) return;
  if (k === 'haptics') { try { localStorage.setItem('tb.haptics', String(e.target.checked)); } catch {} if (e.target.checked) navigator.vibrate?.(12); }
  if (k === 'notify') {
    if (e.target.checked && Notification.permission !== 'granted') { const ok = await (await import('./alerts.js')).enable(); e.target.checked = ok; }
    else api.store.set('tb.notify', e.target.checked);
  }
});

function countUp(el) {
  if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const v = Number(el.dataset.v); if (!(v > 0)) return;
  const t0 = performance.now();
  const step = (t) => { const k = Math.min((t - t0) / 900, 1); el.textContent = brl(v * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

// ---------------------------------------------------------------- eventos
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-acctab], [data-mbar]'); if (!t) return;
  if (t.dataset.acctab) { tab = t.dataset.acctab; render(); $('.tabs')?.scrollIntoView({ block: 'nearest' }); return; }
  $$('[data-mbar]').forEach((b) => b.classList.toggle('is-on', b === t));
  const info = $('#mbarsInfo'); if (info) info.textContent = `${monthLabel(t.dataset.mbar, { month: 'long', year: 'numeric' })}: ${brl(Number(t.dataset.v))}`;
});
document.addEventListener('input', (e) => {
  if (e.target.id !== 'projRange') return;
  projMonths = Number(e.target.value);
  const st = stats();
  $('#projM').textContent = `${projMonths} ${projMonths > 1 ? 'meses' : 'mês'}`;
  $('#projV').textContent = brl(st.avg * projMonths);
});
