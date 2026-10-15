// Na fila do caixa: um jogo rápido de "Tá barato ou tá caro?", o total do carrinho para conferir
// antes de pagar e três preços para checar enquanto a fila anda.
import * as api from './api.js';
import { S, $, esc, brl, logo, hooks, isOn, media } from './core.js';
import { track } from './track.js';
import * as ads from './ads.js';
import * as carrinho from './carrinho.js';

const ROUNDS = 10;
let game = null, timer = null;
const startKey = 'tb.queueStart';

function since() {
  let t0 = Number(sessionStorage.getItem(startKey));
  if (!t0 || Date.now() - t0 > 2 * 36e5) { t0 = Date.now(); sessionStorage.setItem(startKey, t0); track('queue_open', { market_id: carrinho.currentMarket() }); }
  return t0;
}
const mmss = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function newRound() {
  const pool = S.products.filter((p) => p.prices.filter((x) => isOn(x.market_id)).length >= 3);
  const p = pool[Math.floor(Math.random() * pool.length)];
  const ps = p.prices.filter((x) => isOn(x.market_id));
  const x = ps[Math.floor(Math.random() * ps.length)];
  const avg = ps.reduce((s, y) => s + y.price, 0) / ps.length;
  return { p, x, avg, best: ps[0], answer: x.price <= avg ? 'barato' : 'caro', picked: null };
}

function fact() {
  const rows = S.products.map((p) => { const v = p.prices.filter((x) => isOn(x.market_id)); return v.length > 1 ? { p, d: v[v.length - 1].price - v[0].price, lo: v[0], hi: v[v.length - 1] } : null; })
    .filter(Boolean).sort((a, b) => b.d - a.d);
  const r = rows[Math.floor(Math.random() * Math.min(5, rows.length))];
  if (!r) return '';
  return `${esc(r.p.name)} varia <b>${brl(r.d)}</b> entre os mercados hoje: ${brl(r.lo.price)} no ${esc(S.markets.get(r.lo.market_id)?.name)} e ${brl(r.hi.price)} no ${esc(S.markets.get(r.hi.market_id)?.name)}.`;
}

export function render() {
  const el = $('#filaView'); if (!el || !S.products.length) return;
  const t0 = since();
  const mid = carrinho.currentMarket(); const m = S.markets.get(mid);
  const c = S.cart || api.store.get('tb.cart', null) || { items: [] };
  const t = c.items.reduce((s, i) => s + (i.price || 0) * i.qty, 0);
  game ||= { round: 0, score: 0, streak: 0, best: api.store.get('tb.filaBest', 0), q: newRound() };
  el.innerHTML = `
    <div class="fila">
      <header class="fila-head">
        <div><p class="muted small">${m ? `${esc(m.name)} · ` : ''}na fila há <b id="filaTimer">${mmss(Date.now() - t0)}</b></p><h1>Enquanto a fila anda</h1></div>
        <a class="btn btn--ghost btn--sm" href="#carrinho">Voltar ao carrinho</a>
      </header>

      <a class="fila-cart" href="#carrinho">
        <span><small>Seu carrinho</small><b>${brl(t)}</b><span class="muted small">${c.items.length} ${c.items.length === 1 ? 'item' : 'itens'}${c.budget ? ` · orçamento ${brl(c.budget)}` : ''}</span></span>
        <em>${c.items.length ? 'Confira antes de passar no caixa' : 'Anote os itens para conferir o total'}</em>
      </a>

      <button class="fila-nota" data-cupom="open"><span aria-hidden="true">🧾</span><span><b>Depois de pagar: confira a nota</b><small>Leia o QR da nota e veja se o caixa cobrou o preço da etiqueta</small></span><em>›</em></button>

      <section class="panel game" id="game">${gameHTML()}</section>

      <section class="panel fila-fact"><p class="pd__h" style="margin:0">Você sabia?</p><p>${fact()}</p></section>

      <section class="panel fila-check">
        <div><h2>Confira 3 preços desta loja</h2><p class="muted small">Leva 1 minuto, rende pontos e deixa o site mais certo para todo mundo.</p></div>
        <button class="btn btn--primary btn--sm" data-fiscal-market="${mid}">Conferir</button>
      </section>
      <div id="adFila"></div>
    </div>`;
  ads.render('fila', $('#adFila'));
  clearInterval(timer);
  timer = setInterval(() => { const n = $('#filaTimer'); if (!n || location.hash !== '#fila') return clearInterval(timer); n.textContent = mmss(Date.now() - t0); }, 1000);
}

function gameHTML() {
  const g = game;
  if (g.round >= ROUNDS) {
    return `<div class="game-end"><p class="pd__h" style="margin:0">Tá barato ou tá caro?</p>
      <p class="fx-done__pts">${g.score}/${ROUNDS}</p>
      <p>${g.score >= 8 ? 'Olho de fiscal! Você conhece os preços de Manaus.' : g.score >= 5 ? 'Mandou bem. Mais uma rodada?' : 'Os preços enganam, né? Tenta de novo.'}${g.score >= g.best ? ' <b>Seu recorde!</b>' : ` Recorde: ${g.best}.`}</p>
      <div class="row-actions" style="justify-content:center"><button class="btn btn--primary" data-game="again">Jogar de novo</button><button class="btn btn--ghost" data-game="share">Desafiar alguém</button></div></div>`;
  }
  const { p, x, picked, answer, avg, best } = g.q;
  const mk = S.markets.get(x.market_id);
  return `<div class="game-top"><p class="pd__h" style="margin:0">Tá barato ou tá caro?</p><span class="muted small">Rodada ${g.round + 1} de ${ROUNDS} · ${g.score} ${g.score === 1 ? 'acerto' : 'acertos'}${g.streak > 1 ? ` · 🔥 ${g.streak} seguidos` : ''}</span></div>
    <div class="game-q">${media(p, 'pd__media')}<div><b>${esc(p.name)}</b><small class="muted">${esc([p.brand, p.unit].filter(Boolean).join(' · '))}</small>
      <span class="game-price">${brl(x.price)}</span><small>${logo(mk, 'xs')} no ${esc(mk.name)}</small></div></div>
    ${picked ? `<div class="game-a ${picked === answer ? 'is-ok' : 'is-bad'}"><b>${picked === answer ? 'Acertou!' : 'Errou!'}</b> Está <b>${answer}</b>: a média nos mercados é ${brl(avg)} e o menor preço é ${brl(best.price)} no ${esc(S.markets.get(best.market_id).name)}.</div>
      <button class="btn btn--primary btn--block" data-game="next">${g.round + 1 >= ROUNDS ? 'Ver resultado' : 'Próximo'}</button>`
    : `<div class="game-btns"><button class="btn btn--block game-b game-b--cheap" data-game="barato">Tá barato</button><button class="btn btn--block game-b game-b--exp" data-game="caro">Tá caro</button></div>`}`;
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-game]'); if (!b) return;
  const g = game; const a = b.dataset.game;
  if (a === 'barato' || a === 'caro') {
    g.q.picked = a;
    if (a === g.q.answer) { g.score++; g.streak++; } else g.streak = 0;
  } else if (a === 'next') { g.round++; if (g.round < ROUNDS) g.q = newRound(); else if (g.score > g.best) { g.best = g.score; api.store.set('tb.filaBest', g.best); } }
  else if (a === 'again') { game = { round: 0, score: 0, streak: 0, best: g.best, q: newRound() }; }
  else if (a === 'share') {
    const text = `Acertei ${g.score} de ${ROUNDS} no "Tá barato ou tá caro?" com preços reais de Manaus. Duvido você! ${location.origin}${location.pathname}#fila`;
    try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); hooks.toast?.('Copiado.'); } } catch {}
    return;
  }
  $('#game').innerHTML = gameHTML();
});
