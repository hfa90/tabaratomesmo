// Portal › Recompensas: os clientes juntam pontos mandando a nota fiscal da compra (Cofrinho) e trocam
// por descontos que o próprio supermercado oferece. O mercado só paga o desconto USADO, e cada uso vem
// com a nota da compra (ou é validado aqui no caixa). Sem sorteio: a pessoa sabe exatamente o que ganha.
import * as P from './portal-api.js';
import { $, esc, brl } from './core.js';
import { fmtN } from './viz.js';
import { ic } from './icons.js';

const ST = { usado: ['ok', 'Usado'], ativo: ['promo', 'Ativo'], vencido: ['soft', 'Venceu'], cancelado: ['soft', 'Cancelado'] };
const num = (v) => Number(String(v ?? '').replace(/\s|R\$/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
const dt = (d) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
const money = (v) => (Number.isInteger(Number(v)) ? `R$ ${Number(v)}` : brl(Number(v)));
let C = null, D = null;

export async function render(ctx) {
  C = ctx;
  const m = ctx.market();
  ctx.main.innerHTML = `${ctx.banner}
    <header class="pt-head"><div><h1>Recompensas</h1>
      <p class="muted">Os clientes juntam pontos mandando a nota fiscal da compra. Ofereça descontos do ${esc(m.name)} que eles trocam pelos pontos: você só paga o desconto usado, e cada uso vem com a nota da compra.</p></div>
      <button class="btn btn--primary" data-rw-new>+ Nova recompensa</button></header>
    <div id="rwBody"><div class="skeleton" style="height:360px"></div></div>`;
  try { D = await P.rewardsList(ctx.mid); }
  catch (e) { $('#rwBody').innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
  paint();
}

function paint() {
  const M = D.month || {}, m = C.market();
  const roi = Number(M.cost) ? Math.round((Number(M.receipts_value) / Number(M.cost)) * 10) / 10 : null;
  const rows = D.rewards || [];
  $('#rwBody').innerHTML = `
    ${!D.enabled ? '<p class="note">A equipe do Tá Barato Mesmo? pausou a troca de pontos no momento. Suas recompensas ficam guardadas.</p>' : ''}
    ${!D.partner ? '<p class="note">As recompensas aparecem para os clientes quando o mercado tem acesso ativo ao portal.</p>' : ''}
    <div class="kpis">
      <div class="kpi"><span class="kpi__l">Códigos trocados no mês</span><span class="kpi__v">${fmtN(M.redeemed)}</span><span class="kpi__h">${fmtN(M.people)} clientes · ${fmtN(M.active)} ainda válidos</span></div>
      <div class="kpi"><span class="kpi__l">Usados na loja</span><span class="kpi__v">${fmtN(M.used)}</span><span class="kpi__h">pela nota ou validados no caixa</span></div>
      <div class="kpi kpi--accent"><span class="kpi__l">Compras com código</span><span class="kpi__v">${brl(Number(M.receipts_value || 0))}</span><span class="kpi__h">${roi ? `${String(roi).replace('.', ',')}× o valor dos descontos` : 'valor das compras em que o código foi usado'}</span></div>
      <div class="kpi"><span class="kpi__l">Descontos dados no mês</span><span class="kpi__v">${brl(Number(M.cost || 0))}</span><span class="kpi__h">o que o ${esc(m.name)} pagou</span></div>
    </div>

    <div class="pt-grid">
      <section class="panel"><div class="panel__head"><h2>${ic('ticket')} Suas recompensas</h2><span class="muted small">até 6 ativas</span></div>
        ${rows.length ? `<ul class="rw-list">${rows.map((w) => `<li class="${w.active ? '' : 'is-off'}">
            <span class="rw-v">${money(w.value)}</span>
            <span class="rw-t"><b>${esc(w.title)}</b><small>${Number(w.min_spend) ? `compras acima de ${brl(Number(w.min_spend))} · ` : ''}${fmtN(w.cost_points)} pontos · vale ${w.valid_days} dias${w.monthly_stock ? ` · ${fmtN(w.month_redeemed)} de ${fmtN(w.monthly_stock)} no mês` : ''}</small>
              <small>${fmtN(w.redeemed)} trocados · ${fmtN(w.used)} usados${w.active ? '' : ' · <b>pausada</b>'}</small></span>
            <button class="btn btn--ghost btn--sm" data-rw-edit="${w.id}">Editar</button></li>`).join('')}</ul>`
          : `<div class="rw-empty"><p><b>Nenhuma recompensa ainda.</b> Comece com uma simples, como <b>R$ 5 de desconto em compras acima de R$ 100 por 600 pontos</b>: são cerca de 4 a 6 notas de rancho.</p>
              <button class="btn btn--primary" data-rw-new data-rw-sugestao>Criar esta recompensa</button></div>`}
      </section>

      <section class="panel"><div class="panel__head"><h2>${ic('check')} Validar código no caixa</h2></div>
        <p class="small muted">O cliente mostra o código no celular (começa com TB). Digite com o valor da compra: o sistema confere validade, compra mínima e se já foi usado.</p>
        <form class="cv-redeem form" id="rwCheck">
          <label>Código<input class="input" name="code" required placeholder="TB7K2Q9X" autocomplete="off" maxlength="12" /></label>
          <label>Valor da compra (R$)<input name="total" inputmode="decimal" placeholder="0,00" /></label>
          <button class="btn btn--primary">Validar</button>
        </form>
        <div id="rwCheckOut"></div>
        <p class="small muted">Se o cliente pagar sem mostrar o código e mandar a nota pelo site, o código é dado como usado sozinho (comprovado pela nota).</p>
        <h3 class="pd__h" style="margin-top:6px">Como o cliente vê</h3>
        <div class="rw-prev"><span class="rw-v">${money(rows[0]?.value || 5)}</span><span><b>${esc(rows[0]?.title || 'R$ 5 de desconto no rancho')}</b><small>${esc(m.name)} · ${fmtN(rows[0]?.cost_points || 600)} pontos</small></span></div>
      </section>
    </div>

    <section class="panel"><div class="panel__head"><h2>${ic('list')} Últimos códigos</h2></div>
      ${(D.recent || []).length ? `<div class="tbl-wrap"><table class="tbl tbl--sm"><thead><tr><th>Trocado em</th><th>Recompensa</th><th class="r">Desconto</th><th>Situação</th><th class="r">Compra</th></tr></thead><tbody>
        ${D.recent.map((x) => { const [cls, lbl] = ST[x.status] || ST.ativo; return `<tr class="${['vencido', 'cancelado'].includes(x.status) ? 'is-off' : ''}"><td class="nowrap">${dt(x.created_at)}</td><td>${esc(x.title)}</td>
          <td class="r">${brl(Number(x.value))}</td><td><span class="pill pill--${cls}">${lbl}</span>${x.used_via ? `<small class="muted"> ${x.used_via === 'nota' ? 'pela nota' : 'no caixa'}</small>` : ''}</td>
          <td class="r">${x.receipt_total ? brl(Number(x.receipt_total)) : '–'}</td></tr>`; }).join('')}
      </tbody></table></div>` : '<p class="muted small">Ninguém trocou pontos ainda.</p>'}
    </section>

    <details class="panel"><summary><b>Como funciona</b></summary>
      <ol class="small" style="margin:10px 0 0;padding-left:18px;display:grid;gap:6px">
        <li>A cada nota fiscal que manda no site, o cliente ganha pontos (20 a 150, o dobro em mercado parceiro) e bônus por mandar todo dia, toda semana e cumprir desafios.</li>
        <li>No Cofrinho, ele troca os pontos por uma recompensa sua e recebe um código, que vale pelo número de dias que você escolher.</li>
        <li>No caixa, o operador valida o código aqui. Ou o cliente paga normalmente, manda a nota e o código é dado como usado pela própria nota.</li>
        <li>Você só paga o desconto usado. O estoque do mês limita quantos códigos saem.</li>
      </ol></details>`;
}

function form(w = null, sug = false) {
  const v = w || (sug ? { title: 'R$ 5 de desconto no rancho', value: 5, min_spend: 100, cost_points: 600, valid_days: 7, monthly_stock: 200, active: true }
    : { title: '', value: '', min_spend: '', cost_points: 600, valid_days: 7, monthly_stock: '', active: true });
  const f2 = (x) => (x === '' || x == null ? '' : Number(x).toFixed(2).replace('.', ','));
  C.openSheet?.(`<h2 class="sheet__title" id="ptSheetTitle">${w ? 'Editar recompensa' : 'Nova recompensa'}</h2>
    <form class="form" id="rwForm">
      <input type="hidden" name="rid" value="${w?.id || ''}" />
      <label>Nome (aparece para o cliente)<input name="title" maxlength="60" required value="${esc(v.title)}" placeholder="Ex.: R$ 5 de desconto no rancho" /></label>
      <div class="form__row">
        <label>Desconto (R$)<input name="value" inputmode="decimal" required value="${f2(v.value)}" placeholder="5,00" /></label>
        <label>Compra mínima (R$)<input name="min_spend" inputmode="decimal" value="${f2(v.min_spend)}" placeholder="100,00" /></label>
      </div>
      <div class="form__row">
        <label>Pontos para trocar<input name="cost_points" inputmode="numeric" required value="${v.cost_points}" /></label>
        <label>Vale por (dias)<input name="valid_days" inputmode="numeric" value="${v.valid_days}" /></label>
      </div>
      <label>Quantos códigos por mês <small class="muted">(vazio = sem limite)</small><input name="monthly_stock" inputmode="numeric" value="${v.monthly_stock ?? ''}" placeholder="200" /></label>
      <label class="check"><input type="checkbox" name="active" ${v.active ? 'checked' : ''} /> Aparece para os clientes</label>
      <p class="small muted">Referência: uma nota de rancho dá de 40 a 150 pontos com os bônus. 600 pontos ≈ 4 a 6 notas; 1.500 ≈ um mês de compras.</p>
      <p class="form__err" role="alert"></p>
      <button class="btn btn--primary btn--block">${w ? 'Salvar' : 'Criar recompensa'}</button>
    </form>`);
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-rw-new], [data-rw-edit]'); if (!t || !C) return;
  if (t.dataset.rwEdit) return form((D?.rewards || []).find((w) => String(w.id) === t.dataset.rwEdit));
  return form(null, t.dataset.rwSugestao !== undefined);
});
document.addEventListener('submit', async (e) => {
  if (e.target.id === 'rwForm') {
    e.preventDefault();
    const f = e.target; const err = f.querySelector('.form__err'); err.textContent = '';
    const g = (n) => f.elements.namedItem(n); // (f.title é o atributo do próprio formulário)
    const p = { id: g('rid').value || null, title: g('title').value.trim(), value: num(g('value').value), min_spend: g('min_spend').value ? num(g('min_spend').value) : 0,
      cost_points: Math.round(num(g('cost_points').value)), valid_days: Math.round(num(g('valid_days').value || 7)),
      monthly_stock: g('monthly_stock').value ? Math.round(num(g('monthly_stock').value)) : null, active: g('active').checked };
    if (p.title.length < 3) { err.textContent = 'Dê um nome para a recompensa.'; return; }
    if (!(p.value > 0 && p.value <= 200)) { err.textContent = 'O desconto vai de R$ 0,01 a R$ 200.'; return; }
    if (!(p.cost_points >= 50 && p.cost_points <= 20000)) { err.textContent = 'Os pontos vão de 50 a 20.000.'; return; }
    if (!(p.valid_days >= 1 && p.valid_days <= 60)) { err.textContent = 'A validade vai de 1 a 60 dias.'; return; }
    if (p.min_spend && p.min_spend < p.value) { err.textContent = 'A compra mínima precisa ser maior que o desconto.'; return; }
    try { await P.rewardSave(C.mid, p); C.closeSheet?.(); C.toast(p.id ? 'Recompensa salva.' : 'Recompensa criada. Os clientes já podem trocar.'); render(C); }
    catch (x) { err.textContent = x.message; }
  }
  if (e.target.id === 'rwCheck') {
    e.preventDefault();
    const f = e.target; const out = $('#rwCheckOut'); const total = f.total.value ? num(f.total.value) : null;
    try {
      const r = await P.rewardCheck(C.mid, f.code.value, total);
      out.innerHTML = `<p class="ok-box">${ic('check')} Código válido: desconte <b>${brl(Number(r.value))}</b> (${esc(r.title)}).</p>`;
      f.reset(); D = await P.rewardsList(C.mid).catch(() => D);
    } catch (x) { out.innerHTML = `<p class="note">${esc(x.message)}</p>`; }
  }
});
