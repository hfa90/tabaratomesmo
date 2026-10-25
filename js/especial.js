// Página especial de datas temáticas (#especial) e o banner que chama para ela no início e nas ofertas.
// Quem liga a data é a administração; os produtos são escolhidos pelos supermercados (special_event_products).
// A página tem: cena 3D no topo (temas.js), contagem regressiva, carrossel 3D dos destaques (arrastar para girar),
// cartões que inclinam em 3D seguindo o dedo, filtro por supermercado e efeitos ao pôr na lista.
// Prévia para a administração: #especial?tema=natal&previa=1 (monta a página com produtos de exemplo).
import * as api from './api.js';
import { S, $, $$, esc, brl, logo, hooks, visiblePrices, reduceMotion } from './core.js';
import { ic } from './icons.js';
import { THEMES, scene } from './temas.js';
import { track } from './track.js';

let data = null;         // { event, items, preview }
let sc = null, tick = null, ringRaf = 0;
let mk = 'all';

const params = () => new URLSearchParams(location.hash.split('?')[1] || '');
const theme = () => THEMES[data?.event?.theme] || THEMES.blackfriday;
const left = (iso) => { const ms = Math.max(0, new Date(iso) - Date.now()); return { d: Math.floor(ms / 864e5), h: Math.floor(ms / 36e5) % 24, m: Math.floor(ms / 6e4) % 60, s: Math.floor(ms / 1e3) % 60, ms }; };
const pad = (n) => String(n).padStart(2, '0');

/** produtos da data, com o preço em cada mercado */
function rows() {
  if (!data) return [];
  const out = [];
  for (const it of data.items) {
    const p = S.products.find((x) => x.id === it.product_id); const m = S.markets.get(it.supermarket_id);
    if (!p || !m) continue;
    const x = p.prices.find((y) => y.market_id === it.supermarket_id);
    const regular = x?.promo && x.regular ? x.regular : x?.prev && x.prev > (x?.price || 0) ? x.prev : x?.price ?? null;
    const price = it.special_price != null ? Number(it.special_price) : x?.price ?? null;
    if (price == null) continue;
    const off = regular && regular > price ? Math.round((1 - price / regular) * 100) : 0;
    out.push({ p, m, price, regular: off ? regular : null, off, sort: it.sort ?? 0 });
  }
  return out.sort((a, b) => b.off - a.off || a.sort - b.sort);
}

function previewData(themeKey) {
  const [s, e] = [new Date(Date.now() - 864e5), new Date(Date.now() + 6 * 864e5)];
  const t = THEMES[themeKey] || THEMES.blackfriday;
  const items = S.products.map((p) => ({ p, v: visiblePrices(p) })).filter((x) => x.v.length >= 2)
    .sort((a, b) => (b.v.at(-1).price - b.v[0].price) - (a.v.at(-1).price - a.v[0].price)).slice(0, 14)
    .map((x, i) => ({ product_id: x.p.id, supermarket_id: x.v[0].market_id, special_price: Math.round(x.v[0].price * 0.9 * 100) / 100, sort: i }));
  return { event: { slug: `previa-${themeKey}`, theme: themeKey, title: t.title, subtitle: t.subtitle, banner_text: t.banner, starts_at: s.toISOString(), ends_at: e.toISOString() }, items, preview: true };
}

export async function init() {
  const q = params();
  if (q.get('previa') && THEMES[q.get('tema')]) data = previewData(q.get('tema'));
  else data = await api.loadEvent();
  renderBanners();
  if ((location.hash || '').startsWith('#especial')) render();
}

// ---------------------------------------------------------------- banner (início e ofertas)
function bannerHTML() {
  const e = data.event; const t = theme(); const l = left(e.ends_at);
  return `<a class="esp-banner" href="#especial" data-esp-go style="--t-bg1:${t.c.bg1};--t-bg2:${t.c.bg2};--t-acc:${t.c.acc};--t-acc2:${t.c.acc2}">
    <span class="esp-banner__fx" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>
    <span class="esp-banner__emb esp-emb esp-emb--${t.object}" aria-hidden="true"><span></span></span>
    <span class="esp-banner__t"><small>${esc(t.name)}${data.preview ? ' · prévia' : ''}</small><b>${esc(e.banner_text || e.title)}</b>
      <em>${l.ms ? `termina em ${l.d ? `${l.d}d ` : ''}${pad(l.h)}h${pad(l.m)}` : 'últimas horas'}</em></span>
    <span class="esp-banner__go">Entrar ${ic('arrow')}</span></a>`;
}
export function renderBanners() {
  for (const id of ['espBannerInicio', 'espBannerOfertas']) {
    const el = $('#' + id); if (!el) continue;
    if (!data?.event || !data.items.length && !data.preview) { el.innerHTML = ''; el.hidden = true; continue; }
    el.hidden = false; el.innerHTML = bannerHTML();
  }
}

// ---------------------------------------------------------------- página
export async function render() {
  const el = $('#especialView'); if (!el) return;
  leave();
  const q = params();
  if (q.get('previa') && THEMES[q.get('tema')] && data?.event?.theme !== q.get('tema')) { data = previewData(q.get('tema')); renderBanners(); }
  if (!data?.event) {
    el.innerHTML = `<section class="esp-none"><span>${ic('calendar')}</span><h1>Nenhuma data especial agora</h1><p class="muted">Quando tiver Black Friday, Natal, Dia das Mães e outras datas, a página aparece aqui com as ofertas dos supermercados.</p><a class="btn btn--primary" href="#ofertas">Ver as ofertas de hoje</a></section>`;
    return;
  }
  const e = data.event; const t = theme(); const R = rows();
  const markets = [...new Map(R.map((r) => [r.m.id, r.m])).values()];
  if (mk !== 'all' && !markets.some((m) => m.id === Number(mk))) mk = 'all';
  const list = R.filter((r) => mk === 'all' || r.m.id === Number(mk));
  const top = R.slice(0, 8);
  el.style.cssText = `--t-bg1:${t.c.bg1};--t-bg2:${t.c.bg2};--t-acc:${t.c.acc};--t-acc2:${t.c.acc2};--t-ink:${t.c.ink};--t-card:${t.c.card}`;
  el.className = `esp esp--${e.theme}`;
  el.innerHTML = `
    <section class="esp-hero">
      <div class="esp-stage" id="espStage"><div class="esp-fallback esp-emb esp-emb--${t.object}" aria-hidden="true"><span></span></div></div>
      <div class="esp-hero__txt">
        <span class="esp-badge">${esc(t.name)}${data.preview ? ' · prévia da administração' : ''}</span>
        <h1>${esc(e.title)}</h1>
        ${e.subtitle ? `<p>${esc(e.subtitle)}</p>` : ''}
        <div class="esp-count" id="espCount" aria-label="Tempo até acabar"></div>
        <div class="esp-hero__cta"><a class="esp-btn" href="#espOfertas" data-esp-scroll>${ic('tag')} Ver as ofertas</a><small class="esp-hint">${reduceMotion ? '' : 'Toque nos objetos 3D'}</small></div>
      </div>
    </section>
    ${top.length >= 4 ? `<section class="esp-sec"><h2>Destaques</h2><p class="esp-sub">Arraste para girar</p>
      <div class="esp-ring-wrap" id="espRingWrap"><div class="esp-ring" id="espRing" style="--n:${top.length}">
        ${top.map((r, i) => `<button class="esp-ring__it" style="--i:${i}" data-open-product="${r.p.id}">
          <span class="esp-ring__img">${r.p.image_url ? `<img src="${esc(r.p.image_url)}" alt="" loading="lazy" />` : esc(r.p.emoji || '')}</span>
          <b>${esc(r.p.name)}</b><span class="esp-ring__p">${brl(r.price)}</span>${r.off ? `<em>−${r.off}%</em>` : ''}<small>${esc(r.m.name)}</small></button>`).join('')}
      </div></div></section>` : ''}
    <section class="esp-sec" id="espOfertas">
      <h2>Ofertas de ${esc(t.name)}</h2>
      <p class="esp-sub">Escolhidas pelos supermercados para esta data. Toque em “Lista” para pôr no seu rancho.</p>
      ${markets.length > 1 ? `<div class="esp-chips" role="tablist">${[['all', 'Todos']].concat(markets.map((m) => [m.id, m.name])).map(([id, n]) => `<button role="tab" aria-selected="${String(mk) === String(id)}" data-esp-mk="${id}">${esc(n)}</button>`).join('')}</div>` : ''}
      ${list.length ? `<div class="esp-grid">${list.map((r, i) => `<article class="esp-card" data-tilt style="--d:${Math.min(i, 12) * 50}ms">
        <div class="esp-card__in">
          ${r.off ? `<span class="esp-card__off">−${r.off}%</span>` : ''}
          <button class="esp-card__img" data-open-product="${r.p.id}" aria-label="Ver ${esc(r.p.name)}">${r.p.image_url ? `<img src="${esc(r.p.image_url)}" alt="" loading="lazy" />` : `<span>${esc(r.p.emoji || '')}</span>`}</button>
          <b class="esp-card__n">${esc(r.p.name)}</b><small>${esc([r.p.brand, r.p.unit].filter(Boolean).join(' · '))}</small>
          <span class="esp-card__mk">${logo(r.m, 'xs')} ${esc(r.m.name)}</span>
          <span class="esp-card__pr">${r.regular ? `<s>${brl(r.regular)}</s>` : ''}<strong>${brl(r.price)}</strong></span>
          <button class="esp-card__add" data-add="${r.p.id}" data-esp-add>${ic('plus')} Lista</button>
        </div><span class="esp-card__glare" aria-hidden="true"></span></article>`).join('')}</div>`
        : '<p class="esp-empty">Os supermercados ainda estão escolhendo as ofertas desta data. Volte mais tarde!</p>'}
    </section>
    <p class="esp-foot">${esc(t.name)} · de ${new Date(e.starts_at).toLocaleDateString('pt-BR')} a ${new Date(e.ends_at).toLocaleDateString('pt-BR')}. Preços informados pelos supermercados; confira na loja.</p>`;
  countdown(); tilt(); reveal(); ring();
  scene($('#espStage'), e.theme, { onTap: () => { try { navigator.vibrate?.(10); } catch {} } }).then((h) => {
    if (!h) return; sc = h; $('#espStage .esp-fallback')?.remove();
  });
  if (!data.preview) track('promo_view', { query: `especial:${e.slug}` });
}

export function leave() {
  sc?.stop(); sc = null; clearInterval(tick); tick = null; cancelAnimationFrame(ringRaf);
}

function countdown() {
  const el = $('#espCount'); if (!el) return;
  const e = data.event; const started = new Date(e.starts_at) <= new Date();
  const draw = () => {
    const l = left(started ? e.ends_at : e.starts_at);
    el.innerHTML = `<span class="esp-count__k">${started ? 'Termina em' : 'Começa em'}</span>${[['d', 'dias'], ['h', 'horas'], ['m', 'min'], ['s', 'seg']].map(([k, n]) => `<span class="esp-count__b"><b>${pad(l[k])}</b><small>${n}</small></span>`).join('')}`;
  };
  draw(); tick = setInterval(draw, 1000);
}

/** cartões inclinam em 3D seguindo o dedo/mouse */
function tilt() {
  if (reduceMotion) return;
  for (const c of $$('[data-tilt]')) {
    c.addEventListener('pointermove', (ev) => { const r = c.getBoundingClientRect(); const x = (ev.clientX - r.left) / r.width - 0.5, y = (ev.clientY - r.top) / r.height - 0.5;
      c.style.setProperty('--rx', `${(-y * 14).toFixed(2)}deg`); c.style.setProperty('--ry', `${(x * 16).toFixed(2)}deg`); c.style.setProperty('--gx', `${(x + 0.5) * 100}%`); c.style.setProperty('--gy', `${(y + 0.5) * 100}%`); c.classList.add('is-tilt'); });
    c.addEventListener('pointerleave', () => { c.style.setProperty('--rx', '0deg'); c.style.setProperty('--ry', '0deg'); c.classList.remove('is-tilt'); });
  }
}
function reveal() {
  const cards = $$('.esp-card'); if (!('IntersectionObserver' in window) || reduceMotion) { cards.forEach((c) => c.classList.add('is-in')); return; }
  const io = new IntersectionObserver((es) => es.forEach((x) => { if (x.isIntersecting) { x.target.classList.add('is-in'); io.unobserve(x.target); } }), { threshold: 0.15 });
  cards.forEach((c) => io.observe(c));
}
/** carrossel 3D: gira sozinho; arrastar gira na mão */
function ring() {
  const wrap = $('#espRingWrap'), el = $('#espRing'); if (!el) return;
  let rot = 0, vel = reduceMotion ? 0 : 0.12, drag = null;
  const set = () => el.style.setProperty('--rot', `${rot}deg`);
  const step = () => { if (!drag) { rot -= vel; set(); } ringRaf = requestAnimationFrame(step); };
  if (!reduceMotion) step();
  wrap.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, r: rot, moved: false }; wrap.setPointerCapture(e.pointerId); });
  wrap.addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - drag.x; if (Math.abs(dx) > 4) drag.moved = true; rot = drag.r + dx * 0.4; set(); });
  const end = () => { if (drag?.moved) { wrap.dataset.justDragged = '1'; setTimeout(() => delete wrap.dataset.justDragged, 60); } drag = null; };
  wrap.addEventListener('pointerup', end); wrap.addEventListener('pointercancel', end);
  wrap.addEventListener('click', (e) => { if (wrap.dataset.justDragged) { e.preventDefault(); e.stopPropagation(); } }, true);
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-esp-mk], [data-esp-scroll], [data-esp-add], [data-esp-go]'); if (!t) return;
  if (t.dataset.espMk) { mk = t.dataset.espMk; return render(); }
  if (t.dataset.espScroll !== undefined) { e.preventDefault(); $('#espOfertas')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }); return; }
  if (t.dataset.espAdd !== undefined) { sc?.burst(); t.classList.add('is-added'); setTimeout(() => t.classList.remove('is-added'), 900); return; }
  if (t.dataset.espGo !== undefined && data?.preview) { e.preventDefault(); location.hash = `#especial?tema=${data.event.theme}&previa=1`; }
});
