// 📸 Achar foto do produto (portal do supermercado), sem IA:
// busca sozinha, enquanto a pessoa digita, pelo nome + marca + tamanho e pelo código de barras em
//   1. fotos que já existem no Tá Barato Mesmo? (outros mercados do mesmo produto)
//   2. Open Food Facts (alimentos e bebidas, com foto da embalagem; por EAN ou por nome)
//   3. Open Beauty Facts / Open Products Facts (higiene e limpeza)
//   4. Wikimedia Commons (hortifrúti, carnes e itens a granel, que não têm embalagem)
// Um clique escolhe; também dá para colar (Ctrl+V), arrastar ou tirar foto.
// A imagem escolhida é baixada e hospedada no armazenamento do site ao salvar.
import * as api from './api.js';
import { esc } from './core.js';
import { parse, match } from './voice.js';

const OFF_FIELDS = 'code,product_name,product_name_pt,brands,quantity,image_front_url,image_front_small_url,image_url';
const strip = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const digits = (s) => String(s || '').replace(/\D/g, '');
let catalog = null;
const cache = new Map();

async function getJSON(url, ms = 7000) {
  if (cache.has(url)) return cache.get(url);
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal }); const j = r.ok ? await r.json() : null; cache.set(url, j); return j; }
  catch { return null; } finally { clearTimeout(t); }
}

// ---------------------------------------------------------------- fontes
async function fromSite(q) {
  catalog ||= (await api.loadCatalog().catch(() => ({ products: [] }))).products;
  const withPhoto = catalog.filter((p) => p.photo || p.image_url);
  if (!q.text) return [];
  const hits = q.ean ? withPhoto.filter((p) => p.ean && digits(p.ean).replace(/^0+/, '') === q.ean.replace(/^0+/, '')) : [];
  const byName = match(parse(q.text), withPhoto, { limit: 4 }).filter((x) => x.id >= 0.55).map((x) => x.p);
  return [...new Set([...hits, ...byName])].slice(0, 4).map((p) => ({
    src: 'site', thumb: p.photo || p.image_url, full: p.photo || p.image_url, label: [p.name, p.brand, p.unit].filter(Boolean).join(' '), exact: hits.includes(p),
  }));
}

function offItem(p, base, exact = false) {
  const img = p.image_front_url || p.image_url; if (!img) return null;
  return { src: base.includes('beauty') ? 'obf' : base.includes('products') ? 'opf' : 'off', thumb: p.image_front_small_url || img, full: img.replace(/\.(100|200)\.jpg$/, '.400.jpg'),
    label: [p.product_name_pt || p.product_name, p.brands?.split(',')[0], p.quantity].filter(Boolean).join(' · '), ean: p.code, brand: p.brands?.split(',')[0]?.trim(), qty: p.quantity, exact };
}
async function fromOFF(q) {
  const bases = ['https://world.openfoodfacts.org'];
  if (['higiene', 'limpeza'].includes(q.category)) bases.unshift('https://world.openbeautyfacts.org', 'https://world.openproductsfacts.org');
  const out = [];
  if (q.ean && q.ean.length >= 8) {
    for (const b of bases) {
      const j = await getJSON(`${b}/api/v2/product/${q.ean}.json?fields=${OFF_FIELDS}`);
      const it = j?.product && offItem(j.product, b, true); if (it) { out.push(it); break; }
    }
  }
  // variações da busca: nome + marca, marca + tipo, só o nome (o tamanho só ajuda a ordenar)
  const first = (q.name || '').split(/\s+/)[0] || '';
  const terms = [...new Set([[q.name, q.brand].filter(Boolean).join(' '), [q.brand, first].filter(Boolean).join(' '), q.name].map((x) => x.trim()).filter((x) => x.length >= 3))];
  const search = (b, term, br = true) => getJSON(`${b}/cgi/search.pl?search_terms=${encodeURIComponent(term)}&search_simple=1&json=1&page_size=12&fields=${OFF_FIELDS}${br ? '&tagtype_0=countries&tag_contains_0=contains&tag_0=brazil' : ''}`)
    .then((j) => (j?.products || []).map((p) => offItem(p, b)).filter(Boolean));
  if (terms.length) {
    out.push(...(await Promise.all(bases.flatMap((b) => terms.map((t) => search(b, t))))).flat());
    if (out.length < 6) out.push(...(await Promise.all(bases.map((b) => search(b, terms[0], false)))).flat()); // pouco no Brasil: procura no mundo
  }
  // os mais parecidos com o que foi digitado primeiro (marca e tamanho contam)
  const words = strip(q.text).split(/\s+/).filter((w) => w.length > 1);
  const score = (it) => (it.exact ? 100 : 0) + words.filter((w) => strip(it.label).includes(w)).length;
  const seen = new Set();
  return out.filter((it) => (seen.has(it.full) ? false : seen.add(it.full))).sort((a, b) => score(b) - score(a)).slice(0, 10);
}

async function fromWiki(q) {
  if (!q.name || q.name.length < 3) return [];
  const term = `${q.name} ${['carnes'].includes(q.category) ? 'carne' : ['hortifruti'].includes(q.category) ? '' : 'alimento'}`.trim();
  const j = await getJSON(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(term + ' filetype:bitmap')}&gsrlimit=6&prop=imageinfo&iiprop=url|mime&iiurlwidth=480&format=json&origin=*`);
  return Object.values(j?.query?.pages || {}).filter((p) => /jpe?g|png|webp/.test(p.imageinfo?.[0]?.mime || ''))
    .map((p) => ({ src: 'wiki', thumb: p.imageinfo[0].thumburl, full: p.imageinfo[0].thumburl, label: p.title.replace(/^File:|\.\w+$/g, '') })).slice(0, 6);
}

const SRC = { site: 'no site', off: 'Open Food Facts', obf: 'Open Beauty Facts', opf: 'Open Products Facts', wiki: 'Wikimedia' };

// ---------------------------------------------------------------- tela
/**
 * Monta o localizador dentro de `box`.
 * query(): { name, brand, unit, ean, category }  — lido do formulário a cada busca
 * onPick({ url, file, item }): a foto escolhida (url remota ou arquivo local)
 */
export function mount(box, { query, onPick }) {
  box.innerHTML = `<div class="ff">
    <div class="ff-head"><b>📸 Fotos encontradas</b><small id="ffStatus">Digite o nome do produto…</small></div>
    <div class="ff-grid" id="ffGrid" role="listbox" aria-label="Fotos sugeridas"></div>
    <div class="ff-more">
      <label class="btn btn--ghost btn--sm"><input type="file" accept="image/*" capture="environment" hidden data-ff-file />📷 Tirar foto</label>
      <label class="btn btn--ghost btn--sm"><input type="file" accept="image/*" hidden data-ff-file />🖼️ Do computador</label>
      <a class="btn btn--ghost btn--sm" id="ffGoogle" target="_blank" rel="noopener">🔎 Google Imagens</a>
      <span class="muted small">ou cole uma imagem aqui (Ctrl+V)</span>
    </div>
  </div>`;
  const grid = box.querySelector('#ffGrid'), status = box.querySelector('#ffStatus');
  let seq = 0, timer = null, items = [];

  const run = async () => {
    const f = query();
    const q = { ...f, ean: digits(f.ean), text: [f.name, f.brand, f.unit].filter(Boolean).join(' ').trim() };
    box.querySelector('#ffGoogle').href = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q.text || q.ean || '')}`;
    if (!q.text && !q.ean) { grid.innerHTML = ''; status.textContent = 'Digite o nome do produto…'; return; }
    const my = ++seq;
    status.innerHTML = '<span class="spin" aria-hidden="true"></span> Procurando…';
    grid.innerHTML = Array.from({ length: 6 }, () => '<span class="ff-skel"></span>').join('');
    const [a, b, c] = await Promise.all([fromSite(q), fromOFF(q), ['hortifruti', 'carnes'].includes(q.category) || !q.brand ? fromWiki(q) : []]);
    if (my !== seq) return; // chegou uma busca mais nova
    items = [...a, ...b, ...c];
    status.textContent = items.length ? `${items.length} fotos · toque para usar` : 'Nada encontrado. Tente só o nome e a marca, ou tire uma foto.';
    grid.innerHTML = items.map((it, i) => `<button type="button" class="ff-it ${it.exact ? 'is-exact' : ''}" role="option" data-ff="${i}" title="${esc(it.label)}">
      <img src="${esc(it.thumb)}" alt="${esc(it.label)}" loading="lazy" referrerpolicy="no-referrer" />
      <span>${it.exact ? '✓ mesmo código' : esc(SRC[it.src])}</span></button>`).join('');
    grid.querySelectorAll('img').forEach((im) => im.addEventListener('error', () => im.closest('.ff-it')?.remove()));
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(run, 550); };

  grid.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ff]'); if (!b) return;
    grid.querySelectorAll('.ff-it').forEach((x) => x.classList.toggle('is-on', x === b));
    const it = items[Number(b.dataset.ff)];
    onPick({ url: it.full, item: it });
  });
  box.addEventListener('change', (e) => { const f = e.target.matches('[data-ff-file]') && e.target.files?.[0]; if (f) { onPick({ file: f }); e.target.value = ''; } });
  const paste = (e) => {
    if (!box.isConnected) return document.removeEventListener('paste', paste);
    const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); onPick({ file: f }); }
  };
  document.addEventListener('paste', paste);
  run();
  return { refresh: schedule, now: run };
}

/** baixa a imagem escolhida e devolve um File (para hospedar no site). Sem acesso: null */
export async function download(url, name = 'foto') {
  try {
    const r = await fetch(url, { mode: 'cors', referrerPolicy: 'no-referrer' });
    if (!r.ok) return null;
    const b = await r.blob();
    if (!b.type.startsWith('image/')) return null;
    return new File([b], `${name}.${(b.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`, { type: b.type });
  } catch { return null; }
}
