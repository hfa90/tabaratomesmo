// Cores de cada supermercado na Área do parceiro (parceiros.html?m=slug).
// A cor principal e a de destaque vêm da logomarca (admin › Supermercados › Editar › Cores da página).
// Daqui saem os tokens do site (--brand, --brand-2, --brand-soft, --brand-ink) já com contraste bom
// no tema claro e no escuro, mais --brand-accent para detalhes. Discreto: muda o tom, não a página.

// tiradas das logomarcas (assets/logos); valem enquanto a administração não escolher outras
const KNOWN = {
  'nova-era': ['#C21A19', '#F29100'],
  db: ['#009A3E', '#E2231A'],
  veneza: ['#1F2F6B', '#00A3D9'],
  'baratao-da-carne': ['#C8202F', '#2E7D32'],
  coema: ['#009048', '#E30613'],
};
const HEX = /^#[0-9a-f]{6}$/i;

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t)); // t = quanto de b
function lum(h) {
  const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** escurece (ou clareia) até ter contraste com o fundo */
function fit(c, bg, min) {
  const toward = lum(bg) > 0.5 ? '#000000' : '#FFFFFF';
  let out = c;
  for (let t = 0.06; contrast(out, bg) < min && t <= 0.9; t += 0.06) out = mix(c, toward, t);
  return out;
}

/** paleta do mercado: { primary, accent } */
export function palette(m = {}) {
  const k = KNOWN[m.slug] || [];
  const primary = [m.brand_primary, k[0], m.color].find((c) => HEX.test(c || '')) || '#0F5A3E';
  const accent = [m.brand_accent, k[1]].find((c) => HEX.test(c || '')) || mix(primary, '#FFD43B', 0.55);
  return { primary: primary.toUpperCase(), accent: accent.toUpperCase() };
}

/** tokens CSS para os dois temas */
export function tokens(m) {
  const { primary, accent } = palette(m);
  const L = { bg: '#FFFFFF' }, D = { bg: '#171C19' };
  const bL = fit(primary, L.bg, 4.6);                    // texto e botões no claro
  const bD = fit(mix(primary, '#FFFFFF', 0.25), D.bg, 5); // no escuro, um tom mais claro
  const ink = (c) => (contrast(c, '#FFFFFF') >= 4.5 ? '#FFFFFF' : '#0B0F0D');
  return {
    light: { '--brand': bL, '--brand-2': mix(bL, '#000000', 0.14), '--brand-soft': mix(primary, L.bg, 0.9), '--brand-ink': ink(bL),
      '--brand-accent': fit(accent, L.bg, 3), '--brand-accent-soft': mix(accent, L.bg, 0.88), '--brand-raw': primary },
    dark: { '--brand': bD, '--brand-2': mix(bD, '#FFFFFF', 0.12), '--brand-soft': mix(primary, D.bg, 0.8), '--brand-ink': ink(bD),
      '--brand-accent': fit(accent, D.bg, 3), '--brand-accent-soft': mix(accent, D.bg, 0.82), '--brand-raw': primary },
  };
}

/** pinta a página com as cores do mercado (ou volta ao verde do Tá Barato Mesmo? com m = null) */
export function apply(m) {
  const root = document.body;
  const props = ['--brand', '--brand-2', '--brand-soft', '--brand-ink', '--brand-accent', '--brand-accent-soft', '--brand-raw'];
  props.forEach((p) => { root.style.removeProperty(p + '-l'); root.style.removeProperty(p + '-d'); });
  if (!m) { root.classList.remove('is-branded'); delete root.dataset.mk; setThemeColor(null); return; }
  const t = tokens(m);
  for (const [k, v] of Object.entries(t.light)) root.style.setProperty(k + '-l', v);
  for (const [k, v] of Object.entries(t.dark)) root.style.setProperty(k + '-d', v);
  root.classList.add('is-branded'); root.dataset.mk = m.slug || '';
  setThemeColor(t.light['--brand-soft']);
}
function setThemeColor(c) {
  const meta = document.querySelector('meta[name="theme-color"]'); if (!meta) return;
  meta.dataset.base ||= meta.content;
  meta.content = c || meta.dataset.base;
}
