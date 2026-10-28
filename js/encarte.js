// Importar encarte com IA (admin master e portal do supermercado).
// Fotos ou PDF do folheto → a IA lê cada página → o sistema acha cada produto no catálogo
// (código de barras, nome, marca e tamanho) → a pessoa revisa só o que tem dúvida → publica:
//   • "de/por" vira promoção com a validade do encarte
//   • preço normal atualiza o preço do mercado
//   • produto que não existe é criado na categoria sugerida
import * as api from './api.js';
import { $, $$, esc, brl, logo } from './core.js';
import { parse, match } from './voice.js';
import * as ia from './ia.js';
import * as off from './offline.js';

// O encarte em andamento não se perde ao trocar de tela nem ao recarregar a página:
// fica na memória (com as páginas abertas) e guardado no aparelho (sem as imagens grandes), por 7 dias.
let E = null; // estado da tela aberta
const SESSIONS = new Map(); // escopo ("admin" ou "mk:<id>") → estado
const KEEP_MS = 7 * 864e5;
const keyOf = (opts) => `encarte:${opts.demo ? 'demo:' : ''}${opts.fixedMarket ? 'mk:' + opts.fixedMarket : 'admin'}`;
const pname = (p) => [p.name, p.brand, p.unit].filter(Boolean).join(' ');
const fmt = (v) => (v == null ? '' : String(v.toFixed(2)).replace('.', ','));

/** "5kg" → "5 kg", "1L" → "1 L", "kg" → "1 kg", "12un" → "12 un" */
export function normUnit(t, porKg = false) {
  if (porKg && (!t || /^\s*kg\s*$/i.test(t))) return '1 kg';
  if (!t) return '';
  const m = String(t).replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(kg|g|mg|l|lt|ml|un|und|unid|rolos?|m)\b/i);
  if (!m) return String(t).trim();
  const u = { lt: 'L', l: 'L', und: 'un', unid: 'un', rolo: 'rolos' }[m[2].toLowerCase()] || m[2].toLowerCase();
  return `${String(Number(m[1])).replace('.', ',')} ${u}`;
}

/**
 * Monta a tela dentro de `el`.
 * opts: { markets, fixedMarket, categories, apply(mid, rows, starts, ends, file), toast, demo }
 */
export async function mount(el, opts) {
  const key = keyOf(opts);
  E = SESSIONS.get(key) || await restore(key) || { key, mid: opts.fixedMarket ?? null, pages: [], rows: [], filter: 'all', starts: '', ends: '', hint: '', fileNames: [], catalog: null, busy: false, result: '' };
  E.el = el; E.opts = opts; E.key = key;
  SESSIONS.set(key, E);
  el.innerHTML = `
    <header class="pt-head"><div><h1>Importar encarte com IA</h1>
      <p class="muted">Envie as fotos ou o PDF do encarte. A IA lê cada produto e preço, o sistema acha no catálogo e você só revisa o que estiver em dúvida antes de publicar.</p></div></header>
    <section class="panel en-setup">
      <div class="en-row">
        ${opts.fixedMarket ? '' : `<label class="en-f">Supermercado<select id="enMk"><option value="">Detectar pelo encarte…</option>${opts.markets.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></label>`}
        <label class="en-f">Válido de<input type="date" id="enStart" /></label>
        <label class="en-f">até<input type="date" id="enEnd" /></label>
      </div>
      <label class="drop en-drop" id="enDrop"><input type="file" id="enFiles" accept="image/*,application/pdf" multiple hidden />
        <span class="en-drop__i" aria-hidden="true">🗞️</span><b>Arraste o encarte aqui</b><span class="muted small">Fotos (JPG, PNG) ou PDF, várias páginas de uma vez</span></label>
      <details class="en-hint"><summary>Dica para a IA (opcional)</summary><input id="enHint" maxlength="200" placeholder="Ex.: preços com cartão Clube valem só para associados" /></details>
      <div id="enSaved"></div>
      <div id="enPages" class="en-pages"></div>
    </section>
    <section id="enReview"></section>`;
  const drop = $('#enDrop', el), inp = $('#enFiles', el);
  inp.addEventListener('change', () => inp.files.length && start([...inp.files]));
  ['dragover', 'dragenter'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', (e) => e.dataTransfer.files.length && start([...e.dataTransfer.files]));
  $('#enMk', el)?.addEventListener('change', (e) => { E.mid = e.target.value ? Number(e.target.value) : null; rematchPrices(); drawReview(); });
  $('#enStart', el).addEventListener('change', (e) => { E.starts = e.target.value; persist(); });
  $('#enEnd', el).addEventListener('change', (e) => { E.ends = e.target.value; persist(); });
  $('#enHint', el).addEventListener('change', (e) => { E.hint = e.target.value; persist(); });
  // devolve à tela o que já estava em andamento
  if ($('#enMk', el) && E.mid) $('#enMk', el).value = E.mid;
  $('#enStart', el).value = E.starts || ''; $('#enEnd', el).value = E.ends || ''; $('#enHint', el).value = E.hint || '';
  if (E.hint) $('.en-hint', el).open = true;
  drawSaved();
  if (E.pages.length) drawPages();
  if (E.rows.length) drawReview();
  if (E.result) $('#enReview', el).insertAdjacentHTML('afterbegin', E.result);
  if (!E.catalog) api.loadCatalog().then((c) => { E.catalog = c.products; if (E.rows.length) drawReview(); }).catch(() => { E.catalog = []; });
}

// ---------------------------------------------------------------- guardar e recuperar
async function restore(key) {
  try {
    const r = await off.read(key); const v = r?.value;
    if (!v || Date.now() - Date.parse(v.at) > KEEP_MS || (!v.pages?.length && !v.rows?.length)) return null;
    return { ...v, key, catalog: null, busy: false, restoredAt: v.at,
      // as imagens grandes não ficam guardadas: página que não terminou de ler precisa do arquivo de novo
      pages: v.pages.map((p) => (p.status === 'ok' ? p : { ...p, status: 'erro', err: 'envie o arquivo de novo para ler esta página' })) };
  } catch { return null; }
}
let persistT = null;
function persist() {
  if (!E) return;
  const st = E; clearTimeout(persistT);
  persistT = setTimeout(() => {
    const v = { at: new Date().toISOString(), mid: st.mid, starts: st.starts, ends: st.ends, hint: st.hint, filter: st.filter, fileNames: st.fileNames, result: st.result,
      rows: st.rows, pages: st.pages.map(({ cv, ...p }) => p) };
    off.save(st.key, v);
  }, 400);
}
function drawSaved() {
  const box = $('#enSaved', E.el); if (!box) return;
  const has = E.pages.length || E.rows.length;
  box.innerHTML = has ? `<div class="en-saved"><span>🗂️ ${E.restoredAt ? `Encarte em andamento, guardado em ${new Date(E.restoredAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'Encarte em andamento'}: ${E.pages.length} páginas, ${E.rows.length} itens${E.fileNames?.length ? ` (${esc(E.fileNames.join(', ').slice(0, 80))})` : ''}. Pode enviar mais páginas.</span>
    <button class="btn btn--ghost btn--sm" data-en-reset ${E.busy ? 'disabled' : ''}>Começar outro encarte</button></div>` : '';
}
async function reset() {
  if (E.busy) return;
  SESSIONS.delete(E.key); clearTimeout(persistT);
  await off.save(E.key, null);
  mount(E.el, E.opts);
}

// ---------------------------------------------------------------- ler as páginas
async function start(files) {
  if (E.busy) return;
  const ok = files.filter((f) => ia.isPdf(f) || f.type.startsWith('image/'));
  if (!ok.length) return E.opts.toast('Envie fotos ou PDF do encarte.', 'warn');
  E.busy = true; E.fileNames = [...(E.fileNames || []), ...ok.map((f) => f.name)];
  E.result = ''; drawSaved();
  const box = $('#enPages', E.el);
  box.innerHTML = '<p class="muted small">Abrindo os arquivos…</p>';
  const pages = [];
  for (const f of ok) {
    try {
      const cvs = await ia.fileCanvases(f, { maxPages: 30, scale: 2, max: 2200, onPage: (i, n) => (box.innerHTML = `<p class="muted small">Abrindo ${esc(f.name)}: página ${i} de ${n}…</p>`) });
      cvs.forEach((cv, i) => pages.push({ cv, thumb: ia.toCanvas(cv, 160).toDataURL('image/jpeg', 0.6), name: cvs.length > 1 ? `${f.name} · p.${i + 1}` : f.name, status: 'fila', items: [] }));
    } catch (e) { E.opts.toast(`Não abri ${f.name}: ${e.message}`, 'warn'); }
  }
  const first = E.pages.length;
  E.pages.push(...pages);
  drawPages();
  if (!E.catalog) E.catalog = (await api.loadCatalog().catch(() => ({ products: [] }))).products;
  // 2 páginas por vez: mais rápido sem estourar o limite da IA
  let next = first;
  const worker = async () => { while (next < E.pages.length) { const i = next++; await readPage(i); } };
  await Promise.all([worker(), worker()]);
  E.busy = false;
  drawSaved(); drawReview(); persist();
}

async function readPage(i) {
  const pg = E.pages[i];
  if (!pg.cv) return E.opts.toast('Esta página não está mais aberta: envie o arquivo de novo.', 'warn');
  pg.status = 'lendo'; drawPages();
  try {
    const out = E.opts.demo ? await demoRead(pg) : await ia.iaRead('encarte', [pg.cv], {
      supermarket_id: E.mid, page: i + 1, hint: E.hint || $('#enHint', E.el)?.value || '', categories: E.opts.categories.map((c) => c.slug),
    });
    const r = out.result || {};
    pg.items = r.itens || []; pg.status = 'ok'; pg.truncated = out.truncated;
    if (r.validade_inicio && !E.starts) { E.starts = r.validade_inicio; const x = $('#enStart', E.el); if (x) x.value = r.validade_inicio; }
    if (r.validade_fim && !E.ends) { E.ends = r.validade_fim; const x = $('#enEnd', E.el); if (x) x.value = r.validade_fim; }
    if (r.supermercado && !E.mid) {
      const n = ia.strip(r.supermercado);
      const m = E.opts.markets.find((x) => { const w = ia.strip(x.name).replace(/supermercados?/g, '').trim(); return w && n.includes(w); });
      if (m) { E.mid = m.id; const s = $('#enMk', E.el); if (s) s.value = m.id; }
    }
    for (const it of pg.items) {
      const r = rowFrom(it, i);
      // o mesmo produto com o mesmo preço em outra página: fica um só
      const same = E.rows.find((x) => x.preco === r.preco && (r.pid ? x.pid === r.pid : ia.strip(`${x.nome} ${x.marca} ${x.unidade}`) === ia.strip(`${r.nome} ${r.marca} ${r.unidade}`)));
      if (!same) E.rows.push(r);
    }
  } catch (e) { pg.status = 'erro'; pg.err = e.message; }
  drawPages(); drawReview(); persist();
}

function drawPages() {
  const box = $('#enPages', E.el); if (!box) return;
  const done = E.pages.filter((p) => p.status === 'ok').length;
  box.innerHTML = `<p class="en-prog"><b>${done} de ${E.pages.length}</b> páginas lidas · ${E.rows.length} itens encontrados</p>
    <ul class="en-pgl">${E.pages.map((p, i) => `<li class="is-${p.status}">${p.thumb ? `<img src="${p.thumb}" alt="" />` : '<span class="en-nothumb" aria-hidden="true">🗞️</span>'}
      <span><b>${esc(p.name)}</b><small>${{ fila: 'na fila', lendo: 'lendo…', ok: `${p.items.length} itens${p.truncated ? ' (página muito cheia: confira)' : ''}`, erro: esc(p.err || 'erro') }[p.status]}</small></span>
      ${p.status === 'erro' && p.cv ? `<button class="btn btn--sm btn--ghost" data-en-retry="${i}">Tentar de novo</button>` : ''}</li>`).join('')}</ul>`;
}

// ---------------------------------------------------------------- casar com o catálogo
function rowFrom(it, page) {
  const unidade = normUnit(it.tamanho, it.por_kg);
  const r = { k: Math.random().toString(36).slice(2, 9), page, ai: it, include: true, pid: null, mode: 'match',
    nome: it.nome, marca: it.marca || '', unidade, categoria: it.categoria || 'mercearia', ean: it.ean || null,
    preco: it.preco, preco_de: it.preco_de || null, oferta: it.oferta || null, cands: [], score: 0 };
  findProduct(r);
  return r;
}

function findProduct(r) {
  const P = E.catalog || [];
  if (r.ean) { const k = r.ean.replace(/^0+/, ''); const p = P.find((x) => x.ean && x.ean.replace(/^0+/, '') === k); if (p) { r.pid = p.id; r.score = 1; r.cands = [p.id]; return; } }
  const res = match(parse([r.nome, r.marca, r.unidade].filter(Boolean).join(' ')), P, { limit: 5 });
  r.cands = res.map((x) => x.p.id);
  const best = res[0];
  if (best && best.id >= 0.7 && best.sizeOk !== false) { r.pid = best.p.id; r.score = best.score; }
  else if (!best || best.id < 0.5) { r.mode = 'new'; }
  else { r.pid = null; r.score = best.score; } // em dúvida: pede revisão
}

const prodOf = (id) => (E.catalog || []).find((p) => p.id === id);
function currentPrice(r) {
  const p = prodOf(r.pid); if (!p || !E.mid) return null;
  const x = p.prices.find((y) => y.market_id === E.mid); return x ? (x.regular ?? x.price) : null;
}
function flags(r) {
  const f = [];
  if ((r.ai.confianca ?? 1) < 0.75) f.push('IA em dúvida');
  if (r.ai.preco_condicional) f.push('preço condicional');
  if (r.mode === 'match' && !r.pid) f.push('escolha o produto');
  const cur = currentPrice(r); const ref = r.preco_de || r.preco;
  if (cur && (ref > cur * 1.45 || ref < cur * 0.55)) f.push('muito diferente do atual');
  if (r.mode === 'new' && !r.unidade) f.push('sem tamanho');
  return f;
}
function rematchPrices() { /* preço atual depende do mercado: só redesenha */ }

// ---------------------------------------------------------------- revisão
function drawReview() {
  const box = $('#enReview', E.el); if (!box) return;
  if (!E.rows.length) { box.innerHTML = ''; persist(); return; }
  const R = E.rows;
  const need = R.filter((r) => r.include && flags(r).length);
  const isNew = R.filter((r) => r.mode === 'new'), promo = R.filter((r) => r.preco_de);
  const list = { all: R, need, new: isNew, promo }[E.filter] || R;
  const sel = R.filter((r) => r.include && (r.mode === 'new' || r.pid));
  box.innerHTML = `<section class="panel en-rev">
    <div class="panel__head"><h2>Revisar ${R.length} itens</h2>
      <div class="chips">${[['all', `Todos ${R.length}`], ['need', `Revisar ${need.length}`], ['new', `Novos ${isNew.length}`], ['promo', `De/por ${promo.length}`]].map(([k, l]) => `<button class="chip ${E.filter === k ? 'is-on' : ''}" data-en-f="${k}">${l}</button>`).join('')}</div></div>
    ${!E.mid ? '<p class="note">Escolha o supermercado lá em cima para ver o preço atual e publicar.</p>' : ''}
    <div class="tbl-wrap"><table class="tbl en-tbl"><thead><tr><th><input type="checkbox" data-en-all ${R.every((r) => r.include) ? 'checked' : ''} aria-label="Marcar todos" /></th><th>Lido no encarte</th><th>Produto no site</th><th class="r">Preço</th><th class="r">De</th><th class="r">Atual</th></tr></thead>
    <tbody>${list.map(rowHTML).join('') || '<tr><td colspan="6" class="muted center" style="padding:20px">Nada neste filtro. 👍</td></tr>'}</tbody></table></div>
    <div class="en-go">
      <p class="small"><b>${sel.length}</b> itens serão publicados: ${sel.filter((r) => r.preco_de).length} promoções, ${sel.filter((r) => r.mode === 'new').length} produtos novos${E.starts || E.ends ? `, válidos ${E.starts ? 'de ' + E.starts.split('-').reverse().join('/') : ''} ${E.ends ? 'até ' + E.ends.split('-').reverse().join('/') : ''}` : ''}.</p>
      <button class="btn btn--primary" data-en-apply ${!E.mid || !sel.length || E.busy ? 'disabled' : ''}>Publicar ${sel.length} itens</button>
    </div>
    <div id="enResult"></div></section>`;
  persist();
}

function rowHTML(r) {
  const p = prodOf(r.pid); const f = flags(r); const cur = currentPrice(r); const ref = r.preco_de || r.preco;
  const diff = cur ? (ref / cur - 1) * 100 : null;
  const conf = Math.round((r.ai.confianca ?? 0) * 100);
  return `<tr class="${r.include ? '' : 'is-off'} ${f.length && r.include ? 'is-warn' : ''}" data-k="${r.k}">
    <td><input type="checkbox" data-en-inc="${r.k}" ${r.include ? 'checked' : ''} aria-label="Publicar este item" /></td>
    <td class="en-ai"><b>${esc([r.ai.nome, r.ai.marca, r.ai.tamanho].filter(Boolean).join(' · '))}</b>
      <small>${r.ai.oferta ? `🏷️ ${esc(r.ai.oferta)} · ` : ''}p.${r.page + 1} · <span class="en-conf ${conf < 75 ? 'is-low' : ''}">${conf}%</span></small>
      ${f.length ? `<small class="en-flags">${f.map((x) => `<span>${esc(x)}</span>`).join('')}</small>` : ''}</td>
    <td class="en-prod">${r.mode === 'new' ? `<div class="en-new"><span class="pill pill--soft">novo</span>
        <input data-en-ed="${r.k}:nome" value="${esc(r.nome)}" aria-label="Nome" /><input data-en-ed="${r.k}:marca" value="${esc(r.marca)}" placeholder="Marca" aria-label="Marca" /><input data-en-ed="${r.k}:unidade" value="${esc(r.unidade)}" placeholder="Tamanho" aria-label="Tamanho" />
        <select data-en-ed="${r.k}:categoria" aria-label="Categoria">${E.opts.categories.map((c) => `<option value="${c.slug}" ${c.slug === r.categoria ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <button class="linkish" data-en-pick="${r.k}">já existe? escolher</button></div>`
      : `<button class="en-pick ${p ? '' : 'is-empty'}" data-en-pick="${r.k}">${p ? `${p.emoji || '🛒'} ${esc(pname(p))}` : '❔ Escolher produto'}</button>`}</td>
    <td class="r"><input class="en-num" inputmode="decimal" data-en-ed="${r.k}:preco" value="${fmt(r.preco)}" aria-label="Preço" /></td>
    <td class="r"><input class="en-num" inputmode="decimal" data-en-ed="${r.k}:preco_de" value="${fmt(r.preco_de)}" placeholder="–" aria-label="Preço de" /></td>
    <td class="r nowrap">${cur ? `${brl(cur)}${diff != null && Math.abs(diff) >= 1 ? `<small class="${diff < 0 ? 'down' : 'up'}">${diff > 0 ? '+' : ''}${diff.toFixed(0)}%</small>` : ''}` : '<small class="muted">–</small>'}</td>
  </tr>`;
}

function pickSheet(r) {
  const tr = $(`tr[data-k="${r.k}"]`, E.el); if (!tr) return;
  $$('.en-popover', E.el).forEach((x) => x.remove());
  const td = $('.en-prod', tr);
  td.insertAdjacentHTML('beforeend', `<div class="en-popover"><input type="search" placeholder="Buscar no catálogo…" aria-label="Buscar produto" />
    <ul></ul><button class="btn btn--sm btn--ghost" data-en-new="${r.k}">＋ Criar produto novo</button></div>`);
  const pop = $('.en-popover', td), inp = $('input', pop), ul = $('ul', pop);
  const show = (q) => {
    const ids = q.trim().length >= 2 ? match(parse(q), E.catalog || [], { limit: 8 }).map((x) => x.p.id) : r.cands;
    ul.innerHTML = ids.map((id) => prodOf(id)).filter(Boolean).map((p) => `<li><button data-en-set="${r.k}:${p.id}">${p.emoji || '🛒'} ${esc(pname(p))}</button></li>`).join('') || '<li class="muted small">Nada encontrado.</li>';
  };
  inp.addEventListener('input', () => show(inp.value)); show(''); inp.focus();
}

// ---------------------------------------------------------------- publicar
async function apply(btn) {
  const sel = E.rows.filter((r) => r.include && (r.mode === 'new' || r.pid));
  if (!E.mid || !sel.length) return;
  btn.disabled = true; btn.textContent = 'Publicando…';
  const rows = sel.map((r) => ({
    product_id: r.mode === 'new' ? null : r.pid, nome: r.nome, marca: r.marca || null, unidade: r.unidade || null, categoria: r.categoria,
    ean: r.ean, preco: r.preco, preco_de: r.preco_de && r.preco_de > r.preco ? r.preco_de : null, oferta: r.oferta,
  }));
  try {
    const out = await E.opts.apply(E.mid, rows, E.starts || null, E.ends || null, (E.fileNames || []).join(', ').slice(0, 200));
    const html = `<div class="ok-box en-done"><b>✓ Encarte publicado em ${new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.</b> ${out.prices} preços atualizados, ${out.promos} promoções, ${out.created} produtos novos.
      ${out.errors?.length ? `<details><summary>${out.errors.length} itens com erro</summary><ul>${out.errors.map((e) => `<li>${esc(e.nome || 'linha ' + e.linha)}: ${esc(e.erro)}</li>`).join('')}</ul></details>` : ''}</div>`;
    E.opts.toast('Encarte publicado no site.');
    E.rows = E.rows.filter((r) => !sel.includes(r));
    E.result = html;
    btn.textContent = 'Publicado ✓';
    drawReview(); drawSaved();
    $('#enReview', E.el).insertAdjacentHTML('afterbegin', html);
  } catch (e) { btn.disabled = false; btn.textContent = 'Tentar de novo'; E.opts.toast(e.message || 'Não foi possível publicar.', 'warn'); }
}

// ---------------------------------------------------------------- demonstração (sem IA)
async function demoRead() {
  await new Promise((r) => setTimeout(r, 900));
  const P = (E.catalog || []).slice().sort(() => Math.random() - 0.5).slice(0, 8);
  return { result: { supermercado: E.opts.markets[0]?.name, validade_inicio: new Date().toISOString().slice(0, 10), validade_fim: new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10),
    itens: [...P.map((p, i) => { const x = p.prices[0]?.price || 9.9; const promo = i % 3 === 0; return { nome: p.name, marca: p.brand, tamanho: (p.unit || '').replace(' ', ''), preco: promo ? Math.round(x * 0.85 * 100) / 100 : x, preco_de: promo ? x : null, por_kg: /kg/.test(p.unit || '') && p.category_slug === 'carnes', categoria: p.category_slug, confianca: i === 5 ? 0.6 : 0.93, preco_condicional: false }; }),
      { nome: 'Biscoito recheado', marca: 'Marca Nova', tamanho: '130g', preco: 2.49, preco_de: null, categoria: 'mercearia', confianca: 0.88, por_kg: false, preco_condicional: false }] } };
}

// ---------------------------------------------------------------- eventos
document.addEventListener('click', (e) => {
  if (!E) return;
  const t = e.target.closest('[data-en-f],[data-en-pick],[data-en-set],[data-en-new],[data-en-apply],[data-en-retry],[data-en-reset]');
  if (!t) { if (!e.target.closest('.en-popover')) $$('.en-popover', E.el).forEach((x) => x.remove()); return; }
  const d = t.dataset; const row = (k) => E.rows.find((r) => r.k === k);
  if (d.enF) { E.filter = d.enF; return drawReview(); }
  if (d.enPick) return pickSheet(row(d.enPick));
  if (d.enSet) { const [k, id] = d.enSet.split(':'); const r = row(k); r.pid = Number(id); r.mode = 'match'; return drawReview(); }
  if (d.enNew) { const r = row(d.enNew); r.mode = 'new'; r.pid = null; return drawReview(); }
  if (d.enApply !== undefined) return apply(t);
  if (d.enRetry) return readPage(Number(d.enRetry));
  if (d.enReset !== undefined) return reset();
});
document.addEventListener('change', (e) => {
  if (!E) return;
  const t = e.target;
  if (t.dataset.enInc) { const r = E.rows.find((x) => x.k === t.dataset.enInc); r.include = t.checked; return drawReview(); }
  if (t.dataset.enAll !== undefined) { E.rows.forEach((r) => (r.include = t.checked)); return drawReview(); }
  if (t.dataset.enEd) {
    const [k, f] = t.dataset.enEd.split(':'); const r = E.rows.find((x) => x.k === k); if (!r) return;
    r[f] = ['preco', 'preco_de'].includes(f) ? (ia.money(t.value) || null) : t.value;
    drawReview();
  }
});
