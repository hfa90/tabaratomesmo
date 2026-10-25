// Portal › Clientes: onde estão as pessoas que vão ao supermercado, se elas vão à loja mais perto
// de casa, os dias da semana, os dias do mês e os horários com mais visitas.
// "Visita" = chegou à loja com o site aberto, marcou que comprou ou mandou a nota fiscal.
// Bairros só aparecem com 3 pessoas ou mais (privacidade); nada identifica uma pessoa.
import * as P from './portal-api.js';
import { $, esc } from './core.js';
import { hbars, kpi, fmtN } from './viz.js';

const DOW = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const DOW_S = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
let days = 90, map = null;

function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (!document.querySelector('link[href*="leaflet.css"]')) document.head.insertAdjacentHTML('beforeend', '<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />');
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; s.onload = res; s.onerror = rej; document.head.append(s); });
}

function bars(rows, { label, value, hi }) {
  const mx = Math.max(...rows.map(value), 1);
  return `<div class="vb">${rows.map((r) => `<div class="vb__c ${hi(r) ? 'is-hi' : ''}" title="${esc(label(r, true))}: ${fmtN(value(r))}">
    <span class="vb__v">${fmtN(value(r))}</span><span class="vb__b"><i style="--h:${Math.max(3, (value(r) / mx) * 100)}%"></i></span><span class="vb__l">${label(r)}</span></div>`).join('')}</div>`;
}

function monthGrid(rows) {
  const by = new Map(rows.map((r) => [r.day, r.visits])); const mx = Math.max(...rows.map((r) => r.visits), 1);
  return `<div class="mg">${Array.from({ length: 31 }, (_, i) => { const d = i + 1, v = by.get(d) || 0;
    const a = 0.08 + (v / mx) * 0.92;
    return `<span class="mg__d ${a > 0.6 ? 'is-dark' : ''}" style="--a:${a.toFixed(2)}" title="Dia ${d}: ${fmtN(v)} visitas"><b>${d}</b><small>${v ? fmtN(v) : ''}</small></span>`; }).join('')}</div>
    <div class="mg__leg"><span>menos</span><i></i><span>mais visitas</span></div>`;
}

/** frases que explicam o que os números querem dizer */
function insights(D, m) {
  const out = [];
  const z = D.zones.filter((x) => x.zone !== 'Não informado'); const zt = z.reduce((s, x) => s + x.visits, 0);
  if (z[0] && zt) out.push(`A maior parte do seu público vem da zona <b>${esc(z[0].zone)}</b> (${pct(z[0].visits, zt)}% das visitas).`);
  const wd = [...D.weekday].sort((a, b) => b.visits - a.visits);
  if (wd[0]) out.push(`<b>${DOW[wd[0].dow]}</b> é o dia mais forte${wd.at(-1) ? `; <b>${DOW[wd.at(-1).dow].toLowerCase()}</b> é o mais fraco — bom dia para uma oferta que traga gente` : ''}.`);
  const md = D.monthday; const tot = md.reduce((s, x) => s + x.visits, 0);
  const early = md.filter((x) => x.day >= 5 && x.day <= 10).reduce((s, x) => s + x.visits, 0);
  if (tot && pct(early, tot) > 24) out.push(`Os dias <b>5 a 10</b> (época de pagamento) concentram <b>${pct(early, tot)}%</b> das visitas do mês.`);
  const n = D.nearest || {};
  if (n.known) {
    out.push(`<b>${pct(n.own_nearest, n.known)}%</b> das visitas foram à loja do ${esc(m.name)} mais perto de casa.`);
    if (n.passed_other) out.push(`Em <b>${pct(n.passed_other, n.known)}%</b> das visitas a pessoa passou por um concorrente mais perto para vir até você — sinal de preço ou fidelidade.`);
  }
  return out;
}

export async function render({ main, mid, market, banner }) {
  const m = market();
  main.innerHTML = `${banner}
    <header class="pt-head"><div><h1>Clientes</h1><p class="muted">De onde vêm as pessoas que vão ao ${esc(m.name)}, se vão à loja mais perto de casa e quando vão.</p></div>
      <div class="seg" role="radiogroup" aria-label="Período">${[[30, '30 dias'], [90, '90 dias'], [180, '6 meses'], [365, '1 ano']].map(([d, l]) => `<button role="radio" aria-checked="${days === d}" data-cdays="${d}">${l}</button>`).join('')}</div></header>
    <div id="cli"><div class="skeleton" style="height:420px"></div></div>`;
  let D;
  try { D = await P.customers(mid, days); }
  catch (e) { $('#cli').innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
  const n = D.nearest || {};
  const z = D.zones.filter((x) => x.zone !== 'Não informado');
  const tips = insights(D, m);
  $('#cli').innerHTML = `
    <section class="kpis">
      ${kpi('Visitas', D.visits, { hint: 'chegadas, compras e notas' })}
      ${kpi('Pessoas diferentes', D.people)}
      ${kpi('Têm você como preferido', D.fans, { hint: 'no cadastro do site', accent: true })}
      ${kpi('Foram à loja mais perto', pct(n.own_nearest, n.known), { fmt: (v) => `${v}%`, hint: n.known ? `de ${fmtN(n.known)} visitas com casa conhecida` : 'precisa de mais visitas' })}
      ${kpi('Distância média de casa', n.avg_km ?? 0, { fmt: (v) => `${String(v).replace('.', ',')} km` })}
    </section>
    ${tips.length ? `<section class="panel cli-tips"><div class="panel__head"><h2>O que os números dizem</h2></div><ul>${tips.map((t) => `<li>${t}</li>`).join('')}</ul></section>` : ''}
    <div class="pt-grid cli-top">
      <section class="panel"><div class="panel__head"><h2>Mapa dos bairros</h2><span class="muted small">círculo maior = mais visitas</span></div>
        <div id="cliMap" class="cli-map" role="region" aria-label="Mapa de Manaus com os bairros dos clientes"></div></section>
      <section class="panel"><div class="panel__head"><h2>Zonas da cidade</h2></div>
        ${hbars(z, { label: (r) => esc(r.zone), value: (r) => r.visits, note: (r) => `${fmtN(r.people)} pessoas` })}
        <div class="panel__head" style="margin-top:14px"><h2>Bairros</h2></div>
        ${hbars(D.bairros.slice(0, 8), { label: (r) => esc(r.name), value: (r) => r.visits })}</section>
    </div>
    <section class="panel"><div class="panel__head"><h2>Vão à loja mais perto de casa?</h2><span class="muted small">pelo endereço ou bairro informado no cadastro</span></div>
      ${n.known ? `<div class="near">
        ${[[n.own_nearest, `foram à <b>loja do ${esc(m.name)} mais perto</b> de casa`], [n.any_nearest, `têm o <b>${esc(m.name)} como o mercado mais perto</b> de casa`], [n.passed_other, `<b>passaram por um concorrente</b> mais perto para vir`]]
          .map(([v, t]) => `<div class="near__i"><span class="near__ring" style="--p:${pct(v, n.known)}"><b>${pct(v, n.known)}%</b></span><p>${t}</p></div>`).join('')}
      </div>` : '<p class="muted small">Ainda não há visitas suficientes com o endereço de casa conhecido.</p>'}
      ${D.stores?.length > 1 ? `<div class="panel__head" style="margin-top:14px"><h2>Visitas por loja</h2></div>${hbars(D.stores, { label: (r) => esc(r.name), value: (r) => r.visits })}` : ''}</section>
    <div class="pt-grid">
      <section class="panel"><div class="panel__head"><h2>Dias da semana</h2></div>
        ${bars(D.weekday, { label: (r, full) => (full ? DOW[r.dow] : DOW_S[r.dow]), value: (r) => r.visits, hi: (r) => r.visits === Math.max(...D.weekday.map((x) => x.visits)) })}</section>
      <section class="panel"><div class="panel__head"><h2>Horários</h2></div>
        ${bars(D.hours, { label: (r) => `${r.h}h`, value: (r) => r.visits, hi: (r) => r.visits === Math.max(...D.hours.map((x) => x.visits)) })}</section>
    </div>
    <section class="panel"><div class="panel__head"><h2>Dias do mês</h2><span class="muted small">soma de todos os meses do período</span></div>${monthGrid(D.monthday)}</section>
    <p class="muted small">Privacidade: números somados e anônimos; bairros só aparecem com 3 pessoas ou mais. "Visita" é a chegada à loja com o site aberto, a compra marcada no site ou a nota fiscal enviada.${P.MODE === 'demo' ? ' Dados simulados (demonstração).' : ''}</p>`;
  drawMap(D);
}

async function drawMap(D) {
  const el = $('#cliMap'); if (!el) return;
  try { await loadLeaflet(); } catch { el.innerHTML = '<p class="muted small" style="padding:12px">Não foi possível carregar o mapa.</p>'; return; }
  if (map) { map.remove(); map = null; }
  map = window.L.map(el, { scrollWheelZoom: false, attributionControl: true }).setView([-3.07, -60.0], 11);
  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© OpenStreetMap' }).addTo(map);
  const mx = Math.max(...D.bairros.map((b) => b.visits), 1);
  for (const b of D.bairros) {
    if (b.lat == null) continue;
    window.L.circleMarker([b.lat, b.lng], { radius: 6 + Math.sqrt(b.visits / mx) * 22, color: '#0F5A3E', weight: 1.5, fillColor: '#16805A', fillOpacity: 0.35 })
      .bindTooltip(`<b>${esc(b.name)}</b><br>${fmtN(b.visits)} visitas · ${fmtN(b.people)} pessoas`).addTo(map);
  }
  for (const s of D.stores || []) {
    if (s.lat == null) continue;
    window.L.marker([s.lat, s.lng], { icon: window.L.divIcon({ className: 'cli-store', html: '<span></span>', iconSize: [18, 18] }) })
      .bindTooltip(`<b>${esc(s.name)}</b><br>${fmtN(s.visits)} visitas`).addTo(map);
  }
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cdays]'); if (!b) return;
  days = Number(b.dataset.cdays); window.dispatchEvent(new HashChangeEvent('hashchange'));
});
