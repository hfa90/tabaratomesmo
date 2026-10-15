// Preço por quilo, litro ou unidade, e "qual tamanho compensa".
// Usa o tamanho escrito no catálogo ("500 g", "1,5 L", "30 un") e o leitor de unidades do voice.js.
import { parseUnit, strip } from './voice.js';
import { brl } from './core.js';

/** quantidade do produto em kg, L ou unidades: { qty, kind: 'kg'|'L'|'un', word } */
export function sizeOf(unitText) {
  const u = parseUnit(unitText || '');
  if (!u?.base) return null;
  const [v, b] = u.base;
  if (!(v > 0)) return null;
  if (b === 'g') return { qty: v / 1000, kind: 'kg', word: 'quilo' };
  if (b === 'ml') return { qty: v / 1000, kind: 'L', word: 'litro' };
  if (b === 'un') return { qty: v, kind: 'un', word: 'unidade' };
  return null;
}

/** preço por kg / L / unidade. { value, kind, word, text: "R$ 5,15 o quilo", short: "R$ 5,15/kg" } */
export function perUnit(unitText, price) {
  const s = sizeOf(unitText);
  if (!s || !(price > 0)) return null;
  const value = price / s.qty;
  const short = `${brl(value)}/${s.kind === 'un' ? 'un' : s.kind}`;
  const text = s.kind === 'un' ? `${brl(value)} cada` : `${brl(value)} o ${s.word}`;
  return { value, kind: s.kind, word: s.word, qty: s.qty, short, text };
}

/** mostra o preço por kg só quando ajuda: tamanhos diferentes de 1 kg / 1 L / 1 un */
export function perUnitBadge(unitText, price) {
  const r = perUnit(unitText, price);
  if (!r || Math.abs(r.qty - 1) < 1e-9) return '';
  return `<span class="ppu" title="Preço por ${r.word}">${r.short}</span>`;
}

const baseName = (p) => strip(p.name).replace(/\s+/g, ' ').trim();

/** outros tamanhos do mesmo produto (mesmo nome), do que sai mais barato por kg/L/un para o mais caro */
export function sizeSiblings(p, products, priceOf) {
  const me = sizeOf(p.unit);
  if (!me) return [];
  const key = baseName(p);
  const list = products.filter((q) => baseName(q) === key && sizeOf(q.unit)?.kind === me.kind)
    .map((q) => { const price = priceOf(q); return price ? { p: q, price, pu: perUnit(q.unit, price) } : null; })
    .filter(Boolean);
  const sizes = new Set(list.map((x) => x.pu.qty));
  if (sizes.size < 2) return [];
  return list.sort((a, b) => a.pu.value - b.pu.value);
}

/** compara dois pacotes: { a: {price, amount, unit}, b: {...} } → quem ganha e quanto */
export function compareTwo(a, b) {
  const pa = perUnit(`${a.amount} ${a.unit}`, a.price), pb = perUnit(`${b.amount} ${b.unit}`, b.price);
  if (!pa || !pb || pa.kind !== pb.kind) return null;
  const diff = Math.abs(pa.value - pb.value);
  const tie = diff / Math.max(pa.value, pb.value) < 0.005;
  const win = tie ? null : pa.value < pb.value ? 'a' : 'b';
  return { pa, pb, win, diff, pct: tie ? 0 : (diff / Math.max(pa.value, pb.value)) * 100 };
}
