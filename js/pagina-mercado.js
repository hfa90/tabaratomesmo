// mercado.html — página pública de cada supermercado (boa para o Google e para compartilhar).
//   mercado.html            → todos os supermercados
//   mercado.html?m=coema    → lojas, endereços, horários e as ofertas de hoje em que ele é o mais barato
import * as api from './api.js';
import { S, esc, brl, logo, logoFull, media, trustTag } from './core.js';
import { initAccount } from './pagina.js';
import { ic } from './icons.js';
import { chips } from './servicos.js';

const SITE = 'https://hfa90.github.io/tabaratomesmo/';
const $ = (s) => document.querySelector(s);
const route = (st) => `https://www.google.com/maps/dir/?api=1&destination=${st.lat},${st.lng}`;

function meta(title, desc, url) {
  document.title = title;
  document.querySelector('meta[name=description]')?.setAttribute('content', desc);
  $('#ogt')?.setAttribute('content', title);
  $('#canon')?.setAttribute('href', url);
}
function jsonLd(obj) {
  const s = document.createElement('script'); s.type = 'application/ld+json'; s.textContent = JSON.stringify(obj); document.head.append(s);
}

/** produtos em que este mercado tem o menor preço, do maior para o menor "a menos" */
function winners(products, mid) {
  const out = [];
  for (const p of products) {
    const ps = p.prices; if (ps.length < 2) continue;
    const i = ps.findIndex((x) => x.market_id === mid); if (i !== 0) continue;
    const save = ps[1].price - ps[0].price; if (save < 0.05) continue;
    out.push({ p, x: ps[0], next: ps[1], save });
  }
  return out.sort((a, b) => (b.x.promo ? 1 : 0) - (a.x.promo ? 1 : 0) || b.save / b.next.price - a.save / a.next.price);
}

function listPage(data) {
  const ms = data.supermarkets;
  meta('Supermercados de Manaus | Tá Barato Mesmo?', `Lojas, endereços e ofertas de hoje de ${ms.map((m) => m.name).join(', ')} em Manaus.`, `${SITE}mercado.html`);
  $('#mkPage').innerHTML = `
    <header class="pg-hero"><p class="pg-kicker">Manaus</p><h1>Supermercados</h1>
      <p class="pg-lead">Lojas, endereços e as ofertas de hoje de cada supermercado. Para saber onde a sua lista sai mais barata, use o comparador.</p>
      <a class="btn btn--primary" href="./#ofertas">${ic('search')} Comparar preços agora</a></header>
    <div class="mk-grid">${ms.map((m) => {
      const n = data.stores.filter((s) => s.supermarket_id === m.id).length;
      const w = winners(data.products, m.id).length;
      return `<a class="mk-card" href="mercado.html?m=${encodeURIComponent(m.slug)}" style="--c:${esc(m.color || '#0F5A3E')}">
        <span class="mk-card__logo">${logoFull(m)}</span><b>${esc(m.name)}</b>
        <small>${n} ${n === 1 ? 'loja' : 'lojas'}${w ? ` · mais barato em ${w} produtos hoje` : ''}</small><em>Ver lojas e ofertas ›</em></a>`;
    }).join('')}</div>`;
}

function marketPage(data, m) {
  const stores = data.stores.filter((s) => s.supermarket_id === m.id);
  const win = winners(data.products, m.id);
  const has = data.products.filter((p) => p.prices.some((x) => x.market_id === m.id)).length;
  const others = data.supermarkets.filter((x) => x.id !== m.id);
  const url = `${SITE}mercado.html?m=${encodeURIComponent(m.slug)}`;
  meta(`${m.name} em Manaus: lojas e ofertas de hoje | Tá Barato Mesmo?`,
    `${m.name}: ${stores.length} ${stores.length === 1 ? 'loja' : 'lojas'} em Manaus${stores[0]?.neighborhood ? ` (${stores.map((s) => s.neighborhood).filter(Boolean).slice(0, 4).join(', ')})` : ''}. Veja onde fica e em quais produtos é o mais barato hoje.`, url);
  jsonLd({ '@context': 'https://schema.org', '@graph': stores.map((s) => ({
    '@type': 'GroceryStore', name: s.name || m.name, brand: m.name, url,
    address: { '@type': 'PostalAddress', streetAddress: s.address || undefined, addressLocality: 'Manaus', addressRegion: 'AM', addressCountry: 'BR' },
    geo: { '@type': 'GeoCoordinates', latitude: s.lat, longitude: s.lng }, openingHours: s.opening_hours || undefined,
  })) });
  $('#mkPage').innerHTML = `
    <header class="pg-hero mk-hero" style="--c:${esc(m.color || '#0F5A3E')}">
      <span class="mk-hero__logo">${logoFull(m)}</span>
      <div><p class="pg-kicker">Supermercado em Manaus</p><h1>${esc(m.name)}</h1>
        <p class="pg-lead">${stores.length} ${stores.length === 1 ? 'loja' : 'lojas'} · ${has} produtos com preço no comparador${win.length ? ` · <b>mais barato em ${win.length}</b> hoje` : ''}</p>
        ${m.about ? `<p class="mk-about">${esc(m.about)}</p>` : ''}
        <div class="row-actions">
          <a class="btn btn--primary" href="./#ofertas">${ic('search')} Comparar com os outros</a>
          ${/^https:\/\//.test(m.shop_url || '') ? `<a class="btn btn--ghost" href="${esc(m.shop_url)}" target="_blank" rel="noopener">${ic('cart')} Comprar online</a>` : ''}
          ${/^https?:\/\//.test(m.website || '') ? `<a class="btn btn--text" href="${esc(m.website)}" target="_blank" rel="noopener">Site oficial</a>` : ''}
          ${/^\d{10,13}$/.test(m.whatsapp || '') ? `<a class="btn btn--ghost" href="https://wa.me/55${esc(m.whatsapp.replace(/^55(?=\d{10,11}$)/, ''))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
        </div></div>
    </header>

    ${(m.services || []).length ? `<section class="pg-sec"><h2>Na loja você encontra</h2>${chips(m, 99, 'svc svc--lg')}</section>` : ''}

    <section class="pg-sec"><h2>Mais barato aqui hoje</h2>
      ${win.length ? `<ul class="mk-deals">${win.slice(0, 12).map(({ p, x, next, save }) => `<li><a href="./#ofertas" class="mk-deal">
          ${media(p, 'mk-deal__media')}<span class="mk-deal__t"><b>${esc(p.name)}</b><small>${esc([p.brand, p.unit].filter(Boolean).join(' · '))}</small></span>
          <span class="mk-deal__v"><b>${brl(x.price)}</b><small class="down">−${brl(save)} vs ${esc(data.supermarkets.find((y) => y.id === next.market_id)?.name || 'o próximo')}</small>${trustTag(x)}</span></a></li>`).join('')}</ul>
        <p class="muted small">Comparado com os outros supermercados do site. Preços mudam: confira na loja.</p>`
        : '<p class="muted">Hoje nenhum produto está mais barato aqui do que nos outros. Veja todas as ofertas no comparador.</p>'}
    </section>

    <section class="pg-sec"><h2>Lojas</h2>
      <ul class="mk-stores">${stores.map((s) => `<li>
        <span class="mk-st__i" aria-hidden="true">${ic('pin')}</span>
        <span class="mk-st__t"><b>${esc(s.name || m.name)}</b><small>${esc([s.address, s.neighborhood].filter(Boolean).join(' · ') || 'Manaus')}</small>${s.opening_hours ? `<small>${ic('hourglass')} ${esc(s.opening_hours)}</small>` : ''}</span>
        <a class="btn btn--ghost btn--sm" href="${route(s)}" target="_blank" rel="noopener">Como chegar</a></li>`).join('') || '<li class="muted">Endereços em breve.</li>'}</ul>
    </section>

    ${others.length ? `<section class="pg-sec"><h2>Outros supermercados</h2><div class="mk-other">${others.map((x) => `<a href="mercado.html?m=${encodeURIComponent(x.slug)}">${logo(x, 'sm')}<span>${esc(x.name)}</span></a>`).join('')}</div></section>` : ''}`;
}

async function main() {
  initAccount();
  let data;
  try { data = await api.loadCatalog(); }
  catch { $('#mkPage').innerHTML = '<p class="note">Não deu para carregar agora. Confira a internet e recarregue.</p>'; return; }
  data.supermarkets.forEach((m) => S.markets.set(m.id, m));
  const q = new URLSearchParams(location.search).get('m');
  const m = q && data.supermarkets.find((x) => x.slug === q || String(x.id) === q);
  if (m) marketPage(data, m); else listPage(data);
}
main();
