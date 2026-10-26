// Leitor de frases de compra em português, sem IA: regras determinísticas.
//   "Nescau 500 gramas está de 12 reais e cinquenta centavos"
//   "nescau 500gramas 12 e 50 centavos" · "duas caixas de leite a 5,49" · "meio quilo de carne moída 19,90"
// parse(texto) → { qty, name, size: { amount, unit, label } | null, price | null }
// match(parsed, produtos) → melhores produtos do catálogo, com nota e se o tamanho confere.

// ---------------------------------------------------------------- normalização
export const strip = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const UNITS = {
  0: ['zero'], 1: ['um', 'uma', 'hum'], 2: ['dois', 'duas'], 3: ['tres'], 4: ['quatro'], 5: ['cinco'], 6: ['seis', 'meia duzia'],
  7: ['sete'], 8: ['oito'], 9: ['nove'], 10: ['dez'], 11: ['onze'], 12: ['doze'], 13: ['treze'], 14: ['quatorze', 'catorze'], 15: ['quinze'],
  16: ['dezesseis', 'dezasseis', 'dezeseis'], 17: ['dezessete', 'dezassete', 'dezesete'], 18: ['dezoito'], 19: ['dezenove', 'dezanove'],
  20: ['vinte'], 30: ['trinta'], 40: ['quarenta'], 50: ['cinquenta', 'cincoenta'], 60: ['sessenta'], 70: ['setenta'], 80: ['oitenta'], 90: ['noventa'],
  100: ['cem', 'cento'], 200: ['duzentos', 'duzentas'], 300: ['trezentos', 'trezentas'], 400: ['quatrocentos', 'quatrocentas'],
  500: ['quinhentos', 'quinhentas'], 600: ['seiscentos', 'seiscentas'], 700: ['setecentos', 'setecentas'], 800: ['oitocentos', 'oitocentas'],
  900: ['novecentos', 'novecentas'],
};
const WORD2NUM = new Map(Object.entries(UNITS).flatMap(([n, ws]) => ws.filter((w) => !w.includes(' ')).map((w) => [w, Number(n)])));

const UNIT_WORDS = [
  [/^(g|gr|grs|grama|gramas|gramos)$/, 'g'], [/^(kg|kgs|k|quilo|quilos|kilo|kilos|quilograma|quilogramas)$/, 'kg'],
  [/^(mg|miligrama|miligramas)$/, 'mg'], [/^(ml|mls|mililitro|mililitros)$/, 'ml'], [/^(l|lt|lts|litro|litros)$/, 'l'],
  [/^(un|und|unid|unidade|unidades|unds)$/, 'un'], [/^(rolo|rolos)$/, 'rolos'], [/^(m|metro|metros)$/, 'm'],
];
const unitOf = (w) => { for (const [re, u] of UNIT_WORDS) if (re.test(w)) return u; return null; };

const STOP = new Set(['esta', 'ta', 'tah', 'to', 'de', 'do', 'da', 'dos', 'das', 'por', 'a', 'o', 'os', 'as', 'custa', 'custando', 'custou', 'custam',
  'preco', 'precos', 'reais', 'real', 'centavo', 'centavos', 'com', 'no', 'na', 'nos', 'nas', 'e', 'sai', 'saindo', 'valor', 'ficou', 'fica', 'sao',
  'apenas', 'so', 'r', 'r$', 'rs', 'pra', 'para', 'agora', 'aqui', 'ai', 'la', 'cada', 'que', 'tem', 'peguei', 'pegar', 'levando', 'levei', 'leva', 'botei',
  'coloca', 'coloquei', 'adiciona', 'adicionar', 'anota', 'anotar', 'ok', 'tipo', 'mais', 'menos', 'uns', 'umas', 'conto', 'contos', 'pila', 'pilas',
  'promocao', 'oferta', 'em', 'leve', 'leva', 'pague', 'paga', 'segunda', 'desconto', 'porcento', 'metade', 'gratis', 'pela', 'quilo', 'quilos', 'kilo', 'kilos', 'kg', 'litro', 'unidade', 'grama', 'gramas', 'vale', 'valendo', 'deu', 'da', 'dá', 'x', 'vezes', 'quantidade', 'qtd', 'item', 'itens']);

/** tokeniza e troca números por extenso por algarismos ("vinte e cinco" → 25, "doze e cinquenta" fica "12 e 50") */
export function tokenize(text) {
  let s = strip(text)
    .replace(/r\$\s*/g, ' r$ ')
    .replace(/%/g, ' porcento ').replace(/\bpor\s*cento\b/g, ' porcento ')
    .replace(/\b2\s*(ª|a|º)(?=\s|$)/g, ' segunda ')
    .replace(/(\d)\s*:\s*(\d{2})(?!\d)/g, '$1,$2')            // "12:50" que o reconhecedor às vezes escreve
    .replace(/(\d)\s*(kg|kgs|g|gr|grs|ml|mls|l|lt|lts|un|und|unid|mg|k)\b/g, '$1 $2')
    .replace(/(\d)(gramas?|quilos?|kilos?|litros?|mililitros?|unidades?)\b/g, '$1 $2')
    .replace(/(\d)\s*x\b/g, '$1 x ').replace(/\bx\s*(\d)/g, ' x $1')
    .replace(/[^\w$,.\s]/g, ' ')
    .replace(/meia duzia/g, '6')
    .replace(/(\d)\.(\d{3})(?!\d)/g, '$1$2');                 // 1.000 → 1000
  const raw = s.split(/\s+/).filter(Boolean);
  // números por extenso: junta "vinte e cinco" (25), "cento e vinte" (120), "mil e quinhentos" (1500),
  // mas mantém separados "doze e cinquenta" (12 e 50), que é como se fala preço
  const room = (n) => (n % 1000 === 0 ? 1000 : n % 100 === 0 ? 100 : n % 10 === 0 ? 10 : 1);
  const out = [];
  let i = 0;
  while (i < raw.length) {
    if (!(WORD2NUM.has(raw[i]) || raw[i] === 'mil')) { out.push(raw[i]); i++; continue; }
    let acc = raw[i] === 'mil' ? 1000 : WORD2NUM.get(raw[i]);
    let j = i + 1;
    while (j < raw.length) {
      const joiner = raw[j] === 'e';
      const t = joiner ? raw[j + 1] : raw[j];
      if (t === 'mil' && !joiner) { acc = (acc || 1) * 1000; j++; continue; }
      const v = t === 'mil' ? null : WORD2NUM.get(t);
      if (v == null || v === 0 || !(v < room(acc)) || acc === 0) break;
      acc += v; j += joiner ? 2 : 1;
    }
    out.push(String(acc));
    i = j;
  }
  return out;
}

const isNum = (t) => /^\d+([.,]\d+)?$/.test(t);
const num = (t) => Number(String(t).replace(',', '.'));

/** valor de produto em gramas/ml/unidades para comparar tamanhos */
export function sizeBase(amount, unit) {
  if (amount == null || !unit) return null;
  return { g: [amount, 'g'], kg: [amount * 1000, 'g'], mg: [amount / 1000, 'g'], ml: [amount, 'ml'], l: [amount * 1000, 'ml'],
    un: [amount, 'un'], rolos: [amount, 'un'], m: [amount, 'm'] }[unit] || null;
}
const sizeLabel = (a, u) => `${String(a).replace('.', ',')} ${u === 'l' ? 'L' : u}`;

/** lê o tamanho escrito no catálogo ("500 g", "1,5 L", "12 un", "30 un") */
export function parseUnit(str) {
  const m = strip(str).match(/(\d+(?:[.,]\d+)?)\s*([a-z]+)/);
  if (!m) return null;
  const u = unitOf(m[2]); if (!u) return null;
  return { amount: num(m[1]), unit: u, base: sizeBase(num(m[1]), u) };
}

// ---------------------------------------------------------------- frase → item
export function parse(text) {
  const t = tokenize(text);
  const used = new Array(t.length).fill(false);
  let price = null, size = null, qty = null;

  const mark = (...idx) => idx.forEach((k) => { if (k >= 0 && k < t.length) used[k] = true; });

  // 0) promoção falada: "leve 3 pague 2", "segunda unidade 50% de desconto", "a segunda sai pela metade"
  let promo = null;
  for (let k = 0; k < t.length && !promo; k++) {
    if (/^(leve|leva|compre|compra)$/.test(t[k]) && isNum(t[k + 1]) && /^(pague|paga)$/.test(t[k + 2] || '') && isNum(t[k + 3])) {
      const buy = num(t[k + 1]), pay = num(t[k + 3]);
      if (buy > pay && pay > 0) { promo = { kind: 'leve', buy, pay, label: `Leve ${buy}, pague ${pay}` }; mark(k, k + 1, k + 2, k + 3); }
    } else if (t[k] === 'segunda') {
      for (let j = k + 1; j < Math.min(t.length, k + 7); j++) {
        let off = null;
        if (isNum(t[j]) && t[j + 1] === 'porcento') off = num(t[j]);
        else if (t[j] === 'metade') off = 50;
        else if (/^(gratis|graca)$/.test(t[j])) off = 100;
        if (off != null && off > 0 && off <= 100) {
          let end = t[j + 1] === 'porcento' ? j + 1 : j;
          while (/^(de|desconto|do|preco|off)$/.test(t[end + 1] || '')) end++;
          promo = { kind: 'segunda', off, label: off === 100 ? '2ª unidade grátis' : `2ª unidade com ${off}% off` };
          for (let z = k; z <= end; z++) mark(z);
          break;
        }
      }
    }
  }
  const centsAfter = (k) => { // "e 50 (centavos)" a partir de k (que aponta para "e")
    if (t[k] === 'e' && isNum(t[k + 1]) && Number.isInteger(num(t[k + 1])) && num(t[k + 1]) < 100 && !unitOf(t[k + 2] || '')) {
      return { cents: num(t[k + 1]), end: t[k + 2] === 'centavos' || t[k + 2] === 'centavo' ? k + 2 : k + 1 };
    }
    return null;
  };

  // 1) tamanho: número + unidade (com "e meio": "1 quilo e meio"); "meio quilo"
  for (let k = 0; k < t.length; k++) {
    if (size) break;
    if (t[k] === 'meio' || t[k] === 'meia') {
      const u = unitOf(t[k + 1] || '');
      if (u) { size = { amount: 0.5, unit: u }; mark(k, k + 1); }
      continue;
    }
    if (isNum(t[k]) && !used[k]) {
      const u = unitOf(t[k + 1] || '');
      if (u && u !== 'm') {
        let amount = num(t[k]); let end = k + 1;
        if (t[k + 2] === 'e' && (t[k + 3] === 'meio' || t[k + 3] === 'meia')) { amount += 0.5; end = k + 3; }
        // "1 l" logo antes de um preço: ainda é tamanho
        size = { amount, unit: u };
        for (let z = k; z <= end; z++) mark(z);
      }
    }
  }

  // 2) preço com moeda: "r$ 12,50", "12 reais (e 50 centavos)", "12,50 reais"
  for (let k = 0; k < t.length && price == null; k++) {
    if (t[k] === 'r$' && isNum(t[k + 1])) {
      price = num(t[k + 1]); mark(k, k + 1);
      const c = centsAfter(k + 2); if (c && Number.isInteger(price)) { price += c.cents / 100; for (let z = k + 2; z <= c.end; z++) mark(z); }
    } else if (isNum(t[k]) && !used[k] && /^(reais|real|conto|contos|pila|pilas)$/.test(t[k + 1] || '')) {
      price = num(t[k]); mark(k, k + 1);
      const c = centsAfter(k + 2); if (c) { price += c.cents / 100; for (let z = k + 2; z <= c.end; z++) mark(z); }
    }
  }
  // 3) "12 e 50 (centavos)" — inteiro seguido de "e" e centavos
  if (price == null) {
    for (let k = t.length - 1; k >= 0; k--) {
      if (used[k] || !isNum(t[k]) || !Number.isInteger(num(t[k]))) continue;
      const c = centsAfter(k + 1);
      if (c && !used[k + 2]) {
        price = num(t[k]) + c.cents / 100; for (let z = k; z <= c.end; z++) mark(z); break;
      }
    }
  }
  // 3b) dois inteiros seguidos no fim, segundo com 2 dígitos: "12 50" → 12,50
  if (price == null) {
    for (let k = t.length - 2; k >= 0; k--) {
      if (!used[k] && !used[k + 1] && /^\d+$/.test(t[k]) && /^\d{2}$/.test(t[k + 1]) && !unitOf(t[k + 2] || '')) {
        price = num(t[k]) + num(t[k + 1]) / 100; mark(k, k + 1); break;
      }
    }
  }
  // 4) decimal solto: "5,49"
  if (price == null) {
    for (let k = t.length - 1; k >= 0; k--) {
      if (!used[k] && /^\d+[.,]\d{1,2}$/.test(t[k])) { price = num(t[k]); mark(k); break; }
    }
  }
  // 5) só centavos: "90 centavos"
  if (price == null) {
    for (let k = 0; k < t.length; k++) if (!used[k] && isNum(t[k]) && /^centavos?$/.test(t[k + 1] || '')) { price = num(t[k]) / 100; mark(k, k + 1); break; }
  }

  // 6) quantidade: "2 x", "x 2", "2 unidades" (sem tamanho), número no começo antes de palavra
  for (let k = 0; k < t.length && qty == null; k++) {
    if (used[k]) continue;
    if (isNum(t[k]) && t[k + 1] === 'x') { qty = num(t[k]); mark(k, k + 1); }
    else if (t[k] === 'x' && isNum(t[k + 1])) { qty = num(t[k + 1]); mark(k, k + 1); }
    else if (t[k] === 'quantidade' && isNum(t[k + 1])) { qty = num(t[k + 1]); mark(k, k + 1); }
  }
  if (qty == null) {
    const first = t.findIndex((w, k) => !used[k] && !STOP.has(w));
    if (first >= 0 && isNum(t[first]) && Number.isInteger(num(t[first])) && num(t[first]) > 0 && num(t[first]) <= 50 && t[first + 1] && !isNum(t[first + 1]) && !unitOf(t[first + 1])) {
      qty = num(t[first]); mark(first);
    }
  }
  // 7) último número inteiro restante = preço ("nescau 500 gramas 12")
  if (price == null) {
    for (let k = t.length - 1; k >= 0; k--) {
      if (!used[k] && isNum(t[k])) { price = num(t[k]); mark(k); const c = centsAfter(k + 1); if (c) { price += c.cents / 100; for (let z = k + 1; z <= c.end; z++) mark(z); } break; }
    }
  }

  const nameTokens = t.filter((w, k) => !used[k] && !STOP.has(w) && !isNum(w) && w.length > 0);
  const name = nameTokens.join(' ').trim();
  return {
    text: String(text || '').trim(),
    qty: qty || 1,
    name,
    words: nameTokens,
    size: size ? { ...size, label: sizeLabel(size.amount, size.unit), base: sizeBase(size.amount, size.unit) } : null,
    price: price != null && price > 0 && price < 100000 ? Math.round(price * 100) / 100 : null,
    promo,
  };
}

/** quanto sai cada unidade numa promoção. promo: { kind: 'leve'|'segunda'|'atacado'|'depor', ... }, price = preço normal de 1 */
export function promoEffective(promo, price) {
  if (!promo || !(price > 0)) return null;
  let qty = 1, total = price;
  if (promo.kind === 'leve') { qty = promo.buy; total = price * promo.pay; }
  else if (promo.kind === 'segunda') { qty = 2; total = price + price * (1 - promo.off / 100); }
  else if (promo.kind === 'atacado') { qty = promo.from; total = promo.price * promo.from; }
  else if (promo.kind === 'depor') { qty = 1; total = promo.price; }
  const unit = total / qty;
  const normal = price * qty;
  return { qty, total: Math.round(total * 100) / 100, unit: Math.round(unit * 100) / 100, normal, save: Math.max(0, normal - total), pct: normal > 0 ? Math.max(0, (1 - total / normal) * 100) : 0 };
}

// ---------------------------------------------------------------- busca no catálogo
/** chave "fonética" do português falado no Brasil, para tolerar erros do reconhecedor */
export function phon(w) {
  let s = strip(w).replace(/[^a-z]/g, '');
  if (!s) return '';
  s = s.replace(/^h/, '').replace(/ph/g, 'f').replace(/ch|sh/g, 'x').replace(/lh/g, 'li').replace(/nh/g, 'ni')
    .replace(/qu([ei])/g, 'k$1').replace(/qu/g, 'k').replace(/gu([ei])/g, 'g$1').replace(/c([ei])/g, 's$1').replace(/c/g, 'k')
    .replace(/ç/g, 's').replace(/ss/g, 's').replace(/([aeiou])s([aeiou])/g, '$1z$2').replace(/z/g, 's')
    .replace(/y/g, 'i').replace(/w/g, 'v').replace(/x([aeiou])/g, 'x$1')
    .replace(/([aeiou])l$/g, '$1u').replace(/([aeiou])l([^aeiou])/g, '$1u$2')   // nescal → nescau, alface ~ aufase
    .replace(/(.)\1+/g, '$1');
  if (s.length > 3) s = s.replace(/(oes|aes|ais|eis|es|s)$/, (m) => ({ oes: 'ao', aes: 'ao', ais: 'au', eis: 'eu', es: '', s: '' }[m]));
  return s;
}

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length; if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const sim = (a, b) => (a && b ? 1 - lev(a, b) / Math.max(a.length, b.length) : 0);

// marcas e apelidos comuns → palavras do catálogo
const ALIASES = {
  nescau: 'achocolatado', toddy: 'achocolatado', ovomaltine: 'achocolatado', coca: 'refrigerante coca', cocacola: 'refrigerante coca',
  pepsi: 'refrigerante', fanta: 'refrigerante', sprite: 'refrigerante', bare: 'guarana', antarctica: 'guarana', kuat: 'guarana',
  omo: 'sabao po', ariel: 'sabao po', ype: 'detergente', limpol: 'detergente', qboa: 'agua sanitaria', candida: 'agua sanitaria',
  neve: 'papel higienico', personal: 'papel higienico', colgate: 'creme dental', closeup: 'creme dental', sorriso: 'creme dental',
  dove: 'sabonete', lux: 'sabonete', seda: 'shampoo', elseve: 'shampoo', comfort: 'amaciante', downy: 'amaciante',
  ninho: 'leite po', italac: 'leite', piracanjuba: 'leite', parmalat: 'leite', camil: 'feijao arroz', kicaldo: 'feijao',
  'tio joao': 'arroz', pilao: 'cafe', 'tres coracoes': 'cafe', melitta: 'cafe', soya: 'oleo', liza: 'oleo', uniao: 'acucar',
  cisne: 'sal', galo: 'macarrao', renata: 'macarrao', heinz: 'molho tomate', quero: 'milho', 'gomes da costa': 'sardinha',
  skol: 'cerveja', brahma: 'cerveja', budweiser: 'cerveja', crystal: 'agua', indaia: 'agua', 'del valle': 'suco', sadia: 'linguica', perdigao: 'linguica',
  aviacao: 'manteiga', catupiry: 'requeijao', vitarella: 'biscoito', uarini: 'farinha', mucarela: 'mussarela queijo', muçarela: 'queijo',
  mussarela: 'queijo', patinho: 'carne moida', frango: 'frango', ovo: 'ovos', zero: '',
};

function productIndex(products) {
  return products.map((p) => {
    const words = strip(`${p.name} ${p.brand || ''} ${p.category_name || ''}`).split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w));
    return { p, words, keys: [...new Set(words.map(phon).filter(Boolean))], brandKeys: strip(p.brand || '').split(/\s+/).map(phon).filter(Boolean), unit: parseUnit(p.unit) };
  });
}
let IDX = null, IDX_SRC = null;

/** procura o produto falado; devolve [{ p, score, sizeOk }] do melhor para o pior */
export function match(parsed, products, { limit = 3 } = {}) {
  if (IDX_SRC !== products) { IDX = productIndex(products); IDX_SRC = products; }
  const raw = parsed.words || [];
  if (!raw.length) return [];
  // expande apelidos (inclui pares de palavras como "tio joao")
  const qWords = [];
  for (let i = 0; i < raw.length; i++) {
    const two = raw[i] + ' ' + (raw[i + 1] || '');
    if (ALIASES[two] !== undefined) { qWords.push({ w: raw[i], brand: true }, { w: raw[i + 1], brand: true }, ...ALIASES[two].split(' ').filter(Boolean).map((w) => ({ w, alias: true }))); i++; continue; }
    qWords.push({ w: raw[i], brand: ALIASES[raw[i]] !== undefined });
    if (ALIASES[raw[i]]) ALIASES[raw[i]].split(' ').filter(Boolean).forEach((w) => qWords.push({ w, alias: true }));
  }
  // cada palavra falada lembra das palavras-apelido que vieram dela ("toddy" → "achocolatado")
  let owner = null;
  const q = qWords.map((x) => { if (!x.alias) owner = x; return { ...x, k: phon(x.w), owner: x.alias ? owner : null }; }).filter((x) => x.k.length > 1);
  if (!q.length) return [];
  const spokenWords = q.filter((x) => !x.alias);
  const aliasOf = (x) => q.filter((y) => y.alias && y.owner && y.owner.w === x.w);

  const scored = IDX.map((it) => {
    let hit = 0, brandHit = false;
    const scoreOf = (x) => Math.max(...it.keys.map((k) => (k.startsWith(x.k) && x.k.length >= 4 ? 0.95 : sim(x.k, k))));
    for (const x of spokenWords) {
      // a marca falada pode não estar no catálogo: vale o apelido dela, com peso um pouco menor
      const s = Math.max(scoreOf(x), ...aliasOf(x).map((y) => scoreOf(y) * 0.9));
      if (s >= 0.72) { hit += s; if (it.brandKeys.some((b) => sim(b, x.k) >= 0.8)) brandHit = true; }
    }
    const aliasHits = q.filter((x) => x.alias).map(scoreOf).filter((s) => s >= 0.8).length;
    const covered = spokenWords.length ? hit / spokenWords.length : 0;
    // quanto do nome do produto foi coberto (evita "leite" casar com "leite em pó" sem distinção)
    const nameKeys = strip(it.p.name).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)).map(phon);
    const nameCov = nameKeys.length ? nameKeys.filter((k) => q.some((x) => sim(x.k, k) >= 0.72 || (k.startsWith(x.k) && x.k.length >= 4))).length / nameKeys.length : 0;
    let score = covered * 0.6 + nameCov * 0.3 + (brandHit ? 0.15 : 0) + Math.min(aliasHits, 2) * 0.12;
    const id = score; // quão parecido é o produto, sem olhar o tamanho
    let sizeOk = null;
    if (parsed.size?.base && it.unit?.base) {
      const [a, ua] = parsed.size.base, [b, ub] = it.unit.base;
      sizeOk = ua === ub && Math.abs(a - b) / b <= 0.03;
      score += sizeOk ? 0.1 : -0.15;
    }
    return { p: it.p, score: Math.round(score * 100) / 100, id: Math.round(id * 100) / 100, sizeOk };
  }).filter((r) => r.id >= 0.45).sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/** decide o que fazer com o item falado num mercado */
export function verdict(parsed, best, marketId) {
  if (!best || best.id < 0.6) return { kind: 'novo', text: 'Ainda não temos esse produto no site.' };
  if (best.sizeOk === false) return { kind: 'tamanho', text: `Temos ${best.p.name} ${best.p.unit || ''}, mas não em ${parsed.size.label}.` };
  const x = best.p.prices?.find((y) => y.market_id === marketId);
  if (!x) return { kind: 'sem_preco', text: 'Ainda não temos o preço deste produto neste mercado.', site: null };
  if (parsed.price == null) return { kind: 'sem_valor', text: `No site: R$ ${x.price.toFixed(2).replace('.', ',')}`, site: x.price };
  if (Math.abs(parsed.price - x.price) <= 0.01) return { kind: 'confere', text: 'Preço confere com o site.', site: x.price };
  return { kind: 'diferente', text: `No site está R$ ${x.price.toFixed(2).replace('.', ',')}.`, site: x.price };
}
