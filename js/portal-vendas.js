// Portal › Vendas comprovadas: quem viu algo do mercado no site e, em até 7 dias, mandou uma nota
// fiscal com o CNPJ dele. É o número que mostra ao gerente que a campanha e a publicidade se pagam.
// Regras da conta (no banco, market_sales_proof): só notas reconhecidas pelo CNPJ; cada nota conta uma vez,
// para o último contato antes dela; grupos com menos de 3 compradores não mostram valores.
import * as P from './portal-api.js';
import { $, esc, brl } from './core.js';
import { fmtN, downloadCSV } from './viz.js';
import { ic } from './icons.js';

const SRC = {
  campanha: { name: 'Campanhas', icon: 'bell', what: 'viram ou tocaram numa campanha' },
  promocao: { name: 'Promoções', icon: 'tag', what: 'viram um produto seu em promoção' },
  rota: { name: 'Rota até a loja', icon: 'route', what: 'abriram a rota para uma loja sua' },
  publicidade: { name: 'Publicidade', icon: 'sparkle', what: 'viram ou tocaram no seu anúncio' },
  cubra: { name: 'Cubra a diferença', icon: 'ticket', what: 'receberam ou ativaram seu cupom' },
  queima: { name: 'Queima de perecíveis', icon: 'flame', what: 'viram ou reservaram uma queima' },
};
const KIND = { aviso: 'Aviso no celular', janela: 'Janela na tela', vitrine: 'Vitrine' };
const S = { days: 30, win: 7, data: null };
const money = (v) => (v == null ? '<span class="muted-cell" title="Menos de 3 compradores: escondido para ninguém ser identificado">poucos dados</span>' : brl(Number(v)));
const pct = (v) => (v == null ? '–' : `${String(v).replace('.', ',')}%`);
const dt = (d) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');

let C = null;
export async function render(ctx) {
  C = ctx;
  const m = ctx.market();
  ctx.main.innerHTML = `${ctx.banner}
    <header class="pt-head"><div><h1>Vendas comprovadas</h1>
      <p class="muted">Pessoas que viram o ${esc(m.name)} no Tá Barato Mesmo? e, depois, mandaram uma nota fiscal com o CNPJ da sua loja. Não é estimativa: é nota.</p></div>
      <div class="row-actions">
        <div class="seg" role="radiogroup" aria-label="Período">${[[7, '7 dias'], [30, '30 dias'], [90, '90 dias']].map(([d, l]) => `<button role="radio" aria-checked="${S.days === d}" data-vd-days="${d}">${l}</button>`).join('')}</div>
        <label class="small muted" style="display:inline-flex;gap:6px;align-items:center">Janela
          <select class="input sel sel--sm" data-vd-win style="min-width:0">${[3, 7, 14].map((w) => `<option value="${w}" ${S.win === w ? 'selected' : ''}>${w} dias</option>`).join('')}</select></label>
      </div></header>
    <div id="vdBody"><div class="skeleton" style="height:420px"></div></div>`;
  try { S.data = await P.salesProof(ctx.mid, S.days, S.win); }
  catch (e) { $('#vdBody').innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
  paint();
}

function paint() {
  const D = S.data, T = D.totals, m = C.market();
  const camps = (D.campaigns || []).filter((c) => c.people > 0);
  const star = [...camps].sort((a, b) => (b.revenue || 0) - (a.revenue || 0) || b.buyers - a.buyers)[0];
  const lift = T.conv != null && T.ctrl_conv ? Math.round((T.conv / T.ctrl_conv) * 10) / 10 : null;
  const src = [...(D.by_source || [])].map((s) => ({ ...s, meta: SRC[s.src] })).filter((s) => s.meta);
  const maxDay = Math.max(1, ...(D.daily || []).map((x) => Number(x.revenue) || x.receipts));

  $('#vdBody').innerHTML = `
    <section class="proof-hero" aria-label="Resumo">
      ${star && star.buyers ? `<p class="small">Destaque do período</p>
        <p class="proof-hero__big">Sua campanha “${esc(star.title)}”: <b>${fmtN(star.people)} pessoas</b> viram, <b>${fmtN(star.buyers)}</b> compraram na sua loja${star.revenue != null ? `, <b>${brl(Number(star.revenue))}</b> em notas, ticket médio <b>${brl(Number(star.ticket))}</b>` : ''}.</p>`
      : `<p class="small">Últimos ${S.days} dias</p>
        <p class="proof-hero__big"><b>${fmtN(T.people)} pessoas</b> viram o ${esc(m.name)} no site e <b>${fmtN(T.buyers)}</b> mandaram nota da sua loja em até ${S.win} dias${T.revenue != null ? `: <b>${brl(Number(T.revenue))}</b> em compras comprovadas` : ''}.</p>`}
      <p class="small">Notas reconhecidas pelo CNPJ · cada nota conta uma vez · janela de ${S.win} dias depois do contato</p>
    </section>

    <div class="kpis">
      <div class="kpi"><span class="kpi__l">Pessoas alcançadas</span><span class="kpi__v">${fmtN(T.people)}</span><span class="kpi__h">${fmtN(T.logged)} com a conta aberta</span></div>
      <div class="kpi"><span class="kpi__l">Compraram (com nota)</span><span class="kpi__v">${fmtN(T.buyers)}</span><span class="kpi__h">${pct(T.conv)} de quem viu com a conta aberta</span></div>
      <div class="kpi kpi--accent"><span class="kpi__l">Vendas comprovadas</span><span class="kpi__v">${T.revenue == null ? '–' : brl(Number(T.revenue))}</span><span class="kpi__h">${fmtN(T.receipts)} notas fiscais</span></div>
      <div class="kpi"><span class="kpi__l">Ticket médio</span><span class="kpi__v">${T.ticket == null ? '–' : brl(Number(T.ticket))}</span><span class="kpi__h">das notas atribuídas</span></div>
    </div>
    ${D.hidden ? `<p class="note">Ainda são menos de 3 compradores no período: os valores em reais ficam escondidos para ninguém ser identificado. Os números aparecem assim que mais pessoas mandarem notas.</p>` : ''}

    <div class="pt-grid">
      <section class="panel"><div class="panel__head"><h2>${ic('users')} Do contato à nota</h2></div>
        <ul class="proof-funnel" style="padding:0;margin:0">
          ${[['Viram algo do seu mercado', T.people], ['Estavam com a conta aberta', T.logged], ['Mandaram nota da sua loja', T.buyers]].map(([l, v], i) =>
            `<li><span>${l}</span><b>${fmtN(v)}</b><span class="proof-funnel__t"><span style="--w:${Math.max(2, (v / Math.max(T.people, 1)) * 100)}%;--c:${i === 2 ? 'var(--brand)' : 'color-mix(in srgb, var(--brand) ' + (40 + i * 20) + '%, var(--surface-2))'}"></span></span></li>`).join('')}
        </ul>
        ${lift ? `<div class="proof-lift"><b>${String(lift).replace('.', ',')}×</b><span class="small">Quem viu algo do ${esc(m.name)} comprou lá <b>${pct(T.conv)}</b> das vezes; quem usou o site e não viu, <b>${pct(T.ctrl_conv)}</b>.</span></div>` : ''}
        <p class="small muted">No total, o site recebeu ${fmtN(T.all_receipts)} notas da sua loja no período (${brl(Number(T.all_revenue || 0))}), contando quem chegou sem ver nada.</p>
      </section>
      <section class="panel"><div class="panel__head"><h2>${ic('chart')} Vendas comprovadas por dia</h2></div>
        ${(D.daily || []).length ? `<div class="hm" style="grid-template-columns:repeat(${D.daily.length}, minmax(6px, 1fr));align-items:end;height:150px;gap:3px">
          ${D.daily.map((x) => { const v = Number(x.revenue) || x.receipts; return `<span title="${dt(x.d + 'T12:00')}: ${x.revenue != null ? brl(Number(x.revenue)) + ' · ' : ''}${x.receipts} ${x.receipts > 1 ? 'notas' : 'nota'}" style="display:block;height:${Math.max(4, (v / maxDay) * 100)}%;background:var(--brand);border-radius:4px 4px 0 0;opacity:${0.55 + 0.45 * (v / maxDay)}"></span>`; }).join('')}
        </div><p class="small muted">${dt(D.daily[0].d + 'T12:00')} a ${dt(D.daily[D.daily.length - 1].d + 'T12:00')}</p>` : '<p class="muted small">Nenhuma nota atribuída ainda no período.</p>'}
      </section>
    </div>

    <section class="panel"><div class="panel__head"><h2>${ic('compass')} De onde vieram as vendas</h2></div>
      <div class="src-grid">${src.map((s) => `<article class="src-card"><h3>${ic(s.meta.icon)} ${s.meta.name}</h3>
        <dl><dt>Pessoas</dt><dd>${fmtN(s.people)}</dd><dt>Compraram</dt><dd>${fmtN(s.buyers)}</dd><dt>Notas</dt><dd>${fmtN(s.receipts)}</dd>
          <dt>Em notas</dt><dd>${s.buyers ? money(s.revenue) : '–'}</dd><dt>Ticket</dt><dd>${s.buyers ? money(s.ticket) : '–'}</dd></dl>
        <p class="small muted">Pessoas que ${s.meta.what}.</p></article>`).join('')}</div>
    </section>

    <section class="panel"><div class="panel__head"><h2>${ic('bell')} Campanhas</h2>
      <button class="btn btn--ghost btn--sm" data-vd-csv>${ic('save')} Baixar planilha</button></div>
      ${camps.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Campanha</th><th class="r">Viram</th><th class="r">Compraram</th><th class="r">Conversão</th><th class="r">Em notas</th><th class="r">Ticket médio</th></tr></thead><tbody>
        ${camps.map((c) => `<tr><td><b>${esc(c.title)}</b><small class="muted">${KIND[c.kind] || ''} · ${dt(c.starts_at)} a ${dt(c.ends_at)}</small></td>
          <td class="r">${fmtN(c.people)}</td><td class="r">${fmtN(c.buyers)}</td><td class="r">${c.logged ? pct(Math.round((c.buyers / c.logged) * 1000) / 10) : '–'}</td>
          <td class="r">${money(c.revenue)}</td><td class="r">${money(c.ticket)}</td></tr>`).join('')}
      </tbody></table></div>` : `<p class="muted small">Nenhuma campanha no período. <a class="linkish" href="#campanhas">Criar uma campanha</a> e acompanhar aqui quanto ela vendeu.</p>`}
    </section>

    <section class="panel"><div class="panel__head"><h2>${ic('receipt')} Prova direta: o produto da promoção na nota</h2></div>
      <p class="small muted">Notas da sua loja com o produto pelo preço da promoção, durante a promoção. Com o preço exclusivo do site e o código no caixa, a prova fica ainda mais direta.</p>
      ${(D.promos || []).length ? `<div class="tbl-wrap"><table class="tbl tbl--sm"><thead><tr><th>Produto</th><th>Tipo</th><th class="r">Notas</th><th class="r">Unidades</th><th class="r">Valor</th></tr></thead><tbody>
        ${D.promos.map((p) => `<tr><td><b>${esc(p.product)}</b></td><td>${p.kind === 'exclusiva' ? `<span class="pill pill--excl">Só pelo app</span>${p.code ? ` <code>${esc(p.code)}</code>` : ''}` : '<span class="pill pill--promo">Oferta</span>'}</td>
          <td class="r">${fmtN(p.receipts)}</td><td class="r">${fmtN(Math.round(p.units))}</td><td class="r">${money(p.value)}</td></tr>`).join('')}
      </tbody></table></div>` : `<p class="muted small">Ainda não chegou nota com produto de promoção sua. <a class="linkish" href="#promocoes">Criar promoção exclusiva</a>.</p>`}
    </section>

    <details class="panel"><summary><b>Como contamos</b></summary>
      <ul class="small" style="margin:10px 0 0;padding-left:18px;display:grid;gap:6px">
        <li><b>Contato</b>: a pessoa viu ou tocou numa campanha sua, viu um produto seu em promoção, abriu a rota para uma loja sua, viu seu anúncio, recebeu seu cupom do “Cubra a diferença” ou uma queima.</li>
        <li><b>Venda comprovada</b>: em até ${S.win} dias depois do contato, a mesma pessoa mandou no site uma nota fiscal (NFC-e) cujo CNPJ é de uma loja sua.</li>
        <li>Cada nota conta <b>uma vez só</b>, para o último contato antes dela. Quem estava sem conta aparece em “pessoas alcançadas”, mas não dá para ligar a uma nota.</li>
        <li>Para proteger os clientes, grupos com menos de 3 compradores não mostram valores. Ninguém é identificado.</li>
        <li><b>Pontos em dobro</b>: a nota de mercado parceiro vale o dobro de pontos para a pessoa. Isso aumenta as notas que chegam da sua loja e deixa este relatório mais completo.</li>
      </ul></details>`;
}

document.addEventListener('click', (e) => {
  const d = e.target.closest('[data-vd-days]'); if (d && C) { S.days = Number(d.dataset.vdDays); render(C); return; }
  if (e.target.closest('[data-vd-csv]') && S.data) {
    downloadCSV(`vendas-comprovadas-${S.days}d.csv`, S.data.campaigns || [], [['title', 'Campanha'], ['kind', 'Formato'], [(r) => r.starts_at?.slice(0, 10), 'Início'], [(r) => r.ends_at?.slice(0, 10), 'Fim'],
      ['people', 'Pessoas que viram'], ['buyers', 'Compraram'], ['receipts', 'Notas'], ['revenue', 'Valor em notas (R$)'], ['ticket', 'Ticket médio (R$)']]);
  }
});
document.addEventListener('change', (e) => { if (e.target.matches('[data-vd-win]') && C) { S.win = Number(e.target.value); render(C); } });
