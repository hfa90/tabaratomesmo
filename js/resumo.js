// "Meu mês": cartão bonito para mandar no WhatsApp ou pôr no status.
// Feito no próprio celular (canvas 1080×1350), sem servidor:
//   quanto a pessoa economizou, onde mais comprou, o que mais baixou e o que mais subiu em Manaus.
// Quem ainda não economizou recebe um cartão com os preços do mês (também vale compartilhar).
import { S, $, brl, visiblePrices, hooks } from './core.js';
import { ic } from './icons.js';
import * as account from './account.js';
import { track } from './track.js';

const W = 1080, H = 1350;
const SITE = 'hfa90.github.io/tabaratomesmo';
const monthName = () => new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase());

function movers() {
  const ps = S.products.filter((p) => visiblePrices(p).length && p.change_pct != null);
  const down = ps.filter((p) => p.change_pct < -0.4).sort((a, b) => a.change_pct - b.change_pct)[0] || null;
  const up = ps.filter((p) => p.change_pct > 0.4).sort((a, b) => b.change_pct - a.change_pct)[0] || null;
  // maior diferença entre mercados (o "achado" do mês)
  const gap = S.products.map((p) => ({ p, v: visiblePrices(p) })).filter((x) => x.v.length >= 2)
    .map((x) => ({ ...x, d: x.v[x.v.length - 1].price - x.v[0].price })).sort((a, b) => b.d - a.d)[0] || null;
  // mercado que mais vezes tem o menor preço
  const wins = new Map();
  for (const p of S.products) { const v = visiblePrices(p); if (v.length >= 2) wins.set(v[0].market_id, (wins.get(v[0].market_id) || 0) + 1); }
  const champ = [...wins].sort((a, b) => b[1] - a[1])[0];
  const champM = champ ? { m: S.markets.get(champ[0]), n: champ[1] } : null;
  return { down, up, gap, champ: champM?.m ? champM : null };
}

function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

function drawMark(ctx, x, y, s) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s / 48, s / 48);
  const g = ctx.createLinearGradient(0, 0, 48, 48); g.addColorStop(0, '#16805A'); g.addColorStop(1, '#0B4A33');
  ctx.fillStyle = g; rr(ctx, 0, 0, 48, 48, 13); ctx.fill();
  ctx.translate(24, 24); ctx.rotate(-14 * Math.PI / 180); ctx.translate(-24, -24);
  ctx.fillStyle = '#FFD43B'; ctx.strokeStyle = '#FFD43B'; ctx.lineWidth = 2.6; ctx.lineJoin = 'round';
  const t = new Path2D('M11 24 L18.5 15.5 H35 a4 4 0 0 1 4 4 V28.5 a4 4 0 0 1 -4 4 H18.5 Z'); ctx.fill(t); ctx.stroke(t);
  ctx.fillStyle = '#0F5A3E'; ctx.beginPath(); ctx.arc(18, 24, 2.1, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#0F5A3E'; ctx.lineWidth = 3.2; ctx.lineCap = 'round'; ctx.stroke(new Path2D('M24 24.3l3.6 3.6 7-7.8'));
  ctx.restore();
}

function fit(ctx, text, max, size, weight = 800, family = 'Bricolage Grotesque') {
  let s = size; do { ctx.font = `${weight} ${s}px "${family}", system-ui, sans-serif`; s -= 2; } while (ctx.measureText(text).width > max && s > 20);
}

async function draw() {
  try { await Promise.all([document.fonts.load('800 80px "Bricolage Grotesque"'), document.fonts.load('600 40px Figtree'), document.fonts.load('700 40px Figtree')]); } catch {}
  const d = account.monthData(); const mv = movers();
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  // fundo
  const bg = ctx.createRadialGradient(W * 0.3, H * 0.15, 50, W * 0.5, H * 0.5, H);
  bg.addColorStop(0, '#16805A'); bg.addColorStop(0.55, '#0F5A3E'); bg.addColorStop(1, '#0A3F2C');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  // etiquetas decorativas ao fundo
  ctx.globalAlpha = 0.06; for (const [x, y, s] of [[820, 90, 260], [-60, 900, 300], [760, 1050, 200]]) drawMark(ctx, x, y, s); ctx.globalAlpha = 1;
  // topo
  drawMark(ctx, 80, 80, 96);
  ctx.fillStyle = '#fff'; ctx.font = '800 44px "Bricolage Grotesque", system-ui'; ctx.fillText('Tá Barato', 196, 128);
  const w1 = ctx.measureText('Tá Barato ').width; ctx.fillStyle = '#FFD43B'; ctx.fillText('Mesmo?', 196 + w1, 128);
  ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = '600 30px Figtree, system-ui'; ctx.fillText(`Meu mês · ${monthName()}`, 196, 168);
  // destaque
  const saved = d.month > 0.5 ? d.month : d.total > 0.5 ? d.total : 0;
  ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.font = '600 40px Figtree, system-ui';
  if (saved) {
    ctx.fillText(d.month > 0.5 ? 'Este mês eu economizei' : 'Já economizei', 80, 340);
    ctx.fillStyle = '#FFD43B'; fit(ctx, brl(saved), W - 160, 168); ctx.fillText(brl(saved), 76, 500);
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = '600 38px Figtree, system-ui'; ctx.fillText('comprando no mercado certo.', 80, 566);
  } else {
    ctx.fillText('Preços dos supermercados', 80, 340);
    ctx.fillStyle = '#fff'; fit(ctx, 'de Manaus', W - 160, 130); ctx.fillText('de Manaus', 76, 470);
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = '600 38px Figtree, system-ui'; ctx.fillText(`comparando ${S.markets.size || 5} mercados.`, 80, 536);
  }
  // linhas
  const rows = [];
  if (d.top?.m) rows.push(['Onde eu mais comprei', d.top.m.name, '#FFD43B']);
  if (mv.gap) rows.push(['Maior diferença do mês', `${mv.gap.p.name}: ${brl(mv.gap.d)}`, '#FFD43B']);
  if (mv.down) rows.push(['O que mais baixou', `${mv.down.name}  −${Math.abs(mv.down.change_pct).toFixed(0)}%`, '#7BE0A8']);
  if (mv.up) rows.push(['O que mais subiu', `${mv.up.name}  +${mv.up.change_pct.toFixed(0)}%`, '#FF9C8A']);
  if (mv.champ && rows.length < 4) rows.push(['Mais vezes o mais barato', `${mv.champ.m.name}: ${mv.champ.n} produtos`, '#FFD43B']);
  let y = 660;
  for (const [k, v, col] of rows.slice(0, 4)) {
    ctx.fillStyle = 'rgba(255,255,255,.09)'; rr(ctx, 80, y, W - 160, 136, 28); ctx.fill();
    ctx.fillStyle = col; rr(ctx, 80, y, 12, 136, 6); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '600 28px Figtree, system-ui'; ctx.fillText(k, 124, y + 52);
    ctx.fillStyle = '#fff'; fit(ctx, v, W - 250, 44, 700, 'Figtree'); ctx.fillText(v, 124, y + 104);
    y += 156;
  }
  // rodapé
  ctx.fillStyle = '#FFD43B'; rr(ctx, 80, H - 150, W - 160, 84, 42); ctx.fill();
  ctx.fillStyle = '#0B3D2A'; ctx.font = '700 32px Figtree, system-ui'; ctx.textAlign = 'center';
  ctx.fillText(`Compare você também: ${SITE}`, W / 2, H - 96); ctx.textAlign = 'left';
  return c;
}

let blob = null;
export async function open() {
  const body = $('#toolBody'); if (!body) return;
  body.innerHTML = `<div class="tool resumo"><h2 class="sheet__title" id="toolTitle"><span aria-hidden="true">${ic('sparkle')}</span> Meu mês</h2>
    <div class="resumo__img"><div class="skeleton" style="aspect-ratio:4/5;border-radius:18px"></div></div></div>`;
  $('#toolSheet').dataset.tool = 'resumo';
  if ($('#toolSheet').hidden) hooks.openSheet('#toolSheet');
  const c = await draw();
  blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const url = URL.createObjectURL(blob);
  const canFiles = !!(navigator.canShare && navigator.canShare({ files: [new File([blob], 'meu-mes.png', { type: 'image/png' })] }));
  body.querySelector('.resumo__img').innerHTML = `<img src="${url}" alt="Cartão com o resumo do seu mês no Tá Barato Mesmo?" />`;
  body.querySelector('.resumo').insertAdjacentHTML('beforeend', `<div class="tool__actions">
    ${canFiles ? `<button class="btn btn--primary btn--xl" data-resumo-share>${ic('send')} Compartilhar</button>` : ''}
    <a class="btn ${canFiles ? 'btn--ghost' : 'btn--primary'} btn--xl" href="${url}" download="meu-mes-ta-barato.png">${ic('save')} Baixar a imagem</a>
    <a class="btn btn--ghost btn--block" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`Olha onde as compras saem mais baratas em Manaus: https://${SITE}`)}">Mandar o link no WhatsApp</a></div>`);
  track('tool', { query: 'resumo' });
}

document.addEventListener('click', async (e) => {
  if (e.target.closest('[data-resumo]')) return open();
  if (e.target.closest('[data-resumo-share]') && blob) {
    try { await navigator.share({ files: [new File([blob], 'meu-mes-ta-barato.png', { type: 'image/png' })], text: `Meu mês no Tá Barato Mesmo? Compare você também: https://${SITE}` }); } catch {}
  }
});
