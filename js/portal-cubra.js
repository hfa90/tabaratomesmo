// Portal › Cubra a diferença: quando o rancho de alguém sai um pouco mais barato em outro mercado,
// o seu mercado oferece um cupom que cobre a diferença, na hora em que a pessoa decide onde comprar.
// O mercado define as regras; o banco (cover_offer) calcula com os preços de agora e respeita o orçamento.
// Só paga o cupom usado: validado aqui no caixa ou comprovado pela nota que a pessoa manda no site.
import * as P from './portal-api.js';
import { $, esc, brl } from './core.js';
import { fmtN } from './viz.js';
import { ic } from './icons.js';

const ST = { usado: ['ok', 'Usado'], aceito: ['promo', 'Ativado'], oferta: ['soft', 'Oferecido'], expirado: ['soft', 'Venceu'], recusado: ['soft', 'Recusado'] };
const num = (v) => Number(String(v ?? '').replace(/\s|R\$/g, '').replace(',', '.'));
const dt = (d) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
let C = null, D = null;

export async function render(ctx) {
  C = ctx;
  const m = ctx.market();
  ctx.main.innerHTML = `${ctx.banner}
    <header class="pt-head"><div><h1>Cubra a diferença</h1>
      <p class="muted">Quando o rancho do mês de alguém sai um pouco mais barato em outro mercado, o ${esc(m.name)} oferece um cupom que cobre a diferença, na hora da decisão. Você só paga o cupom usado.</p></div></header>
    <div id="cvBody"><div class="skeleton" style="height:360px"></div></div>`;
  try { D = await P.coverGet(ctx.mid); }
  catch (e) { $('#cvBody').innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
  paint();
}

function paint() {
  const r = D.rules, M = D.month || {}, m = C.market();
  const budgetPct = r.budget_month ? Math.min(100, (Number(D.spent) / Number(r.budget_month)) * 100) : 0;
  const conv = M.offers ? Math.round((M.used / M.offers) * 1000) / 10 : 0;
  const roi = Number(M.used_value) ? Math.round((Number(M.ranchos_value) / Number(M.used_value)) * 10) / 10 : null;
  $('#cvBody').innerHTML = `
    ${!D.enabled ? `<p class="note">A equipe do Tá Barato Mesmo? pausou o “Cubra a diferença” no momento. Suas regras ficam guardadas.</p>` : ''}
    ${!D.partner ? `<p class="note">O cupom só é oferecido por mercados parceiros com acesso ativo ao portal.</p>` : ''}
    <div class="kpis">
      <div class="kpi"><span class="kpi__l">Ofertas no mês</span><span class="kpi__v">${fmtN(M.offers)}</span><span class="kpi__h">diferença média ${M.avg_diff ? brl(Number(M.avg_diff)) : '–'}</span></div>
      <div class="kpi"><span class="kpi__l">Cupons usados</span><span class="kpi__v">${fmtN(M.used)}</span><span class="kpi__h">${String(conv).replace('.', ',')}% das ofertas · ${fmtN(M.accepted)} ativados</span></div>
      <div class="kpi kpi--accent"><span class="kpi__l">Ranchos conquistados</span><span class="kpi__v">${brl(Number(M.ranchos_value || 0))}</span><span class="kpi__h">${roi ? `${String(roi).replace('.', ',')}× o valor dos cupons` : 'valor dos ranchos que vieram com cupom'}</span></div>
      <div class="kpi"><span class="kpi__l">A pagar no mês</span><span class="kpi__v">${brl(Number(M.used_value || 0))}</span><span class="kpi__h">${brl(Number(M.pending_value || 0))} em cupons ativados ainda válidos</span></div>
    </div>

    <div class="pt-grid">
      <section class="panel"><div class="panel__head"><h2>${ic('tool')} Suas regras</h2>
        <span class="switch" title="Oferecer cupons"><input type="checkbox" id="cvActive" ${r.active ? 'checked' : ''} aria-label="Oferecer cupons" /><i></i></span></div>
        <form class="form" id="cvForm">
          <div class="cv-rules">
            <label>Cobrir diferença de até (R$)<input name="max_diff" inputmode="decimal" value="${fmtMoney(r.max_diff)}" /><small>Acima disso, a diferença é grande demais para cobrir.</small></label>
            <label>Rancho mínimo no ${esc(m.name)} (R$)<input name="min_total" inputmode="decimal" value="${fmtMoney(r.min_total)}" /><small>Só listas que somam isso ou mais na sua loja.</small></label>
            <label>Orçamento por mês (R$)<input name="budget_month" inputmode="decimal" value="${fmtMoney(r.budget_month)}" /><small>Ao chegar nele, as ofertas param até o mês que vem.</small></label>
            <label>A mais que a diferença (R$)<input name="extra" inputmode="decimal" value="${fmtMoney(r.extra)}" /><small>Para o seu mercado ganhar de verdade (ex.: R$ 1).</small></label>
            <label>Validade do cupom (dias)<input name="valid_days" inputmode="numeric" value="${r.valid_days}" /><small>Vale até o fim do último dia.</small></label>
            <label>Compra mínima com o cupom (% do rancho)<input name="min_spend_pct" inputmode="numeric" value="${r.min_spend_pct}" /><small>Evita usar o cupom numa compra pequena.</small></label>
          </div>
          <div class="cv-preview" id="cvPreview"></div>
          <p class="form__err" role="alert"></p>
          <button class="btn btn--primary">Salvar regras</button>
        </form>
        <div><p class="small" style="display:flex;justify-content:space-between"><span>Orçamento do mês</span><b>${brl(Number(D.spent))} de ${brl(Number(r.budget_month))}</b></p>
          <div class="cv-budget"><span style="--w:${budgetPct}%"></span></div></div>
      </section>

      <section class="panel"><div class="panel__head"><h2>${ic('ticket')} Validar cupom no caixa</h2></div>
        <p class="small muted">A pessoa mostra o código no celular (começa com TB). Digite aqui com o valor da compra: o sistema confere validade, compra mínima e se já foi usado.</p>
        <form class="cv-redeem form" id="cvRedeem">
          <label>Código<input class="input" name="code" required placeholder="TB7K2Q9X" autocomplete="off" maxlength="12" /></label>
          <label>Valor da compra (R$)<input name="total" inputmode="decimal" placeholder="0,00" /></label>
          <button class="btn btn--primary">Validar</button>
        </form>
        <div id="cvRedeemOut"></div>
        <p class="small muted">Se a pessoa mandar a nota da compra pelo site, o cupom é marcado como usado sozinho (comprovado pela nota).</p>
        <h3 class="pd__h" style="margin-top:6px">Como a pessoa vê</h3>
        <div class="cv-preview"><span class="small muted">Logo depois de concluir o Rancho do mês:</span>
          <span>“Sai R$ 14,00 mais barato no Concorrente.”</span>
          <b>${esc(m.name)} cobre: cupom de ${brl(14 + (Number(r.extra) || 0))} se fizer o rancho lá até ${new Date(Date.now() + (r.valid_days || 4) * 864e5).toLocaleDateString('pt-BR', { weekday: 'long' })}.</b></div>
      </section>
    </div>

    <section class="panel"><div class="panel__head"><h2>${ic('list')} Cupons recentes</h2></div>
      ${(D.recent || []).length ? `<div class="tbl-wrap"><table class="tbl tbl--sm"><thead><tr><th>Quando</th><th>Perdeu para</th><th class="r">Diferença</th><th class="r">Cupom</th><th class="r">Rancho aqui</th><th>Situação</th><th>Código</th></tr></thead><tbody>
        ${D.recent.map((c) => { const [cls, lbl] = ST[c.status] || ST.oferta; return `<tr class="${['expirado', 'recusado'].includes(c.status) ? 'is-off' : ''}"><td class="nowrap">${dt(c.created_at)}</td><td>${esc(c.best_name || '–')}</td>
          <td class="r">${brl(Number(c.diff))}</td><td class="r"><b>${brl(Number(c.value))}</b></td><td class="r">${brl(Number(c.my_total))}</td>
          <td><span class="pill pill--${cls}">${lbl}</span>${c.used_via ? `<small class="muted"> ${c.used_via === 'nota' ? 'pela nota' : 'no caixa'}</small>` : ''}</td><td>${c.code ? `<code>${esc(c.code)}</code>` : '–'}</td></tr>`; }).join('')}
      </tbody></table></div>` : `<p class="muted small">Nenhuma oferta ainda. Ligue as regras: quando alguém concluir um rancho que sai um pouco mais barato em outro mercado, a oferta aparece na hora.</p>`}
    </section>

    <details class="panel"><summary><b>Como funciona</b></summary>
      <ol class="small" style="margin:10px 0 0;padding-left:18px;display:grid;gap:6px">
        <li>A pessoa conclui o Rancho do mês. O site calcula, com os preços de agora, o total em cada mercado (só itens que existem nos dois lados).</li>
        <li>Se outro mercado ganhou e a diferença para o ${esc(m.name)} cabe nas suas regras e no orçamento, a pessoa vê a oferta do seu mercado.</li>
        <li>Ela toca em “Quero o cupom” e recebe um código. Cada pessoa recebe no máximo um cupom do seu mercado por mês.</li>
        <li>Você só paga quando o cupom é usado: validado aqui no caixa ou comprovado pela nota fiscal enviada no site.</li>
      </ol></details>`;
  preview();
}
const fmtMoney = (v) => Number(v ?? 0).toFixed(2).replace('.', ',');

function readForm() {
  const f = $('#cvForm');
  return { active: $('#cvActive').checked, max_diff: num(f.max_diff.value), min_total: num(f.min_total.value), budget_month: num(f.budget_month.value),
    extra: num(f.extra.value), valid_days: Math.round(num(f.valid_days.value)), min_spend_pct: Math.round(num(f.min_spend_pct.value)) };
}
function preview() {
  const el = $('#cvPreview'); if (!el) return;
  const r = readForm(); const m = C.market();
  if (!r.active) { el.innerHTML = `<span class="small"><b>Desligado.</b> Ligue a chave acima para começar a oferecer cupons.</span>`; return; }
  const ex = Math.min(r.max_diff, 14);
  const n = r.budget_month > 0 ? Math.floor(r.budget_month / (Math.ceil(ex) + r.extra)) : 0;
  el.innerHTML = `<span class="small">Exemplo: um rancho de ${brl(Math.max(r.min_total, 320))} que sai ${brl(ex)} mais barato no concorrente recebe um cupom de <b>${brl(Math.ceil(ex) + r.extra)}</b> do ${esc(m.name)}, válido por ${r.valid_days} ${r.valid_days > 1 ? 'dias' : 'dia'}, para compras a partir de ${brl(Math.max(r.min_total, 320) * r.min_spend_pct / 100)}.</span>
    <span class="small muted">O orçamento cobre cerca de ${fmtN(n)} ${n === 1 ? 'cupom' : 'cupons'} como esse por mês.</span>`;
}

document.addEventListener('input', (e) => { if (e.target.closest('#cvForm') || e.target.id === 'cvActive') preview(); });
document.addEventListener('change', (e) => { if (e.target.id === 'cvActive') preview(); });
document.addEventListener('submit', async (e) => {
  if (e.target.id === 'cvForm') {
    e.preventDefault();
    const r = readForm(); const err = e.target.querySelector('.form__err'); err.textContent = '';
    if (![r.max_diff, r.min_total, r.budget_month, r.extra, r.valid_days, r.min_spend_pct].every(Number.isFinite)) { err.textContent = 'Confira os valores.'; return; }
    if (r.max_diff < 1 || r.max_diff > 500) { err.textContent = 'A diferença máxima vai de R$ 1 a R$ 500.'; return; }
    if (r.valid_days < 1 || r.valid_days > 15) { err.textContent = 'A validade vai de 1 a 15 dias.'; return; }
    if (r.min_spend_pct < 30 || r.min_spend_pct > 100) { err.textContent = 'A compra mínima vai de 30% a 100% do rancho.'; return; }
    try { await P.coverSave(C.mid, r); C.toast(r.active ? 'Regras salvas. As ofertas já valem para os próximos ranchos.' : 'Regras salvas (ofertas desligadas).'); render(C); }
    catch (x) { err.textContent = x.message; }
  }
  if (e.target.id === 'cvRedeem') {
    e.preventDefault();
    const f = e.target; const out = $('#cvRedeemOut'); const total = f.total.value ? num(f.total.value) : null;
    try {
      const r = await P.coverRedeem(C.mid, f.code.value, total);
      out.innerHTML = `<p class="ok-box">${ic('check')} Cupom <b>${esc(r.code)}</b> válido: desconte <b>${brl(Number(r.value))}</b> na compra.</p>`;
      f.reset(); D = await P.coverGet(C.mid).catch(() => D);
    } catch (x) { out.innerHTML = `<p class="note">${esc(x.message)}</p>`; }
  }
});
