// 🧾 Minhas notas: a pessoa manda a nota fiscal da compra (QR, foto, print ou PDF).
//  Para ela:   pontos, +10 comparações, controle de gastos automático (mês, mercado, categoria),
//              "onde essa compra sairia mais barata hoje" e alerta dos produtos que compra sempre.
//  Para o site: preços reais, na data e no supermercado certos (lidos da Sefaz pelo servidor),
//              CNPJ de cada loja, códigos de barras e produtos que a galera compra e ainda não temos.
import * as api from './api.js';
import { ic } from './icons.js';
import { S, $, $$, esc, brl, logo, hooks, isOn } from './core.js';
import { parse, match } from './voice.js';
import * as scanner from './scanner.js';
import { findByEan, validEan } from './scanner.js';
import * as ia from './ia.js';
import { track } from './track.js';

const KEY = 'tb.receipts';
const body = () => $('#toolBody');
const digits = (s) => String(s || '').replace(/\D/g, '');
let cur = null;        // nota em revisão
let remote = null;     // notas do servidor (quem tem conta)
let remoteFor = null;

// ---------------------------------------------------------------- dados
const local = () => api.store.get(KEY, []);
const saveLocal = (list) => api.store.set(KEY, list.slice(0, 300));

function parseDate(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4] || '12'}:${m[5] || '00'}:00-04:00`);
  const d = new Date(s); return Number.isNaN(+d) ? null : d;
}
const fmtDate = (d) => (d ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }) : '');
const productOf = (id) => (id ? S.products.find((p) => p.id === id) : null);
const pname = (p) => [p.name, p.brand, p.unit].filter(Boolean).join(' ');

/** todas as notas: as do aparelho + as do servidor, sem repetir */
function all() {
  const byKey = new Map();
  for (const r of remote || []) {
    byKey.set(r.chave || `srv-${r.id}`, {
      key: r.chave || `srv-${r.id}`, chave: r.chave, source: 'qr', mid: r.supermarket_id, store: { name: r.store_name },
      at: r.issued_at, total: r.total == null ? null : Number(r.total), sent: { points: r.points, prices_added: r.prices_added, market_confirmed: r.market_confirmed, status: r.status },
      items: (r.items || []).map((i) => ({ name: i.name, qty: Number(i.qty) || 1, unit_price: Number(i.unit_price) || 0, total: i.total == null ? null : Number(i.total), pid: i.product_id })),
    });
  }
  for (const r of local()) if (!byKey.has(r.key)) byKey.set(r.key, r); else if (r.mid && !byKey.get(r.key).mid) byKey.get(r.key).mid = r.mid;
  return [...byKey.values()].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
}

// ---------------------------------------------------------------- reconhecer
function guess(it) {
  const code = digits(it.code);
  if (code.length >= 8 && validEan(code)) { const p = findByEan(code); if (p) return { pid: p.id, by: 'ean' }; }
  const name = String(it.name || '').replace(/\b(UN|UND|PCT|CX|KG|LT)\b\.?$/i, '').replace(/[.*]/g, ' ');
  const best = match(parse(name), S.products)[0];
  return best && best.id >= 0.6 ? { pid: best.p.id, by: 'nome', score: best.id } : { pid: null };
}

function marketFor(store) {
  const c = digits(store?.cnpj);
  if (c.length >= 8) {
    const st = S.stores.find((s) => digits(s.cnpj) === c);
    if (st) return { mid: st.supermarket_id, sure: true };
    for (const m of S.markets.values()) if ((m.cnpj_raiz || []).includes(c.slice(0, 8))) return { mid: m.id, sure: true };
  }
  const n = ia.strip(store?.name || '');
  for (const m of S.markets.values()) {
    const words = ia.strip(m.name).replace(/supermercados?/g, '').split(/\s+/).filter((w) => w.length > 1);
    if (words.length && words.every((w) => n.includes(w))) return { mid: m.id, sure: false };
  }
  return { mid: null, sure: false };
}

/** quanto custaria cada item hoje no mercado mais barato (só mercados ligados) */
function bestToday(it) {
  const p = productOf(it.pid); if (!p) return null;
  const x = p.prices.filter((y) => isOn(y.market_id))[0] || p.prices[0];
  return x ? { price: x.price, mid: x.market_id } : null;
}
/** onde a compra inteira (itens reconhecidos) sai mais barata hoje */
function wholeBasket(items) {
  const known = items.filter((i) => productOf(i.pid));
  if (!known.length) return null;
  const paid = known.reduce((s, i) => s + i.unit_price * (i.qty || 1), 0);
  const rows = [...S.markets.values()].filter((m) => isOn(m.id)).map((m) => {
    let sum = 0, have = 0;
    for (const i of known) { const x = productOf(i.pid).prices.find((y) => y.market_id === m.id); if (x) { sum += x.price * (i.qty || 1); have++; } else sum += i.unit_price * (i.qty || 1); }
    return { m, sum, have };
  }).filter((r) => r.have >= Math.ceil(known.length * 0.6)).sort((a, b) => a.sum - b.sum);
  return rows[0] ? { paid, best: rows[0], save: paid - rows[0].sum, known: known.length } : null;
}

// ---------------------------------------------------------------- abrir
function openTool(html) {
  $('#toolSheet').dataset.tool = 'nota';
  body().innerHTML = html;
  if ($('#toolSheet').hidden) hooks.openSheet('#toolSheet');
}
const wait = (title, text, icon = ic('receipt')) => openTool(`<div class="tool"><h2 class="sheet__title" id="toolTitle"><span aria-hidden="true">${icon}</span> ${title}</h2>
  <div class="cupom-wait"><span class="cupom-wait__i" aria-hidden="true">${icon}</span><p id="notaWait">${text}</p></div></div>`);
const waitMsg = (t) => { const el = $('#notaWait'); if (el) el.textContent = t; };

function oops(face, title, text, again = true) {
  openTool(`<div class="tool"><div class="verdict is-meh"><span class="verdict__face" aria-hidden="true">${face}</span><b class="verdict__t" id="toolTitle">${title}</b><span class="verdict__l">${text}</span></div>
    <div class="tool__actions">${again ? ('<button class="btn btn--primary btn--xl" data-nota="qr">' + ic('qr') + ' Ler o QR com a câmera</button><button class="btn btn--ghost btn--xl" data-nota="file">' + ic('image') + ' Escolher foto ou PDF</button>') : ''}<button class="btn btn--text" data-close>Fechar</button></div></div>`);
}

export function openQR() {
  scanner.open({ kind: 'qr', demo: api.MODE !== 'live', onCode: readUrl });
  $('#toolTitle') && ($('#toolTitle').innerHTML = ('<span aria-hidden="true">' + ic('receipt') + '</span> Ler a nota fiscal'));
}

export function pickFile() {
  const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*,application/pdf' });
  inp.addEventListener('change', () => inp.files[0] && fromFile(inp.files[0]));
  inp.click();
}

function pasteLink() {
  openTool(`<div class="tool"><h2 class="sheet__title" id="toolTitle"><span aria-hidden="true">${ic('link')}</span> Colar o link da nota</h2>
    <p class="tool__lead">Leia o QR da nota com a câmera do celular, copie o link que aparece e cole aqui.</p>
    <form class="scan__form" id="notaLink" autocomplete="off"><input name="u" inputmode="url" placeholder="https://sistemas.sefaz.am.gov.br/…" aria-label="Link da nota" required /><button class="btn btn--primary">Ler</button></form></div>`);
  $('#notaLink').addEventListener('submit', (e) => { e.preventDefault(); const u = e.target.u.value.trim(); if (/^https?:\/\//i.test(u)) readUrl(u); });
  setTimeout(() => $('#notaLink input')?.focus(), 250);
}

// ---------------------------------------------------------------- ler pelo link do QR (Sefaz)
async function readUrl(url) {
  if (!/^https?:\/\//i.test(url) && url !== 'demo') return oops(ic('question'), 'Esse QR não é de nota fiscal', 'Aponte para o quadradinho que fica no fim da nota do caixa.');
  wait('Lendo a nota…', 'Buscando os itens na Sefaz. Leva alguns segundos.');
  let r;
  try { r = url === 'demo' || api.MODE !== 'live' ? demoReceipt() : await api.readNfce(url); }
  catch (e) {
    const why = {
      offline: [ic('offline'), 'Sem internet agora', 'A nota é lida na Sefaz. Guarde o papel e mande quando o sinal voltar.'],
      sem_funcao: [ic('tool'), 'Função ainda não instalada', 'O administrador precisa publicar a função "nfce" no Supabase.'],
      host: [ic('question'), 'Esse QR não é de nota fiscal', 'Aponte para o quadradinho que fica no fim da nota do caixa.'],
    }[e.code] || [ic('alert'), 'A Sefaz não respondeu', `${esc(e.message || 'Erro')}. Tente de novo em alguns minutos.`];
    return oops(...why);
  }
  review({ key: r.chave || `qr-${Date.now()}`, chave: r.chave, source: 'qr', url: url === 'demo' ? null : url, store: r.store || {}, date: r.date, at: parseDate(r.date)?.toISOString() || new Date().toISOString(), total: r.total, items: r.items || [], demo: r.demo });
}

// ---------------------------------------------------------------- ler foto, print ou PDF
async function fromFile(file) {
  if (file.size > 25e6) return oops(ic('box'), 'Arquivo grande demais', 'Mande uma foto ou PDF com menos de 25 MB.');
  wait('Lendo a nota…', ia.isPdf(file) ? 'Abrindo o PDF…' : 'Procurando o QR da nota na imagem…');
  let pages;
  try { pages = await ia.fileCanvases(file, { maxPages: 3, onPage: (i, n) => waitMsg(`Abrindo a página ${i} de ${n}…`) }); }
  catch (e) { return oops(ic('alert'), 'Não consegui abrir o arquivo', esc(e.message || 'Tente outra foto ou PDF.')); }
  waitMsg('Procurando o QR da nota…');
  for (const cv of pages) {
    const qr = await ia.decodeQR(cv);
    if (qr && /^https?:\/\//i.test(qr.trim())) return readUrl(qr.trim());
  }
  // sem QR: a IA lê os itens da foto (não dá para conferir na Sefaz, então vira "preço informado")
  if (api.MODE === 'live' && !S.user) {
    hooks.closeSheet('#toolSheet');
    return hooks.openAuth('signup', 'Não achei o QR nessa imagem. Crie sua conta para a IA ler a nota pela foto.');
  }
  if (api.MODE !== 'live') return readUrl('demo');
  waitMsg('Não achei o QR. Lendo a nota com IA…');
  try {
    const out = await ia.iaRead('nota', pages.slice(0, 2));
    const r = out.result || {};
    if (!r.legivel || !r.itens?.length) return oops(ic('search'), 'Não deu para ler essa nota', 'Tire outra foto com a nota esticada, bem iluminada e inteira no quadro (principalmente o QR no fim).');
    review({ key: r.chave || `foto-${Date.now()}`, chave: r.chave, source: 'foto', reading: out.reading_id, store: { name: r.loja, cnpj: r.cnpj }, date: r.data, at: parseDate(r.data)?.toISOString() || new Date().toISOString(), total: r.total, items: r.itens });
  } catch (e) { oops(e.code === 'limite' ? ic('hourglass') : ic('alert'), e.code === 'limite' ? 'Limite de hoje atingido' : 'Não consegui ler agora', esc(e.message)); }
}

// ---------------------------------------------------------------- revisar
function review(r) {
  const m = marketFor(r.store);
  const prev = local().find((x) => x.key === r.key) || (remote || []).find((x) => x.chave && x.chave === r.chave);
  cur = { ...r, mid: m.mid, sureMarket: m.sure, items: r.items.map((it, i) => ({ ...it, i, qty: Number(it.qty) || 1, unit_price: Number(it.unit_price) || 0, ...guess(it) })), already: !!prev?.sent };
  track('tool', { query: 'nota', market_id: cur.mid, value: r.total ?? null });
  draw();
}

function itemRow(it) {
  const p = productOf(it.pid); const b = bestToday(it);
  const cheaper = b && b.price < it.unit_price - 0.009 && b.mid !== cur.mid;
  return `<li class="nr ${p ? '' : 'is-off'}" data-i="${it.i}">
    <div class="nr__main"><span class="nr__n">${esc(it.name)}</span>
      ${p ? `<button class="nr__p" data-nota-fix="${it.i}" aria-label="Trocar o produto">${p.emoji || '🛒'} ${esc(pname(p))} <u>trocar</u></button>`
          : `<button class="nr__p is-none" data-nota-fix="${it.i}">${ic('question')} Não reconheci · <u>escolher</u></button>`}
      ${cheaper ? `<small class="nr__tip">${ic('bulb')} hoje ${brl(b.price)} no ${esc(S.markets.get(b.mid)?.name || '')}</small>` : ''}
    </div>
    <span class="nr__v">${it.qty !== 1 ? `<small>${String(it.qty).replace('.', ',')} ×</small>` : ''}<b>${brl(it.unit_price)}</b></span>
  </li>`;
}

function draw() {
  const r = cur; const m = S.markets.get(r.mid);
  const known = r.items.filter((i) => i.pid).length;
  const wb = wholeBasket(r.items);
  const dbl = !!r.mid && S.partners?.has(r.mid) && !isFoto;
  const est = (20 + 2 * known) * (dbl ? 2 : 1);
  const isFoto = r.source === 'foto';
  openTool(`<div class="tool nota">
    <div class="cupom-head">${m ? logo(m, 'md') : ('<span class="nota-ic" aria-hidden="true">' + ic('receipt') + '</span>')}<span><b id="toolTitle">${esc(r.store?.name || m?.name || 'Nota fiscal')}</b><small>${esc(r.date || '')}${r.demo ? ' · nota de exemplo' : ''}${isFoto ? ' · lida pela foto' : ''}</small></span>${r.total != null ? `<em>${brl(Number(r.total))}</em>` : ''}</div>

    ${!r.sureMarket ? `<div class="nota-mk"><b>Em qual mercado foi esta compra?</b>
      <div class="chips chips--wrap" role="radiogroup">${[...S.markets.values()].map((x) => `<button class="chip ${x.id === r.mid ? 'is-on' : ''}" role="radio" aria-checked="${x.id === r.mid}" data-nota-mk="${x.id}">${logo(x, 'xs')} ${esc(x.name)}</button>`).join('')}</div></div>` : ''}

    <div class="nota-sum"><span><b>${known}</b> de ${r.items.length} itens reconhecidos</span>${known < r.items.length ? '<small>Toque em “escolher” para ajudar o site a aprender.</small>' : ''}</div>

    ${wb && wb.save > 0.5 && wb.best.m.id !== r.mid ? `<div class="nota-tip">${ic('coins')} Estes ${wb.known} itens hoje sairiam <b>${brl(wb.save)} mais baratos</b> no ${logo(wb.best.m, 'xs')} <b>${esc(wb.best.m.name)}</b>.</div>`
      : wb ? ('<div class="nota-tip is-good">' + ic('good') + ' Boa! Você comprou no mercado mais barato para estes itens.</div>') : ''}

    <ul class="nota-list">${r.items.map(itemRow).join('')}</ul>

    <div class="tool__actions">
      ${r.already ? '<p class="ok-box">✓ Você já enviou esta nota. Ela está em Minhas notas.</p>'
        : `<button class="btn btn--primary btn--xl" data-nota="send" ${!r.mid ? 'disabled' : ''}>${ic('send')} ${isFoto ? 'Enviar os preços' : 'Enviar nota'} e ganhar ${isFoto ? 'pontos' : `até +${Math.min(dbl ? 300 : 150, est)} pts`}</button>
           ${dbl ? `<p class="ok-box small center">${ic('star')} <b>Pontos em dobro:</b> o ${esc(m?.name || 'mercado')} é parceiro do Tá Barato Mesmo?.</p>` : ''}
           <p class="muted small center">${!r.mid ? 'Escolha o mercado acima para enviar.' : isFoto ? 'Sem o QR, os preços passam pela confirmação da comunidade.' : `Você ganha pontos e +10 comparações. O site atualiza ${known} ${known === 1 ? 'preço' : 'preços'} com a data da compra.`}</p>`}
      <button class="btn btn--ghost btn--block" data-nota="keep">${ic('save')} Só guardar no meu controle de gastos</button>
    </div>
  </div>`);
}

// trocar / escolher o produto de um item
function fixItem(i) {
  const it = cur.items.find((x) => x.i === i); if (!it) return;
  const li = $(`.nr[data-i="${i}"]`); if (!li) return;
  li.classList.add('is-fixing');
  li.insertAdjacentHTML('beforeend', `<div class="nr-fix"><input type="search" placeholder="Qual é o produto? Ex.: arroz tio joão 5kg" value="" aria-label="Buscar produto" />
    <ul class="nr-res"></ul><button class="btn btn--text btn--sm" data-nota-none="${i}">Não está no site</button></div>`);
  const inp = $('input', li), res = $('.nr-res', li);
  const show = (q) => {
    const list = q.trim().length >= 2 ? match(parse(q), S.products, { limit: 6 }).map((x) => x.p) : match(parse(it.name), S.products, { limit: 6 }).map((x) => x.p);
    res.innerHTML = list.map((p) => `<li><button data-nota-set="${i}:${p.id}">${p.emoji || '🛒'} ${esc(pname(p))}</button></li>`).join('') || '<li class="muted small">Nada encontrado.</li>';
  };
  inp.addEventListener('input', () => show(inp.value)); show('');
  inp.focus();
}

// ---------------------------------------------------------------- enviar
function remember(extra = {}) {
  api.store.del?.('tb.nfPending');
  const r = cur; const list = local().filter((x) => x.key !== r.key);
  list.unshift({ key: r.key, chave: r.chave || null, source: r.source, url: r.url || null, store: { name: r.store?.name || null, cnpj: r.store?.cnpj || null }, date: r.date, at: r.at, total: r.total == null ? null : Number(r.total), mid: r.mid,
    items: r.items.map((i) => ({ name: i.name, code: i.code || null, qty: i.qty, unit_price: i.unit_price, total: i.total ?? null, pid: i.pid || null })), savedAt: new Date().toISOString(), ...extra });
  saveLocal(list);
}

async function send(btn) {
  const r = cur;
  if (api.MODE === 'live' && !S.user) { remember(); hooks.closeSheet('#toolSheet'); return hooks.openAuth('signup', 'Sua nota ficou guardada no aparelho. Crie sua conta para enviar e ganhar pontos.'); }
  btn.disabled = true; btn.textContent = 'Enviando…';
  try {
    if (r.source === 'foto') return await sendFoto(btn);
    const matches = r.items.filter((i) => i.pid).map((i) => ({ i: i.i, product_id: i.pid }));
    const out = await api.saveNfce(r.url || 'demo', matches, r.mid);
    const sv = out.saved || {};
    remember({ sent: { points: sv.points || 0, prices_added: sv.prices_added || 0, market_confirmed: sv.market_confirmed, status: sv.market_confirmed ? 'verificada' : 'pendente' } });
    remoteFor = null; // recarrega a lista do servidor
    done(sv);
  } catch (e) {
    if (e.code === 'duplicada') { remember({ sent: { points: 0, dup: true } }); return oops(ic('receipt'), 'Esta nota já foi enviada', 'Outra pessoa mandou esta mesma nota antes. Ela ficou no seu controle de gastos, mas sem pontos.', false); }
    btn.disabled = false; btn.textContent = 'Tentar enviar de novo';
    hooks.toast?.(e.message || 'Não consegui enviar agora.', 'warn');
  }
}

async function sendFoto(btn) {
  const r = cur; const fresh = r.at && Date.now() - new Date(r.at) < 3 * 864e5;
  let ok = 0, pts = 0;
  if (fresh) for (const it of r.items.filter((i) => i.pid && i.unit_price > 0)) {
    try { const o = await api.reportPrice({ product_id: it.pid, supermarket_id: r.mid, price: Math.round(it.unit_price * 100) / 100, note: 'nota fiscal (foto)' }); ok++; pts += o.points || 0; } catch { /* fora do normal: segue */ }
  }
  remember({ sent: { points: pts, prices_added: 0, reports: ok, status: 'pendente' } });
  done({ points: pts, reports: ok, foto: true, old: !fresh });
  hooks.afterContribution?.();
}

function done(sv) {
  const lvlUp = !S.profile?.completed_at && S.user;
  openTool(`<div class="tool"><div class="fx-done">
    <p class="fx-done__pts">+${sv.points || 0} pts</p>
    <h2 class="sheet__title" id="toolTitle">${sv.foto ? 'Preços enviados!' : 'Nota enviada!'}</h2>
    <ul class="nota-done">
      ${sv.foto ? `<li>${ic('send')} <span><b>${sv.reports || 0}</b> preços foram para a confirmação da comunidade</span></li>${sv.old ? ('<li>' + ic('calendar') + ' <span>A nota tem mais de 3 dias: os preços ficaram só no seu controle de gastos.</span></li>') : ''}`
        : `<li>${ic('good')} <span><b>${sv.prices_added || 0}</b> ${sv.prices_added === 1 ? 'preço atualizado' : 'preços atualizados'} no site com a data da sua compra</span></li>
           ${sv.stale_updated ? `<li>⏱️ <span>${sv.stale_updated} estavam desatualizados: você ajudou muita gente!</span></li>` : ''}
           ${sv.market_confirmed === false ? ('<li>' + ic('search') + ' <span>Ainda não conhecemos o CNPJ desta loja: os preços entram assim que confirmarmos o mercado.</span></li>') : ''}
           ${sv.old ? ('<li>' + ic('calendar') + ' <span>Nota com mais de 30 dias: guardada no histórico, sem atualizar preços.</span></li>') : ''}
           ${lvlUp ? ('<li>' + ic('unlock') + ' <span><b>+10 comparações</b> liberadas para você</span></li>') : ''}`}
      ${sv.partner_bonus ? `<li>${ic('star')} <span><b>Pontos em dobro</b>: nota de mercado parceiro</span></li>` : ''}
      ${sv.coupon_used ? `<li>${ic('ticket')} <span>Seu cupom <b>${esc(sv.coupon_used.code)}</b> (${brl(Number(sv.coupon_used.value))}) foi comprovado por esta nota</span></li>` : ''}
      <li>${ic('chart')} <span>A compra entrou no seu <b>controle de gastos</b></span></li>
    </ul>
    <div class="tool__actions"><a class="btn btn--primary btn--xl" href="#notas" data-close>Ver minhas notas</a>
      <button class="btn btn--ghost btn--block" data-nota="qr">${ic('receipt')} Mandar outra nota</button></div>
  </div></div>`);
  hooks.afterContribution?.();
  if (location.hash === '#notas') render();
}

function keep() {
  remember(); hooks.closeSheet('#toolSheet');
  hooks.toast?.('Nota guardada no seu controle de gastos.');
  if (location.hash === '#notas') render(); else location.hash = '#notas';
}

// ---------------------------------------------------------------- página
function monthKey(d) { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; }
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const totalOf = (r) => (r.total != null ? Number(r.total) : r.items.reduce((s, i) => s + (i.total ?? i.unit_price * (i.qty || 1)), 0));

function stats(list) {
  const now = new Date(); const thisM = monthKey(now);
  const months = []; for (let k = 5; k >= 0; k--) { const d = new Date(now.getFullYear(), now.getMonth() - k, 1); months.push({ key: monthKey(d), label: MES[d.getMonth()], v: 0 }); }
  const byMarket = new Map(), byCat = new Map(), freq = new Map();
  let monthTotal = 0, monthSave = 0, points = 0;
  for (const r of list) {
    const t = totalOf(r); const mk = r.at ? monthKey(r.at) : null;
    const mo = months.find((x) => x.key === mk); if (mo) mo.v += t;
    points += r.sent?.points || 0;
    if (mk === thisM) {
      monthTotal += t;
      byMarket.set(r.mid || 0, (byMarket.get(r.mid || 0) || 0) + t);
      for (const it of r.items) {
        const p = productOf(it.pid); const v = it.total ?? it.unit_price * (it.qty || 1);
        const cat = p?.category_name || 'Outros'; byCat.set(cat, (byCat.get(cat) || 0) + v);
        const b = bestToday(it); if (b && b.price < it.unit_price) monthSave += (it.unit_price - b.price) * (it.qty || 1);
      }
    }
    for (const it of r.items) if (it.pid) {
      const f = freq.get(it.pid) || { n: 0, last: null, lastAt: 0, mid: null };
      f.n++; const at = new Date(r.at || 0).getTime(); if (at >= f.lastAt) { f.lastAt = at; f.last = it.unit_price; f.mid = r.mid; }
      freq.set(it.pid, f);
    }
  }
  const usual = [...freq].filter(([pid, f]) => f.n >= 2 && productOf(pid)).sort((a, b) => b[1].n - a[1].n).slice(0, 8)
    .map(([pid, f]) => ({ p: productOf(pid), ...f, best: bestToday({ pid }) }));
  return { months, monthTotal, monthSave, points, byMarket, byCat, usual };
}

const bars = (rows, fmt = brl) => {
  const max = Math.max(...rows.map((r) => r.v), 1);
  return `<ul class="nbars">${rows.map((r) => `<li><span class="nbars__l">${r.label}</span><span class="nbars__t"><span style="--w:${r.v ? Math.max(3, (r.v / max) * 100) : 0}%"></span></span><b>${r.v ? fmt(r.v) : '–'}</b></li>`).join('')}</ul>`;
};

export function render() {
  const el = $('#notasView'); if (!el) return;
  if (S.user && remoteFor !== S.user.id) {
    remoteFor = S.user.id;
    api.myReceipts().then((r) => { remote = r; if (location.hash === '#notas') render(); }).catch(() => { remote = []; });
  }
  if (!S.user) remote = null;
  const list = all(); const st = stats(list);
  el.innerHTML = `
  <header class="page-head notas-head">
    <h1>${ic('receipt')} Minhas notas</h1>
    <p class="muted">Mande a nota da compra: seus gastos se organizam sozinhos e você ganha pontos.</p>
  </header>

  ${pendingCard()}
  <section class="notas-cta">
    <button class="notas-btn is-main" data-nota="qr"><span aria-hidden="true">${ic('qr')}</span><b>Ler o QR da nota</b><small>Com a câmera, na hora</small></button>
    <button class="notas-btn" data-nota="file"><span aria-hidden="true">${ic('image')}</span><b>Foto, print ou PDF</b><small>Da galeria ou do e-mail</small></button>
    <button class="notas-btn" data-nota="link"><span aria-hidden="true">${ic('link')}</span><b>Colar o link</b><small>Do QR lido em outro app</small></button>
  </section>

  <details class="more">
  <summary>O que você ganha com cada nota ${ic('down')}</summary>
  <section class="notas-why" aria-label="O que você ganha">
    <div><span aria-hidden="true">${ic('star')}</span><b>20 a 150 pontos</b><small>por nota, mais se os preços estavam velhos</small></div>
    <div><span aria-hidden="true">${ic('unlock')}</span><b>+10 comparações</b><small>a cada nota, para quem tem cadastro rápido</small></div>
    <div><span aria-hidden="true">${ic('chart')}</span><b>Gastos organizados</b><small>por mês, mercado e categoria, sem digitar nada</small></div>
    <div><span aria-hidden="true">${ic('coins')}</span><b>Onde sairia mais barato</b><small>e aviso dos produtos que você compra sempre</small></div>
  </section>
  <p class="muted small">Os preços da sua nota também ajudam o site a mostrar valores de verdade, na data e no mercado certos.</p>
  </details>

  ${!list.length ? `<div class="notas-empty"><span aria-hidden="true">${ic('receipt')}</span><p><b>Nenhuma nota ainda.</b> Na próxima compra, guarde a nota e leia o QR que fica no fim dela.</p></div>` : `
  <div class="notas-grid">
    <section class="save-hero notas-hero">
      <span class="save-hero__k">Gasto em ${MES[new Date().getMonth()]} (notas enviadas)</span>
      <span class="save-hero__v">${brl(st.monthTotal)}</span>
      <span class="save-hero__sub">${st.monthSave > 0.5 ? `Dava para economizar <b>${brl(st.monthSave)}</b> comprando cada item onde está mais barato hoje.` : 'Você está comprando bem: quase tudo no menor preço.'}</span>
      <div class="proj"><span>${ic('star')} ${st.points} pontos com notas · ${list.length} ${list.length === 1 ? 'nota' : 'notas'}</span></div>
    </section>
    <section class="panel"><div class="panel__head"><h2>Últimos 6 meses</h2></div>${bars(st.months.map((m) => ({ label: m.label, v: m.v })))}</section>
    ${st.byMarket.size ? `<section class="panel"><div class="panel__head"><h2>Por mercado (este mês)</h2></div>${bars([...st.byMarket].sort((a, b) => b[1] - a[1]).map(([mid, v]) => ({ label: S.markets.get(mid) ? `${logo(S.markets.get(mid), 'xs')} ${esc(S.markets.get(mid).name)}` : 'Outro', v })))}</section>` : ''}
    ${st.byCat.size ? `<section class="panel"><div class="panel__head"><h2>Por categoria (este mês)</h2></div>${bars([...st.byCat].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([c, v]) => ({ label: esc(c), v })))}</section>` : ''}
  </div>

  ${st.usual.length ? `<section class="panel notas-usual"><div class="panel__head"><h2>O que você sempre compra</h2><small class="muted">toque na ${ic('star')} para ser avisado quando baixar</small></div>
    <ul>${st.usual.map((u) => { const cheaper = u.best && u.best.price < u.last - 0.009; return `<li>
      <button class="nu__p" data-open-product="${u.p.id}">${u.p.emoji || '🛒'} <span><b>${esc(pname(u.p))}</b><small>comprou ${u.n}× · última vez ${brl(u.last)}</small></span></button>
      <span class="nu__b ${cheaper ? 'is-cheaper' : ''}">${u.best ? `<small>${cheaper ? 'hoje' : 'menor hoje'}</small><b>${brl(u.best.price)}</b><small>${esc(S.markets.get(u.best.mid)?.name || '')}</small>` : ''}</span>
      <button class="nu-fav ${S.favs.has(u.p.id) ? 'is-on' : ''}" data-fav="${u.p.id}" aria-pressed="${S.favs.has(u.p.id)}" aria-label="Avisar quando baixar">${ic('star')}</button></li>`; }).join('')}</ul></section>` : ''}

  <section class="panel"><div class="panel__head"><h2>Notas</h2></div>
    <ul class="notas-list">${list.slice(0, 60).map((r) => { const m = S.markets.get(r.mid); const t = totalOf(r); return `<li><details>
      <summary>${m ? logo(m, 'sm') : ('<span class="nota-ic">' + ic('receipt') + '</span>')}<span><b>${esc(m?.name || r.store?.name || 'Nota')}</b><small>${fmtDate(r.at ? new Date(r.at) : null)} · ${r.items.length} itens${r.sent?.points ? ` · +${r.sent.points} pts` : r.sent?.dup ? ' · já enviada por outra pessoa' : r.sent ? '' : ' · <i>não enviada</i>'}</small></span><em>${brl(t)}</em></summary>
      <ul class="nl-items">${r.items.map((i) => { const p = productOf(i.pid); const b = bestToday(i); return `<li><span>${esc(p ? pname(p) : i.name)}</span><span>${i.qty !== 1 ? `${String(i.qty).replace('.', ',')} × ` : ''}${brl(i.unit_price)}${b && b.price < i.unit_price - 0.009 ? ` <small class="down">hoje ${brl(b.price)}</small>` : ''}</span></li>`; }).join('')}</ul>
      ${!r.sent && r.url ? `<button class="btn btn--sm btn--primary" data-nota-resend="${esc(r.key)}">${ic('send')} Enviar e ganhar pontos</button>` : ''}
    </details></li>`; }).join('')}</ul>
  </section>`}
  <p class="muted small center notas-priv">${ic('lock')} Guardamos só o que está na nota (loja, data, itens e preços). Não pedimos nem guardamos o seu CPF.</p>`;
}

// compra fechada na calculadora/carrinho que ainda não teve a nota enviada
function pendingCard() {
  const p = api.store.get('tb.nfPending', null);
  if (!p || Date.now() - new Date(p.at) > 10 * 864e5) return '';
  const m = S.markets.get(p.market);
  return `<section class="nf-pend"><span aria-hidden="true">${ic('receipt')}</span><div><b>Falta a nota da sua compra de ${brl(p.paid ?? p.total)}</b>
    <small>${m ? `${esc(m.name)} · ` : ''}${new Date(p.at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}${p.paid != null && Math.abs(p.paid - p.total) >= 0.01 ? ` · sua conta deu ${brl(p.total)}, o caixa cobrou ${brl(p.paid)}` : ''}. Mande a nota para conferir item por item e organizar o seu rancho.</small></div>
    <button class="btn btn--primary btn--sm" data-nota="qr">Mandar agora</button><button class="nf-pend__x" data-nota="nopend" aria-label="Dispensar">✕</button></section>`;
}

// ---------------------------------------------------------------- nota de exemplo (demonstração)
function demoReceipt() {
  const mid = [...S.markets.keys()][0];
  const its = S.products.filter((p) => p.prices.some((x) => x.market_id === mid)).slice(0, 7).map((p, i) => {
    const pr = p.prices.find((x) => x.market_id === mid).price;
    return { name: ia.strip(`${p.name} ${p.brand || ''} ${p.unit || ''}`).toUpperCase().slice(0, 38), code: p.ean || null, qty: i === 2 ? 2 : 1, unit: 'UN', unit_price: pr, total: Math.round(pr * (i === 2 ? 2 : 1) * 100) / 100 };
  });
  its.push({ name: 'SACOLA PLASTICA', qty: 1, unit: 'UN', unit_price: 0.1, total: 0.1 });
  const m = S.markets.get(mid);
  return { demo: true, chave: null, store: { name: (m?.name || 'Supermercado').toUpperCase() + ' LTDA', cnpj: null }, date: new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).replace(',', ''),
    total: Math.round(its.reduce((s, i) => s + i.total, 0) * 100) / 100, items: its };
}

// ---------------------------------------------------------------- eventos
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-nota], [data-nota-fix], [data-nota-set], [data-nota-none], [data-nota-mk], [data-nota-resend]'); if (!t) return;
  const d = t.dataset;
  if (d.nota === 'qr') return openQR();
  if (d.nota === 'file') return pickFile();
  if (d.nota === 'link') return pasteLink();
  if (d.nota === 'send') return send(t);
  if (d.nota === 'keep') return keep();
  if (d.nota === 'nopend') { api.store.del('tb.nfPending'); return render(); }
  if (d.notaFix) return fixItem(Number(d.notaFix));
  if (d.notaSet) { const [i, pid] = d.notaSet.split(':').map(Number); const it = cur.items.find((x) => x.i === i); if (it) { it.pid = pid; it.by = 'usuario'; } return draw(); }
  if (d.notaNone) { const it = cur.items.find((x) => x.i === Number(d.notaNone)); if (it) it.pid = null; return draw(); }
  if (d.notaMk) { cur.mid = Number(d.notaMk); return draw(); }
  if (d.notaResend) {
    const r = local().find((x) => x.key === d.notaResend); if (!r) return;
    cur = { ...r, sureMarket: !!r.mid, items: r.items.map((it, i) => ({ ...it, i })) };
    return draw();
  }
});
