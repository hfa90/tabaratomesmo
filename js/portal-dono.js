// Portal › o que o dono do supermercado quer ver, sem abrir 15 abas:
//   #resumo  — Resumo da semana (o mesmo que chega toda segunda no Telegram @corp_tabaratomesmo_bot e por e-mail)
//   #radar   — Radar da concorrência: quem baixou preço de um produto seu, com "Igualar"
//   #pagina  — Minha página: diferenciais (açougue, entrega…), horários e WhatsApp que o consumidor vê
//   #faltas  — "Não achei na loja": avisos dos clientes por loja e produto
//   #lojas   — Comparar as lojas da rede entre si
import * as P from './portal-api.js';
import { $, $$, esc, brl } from './core.js';
import { fmtN } from './viz.js';
import { ic } from './icons.js';
import { SERVICOS, chips } from './servicos.js';

export const BOT = 'corp_tabaratomesmo_bot';
const dt = (d) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).replace('.', '');
const agoTxt = (d) => { const h = (Date.now() - new Date(d)) / 36e5; const n = Math.round(h / 24); return h < 1 ? 'agora há pouco' : h < 24 ? `há ${Math.round(h)} h` : n <= 1 ? 'ontem' : `há ${n} dias`; };
const head = (C, t, sub, actions = '') => `${C.banner}<header class="pt-head"><div><h1>${t}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}</div>${actions}</header>`;
const fail = (el, e) => { el.innerHTML = `<p class="note">${esc(e.message)}</p>`; };
const thumb = (r) => `<span class="thumb">${r.image_url ? `<img src="${esc(r.image_url)}" alt="" loading="lazy" />` : `<span>${esc(r.emoji || '🛒')}</span>`}</span>`;
let C = null;

// ================================================================ RESUMO DA SEMANA
export async function renderResumo(ctx) {
  C = ctx; const m = ctx.market();
  ctx.main.innerHTML = head(ctx, 'Resumo da semana', `Tudo o que o Tá Barato Mesmo? trouxe para o ${esc(m.name)} nos últimos 7 dias, numa página só. Toda segunda, às 8h, ele chega pronto no Telegram e no e-mail.`)
    + '<div id="rsBody" class="dono-body"><div class="skeleton" style="height:360px"></div></div>';
  let D, K;
  try { [D, K] = await Promise.all([P.weeklyDigest(ctx.mid), P.corpGet(ctx.mid).catch(() => ({ telegram: [], emails: [] }))]); }
  catch (e) { return fail($('#rsBody'), e); }
  const delta = D.revenue != null && D.prev_revenue ? Math.round(((D.revenue - D.prev_revenue) / D.prev_revenue) * 100) : null;
  $('#rsBody').innerHTML = `
    <div class="kpis">
      <div class="kpi"><span class="kpi__l">Clientes que vieram pelo site</span><span class="kpi__v">${fmtN(D.clients)}</span><span class="kpi__h">${fmtN(D.visits)} chegaram na loja com o site aberto</span></div>
      <div class="kpi kpi--accent"><span class="kpi__l">Notas comprovadas</span><span class="kpi__v">${D.revenue == null ? '–' : brl(Number(D.revenue))}</span><span class="kpi__h">${fmtN(D.receipts)} notas${delta != null ? ` · ${delta >= 0 ? '+' : ''}${delta}% na semana` : ''}</span></div>
      <div class="kpi"><span class="kpi__l">Gasto em anúncios e cupons</span><span class="kpi__v">${brl(Number(D.spend || 0))}</span><span class="kpi__h">${brl(Number(D.spend_ads || 0))} anúncios · ${brl(Number(D.spend_cover || 0))} cupons</span></div>
      <div class="kpi"><span class="kpi__l">Retorno</span><span class="kpi__v">${D.roi ? `${String(Math.round(D.roi)).replace('.', ',')}×` : '–'}</span><span class="kpi__h">cada R$ 1 investido voltou em notas</span></div>
    </div>
    <div class="pt-grid">
      <section class="panel"><div class="panel__head"><h2>${ic('cart')} Ranchos da semana</h2></div>
        <p><b>${fmtN(D.ranchos_won)}</b> ranchos saíram mais baratos no ${esc(m.name)}${D.ranchos_total ? ` (de ${fmtN(D.ranchos_total)} concluídos no site)` : ''}.</p>
        ${(D.lost || []).length ? `<ul class="rs-lost">${D.lost.map((x) => `<li><b>${fmtN(x.n)} ${x.n === 1 ? 'rancho perdido' : 'ranchos perdidos'} por pouco</b> para o ${esc(x.market)}${x.products?.length ? `, por causa ${x.products.map((p, i) => `${i ? 'e d' : 'd'}o <em>${esc(p.toLowerCase())}</em>`).join(' ')}` : ''}.
          <a class="linkish small" href="#demanda">Ver na previsão de demanda</a></li>`).join('')}</ul>` : '<p class="muted small">Nenhum rancho perdido por pouco (até 10% mais caro) nesta semana. 👏</p>'}
        <p class="small muted">Comparação com os preços de hoje, só nos produtos que existem nos dois mercados.</p>
      </section>
      <section class="panel"><div class="panel__head"><h2>${ic('bell')} Outros sinais</h2></div>
        <ul class="rs-sig">
          <li><span>📡</span><span><b>${fmtN(D.radar?.n || 0)}</b> alertas de preço da concorrência, ${fmtN(D.radar?.matched || 0)} igualados <a class="linkish small" href="#radar">Radar</a></span></li>
          <li><span>🔎</span><span><b>${fmtN(D.missing?.n || 0)}</b> avisos de “não achei na loja”${D.missing?.top?.length ? `: ${D.missing.top.map(esc).join(', ')}` : ''} <a class="linkish small" href="#faltas">Faltas</a></span></li>
          <li><span>🏷️</span><span>Você é o mais barato em <b>${fmtN(D.position?.cheapest || 0)}</b> de ${fmtN(D.position?.total || 0)} produtos hoje</span></li>
        </ul>
      </section>
    </div>
    <div class="pt-grid">
      <section class="panel"><div class="panel__head"><h2>${ic('send')} Como chega no Telegram</h2></div>
        <div class="tg-msg">${D.text.split('\n').map((l) => `<p>${l || '&nbsp;'}</p>`).join('')}</div>
      </section>
      <section class="panel"><div class="panel__head"><h2>${ic('users')} Quem recebe</h2></div>
        <p class="small muted">Telegram: abra o robô <b>@${BOT}</b> pelo botão abaixo (cada pessoa liga o próprio Telegram). Além do resumo de segunda, ele avisa na hora quando um concorrente baixar preço e quando um cliente não achar um produto.</p>
        <div class="row-actions"><button class="btn btn--primary" data-rs="link">${ic('send')} Ligar meu Telegram</button>
          <button class="btn btn--ghost" data-rs="now" ${K.pending_now ? 'disabled' : ''}>${K.pending_now ? 'Envio pedido: chega em até 15 min' : 'Enviar o resumo agora'}</button></div>
        <div id="rsCode"></div>
        ${(K.telegram || []).length ? `<ul class="rs-who">${K.telegram.map((t) => `<li><span><b>${esc(t.first_name || 'Telegram')}</b><small class="muted">${esc(t.email || '')} · ligado ${agoTxt(t.linked_at)}</small></span>
          <span class="rs-flags">${[['weekly', 'Resumo'], ['radar', 'Radar'], ['missing', 'Faltas']].map(([k, l]) => `<label class="check-mini"><input type="checkbox" data-rs-flag="${k}" data-chat="${t.chat_id}" ${t[k] ? 'checked' : ''} /> ${l}</label>`).join('')}
          <button class="btn btn--text btn--sm" data-rs-rm="${t.chat_id}">Tirar</button></span></li>`).join('')}</ul>` : '<p class="small muted">Nenhum Telegram ligado ainda.</p>'}
        <form class="form form--inline" id="rsMail"><label>Receber por e-mail também<input name="email" type="email" placeholder="dono@mercado.com.br" required /></label><button class="btn btn--ghost">Adicionar</button></form>
        ${(K.emails || []).length ? `<div class="chips chips--wrap">${K.emails.map((e) => `<span class="chip">${esc(e)} <button class="linkish small" data-rs-mailrm="${esc(e)}" aria-label="Tirar ${esc(e)}">×</button></span>`).join('')}</div>` : ''}
        ${K.last_sent ? `<p class="small muted">Último envio: ${dt(K.last_sent)}</p>` : ''}
      </section>
    </div>`;
}

// ================================================================ RADAR DA CONCORRÊNCIA
export async function renderRadar(ctx) {
  C = ctx; const m = ctx.market();
  ctx.main.innerHTML = head(ctx, 'Radar da concorrência', `Quando outro mercado baixa o preço de um produto que o ${esc(m.name)} vende e fica mais barato que você, aparece aqui e chega na hora no Telegram, com o botão “Igualar”.`)
    + '<div id="rdBody" class="dono-body"><div class="skeleton" style="height:300px"></div></div>';
  let D; try { D = await P.radar(ctx.mid); } catch (e) { return fail($('#rdBody'), e); }
  const open = D.alerts.filter((a) => !a.matched_at);
  $('#rdBody').innerHTML = `
    <div class="kpis">
      <div class="kpi"><span class="kpi__l">Alertas em aberto</span><span class="kpi__v">${fmtN(open.length)}</span><span class="kpi__h">últimos 14 dias</span></div>
      <div class="kpi"><span class="kpi__l">Igualados</span><span class="kpi__v">${fmtN(D.alerts.length - open.length)}</span><span class="kpi__h">pelo portal ou pelo Telegram</span></div>
      <div class="kpi kpi--accent"><span class="kpi__l">Listas em jogo</span><span class="kpi__v">${fmtN(open.reduce((s, a) => s + (a.lists || 0), 0))}</span><span class="kpi__h">listas abertas com esses produtos</span></div>
    </div>
    <section class="panel"><div class="panel__head"><h2>${ic('chart')} Alertas</h2></div>
      ${D.alerts.length ? D.alerts.map((a) => `<article class="rd-row ${a.matched_at ? 'is-off' : ''}">${thumb(a)}<div>
        <p><b>O ${esc(a.competitor_name)} baixou ${esc(a.product_name)}</b> <small class="muted">${esc([a.brand, a.unit].filter(Boolean).join(' · '))} · ${agoTxt(a.created_at)}</small></p>
        <p class="small">Agora <b>${brl(Number(a.comp_now ?? a.comp_price))}</b>${a.comp_prev ? ` (era ${brl(Number(a.comp_prev))})` : ''} · você: <b>${brl(Number(a.my_now ?? a.my_price))}</b>
          ${Number(a.my_now ?? a.my_price) > Number(a.comp_now ?? a.comp_price) ? `<span class="pill pill--warn">${brl(Number(a.my_now ?? a.my_price) - Number(a.comp_now ?? a.comp_price))} acima</span>` : '<span class="pill pill--ok">você já está igual ou abaixo</span>'}</p>
        <p class="small muted">${a.lists ? `Em ${fmtN(a.lists)} ${a.lists === 1 ? 'lista aberta' : 'listas abertas'}` : 'Ainda em nenhuma lista aberta'}${a.near?.length ? ` · perto das suas lojas: ${a.near.map(esc).join(', ')}` : ''}</p>
        </div><div class="rd-act">${a.matched_at ? '<span class="pill pill--ok">Igualado</span>'
          : `<button class="btn btn--primary btn--sm" data-rd-match="${a.id}" data-pid="${a.product_id}" data-price="${a.comp_now ?? a.comp_price}">Igualar ${brl(Number(a.comp_now ?? a.comp_price))}</button>
             <button class="btn btn--text btn--sm" data-rd-skip="${a.id}">Manter meu preço</button>`}</div></article>`).join('')
        : '<p class="muted small">Nenhum concorrente baixou preço de um produto seu para abaixo do seu nos últimos 14 dias.</p>'}
    </section>
    <section class="panel"><div class="panel__head"><h2>${ic('tool')} Quando avisar</h2></div>
      <form class="form form--inline" id="rdSet">
        <label>Só se eu ficar pelo menos (R$) acima<input name="min_diff" inputmode="decimal" value="${Number(D.settings.min_diff ?? 0.1).toFixed(2).replace('.', ',')}" style="max-width:120px" /></label>
        <label>Só produtos em pelo menos (listas)<input name="min_lists" inputmode="numeric" value="${D.settings.min_lists ?? 0}" style="max-width:120px" /></label>
        <button class="btn btn--ghost">Salvar</button></form>
      <p class="small muted">A busca roda a cada 15 minutos, com todos os preços novos do site (mercados, encartes, notas fiscais e clientes).</p>
    </section>`;
}

// ================================================================ MINHA PÁGINA (diferenciais)
export async function renderPagina(ctx) {
  C = ctx; const m = ctx.market();
  const prof = P.MODE === 'demo' ? (P.demoProfile(ctx.mid) || {}) : {};
  const sv = new Set(prof.services || m.services || []);
  const stores = ctx.stores();
  const hours = new Map((prof.hours || []).map((h) => [h.store_id, h.opening_hours]));
  ctx.main.innerHTML = head(ctx, 'Minha página', `Quando o ${esc(m.name)} perde por R$ 3, o cliente ainda pode escolher pela conveniência. Mostre o que a sua loja tem além do preço: aparece na página da rede e no relatório do rancho.`,
    m.slug ? `<a class="btn btn--ghost" href="mercado.html?m=${encodeURIComponent(m.slug)}" target="_blank" rel="noopener">${ic('eye')} Ver como o cliente vê</a>` : '')
    + `<form class="form dono-body" id="pgForm">
      <section class="panel"><div class="panel__head"><h2>${ic('sparkle')} O que a sua loja tem</h2></div>
        <div class="svc-pick">${SERVICOS.map(([k, e, n]) => `<label class="opt-mini"><input type="checkbox" name="svc" value="${k}" ${sv.has(k) ? 'checked' : ''} /><span><i aria-hidden="true">${e}</i>${esc(n)}</span></label>`).join('')}</div>
      </section>
      <div class="pt-grid">
        <section class="panel"><div class="panel__head"><h2>${ic('pencil')} Sobre a rede</h2></div>
          <label>Uma frase sobre o ${esc(m.name)} (até 280 letras)<textarea name="about" maxlength="280" placeholder="Ex.: Rede manauara desde 1990, açougue com carne do dia e padaria própria.">${esc(prof.about ?? m.about ?? '')}</textarea></label>
          <label>WhatsApp de atendimento (DDD + número)<input name="whatsapp" inputmode="tel" value="${esc(prof.whatsapp ?? m.whatsapp ?? '')}" placeholder="(92) 99999-0000" /></label>
        </section>
        <section class="panel"><div class="panel__head"><h2>${ic('hourglass')} Horários das lojas</h2></div>
          ${stores.length ? stores.map((s) => `<label>${esc(s.name)}<input data-hours="${s.id}" maxlength="120" value="${esc(hours.get(s.id) ?? s.opening_hours ?? '')}" placeholder="Ex.: Seg a sáb 7h–22h · Dom 7h–13h" /></label>`).join('') : '<p class="muted small">Cadastre as lojas em Mapa de unidades.</p>'}
        </section>
      </div>
      <section class="panel"><div class="panel__head"><h2>${ic('eye')} Prévia no relatório do rancho</h2></div>
        <div class="vs-prev"><b>${esc(m.name)}</b> <span class="muted small">R$ 3,10 mais caro</span><div id="pgPrev">${chips({ services: [...sv] }, 4)}</div></div>
        <p class="small muted">No relatório, mostramos até 4 diferenciais embaixo de cada mercado.</p></section>
      <p class="form__err" role="alert"></p>
      <button class="btn btn--primary">Salvar minha página</button>
    </form>`;
}

// ================================================================ NÃO ACHEI NA LOJA
export async function renderFaltas(ctx) {
  C = ctx; const m = ctx.market();
  ctx.main.innerHTML = head(ctx, 'Não achei na loja', `Clientes avisam pelo site quando chegam numa loja do ${esc(m.name)} e não encontram um produto. É um alerta de prateleira vazia vindo do próprio cliente. O gerente recebe no Telegram e marca “Já repus”.`)
    + '<div id="ftBody" class="dono-body"><div class="skeleton" style="height:300px"></div></div>';
  let L; try { L = await P.missing(ctx.mid); } catch (e) { return fail($('#ftBody'), e); }
  const open = L.filter((x) => x.open > 0);
  const byStore = new Map(); for (const x of open) byStore.set(x.store_name, (byStore.get(x.store_name) || 0) + x.open);
  $('#ftBody').innerHTML = `
    <div class="kpis">
      <div class="kpi kpi--accent"><span class="kpi__l">Em aberto</span><span class="kpi__v">${fmtN(open.length)}</span><span class="kpi__h">produtos sem ninguém marcar “reposto”</span></div>
      <div class="kpi"><span class="kpi__l">Avisos (14 dias)</span><span class="kpi__v">${fmtN(L.reduce((s, x) => s + x.n, 0))}</span><span class="kpi__h">de clientes do site</span></div>
      <div class="kpi"><span class="kpi__l">Loja com mais faltas</span><span class="kpi__v" style="font-size:1.1rem">${esc([...byStore].sort((a, b) => b[1] - a[1])[0]?.[0] || '–')}</span><span class="kpi__h">em aberto agora</span></div>
    </div>
    <section class="panel"><div class="panel__head"><h2>${ic('search')} Avisos por loja e produto</h2></div>
      ${L.length ? L.map((x) => `<article class="rd-row ${x.open ? '' : 'is-off'}">${thumb(x)}<div>
        <p><b>${esc(x.product_name)}</b> <small class="muted">${esc([x.brand, x.unit].filter(Boolean).join(' · '))}</small></p>
        <p class="small">📍 ${esc(x.store_name)}${x.neighborhood ? ` (${esc(x.neighborhood)})` : ''} · <b>${fmtN(x.n)} ${x.n === 1 ? 'aviso' : 'avisos'}</b> · último ${agoTxt(x.last)}</p></div>
        <div class="rd-act">${x.open ? `<button class="btn btn--primary btn--sm" data-ft-ok="${x.store_id}:${x.product_id}">Já repus</button>` : '<span class="pill pill--ok">Reposto</span>'}</div></article>`).join('')
        : '<p class="muted small">Nenhum aviso nos últimos 14 dias. Prateleira em dia. 👏</p>'}
    </section>`;
}

// ================================================================ COMPARAR AS LOJAS
export async function renderLojas(ctx) {
  C = ctx; const m = ctx.market();
  ctx.main.innerHTML = head(ctx, 'Minhas lojas', `As lojas do ${esc(m.name)} lado a lado nos últimos 30 dias: quem visita, quanto chega em notas, quais ranchos cada uma ganha e para quem perde, e de quais bairros vêm os clientes.`)
    + '<div id="lsBody" class="dono-body"><div class="skeleton" style="height:300px"></div></div>';
  let L; try { L = await P.storesCompare(ctx.mid); } catch (e) { return fail($('#lsBody'), e); }
  if (!L.length) { $('#lsBody').innerHTML = '<p class="note">Nenhuma loja cadastrada. Cadastre em Mapa de unidades.</p>'; return; }
  const max = Math.max(1, ...L.map((s) => s.visits));
  const rate = (s) => (s.won + s.lost ? Math.round((s.won / (s.won + s.lost)) * 100) : null);
  const weak = [...L].filter((s) => rate(s) != null).sort((a, b) => rate(a) - rate(b))[0];
  $('#lsBody').innerHTML = `
    ${weak && L.length > 1 ? `<p class="note">Onde reforçar: a loja <b>${esc(weak.name)}</b> ganha só <b>${rate(weak)}%</b> dos ranchos de quem mora perto dela${weak.lost_to?.[0] ? `, e perde mais para o <b>${esc(weak.lost_to[0].market)}</b>` : ''}. Uma campanha para quem está perto dela ou o “Cubra a diferença” ajudam.</p>` : ''}
    <div class="ls-cards">${L.map((s) => `<article class="panel ls-card">
      <h3>${esc(s.name)} <small class="muted">${esc(s.neighborhood || '')}</small></h3>
      <div class="ls-bar" title="Visitas"><span style="--w:${(s.visits / max) * 100}%"></span></div>
      <dl class="ls-dl"><dt>Visitas pelo site</dt><dd>${fmtN(s.visits)}</dd><dt>Notas</dt><dd>${fmtN(s.receipts)} · ${brl(Number(s.revenue || 0))}</dd>
        <dt>Ranchos de quem mora perto</dt><dd>${rate(s) == null ? '–' : `${fmtN(s.won)} ganhos · ${fmtN(s.lost)} perdidos (${rate(s)}%)`}</dd>
        <dt>Perde mais para</dt><dd>${s.lost_to?.length ? s.lost_to.slice(0, 2).map((x) => `${esc(x.market)} (${fmtN(x.n)})`).join(', ') : '–'}</dd>
        <dt>Faltas em aberto</dt><dd>${fmtN(s.missing)}</dd><dt>Promoções só desta loja</dt><dd>${fmtN(s.promos)}</dd></dl>
      ${s.bairros?.length ? `<p class="small muted">Clientes vêm de: ${s.bairros.slice(0, 4).map((b) => `${esc(b.name)} (${fmtN(b.n)})`).join(', ')}</p>` : ''}
    </article>`).join('')}</div>
    <p class="small muted">“Quem mora perto” usa a casa cadastrada pelos clientes com conta; cada cliente conta para a loja da rede mais perto da casa dele.</p>`;
}

// ================================================================ eventos
document.addEventListener('click', async (e) => {
  if (!C) return;
  const t = e.target.closest('[data-rs], [data-rs-rm], [data-rs-mailrm], [data-rd-match], [data-rd-skip], [data-ft-ok]'); if (!t) return;
  try {
    if (t.dataset.rs === 'link') {
      const code = await P.corpLinkCode(C.mid);
      const url = `https://t.me/${BOT}?start=${code}`;
      $('#rsCode').innerHTML = `<p class="ok-box small">Abrimos o Telegram. Se não abrir, procure <b>@${BOT}</b> e mande o código <code class="code-big">${esc(code)}</code> (vale 30 minutos). <a class="linkish" href="${url}" target="_blank" rel="noopener">Abrir de novo</a></p>`;
      window.open(url, '_blank', 'noopener');
      if (P.MODE === 'demo') setTimeout(() => renderResumo(C), 600);
    } else if (t.dataset.rs === 'now') {
      await P.corpSet(C.mid, { send_now: true }); C.toast('Pronto: o resumo chega no Telegram ligado em até 15 minutos.'); renderResumo(C);
    } else if (t.dataset.rsRm) {
      if (!confirm('Este Telegram vai parar de receber os avisos. Continuar?')) return;
      await P.corpSet(C.mid, { chat_id: Number(t.dataset.rsRm), remove: true }); renderResumo(C);
    } else if (t.dataset.rsMailrm) {
      await P.corpSet(C.mid, { email: t.dataset.rsMailrm, remove: true }); renderResumo(C);
    } else if (t.dataset.rdMatch) {
      const pid = Number(t.dataset.pid), price = Number(t.dataset.price);
      const r = (await C.catalog().catch(() => []))?.find((x) => x.product_id === pid);
      if (!r) return C.toast('Não achei este produto no seu catálogo. Ajuste em Produtos.', 'warn');
      if (!confirm(`Mudar ${r.name} para ${brl(price)} no ${C.market().name}?`)) return;
      t.disabled = true;
      await P.saveProduct(C.mid, { product_id: pid, name: r.name, brand: r.brand, unit: r.unit, category: r.category, ean: r.ean, emoji: r.emoji, sku: r.sku, price });
      await P.radarSet(C.mid, { matched: Number(t.dataset.rdMatch) });
      C.invalidateCatalog(); C.toast(`Preço igualado: ${r.name} a ${brl(price)}. Lembre de trocar a etiqueta na loja.`); renderRadar(C);
    } else if (t.dataset.rdSkip) {
      await P.radarSet(C.mid, { matched: Number(t.dataset.rdSkip) }); C.toast('Ok, alerta arquivado.'); renderRadar(C);
    } else if (t.dataset.ftOk) {
      const [store, product] = t.dataset.ftOk.split(':').map(Number);
      await P.missingResolve(C.mid, store, product); C.toast('Marcado como reposto.'); renderFaltas(C);
    }
  } catch (x) { t.disabled = false; C.toast(x.message, 'warn'); }
});
document.addEventListener('change', async (e) => {
  if (!C) return;
  const f = e.target.closest('[data-rs-flag]');
  if (f) { try { await P.corpSet(C.mid, { chat_id: Number(f.dataset.chat), [f.dataset.rsFlag]: f.checked }); } catch (x) { C.toast(x.message, 'warn'); f.checked = !f.checked; } }
  if (e.target.name === 'svc') { const sv = $$('#pgForm [name=svc]:checked').map((x) => x.value); const el = $('#pgPrev'); if (el) el.innerHTML = chips({ services: sv }, 4); }
});
document.addEventListener('submit', async (e) => {
  if (!C) return;
  const f = e.target;
  if (f.id === 'rsMail') {
    e.preventDefault();
    try { await P.corpSet(C.mid, { email: f.email.value }); C.toast('E-mail adicionado: recebe o resumo toda segunda.'); renderResumo(C); } catch (x) { C.toast(x.message, 'warn'); }
  } else if (f.id === 'rdSet') {
    e.preventDefault();
    const n = (v) => Number(String(v).replace(',', '.'));
    try { await P.radarSet(C.mid, { min_diff: n(f.min_diff.value) || 0, min_lists: Math.round(n(f.min_lists.value)) || 0 }); C.toast('Regras do radar salvas.'); } catch (x) { C.toast(x.message, 'warn'); }
  } else if (f.id === 'pgForm') {
    e.preventDefault();
    const p = { services: $$('[name=svc]:checked', f).map((x) => x.value), about: f.about.value.trim(), whatsapp: f.whatsapp.value.trim(),
      hours: $$('[data-hours]', f).map((x) => ({ store_id: Number(x.dataset.hours), opening_hours: x.value.trim() })) };
    const err = $('.form__err', f); err.textContent = '';
    try {
      const r = await P.setProfile(C.mid, p);
      Object.assign(C.market(), { services: r?.services ?? p.services, about: r?.about ?? p.about, whatsapp: r?.whatsapp ?? p.whatsapp });
      C.toast('Página salva. Já aparece para os clientes.');
    } catch (x) { err.textContent = x.message; }
  }
});
