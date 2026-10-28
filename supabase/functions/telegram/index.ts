// Função "telegram": o robô @tabaratomesmo_bot.
//   • "quanto tá o óleo?", "arroz 5kg"   → preços de hoje em cada mercado, do mais barato para o mais caro
//   • foto do QR da nota ou o link        → lê a nota na Sefaz (função nfce) e diz se dava para pagar menos;
//                                           com a conta ligada, guarda a nota (pontos, preços, gastos do mês)
//   • "põe café na lista", "minha lista"  → a mesma Lista do mês do site (user_state, chega na hora no site)
//   • ligar a conta: o site gera um código (Você › Conta › Telegram) e abre t.me/tabaratomesmo_bot?start=<código>
//
// Precisa de supabase/atualizacoes/atualizacao-2026-10-telegram.sql.
// Segredos (Supabase › Edge Functions › Secrets):
//   TELEGRAM_TOKEN   — o token do @BotFather (nunca vai para o site nem para o GitHub)
//   TELEGRAM_SECRET  — uma senha qualquer; o Telegram manda no cabeçalho de cada mensagem (setWebhook secret_token)
//   SITE_URL         — opcional; padrão https://hfa90.github.io/tabaratomesmo/
// Publicar:  supabase functions deploy telegram --no-verify-jwt   (o Telegram não manda login do Supabase)
//
// O leitor de frases é o mesmo do site: voice.js aqui é uma CÓPIA de js/voice.js (o Supabase não importa
// de github.io). Mudou js/voice.js? Copie para cá e publique a função de novo; o teste automático avisa se esquecer.
// Pelo painel: na função, "Add File" › voice.js, e cole o conteúdo.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import jsQRmod from 'npm:jsqr@1.4.0';
import jpeg from 'npm:jpeg-js@0.4.4';
// @ts-ignore: módulo JS do site, sem tipos
import { parse, match, strip } from './voice.js';

const TOKEN = Deno.env.get('TELEGRAM_TOKEN');
const SECRET = Deno.env.get('TELEGRAM_SECRET');
// deno-lint-ignore no-explicit-any
const jsQR: (d: Uint8ClampedArray, w: number, h: number, o?: unknown) => { data: string } | null = (jsQRmod as any).default ?? jsQRmod;
const SITE = (Deno.env.get('SITE_URL') || 'https://hfa90.github.io/tabaratomesmo/').replace(/\/?$/, '/');
const URL_ = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const sb = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

type Ctx = { chat: number; user: string | null; first: string };
type Price = { market_id: number; price: number; regular: number | null; at: string; src?: string; promo?: { title?: string; ends?: string; kind?: string; code?: string } | null };
type StorePromo = { market_id: number; store: string; neighborhood: string | null; price: number; regular: number; kind: string; code: string | null; ends: string | null };
type Product = { id: number; name: string; brand: string | null; unit: string | null; ean: string | null; photo?: string | null; category_name?: string; change_pct: number | null; prices: Price[]; storePromos?: StorePromo[] };

const BTN = { ofertas: '🔥 Ofertas de hoje', lista: '🛒 Minha lista', nota: '🧾 Mandar nota', ajuda: '❓ Ajuda' };
const MENU = { keyboard: [[{ text: BTN.ofertas }, { text: BTN.lista }], [{ text: BTN.nota }, { text: BTN.ajuda }]], resize_keyboard: true, is_persistent: true };
// código curto para ligar a conta: 3 letras + 3 números ("KQM482", aceita "KQM 482"); o antigo "L" + 32 hex continua valendo
const CODE_RE = /^([a-z]{3})[\s-]?(\d{3})$/i;
const OLD_CODE_RE = /^L[a-f0-9]{32}$/;

// ---------------------------------------------------------------- Telegram
async function tg(method: string, body: Record<string, unknown>) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) console.warn('telegram', method, j.description || r.status);
  return j;
}
const send = (chat: number, text: string, extra: Record<string, unknown> = {}) =>
  tg('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });
const edit = (chat: number, id: number, text: string, extra: Record<string, unknown> = {}) =>
  tg('editMessageText', { chat_id: chat, message_id: id, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });

// ---------------------------------------------------------------- formatos
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const brl = (v: number) => 'R$ ' + v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d),)/g, '.');
const pname = (p: Product) => [p.name, p.brand, p.unit].filter(Boolean).join(' ');
const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');
function ago(at: string) {
  const d = Math.floor((Date.now() - Date.parse(at)) / 864e5);
  const dot = d <= 2 ? '🟢' : d <= 7 ? '🟡' : '⚪';
  const t = d <= 0 ? 'hoje' : d === 1 ? 'ontem' : d < 7 ? `há ${d} dias` : d < 30 ? `há ${Math.round(d / 7)} sem.` : 'há mais de 1 mês';
  return `${dot} ${t}`;
}
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// aviso que acompanha todo preço mostrado pelo robô
const AVISO = '⚠️ <i>Os preços podem mudar sem aviso prévio. O Tá Barato Mesmo? não controla os preços dos supermercados: confira na loja antes de comprar.</i>';
const SRC: Record<string, string> = { nota: 'confirmado por nota fiscal', qr: 'confirmado por nota fiscal', comunidade: 'informado por clientes',
  mercado: 'informado pelo mercado', encarte: 'do encarte do mercado', coleta: 'coletado na loja', seed: 'coletado na loja' };
/** link do produto no site (abre o detalhe com todos os mercados) */
const productUrl = (id: number) => `${SITE}?produto=${id}#ofertas`;
/** foto do produto com endereço completo (o Telegram baixa a imagem) */
const photoUrl = (u?: string | null) => (!u ? null : /^https:\/\//i.test(u) ? u : /^\/\//.test(u) ? 'https:' + u : SITE + u.replace(/^\.?\//, ''));
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Manaus', weekday: 'short', day: '2-digit', month: '2-digit' });
/** até quando o preço vale: data da promoção, ou o aviso de que preço normal não tem data */
function validity(x?: Price | null) {
  if (!x) return '';
  if (x.promo?.ends) return `🗓️ ${x.promo.kind === 'exclusiva' ? 'Preço exclusivo' : 'Promoção'}${x.promo.title ? ` “${esc(cut(x.promo.title, 40))}”` : ''} válida até <b>${fmtDay(x.promo.ends)}</b>${x.promo.code ? ` · código no caixa: <code>${esc(x.promo.code)}</code>` : ''}.`;
  if (x.promo) return '🗓️ Promoção sem data de término informada pelo mercado.';
  return '🗓️ Preço normal da loja: o mercado não informa data de término.';
}

// ---------------------------------------------------------------- catálogo (guardado por 3 minutos)
let CAT: { markets: Map<number, { id: number; name: string }>; products: Product[]; byId: Map<number, Product>; byEan: Map<string, Product> } | null = null;
let CAT_AT = 0;
async function catalog() {
  if (CAT && Date.now() - CAT_AT < 3 * 60e3) return CAT;
  const m = await sb.from('supermarkets').select('id, name').eq('active', true);
  if (m.error) throw m.error;
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const p = await sb.from('v_products').select('id, name, brand, unit, ean, photo, category_name, change_pct, prices').order('id').range(from, from + 999);
    if (p.error) throw p.error;
    rows.push(...(p.data || []));
    if (!p.data || p.data.length < 1000) break;
  }
  const products: Product[] = rows.map((p) => ({
    ...p,
    change_pct: p.change_pct == null ? null : Number(p.change_pct),
    prices: (p.prices || []).map((x: any) => ({ ...x, price: Number(x.price), regular: x.regular == null ? null : Number(x.regular) }))
      .sort((a: Price, b: Price) => a.price - b.price),
  }));
  // promoções que valem só numa unidade (atualizacao-2026-10-promo-unidade.sql); sem a visão, segue sem elas
  const sp = await sb.from('v_store_promos').select('product_id, market_id, store, neighborhood, price, regular, kind, code, ends');
  const byP = new Map<number, StorePromo[]>();
  for (const r of (sp.error ? [] : sp.data || []) as any[]) {
    const x = { ...r, price: Number(r.price), regular: Number(r.regular) };
    byP.set(r.product_id, [...(byP.get(r.product_id) || []), x].sort((a, b) => a.price - b.price));
  }
  products.forEach((p) => { p.storePromos = byP.get(p.id) || []; });
  CAT = {
    markets: new Map((m.data || []).map((x: any) => [x.id, x])),
    products,
    byId: new Map(products.map((p) => [p.id, p])),
    byEan: new Map(products.filter((p) => p.ean).map((p) => [digits(p.ean).replace(/^0+/, ''), p])),
  };
  CAT_AT = Date.now();
  return CAT;
}
const marketName = (id: number) => CAT?.markets.get(id)?.name ?? 'Mercado';

/** acha produtos pelo que a pessoa escreveu (mesmo leitor tolerante do site) */
async function find(text: string, limit = 6) {
  const cat = await catalog();
  const q = strip(text).replace(/[?!.;:]/g, ' ')
    .replace(/\b(quanto|quantos|qual|quais|onde|cade|barato|barata|baratos|baratas|hoje|me|diz|diga|fala|encontro|acho|compro|comprar|preco|precos|valor)\b/g, ' ');
  const parsed = parse(q);
  if (!parsed.words?.length) return { parsed, res: [] as Array<{ p: Product; score: number; id: number }> };
  return { parsed, res: match(parsed, cat.products, { limit }) as Array<{ p: Product; score: number; id: number }> };
}

// ---------------------------------------------------------------- conta e lista
async function touch(chat: number, from: any) {
  const { data, error } = await sb.from('tg_contacts')
    .upsert({ chat_id: chat, first_name: from?.first_name ?? null, username: from?.username ?? null, last_seen_at: new Date().toISOString() }, { onConflict: 'chat_id' })
    .select('user_id').maybeSingle();
  if (error) console.warn('tg_contacts', error.message);
  return data?.user_id ?? null;
}

async function getList(user: string): Promise<Array<[number, number]>> {
  const { data } = await sb.from('user_state').select('value').eq('user_id', user).eq('key', 'tb.list').maybeSingle();
  return Array.isArray(data?.value) ? data!.value.filter((x: unknown) => Array.isArray(x) && Number.isFinite(Number(x[0]))) : [];
}
async function setList(user: string, list: Array<[number, number]>) {
  const { data: pr } = await sb.from('profiles').select('history_gen').eq('id', user).maybeSingle();
  const row = { user_id: user, key: 'tb.list', value: list, device: 'telegram', updated_at: new Date().toISOString() };
  let { error } = await sb.from('user_state').upsert({ ...row, gen: pr?.history_gen ?? 0 }, { onConflict: 'user_id,key' });
  if (error && /gen|PGRST204|column/i.test(error.message + error.code) && !/historico_zerado/.test(error.message))
    ({ error } = await sb.from('user_state').upsert(row, { onConflict: 'user_id,key' }));
  if (error) throw error;
}

function askLink(ctx: Ctx, why = 'usar a sua Lista do mês') {
  return send(ctx.chat, `🔗 Para ${why}, ligue sua conta do site. Leva 10 segundos:\n\n1. Abra o site e entre na sua conta\n2. Vá em <b>Você › Conta › Ligar ao Telegram</b>\n\nAinda não tem conta? Dá para criar lá, é grátis.`,
    { reply_markup: { inline_keyboard: [[{ text: '🌐 Abrir o site', url: SITE + '#conta?telegram' }]] } });
}

// ---------------------------------------------------------------- respostas
/** tela inicial: deixa claro onde a pessoa está e mostra o que dá para fazer, em botões */
async function welcome(ctx: Ctx, opts: { justLinked?: string | null } = {}) {
  const name = opts.justLinked ?? ctx.first;
  const status = opts.justLinked !== undefined
    ? `✅ <b>Conta ligada${opts.justLinked ? `, ${esc(String(opts.justLinked).split(' ')[0])}` : ''}!</b> A Lista do mês daqui é a mesma do site, e as notas que você mandar contam pontos.\n\n🔔 Quando mudar o preço do que você acompanha (favoritos, lista e o que já comprou), eu aviso aqui, das 8h às 21h. Para pausar: /avisos`
    : ctx.user ? '✅ Conectado à sua conta do site. 🔔 Aviso aqui quando mudar o preço do que você acompanha (/avisos para pausar).'
    : '🔗 Ligue sua conta do site para usar a Lista do mês e guardar notas (botão abaixo).';
  // 1ª mensagem: quem é o robô (e o teclado fixo com os atalhos)
  await send(ctx.chat,
    `🛒 Você está no robô oficial do <b>Tá Barato Mesmo?</b>\n@tabaratomesmo_bot · preços dos supermercados de Manaus\n\n${status}`,
    { reply_markup: MENU });
  // 2ª mensagem: as opções
  const quick = [['🍚 Arroz', 'arroz'], ['🫘 Feijão', 'feijao'], ['🛢️ Óleo', 'oleo'], ['☕ Café', 'cafe'], ['🥛 Leite', 'leite'], ['🍗 Frango', 'frango']]
    .map(([t, q]) => ({ text: t, callback_data: `q:${q}` }));
  return send(ctx.chat,
    `<b>O que você quer fazer${name && opts.justLinked === undefined ? `, ${esc(String(name).split(' ')[0])}` : ''}?</b>\n\n` +
    `🔎 Ou escreva o nome de um produto: <i>quanto tá o óleo?</i>, <i>arroz 5kg</i>\n` +
    `🧾 Para conferir uma compra, mande a foto do QR da nota fiscal`,
    { reply_markup: { inline_keyboard: [
      [{ text: '🔥 Ofertas de hoje', callback_data: 'ofertas' }, { text: '📉 Baixaram de preço', callback_data: 'baixou' }],
      [{ text: '🛒 Minha lista', callback_data: 'mylist' }, { text: '🧾 Conferir nota', callback_data: 'nota' }],
      quick.slice(0, 3), quick.slice(3),
      [ctx.user ? { text: '🌐 Abrir o site', url: SITE } : { text: '🔗 Ligar minha conta do site', url: SITE + '#conta?telegram' }],
    ] } });
}

/** onde a diferença entre mercados é maior hoje (promoções primeiro) */
async function ofertas(ctx: Ctx) {
  const cat = await catalog();
  const rows = cat.products.filter((p) => p.prices.length >= 2).map((p) => {
    const lo = p.prices[0], hi = p.prices[p.prices.length - 1].price;
    return { p, lo, pct: (hi - lo.price) / hi, promo: !!lo.promo };
  }).filter((r) => r.pct >= 0.05 || r.promo)
    .sort((a, b) => (Number(b.promo) - Number(a.promo)) || (b.pct - a.pct)).slice(0, 8);
  if (!rows.length) return send(ctx.chat, 'Hoje não achei diferenças grandes entre os mercados. Escreva um produto para ver o preço.');
  const lines = ['🔥 <b>Ofertas de hoje</b>: onde comprar no lugar certo faz mais diferença', ''];
  for (const r of rows) lines.push(`• ${esc(cut(pname(r.p), 40))}: <b>${brl(r.lo.price)}</b> no ${esc(marketName(r.lo.market_id))}${r.promo ? ' 🏷️' : ''} <i>(${Math.round(r.pct * 100)}% menos que o mais caro)</i>`);
  lines.push('', 'Toque num produto para ver todos os mercados.', '', AVISO);
  return send(ctx.chat, lines.join('\n'), { reply_markup: { inline_keyboard: [
    ...rows.map((r) => [{ text: cut(`${pname(r.p)} · ${brl(r.lo.price)}`, 60), callback_data: `p:${r.p.id}` }]),
    [{ text: '📉 Baixaram de preço', callback_data: 'baixou' }, { text: '↩️ Início', callback_data: 'home' }],
  ] } });
}

/** o que mais baixou na última semana */
async function baixou(ctx: Ctx) {
  const cat = await catalog();
  const rows = cat.products.filter((p) => p.change_pct != null && p.change_pct <= -1 && p.prices.length)
    .sort((a, b) => (a.change_pct! - b.change_pct!)).slice(0, 8);
  if (!rows.length) return send(ctx.chat, '📉 Nenhum preço baixou na última semana. Veja as <b>Ofertas de hoje</b>:', { reply_markup: { inline_keyboard: [[{ text: '🔥 Ofertas de hoje', callback_data: 'ofertas' }]] } });
  const lines = ['📉 <b>Baixaram de preço</b> na última semana', ''];
  for (const p of rows) lines.push(`• ${esc(cut(pname(p), 40))}: <b>−${String(Math.abs(p.change_pct!)).replace('.', ',')}%</b> · ${brl(p.prices[0].price)} no ${esc(marketName(p.prices[0].market_id))}`);
  lines.push('', AVISO);
  return send(ctx.chat, lines.join('\n'), { reply_markup: { inline_keyboard: [
    ...rows.map((p) => [{ text: cut(`${pname(p)} · ${brl(p.prices[0].price)}`, 60), callback_data: `p:${p.id}` }]),
    [{ text: '🔥 Ofertas de hoje', callback_data: 'ofertas' }, { text: '↩️ Início', callback_data: 'home' }],
  ] } });
}

/** liga a conta pelo código do site; devolve false se o código não vale */
async function linkWith(ctx: Ctx, code: string) {
  const { data, error } = await sb.rpc('tg_link_consume', { p_code: code, p_chat: ctx.chat, p_first: ctx.first || null, p_username: null });
  if (error || !data?.ok) return false;
  ctx.user = data.user_id;
  await welcome(ctx, { justLinked: data.name ?? '' });
  return true;
}

async function sendProduct(ctx: Ctx, p: Product) {
  await catalog();
  const lines = [`<b>${esc(pname(p))}</b>`, ''];
  if (!p.prices.length) lines.push('Ainda não temos preço deste produto.');
  p.prices.slice(0, 8).forEach((x, i) => {
    const medal = i === 0 ? '🥇' : `${i + 1}.`;
    const reg = x.regular ? ` <s>${brl(x.regular)}</s>` : '';
    const promo = x.promo ? ` 🏷️ <i>${esc(cut(x.promo.title || 'promoção', 30))}</i>` : '';
    lines.push(`${medal} ${esc(marketName(x.market_id))}: <b>${brl(x.price)}</b>${reg} · ${ago(x.at)}${promo}`);
  });
  if (p.prices.length > 1) {
    const hi = p.prices[p.prices.length - 1].price, lo = p.prices[0].price, d = hi - lo;
    if (d >= 0.05) lines.push('', `💡 Entre o mais caro e o mais barato: <b>${brl(d)}</b> (${Math.round((d / hi) * 100)}%).`);
  }
  if (p.change_pct != null && Math.abs(p.change_pct) >= 1)
    lines.push(`${p.change_pct < 0 ? '📉 Baixou' : '📈 Subiu'} ${String(Math.abs(p.change_pct)).replace('.', ',')}% na última semana.`);
  if (p.storePromos?.length) {
    lines.push('', '📍 <b>Promoção só em uma unidade:</b>');
    for (const x of p.storePromos.slice(0, 4)) lines.push(`• ${esc(x.store)}${x.neighborhood ? ` (${esc(x.neighborhood)})` : ''}: <b>${brl(x.price)}</b> <s>${brl(x.regular)}</s>${x.ends ? ` até ${fmtDay(x.ends)}` : ''}${x.kind === 'exclusiva' && x.code ? ` · código <code>${esc(x.code)}</code>` : ''}`);
  }
  if (p.prices[0]) lines.push('', validity(p.prices[0]));
  lines.push('', AVISO);
  return send(ctx.chat, lines.join('\n'), {
    reply_markup: { inline_keyboard: [
      [{ text: '➕ Pôr na lista', callback_data: `add:${p.id}` }, { text: '🔔 Avisar se mudar', callback_data: `fav:${p.id}` }],
      [{ text: '🌐 Ver no site', url: productUrl(p.id) }],
    ] },
  });
}

/** um produto só, ou um bem na frente dos outros: responde direto; senão pergunta qual */
const isSure = (res: Array<{ score: number; id: number }>) =>
  res[0].id >= 0.55 && (!res[1] || (res[0].id >= 0.6 && res[0].score - res[1].score >= 0.08));

function chooser(text: string, res: Array<{ p: Product }>, action = 'p') {
  return {
    text,
    reply_markup: { inline_keyboard: res.map(({ p }) => [{
      text: cut(`${pname(p)}${p.prices[0] ? ` · ${brl(p.prices[0].price)}` : ''}`, 60),
      callback_data: `${action}:${p.id}`,
    }]) },
  };
}

async function priceQuery(ctx: Ctx, text: string) {
  const { res } = await find(text);
  if (!res.length || res[0].id < 0.5)
    return send(ctx.chat, `🤔 Não achei “${esc(cut(text, 40))}”. Tente o nome mais simples, como <i>leite</i>, <i>arroz 5kg</i> ou <i>café Pilão</i>.`);
  if (isSure(res)) return sendProduct(ctx, res[0].p);
  const c = chooser('Qual destes?', res);
  return send(ctx.chat, c.text, { reply_markup: c.reply_markup });
}

/** texto da lista com onde ela sai mais barata */
async function listView(user: string, editing = false) {
  const cat = await catalog();
  const list = await getList(user);
  const items = list.map(([id, q]) => ({ p: cat.byId.get(Number(id)), q: Number(q) || 1 })).filter((x) => x.p) as Array<{ p: Product; q: number }>;
  if (!items.length) return { text: '🛒 Sua Lista do mês está vazia.\n\nEscreva, por exemplo: <i>põe arroz na lista</i>', markup: { inline_keyboard: [[{ text: '🌐 Abrir no site', url: SITE + '#lista' }]] } };
  const lines = [`🛒 <b>Sua Lista do mês</b> (${items.length} ${items.length > 1 ? 'itens' : 'item'})`, ''];
  for (const { p, q } of items.slice(0, 40)) {
    const b = p.prices[0];
    lines.push(`• ${q > 1 ? `${q}× ` : ''}${esc(cut(pname(p), 42))}${b ? ` · ${brl(b.price)} <i>(${esc(marketName(b.market_id))})</i>` : ''}`);
  }
  if (items.length > 40) lines.push(`… e mais ${items.length - 40} itens`);
  // quanto a lista inteira sai em cada mercado
  const rows = [...cat.markets.values()].map((m) => {
    let sum = 0, have = 0;
    for (const { p, q } of items) { const x = p.prices.find((y) => y.market_id === m.id); if (x) { sum += x.price * q; have++; } }
    return { m, sum, have };
  }).filter((r) => r.have >= Math.ceil(items.length * 0.6)).sort((a, b) => (b.have - a.have) || (a.sum - b.sum));
  const full = rows.filter((r) => r.have === items.length).sort((a, b) => a.sum - b.sum);
  const show = (full.length ? full : rows).slice(0, 3);
  if (show.length) {
    lines.push('', '<b>Onde a lista sai mais barata:</b>');
    show.forEach((r, i) => lines.push(`${['🥇', '🥈', '🥉'][i]} ${esc(r.m.name)}: <b>${brl(r.sum)}</b>${r.have < items.length ? ` <i>(sem ${items.length - r.have})</i>` : ''}`));
    if (full.length >= 2) lines.push(`💡 Diferença entre o 1º e o último: <b>${brl(full[full.length - 1].sum - full[0].sum)}</b>`);
  }
  const markup = editing
    ? { inline_keyboard: [...items.slice(0, 30).map(({ p }) => [{ text: `❌ ${cut(pname(p), 50)}`, callback_data: `rm:${p.id}` }]), [{ text: '✅ Pronto', callback_data: 'list' }]] }
    : { inline_keyboard: [[{ text: '✏️ Tirar itens', callback_data: 'edit' }, { text: '🌐 Abrir no site', url: SITE + '#lista' }]] };
  return { text: lines.join('\n'), markup };
}
async function showList(ctx: Ctx, editId?: number, editing = false) {
  if (!ctx.user) return askLink(ctx);
  const v = await listView(ctx.user, editing);
  return editId ? edit(ctx.chat, editId, v.text, { reply_markup: v.markup }) : send(ctx.chat, v.text, { reply_markup: v.markup });
}

async function addToList(ctx: Ctx, pid: number, qty = 1) {
  const list = await getList(ctx.user!);
  const i = list.findIndex(([id]) => Number(id) === pid);
  if (i >= 0) list[i] = [pid, (Number(list[i][1]) || 1) + qty]; else list.push([pid, qty]);
  await setList(ctx.user!, list);
}
async function addByText(ctx: Ctx, text: string) {
  if (!ctx.user) return askLink(ctx);
  const { parsed, res } = await find(text, 5);
  if (!res.length || res[0].id < 0.5) return send(ctx.chat, `🤔 Não achei “${esc(cut(text, 40))}” no catálogo.`);
  if (!isSure(res)) { const c = chooser('Qual destes vai para a lista?', res, 'add'); return send(ctx.chat, c.text, { reply_markup: c.reply_markup }); }
  const qty = Math.max(1, Math.min(99, Math.round(Number(parsed.qty) || 1)));
  await addToList(ctx, res[0].p.id, qty);
  return send(ctx.chat, `✅ Pus ${qty > 1 ? `${qty}× ` : ''}<b>${esc(pname(res[0].p))}</b> na sua lista.`,
    { reply_markup: { inline_keyboard: [[{ text: '🛒 Ver a lista', callback_data: 'list' }]] } });
}
async function removeByText(ctx: Ctx, text: string) {
  if (!ctx.user) return askLink(ctx);
  const cat = await catalog();
  const list = await getList(ctx.user);
  const inList = list.map(([id]) => cat.byId.get(Number(id))).filter(Boolean) as Product[];
  const res = match(parse(strip(text)), inList, { limit: 3 }) as Array<{ p: Product; id: number }>;
  if (!res.length || res[0].id < 0.5) return send(ctx.chat, `🤔 Não achei “${esc(cut(text, 40))}” na sua lista.`);
  await setList(ctx.user, list.filter(([id]) => Number(id) !== res[0].p.id));
  return send(ctx.chat, `🗑️ Tirei <b>${esc(pname(res[0].p))}</b> da lista.`);
}

// ---------------------------------------------------------------- nota fiscal
async function onNota(ctx: Ctx, url: string) {
  tg('sendChatAction', { chat_id: ctx.chat, action: 'typing' });
  const r = await fetch(`${URL_}/functions/v1/nfce`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${ANON}`, apikey: ANON }, body: JSON.stringify({ url }),
  });
  const n = await r.json().catch(() => ({}));
  if (!r.ok || !n.items?.length) return send(ctx.chat, `😕 ${esc(n.error || 'Não consegui ler esta nota agora. Tente de novo daqui a pouco.')}`);

  const cat = await catalog();
  const items = n.items.map((it: any) => {
    const code = digits(it.code).replace(/^0+/, '');
    let p: Product | null = code.length >= 7 ? cat.byEan.get(code) ?? null : null;
    if (!p) {
      const name = String(it.name || '').replace(/\b(UN|UND|PCT|CX|KG|LT)\b\.?$/i, '').replace(/[.*]/g, ' ');
      const b = (match(parse(name), cat.products) as Array<{ p: Product; id: number }>)[0];
      if (b && b.id >= 0.6) p = b.p;
    }
    return { ...it, qty: Number(it.qty) || 1, unit_price: Number(it.unit_price) || 0, p };
  });
  const known = items.filter((i: any) => i.p);

  // guarda na conta (pontos, preços com a data da compra, gastos do mês)
  let saved: any = null, saveErr = '';
  if (ctx.user) {
    const payload = { ...n, supermarket_id: null, items: n.items.map((it: any, i: number) => ({ ...it, product_id: items[i].p?.id ?? null })) };
    const { data, error } = await sb.rpc('receipt_ingest', { p_user: ctx.user, p: payload });
    if (error) saveErr = error.message; else saved = data;
  }
  const boughtAt: number | null = saved?.supermarket_id ?? null;

  const lines = [`🧾 <b>${esc(n.store?.name || 'Nota fiscal')}</b>${n.date ? ` · ${esc(String(n.date).slice(0, 10))}` : ''}`,
    `Total: <b>${n.total != null ? brl(Number(n.total)) : '—'}</b> · ${n.items.length} itens${known.length < n.items.length ? ` (reconheci ${known.length})` : ''}`];

  if (known.length) {
    const paid = known.reduce((s: number, i: any) => s + i.unit_price * i.qty, 0);
    const rows = [...cat.markets.values()].map((m) => {
      let sum = 0, have = 0;
      for (const i of known) { const x = i.p.prices.find((y: Price) => y.market_id === m.id); if (x) { sum += x.price * i.qty; have++; } else sum += i.unit_price * i.qty; }
      return { m, sum, have };
    }).filter((r) => r.have >= Math.ceil(known.length * 0.6)).sort((a, b) => a.sum - b.sum);
    const best = rows[0];
    if (best && paid - best.sum >= 1 && best.m.id !== boughtAt)
      lines.push('', `💡 Hoje estes ${known.length} itens sairiam <b>${brl(paid - best.sum)} mais baratos</b> no <b>${esc(best.m.name)}</b>.`);
    else if (best) lines.push('', '👏 Você comprou bem: não achei lugar que saísse mais barato para estes itens hoje.');
    // onde pagou mais caro, item a item
    const over = known.map((i: any) => {
      const x = i.p.prices[0] as Price | undefined;
      return x && x.market_id !== boughtAt ? { i, x, d: (i.unit_price - x.price) * i.qty } : null;
    }).filter((o: any) => o && o.d >= 0.3).sort((a: any, b: any) => b.d - a.d).slice(0, 3);
    if (over.length) {
      lines.push('', '<b>Onde a diferença foi maior:</b>');
      for (const o of over) lines.push(`• ${esc(cut(pname(o.i.p), 36))}: ${brl(o.i.unit_price)} aqui · <b>${brl(o.x.price)}</b> no ${esc(marketName(o.x.market_id))}`);
    }
  }

  const extra: Record<string, unknown> = {};
  if (saved?.duplicate === 'mine') lines.push('', '📁 Esta nota já estava na sua conta.');
  else if (saved) lines.push('', `✅ Nota guardada na sua conta: <b>+${saved.points ?? 0} pontos</b>${saved.prices_added ? ` · ${saved.prices_added} preços atualizados no site` : ''}.`);
  else if (saveErr) lines.push('', `ℹ️ ${esc(saveErr)}`);
  else {
    lines.push('', '🔗 Ligue sua conta para guardar esta nota, ganhar pontos e ver seus gastos do mês: /conta');
  }
  if (ctx.user) extra.reply_markup = { inline_keyboard: [[{ text: '📊 Ver minhas notas', url: SITE + '#notas' }]] };
  return send(ctx.chat, lines.join('\n'), extra);
}

/** lê o QR de uma foto (JPEG) */
async function onPhoto(ctx: Ctx, fileId: string, size = 0) {
  if (size > 6 * 1024 * 1024) return send(ctx.chat, '📷 Essa imagem é grande demais. Mande como foto (não como arquivo).');
  tg('sendChatAction', { chat_id: ctx.chat, action: 'typing' });
  const f = await tg('getFile', { file_id: fileId });
  if (!f.ok) return send(ctx.chat, '😕 Não consegui baixar a foto. Tente de novo.');
  const buf = new Uint8Array(await (await fetch(`https://api.telegram.org/file/bot${TOKEN}/${f.result.file_path}`)).arrayBuffer());
  let text: string | null = null;
  try {
    const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 160 });
    text = readQR(img.data, img.width, img.height);
  } catch (e) { console.warn('jpeg', String(e)); }
  if (text && /^https?:\/\/\S+\.gov\.br/i.test(text.trim())) return onNota(ctx, text.trim());
  if (text) return send(ctx.chat, '🤔 Li um QR, mas não é de uma nota fiscal (NFC-e).');
  return send(ctx.chat, '📷 Não consegui ler o QR desta foto.\n\nDicas: foto de perto, só do QR, sem sombra e sem tremer. Ou cole aqui o <b>link</b> da nota (o endereço que aparece ao ler o QR com a câmera do celular).');
}
function readQR(data: Uint8Array, w: number, h: number): string | null {
  const full = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), w, h, { inversionAttempts: 'attemptBoth' });
  if (full?.data) return full.data;
  // segunda tentativa: só o meio da foto (o QR costuma estar no centro e fica maior)
  const cw = Math.floor(w * 0.6), ch = Math.floor(h * 0.6), x0 = Math.floor((w - cw) / 2), y0 = Math.floor((h - ch) / 2);
  const crop = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) crop.set(data.subarray(((y + y0) * w + x0) * 4, ((y + y0) * w + x0 + cw) * 4), y * cw * 4);
  return jsQR(crop, cw, ch, { inversionAttempts: 'attemptBoth' })?.data ?? null;
}

// ---------------------------------------------------------------- avisos de preço (agendamento a cada 15 min)
async function toggleAlerts(ctx: Ctx) {
  if (!ctx.user) return askLink(ctx, 'receber avisos quando o preço mudar');
  const { data } = await sb.from('tg_contacts').select('alerts').eq('chat_id', ctx.chat).maybeSingle();
  const on = !(data?.alerts ?? true);
  await sb.from('tg_contacts').update({ alerts: on }).eq('chat_id', ctx.chat);
  return send(ctx.chat, on
    ? '🔔 <b>Avisos de preço ligados.</b> Quando mudar o preço do que você acompanha (favoritos, Lista do mês e o que já comprou), eu aviso aqui, das 8h às 21h, no máximo 6 por dia.'
    : '🔕 <b>Avisos de preço pausados.</b> Para voltar a receber, mande /avisos de novo.');
}

type Alert = { chat_id: number; product_id: number; name: string; brand: string | null; unit: string | null; photo: string | null;
  from: number; to: number; from_market: number | null; best: Price };

/** texto do aviso: o que mudou, onde, até quando vale, de onde veio o preço e o aviso de que pode mudar */
function alertText(a: Alert) {
  const down = a.to < a.from, pct = Math.round(Math.abs(a.to - a.from) / a.from * 100);
  const name = [a.name, a.brand, a.unit].filter(Boolean).join(' ');
  const where = marketName(a.best.market_id);
  const before = a.from_market && a.from_market !== a.best.market_id ? ` (era no ${esc(marketName(a.from_market))})` : '';
  return [
    `${down ? '📉 <b>Baixou' : '📈 <b>Subiu'}: ${esc(name)}</b>`,
    '',
    `De ${brl(a.from)}${before} por <b>${brl(a.to)}</b> no <b>${esc(where)}</b> (${down ? '−' : '+'}${pct}%)` + (a.best.regular ? ` · preço normal ${brl(a.best.regular)}` : ''),
    validity(a.best),
    `🕒 Atualizado ${ago(a.best.at).replace(/^\S+ /, '')}${a.best.src && SRC[a.best.src] ? `, ${SRC[a.best.src]}` : ''}.`,
    '',
    `🔗 <a href="${productUrl(a.product_id)}">Ver no site, com todos os mercados</a>`,
    '',
    AVISO,
  ].filter((l, i, arr) => l !== '' || arr[i - 1] !== '').join('\n');
}

async function sendAlert(a: Alert) {
  const kb = { inline_keyboard: [
    [{ text: '🌐 Ver no site', url: productUrl(a.product_id) }, { text: '➕ Pôr na lista', callback_data: `add:${a.product_id}` }],
    [{ text: '🔕 Pausar avisos', callback_data: 'mute' }],
  ] };
  const text = alertText(a);
  const photo = photoUrl(a.photo);
  let r = photo && text.length <= 1024
    ? await tg('sendPhoto', { chat_id: a.chat_id, photo, caption: text, parse_mode: 'HTML', reply_markup: kb })
    : null;
  // sem foto, foto que o Telegram não conseguiu baixar ou texto longo: vai como mensagem
  if (!r?.ok && r?.error_code !== 403) r = await send(a.chat_id, text, { reply_markup: kb });
  return r;
}

async function runAlerts() {
  await catalog();
  const { data, error } = await sb.rpc('tg_alerts_collect', { p_limit: 300 });
  if (error) return { error: error.message };
  const list = (data ?? []) as Alert[];
  let ok = 0, fail = 0;
  for (const a of list) {
    const r = await sendAlert(a);
    if (r?.ok) ok++;
    else {
      fail++;
      // a pessoa bloqueou o robô: para de tentar
      if (r?.error_code === 403) await sb.from('tg_contacts').update({ alerts: false }).eq('chat_id', a.chat_id);
    }
  }
  return { enviados: ok, falharam: fail };
}

// ---------------------------------------------------------------- comandos e roteamento
async function onText(ctx: Ctx, raw: string) {
  const t = raw.trim();
  const url = t.match(/https?:\/\/\S+/i)?.[0];
  if (url && /\.gov\.br/i.test(url)) return onNota(ctx, url);

  if (t.startsWith('/')) {
    const [cmd0, ...rest] = t.split(/\s+/);
    const cmd = cmd0.slice(1).split('@')[0].toLowerCase(), arg = rest.join(' ');
    if (cmd === 'start' && (OLD_CODE_RE.test(arg) || CODE_RE.test(arg))) {
      if (await linkWith(ctx, arg)) return;
      await send(ctx.chat, '⌛ Esse código de ligação expirou ou já foi usado. No site, toque de novo em <b>Ligar ao Telegram</b>.');
      return welcome(ctx);
    }
    if (cmd === 'start' || cmd === 'ajuda' || cmd === 'help' || cmd === 'menu' || cmd === 'inicio') return welcome(ctx);
    if (cmd === 'ofertas') return ofertas(ctx);
    if (cmd === 'baixou' || cmd === 'baixaram') return baixou(ctx);
    if (cmd === 'lista') return showList(ctx);
    if (cmd === 'nota') return notaHelp(ctx);
    if (cmd === 'conta') return ctx.user
      ? send(ctx.chat, '✅ Sua conta do site está ligada a este Telegram.\n\nPara desligar: /sair')
      : askLink(ctx, 'usar a lista, guardar notas e ganhar pontos');
    if (cmd === 'avisos') return toggleAlerts(ctx);
    if (cmd === 'sair') {
      await sb.from('tg_contacts').update({ user_id: null, linked_at: null }).eq('chat_id', ctx.chat);
      return send(ctx.chat, '👋 Desliguei sua conta deste Telegram. Os preços continuam funcionando; para ligar de novo: /conta');
    }
    return welcome(ctx);
  }
  if (t === BTN.ofertas) return ofertas(ctx);
  if (t === BTN.lista) return showList(ctx);
  if (t === BTN.nota) return notaHelp(ctx);
  if (t === BTN.ajuda) return welcome(ctx);
  // código do site digitado à mão ("KQM 482"); se não for um código válido, segue como pesquisa
  if (CODE_RE.test(t) && await linkWith(ctx, t)) return;

  const s = strip(t).replace(/[?!.,;:]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(ver |mostra |manda |minha |a )*lista( do mes)?$/.test(s)) return showList(ctx);
  let m = s.match(/^(poe|por|coloca|colocar|adiciona|adicionar|bota|botar|anota|anotar|inclui|incluir|add)\s+(.+?)(\s+(na|a)\s+(minha\s+)?lista)?$/);
  if (m) return addByText(ctx, m[2]);
  m = s.match(/^(tira|tirar|remove|remover|apaga|apagar|exclui|excluir)\s+(.+?)(\s+da\s+(minha\s+)?lista)?$/);
  if (m) return removeByText(ctx, m[2].replace(/^(o|a|os|as)\s+/, ''));
  if (/^(oi|ola|oie|bom dia|boa tarde|boa noite|e ai|opa|menu|ajuda|inicio|start|obrigad[oa]|valeu)$/.test(s)) return welcome(ctx);
  if (/^(ofertas?( de hoje)?|promocao|promocoes|promo)$/.test(s)) return ofertas(ctx);
  if (/^(baixou|baixaram|o que baixou)$/.test(s)) return baixou(ctx);
  return priceQuery(ctx, t);
}
const notaHelp = (ctx: Ctx) => send(ctx.chat, '🧾 Mande aqui a <b>foto do QR</b> da nota fiscal (de perto, só do QR) ou cole o <b>link</b> da nota.\n\nEu leio os itens na Sefaz e digo se dava para pagar menos em outro mercado.');

async function onCallback(ctx: Ctx, cb: any) {
  const [k, v] = String(cb.data || '').split(':');
  const pid = Number(v);
  const msgId = cb.message?.message_id;
  const answer = (text?: string) => tg('answerCallbackQuery', { callback_query_id: cb.id, ...(text ? { text } : {}) });
  const cat = await catalog();
  if (k === 'p') { await answer(); const p = cat.byId.get(pid); return p ? sendProduct(ctx, p) : send(ctx.chat, 'Esse produto saiu do catálogo.'); }
  if (k === 'home') { await answer(); return welcome(ctx); }
  if (k === 'mute' || k === 'unmute') {
    await sb.from('tg_contacts').update({ alerts: k === 'unmute' }).eq('chat_id', ctx.chat);
    return answer(k === 'mute' ? '🔕 Avisos de preço pausados. Para voltar: /avisos' : '🔔 Avisos de preço ligados.');
  }
  if (k === 'mylist') { await answer(); return showList(ctx); }
  if (k === 'ofertas') { await answer(); return ofertas(ctx); }
  if (k === 'baixou') { await answer(); return baixou(ctx); }
  if (k === 'nota') { await answer(); return notaHelp(ctx); }
  if (k === 'q') { await answer(); return priceQuery(ctx, v || ''); }
  if (k === 'list') { await answer(); return showList(ctx, msgId); }
  if (k === 'edit') { await answer(); return showList(ctx, msgId, true); }
  if (!ctx.user) { await answer(); return askLink(ctx, k === 'fav' ? 'acompanhar preços' : 'usar a sua Lista do mês'); }
  if (k === 'add') {
    const p = cat.byId.get(pid); if (!p) return answer('Esse produto saiu do catálogo.');
    await addToList(ctx, pid, 1);
    return answer(`✅ ${cut(pname(p), 60)} está na sua lista`);
  }
  if (k === 'rm') {
    const list = await getList(ctx.user);
    await setList(ctx.user, list.filter(([id]) => Number(id) !== pid));
    await answer('Tirei da lista');
    return showList(ctx, msgId, true);
  }
  if (k === 'fav') {
    const { error } = await sb.from('favorites').upsert({ user_id: ctx.user, product_id: pid }, { onConflict: 'user_id,product_id', ignoreDuplicates: true });
    if (error) return answer('Não consegui agora. Tente de novo.');
    await answer('🔔 Pronto! Aviso aqui quando o preço mudar.');
    const { data: ct } = await sb.from('tg_contacts').select('alerts').eq('chat_id', ctx.chat).maybeSingle();
    return ct?.alerts === false ? send(ctx.chat, '🔕 Seus avisos de preço estão pausados. Para voltar a receber: /avisos') : undefined;
  }
  return answer();
}

async function handle(up: any) {
  const msg = up.message;
  const cb = up.callback_query;
  const chat = msg?.chat ?? cb?.message?.chat;
  if (!chat || chat.type !== 'private') return; // só conversas diretas

  // o Telegram reenvia se demoramos: cada mensagem é tratada uma vez só
  const ins = await sb.from('tg_updates').insert({ update_id: up.update_id, chat_id: chat.id });
  if (ins.error) { if (ins.error.code === '23505') return; console.warn('tg_updates', ins.error.message); }
  // freio contra abuso: no máximo 20 mensagens por minuto por pessoa
  const { count } = await sb.from('tg_updates').select('update_id', { count: 'exact', head: true })
    .eq('chat_id', chat.id).gte('at', new Date(Date.now() - 60e3).toISOString());
  if ((count ?? 0) > 20) return;
  if (Math.random() < 0.02) await sb.from('tg_updates').delete().lt('at', new Date(Date.now() - 3 * 864e5).toISOString());

  const from = msg?.from ?? cb?.from;
  const ctx: Ctx = { chat: chat.id, user: await touch(chat.id, from), first: from?.first_name ?? '' };
  if (cb) return onCallback(ctx, cb);
  if (msg.photo?.length) return onPhoto(ctx, msg.photo[msg.photo.length - 1].file_id);
  if (msg.document) {
    if (/^image\/jpe?g$/i.test(msg.document.mime_type || '')) return onPhoto(ctx, msg.document.file_id, msg.document.file_size || 0);
    return send(ctx.chat, '📄 Por enquanto eu leio <b>foto</b> do QR da nota (JPG) ou o <b>link</b> da nota. PDF e outros arquivos, só pelo site.');
  }
  if (msg.voice || msg.audio) return send(ctx.chat, '🎙️ Ainda não entendo áudio. Escreva o nome do produto, tipo <i>quanto tá o leite?</i>');
  if (typeof msg.text === 'string') return onText(ctx, msg.text);
  return welcome(ctx);
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('ok');
  // agendamento (pg_cron, a cada 15 min): manda os avisos de preço. Usa a mesma senha da função "notificar".
  const cron = Deno.env.get('NOTIFICAR_SEGREDO');
  if (req.headers.get('x-segredo')) {
    if (!cron || req.headers.get('x-segredo') !== cron || !TOKEN) return new Response('não autorizado', { status: 401 });
    try { return Response.json(await runAlerts()); } catch (e) { console.error('avisos', e); return Response.json({ error: String(e) }, { status: 500 }); }
  }
  if (!TOKEN || !SECRET) return new Response('faltam os segredos TELEGRAM_TOKEN e TELEGRAM_SECRET', { status: 500 });
  if (req.headers.get('x-telegram-bot-api-secret-token') !== SECRET) return new Response('não autorizado', { status: 401 });
  let up: any;
  try { up = await req.json(); } catch { return new Response('ok'); }
  try { await handle(up); } catch (e) {
    console.error('telegram', e);
    const chat = up?.message?.chat?.id ?? up?.callback_query?.message?.chat?.id;
    if (chat) await send(chat, '😕 Deu um erro aqui do meu lado. Tente de novo em instantes.').catch(() => {});
  }
  // sempre 200: senão o Telegram reenvia a mesma mensagem várias vezes
  return new Response('ok');
});
