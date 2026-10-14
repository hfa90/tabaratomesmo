// Publicidade em formato de "card de curiosidade": mostra uma pergunta e a imagem desfocada;
// a oferta só aparece quando a pessoa toca para descobrir. Um anúncio por espaço, sem pop-up,
// sem som e com "Ocultar" sempre à mão.
import * as api from './api.js';
import { S, $, esc, hooks } from './core.js';
import { track } from './track.js';

let ADS = [];
const shown = new Map();     // id → vezes exibido nesta visita (rodízio)
const seen = new Set();      // impressões já registradas nesta visita
const hidden = () => { const h = api.store.get('tb.adHide', {}); const now = Date.now(); return new Set(Object.entries(h).filter(([, t]) => t > now).map(([k]) => Number(k))); };

export async function load() {
  if (S.settings?.ads_enabled === false) { ADS = []; return; }
  ADS = await api.adsLive().catch(() => []);
}

function pick(slot) {
  const off = hidden();
  const list = ADS.filter((a) => a.slot === slot && !off.has(a.id) && new Date(a.ends_at) > Date.now());
  if (!list.length) return null;
  list.sort((a, b) => (shown.get(a.id) || 0) - (shown.get(b.id) || 0));
  const a = list[0]; shown.set(a.id, (shown.get(a.id) || 0) + 1);
  return a;
}

export function html(a, { preview = false } = {}) {
  return `<aside class="ad" data-ad="${a.id}" aria-label="Publicidade de ${esc(a.market || '')}">
    <span class="ad__tag">Patrocinado${a.market ? ` · ${esc(a.market)}` : ''}</span>
    ${preview ? '' : `<button class="ad__hide" data-ad-hide="${a.id}" aria-label="Ocultar este anúncio" title="Não mostrar por 7 dias">×</button>`}
    <div class="ad__media"><img src="${esc(a.image_url)}" alt="" loading="lazy" decoding="async" /></div>
    <div class="ad__txt">
      <b class="ad__title">${esc(a.title)}</b>
      <span class="ad__teaser">${esc(a.teaser || 'Toque para descobrir.')}</span>
      <span class="ad__body">${esc(a.body || '')}</span>
      <span class="ad__btns">
        <button class="btn btn--sm btn--ink ad__reveal" data-ad-reveal="${a.id}">Descobrir</button>
        <button class="btn btn--sm btn--primary ad__cta" data-ad-cta="${a.id}">${esc(a.cta || 'Ver oferta')}</button>
      </span>
    </div>
  </aside>`;
}

/** coloca um anúncio do espaço `slot` dentro de `el` (ou devolve o HTML se el for null) */
export function render(slot, el) {
  if (!el) return '';
  const a = pick(slot);
  el.innerHTML = a ? html(a) : '';
  if (a) observe(el.querySelector('.ad'));
  return el.innerHTML;
}
export function htmlFor(slot) { const a = pick(slot); return a ? html(a) : ''; }

// impressão = anúncio pelo menos metade visível por 1 segundo
const io = 'IntersectionObserver' in window ? new IntersectionObserver((ents) => {
  for (const en of ents) {
    const id = Number(en.target.dataset.ad);
    clearTimeout(en.target._t);
    if (en.isIntersecting && !seen.has(id)) en.target._t = setTimeout(() => { seen.add(id); if (id > 0) track('ad_view', { ad_id: id }); }, 1000);
  }
}, { threshold: 0.5 }) : null;
export function observe(node) { if (node && io) io.observe(node); }
export function observeAll(root = document) { root.querySelectorAll('.ad').forEach(observe); }

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-ad-reveal], [data-ad-cta], [data-ad-hide]'); if (!t) return;
  e.stopPropagation();
  const id = Number(t.dataset.adReveal || t.dataset.adCta || t.dataset.adHide);
  const card = t.closest('.ad');
  if (t.dataset.adHide) {
    const h = api.store.get('tb.adHide', {}); h[id] = Date.now() + 7 * 864e5; api.store.set('tb.adHide', h);
    card?.remove(); return;
  }
  if (t.dataset.adReveal) { card?.classList.add('is-open'); if (id > 0) track('ad_reveal', { ad_id: id }); return; }
  const a = ADS.find((x) => x.id === id); if (!a) return;
  if (id > 0) track('ad_click', { ad_id: id, market_id: a.supermarket_id });
  if (a.target_type === 'product' && a.target_value) hooks.openProduct?.(Number(a.target_value));
  else if (a.target_type === 'store') {
    const s = [...S.stores].filter((x) => x.supermarket_id === a.supermarket_id).sort((x, y) => (S.nearest.get(x.supermarket_id)?.store?.id === x.id ? -1 : 0) - (S.nearest.get(y.supermarket_id)?.store?.id === y.id ? -1 : 0))[0];
    if (s) window.open(`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`, '_blank', 'noopener');
  } else if (a.target_type === 'url' && /^https:\/\//.test(a.target_value || '')) window.open(a.target_value, '_blank', 'noopener');
}, true);
