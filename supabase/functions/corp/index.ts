// Função "corp": o robô dos supermercados, @corp_tabaratomesmo_bot.
//   • Ligar: no portal (Resumo da semana › Ligar ao Telegram) sai um código; o portal abre
//     t.me/corp_tabaratomesmo_bot?start=<código> e o robô liga este Telegram ao supermercado.
//   • Toda segunda, 8h (Manaus): o resumo da semana (clientes que vieram pelo site, notas comprovadas,
//     gasto em anúncios e cupons, retorno, ranchos perdidos e por quê). Também por e-mail, se houver.
//   • Radar: quando um concorrente baixa o preço de um produto seu e fica mais barato, avisa na hora,
//     com o botão "Igualar" (grava o preço novo do seu mercado).
//   • "Não achei na loja": quando clientes avisam que não encontraram um produto numa loja sua.
//   • Comandos: /resumo (manda agora), /alertas (liga/desliga radar e faltas), /sair.
//
// Segredos (Supabase › Edge Functions › Secrets):
//   CORP_BOT_TOKEN    — token do @corp_tabaratomesmo_bot (do @BotFather; nunca vai para o site nem para o GitHub)
//   CORP_BOT_SECRET   — uma senha qualquer; o Telegram manda no cabeçalho (setWebhook secret_token)
//   NOTIFICAR_SEGREDO — a mesma do agendamento dos avisos (pg_cron chama esta função a cada 15 min)
//   RESEND_API_KEY + EMAIL_FROM — opcionais: mandam o resumo por e-mail (resend.com). Sem eles, só Telegram.
//   SITE_URL          — opcional; padrão https://hfa90.github.io/tabaratomesmo/
// Publicar:  supabase functions deploy corp --no-verify-jwt
import { createClient } from 'jsr:@supabase/supabase-js@2';

const TOKEN = Deno.env.get('CORP_BOT_TOKEN');
const SECRET = Deno.env.get('CORP_BOT_SECRET');
const SITE = (Deno.env.get('SITE_URL') || 'https://hfa90.github.io/tabaratomesmo/').replace(/\/?$/, '/');
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

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
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const brl = (v: number) => 'R$ ' + Number(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d),)/g, '.');
const portal = (hash = '') => `${SITE}parceiros.html${hash}`;
const CODE_RE = /^([a-z]{3})[\s-]?(\d{3})$/i;

// ---------------------------------------------------------------- resumo da semana
type Digest = { market: string; text: string; clients: number; revenue: number | null; spend: number; roi: number | null; [k: string]: unknown };

async function digestFor(market: number): Promise<Digest | null> {
  const { data, error } = await sb.rpc('market_weekly_digest', { p_market: market, p_days: 7 });
  if (error) { console.warn('resumo', market, error.message); return null; }
  return data as Digest;
}

/** e-mail simples (Resend), com o mesmo conteúdo do Telegram */
async function email(to: string[], d: Digest) {
  const key = Deno.env.get('RESEND_API_KEY'), from = Deno.env.get('EMAIL_FROM');
  if (!key || !from || !to.length) return false;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#171A18">
    ${d.text.split('\n').map((l) => `<p style="margin:0 0 8px">${l || '&nbsp;'}</p>`).join('')}
    <p style="margin:20px 0"><a href="${portal('#resumo')}" style="background:#0F5A3E;color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none">Abrir o portal</a></p>
    <p style="color:#6B726D;font-size:12px">Você recebe este resumo porque seu e-mail foi cadastrado no portal do Tá Barato Mesmo?. Para sair, peça ao responsável do supermercado ou remova em Resumo da semana.</p></div>`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to, subject: `${d.market}: sua semana no Tá Barato Mesmo?`, html }),
  });
  if (!r.ok) console.warn('e-mail', r.status, await r.text().catch(() => ''));
  return r.ok;
}

const digestKb = { inline_keyboard: [[{ text: '📊 Abrir o portal', url: portal('#resumo') }, { text: '📡 Radar', url: portal('#radar') }]] };

async function runDigests() {
  const { data: due, error } = await sb.rpc('corp_digest_due', {});
  if (error) return { error: error.message };
  let sent = 0, mails = 0;
  for (const row of (due ?? []) as { supermarket_id: number; week: string; now_request: boolean }[]) {
    const d = await digestFor(row.supermarket_id);
    if (!d) continue;
    const { data: chats } = await sb.rpc('corp_chats', { p_market: row.supermarket_id, p_kind: row.now_request ? null : 'weekly' });
    for (const c of (chats ?? []) as { chat_id: number }[]) { const r = await send(c.chat_id, d.text, { reply_markup: digestKb }); if (r?.ok) sent++; }
    if (!row.now_request) {
      const { data: em } = await sb.from('corp_emails').select('email').eq('supermarket_id', row.supermarket_id);
      if (await email((em ?? []).map((x: { email: string }) => x.email), d)) mails++;
    }
    await sb.rpc('corp_digest_done', { p_market: row.supermarket_id, p_week: row.week });
  }
  return { resumos: sent, emails: mails };
}

// ---------------------------------------------------------------- radar e faltas
type Alert = { id: number; supermarket_id: number; market: string; competitor: string; product: string; comp_price: number; comp_prev: number | null; my_price: number; lists: number; near: string[]; chats: number[] };
function radarText(a: Alert) {
  return [
    `📡 <b>O ${esc(a.competitor)} baixou ${esc(a.product)}</b>`,
    '',
    `Agora: <b>${brl(a.comp_price)}</b>${a.comp_prev ? ` (era ${brl(a.comp_prev)})` : ''}`,
    `No ${esc(a.market)}: ${brl(a.my_price)}, <b>${brl(a.my_price - a.comp_price)} acima</b>`,
    a.lists ? `🛒 Esse produto está em <b>${a.lists} ${a.lists === 1 ? 'lista aberta' : 'listas abertas'}</b> no site.` : '',
    a.near?.length ? `📍 Perto de lojas suas: ${esc(a.near.join(', '))}` : '',
  ].filter(Boolean).join('\n');
}
type Miss = { supermarket_id: number; store: string; neighborhood: string | null; store_id: number; product_id: number; product: string; n: number; total24: number; chats: number[] };

async function runAlerts() {
  await sb.rpc('radar_scan', { p_since: '3 hours' });
  const { data: alerts } = await sb.rpc('radar_collect', {});
  let radar = 0;
  for (const a of (alerts ?? []) as Alert[]) {
    const kb = { inline_keyboard: [[{ text: `✅ Igualar para ${brl(a.comp_price)}`, callback_data: `ig:${a.id}` }], [{ text: 'Ver no portal', url: portal('#radar') }]] };
    for (const chat of a.chats) { const r = await send(chat, radarText(a), { reply_markup: kb }); if (r?.ok) radar++; }
  }
  const { data: miss } = await sb.rpc('missing_collect', {});
  let faltas = 0;
  for (const m of (miss ?? []) as Miss[]) {
    const text = `🔎 <b>Cliente não achou na loja</b>\n\n${esc(m.product)}\n📍 ${esc(m.store)}${m.neighborhood ? ` (${esc(m.neighborhood)})` : ''}\n${m.total24 > 1 ? `<b>${m.total24} pessoas</b> avisaram nas últimas 24 h.` : '1 pessoa avisou agora há pouco.'}`;
    const kb = { inline_keyboard: [[{ text: '✅ Já repus', callback_data: `ok:${m.store_id}:${m.product_id}` }], [{ text: 'Ver no portal', url: portal('#faltas') }]] };
    for (const chat of m.chats) { const r = await send(chat, text, { reply_markup: kb }); if (r?.ok) faltas++; }
  }
  return { radar, faltas };
}

// ---------------------------------------------------------------- conversa
async function myMarkets(chat: number) {
  const { data } = await sb.from('corp_contacts').select('supermarket_id, weekly, radar, missing, supermarkets(name)').eq('chat_id', chat);
  return (data ?? []) as { supermarket_id: number; weekly: boolean; radar: boolean; missing: boolean; supermarkets: { name: string } | null }[];
}
const HELP = `Eu sou o robô dos supermercados parceiros do Tá Barato Mesmo?.\n\n📊 Toda segunda, 8h: o resumo da semana do seu mercado.\n📡 Na hora: quando um concorrente baixa o preço de um produto seu.\n🔎 Quando clientes não acham um produto numa loja sua.\n\nComandos: /resumo · /alertas · /sair`;

async function onText(chat: number, first: string, raw: string) {
  const t = raw.trim();
  const [cmd0, ...rest] = t.split(/\s+/);
  const cmd = cmd0.startsWith('/') ? cmd0.slice(1).split('@')[0].toLowerCase() : '';
  const arg = cmd ? rest.join('') : t.replace(/\s+/g, '');
  if ((cmd === 'start' && arg) || (!cmd && CODE_RE.test(t))) {
    const { data } = await sb.rpc('corp_link_consume', { p_code: arg, p_chat: chat, p_name: first });
    if (data) return send(chat, `✅ <b>Pronto!</b> Este Telegram agora recebe os avisos do <b>${esc(data.market)}</b>.\n\n${HELP}`);
    return send(chat, '⌛ Esse código expirou ou já foi usado. No portal, abra <b>Resumo da semana</b> e toque de novo em <b>Ligar ao Telegram</b>.');
  }
  const mine = await myMarkets(chat);
  if (!mine.length) return send(chat, `Olá${first ? `, ${esc(first)}` : ''}! ${HELP}\n\nPara começar, ligue este Telegram no portal: <b>Resumo da semana › Ligar ao Telegram</b>.`, { reply_markup: { inline_keyboard: [[{ text: 'Abrir o portal', url: portal('#resumo') }]] } });
  if (cmd === 'resumo') {
    for (const m of mine) { const d = await digestFor(m.supermarket_id); if (d) await send(chat, d.text, { reply_markup: digestKb }); }
    return;
  }
  if (cmd === 'alertas') {
    const on = !(mine[0].radar && mine[0].missing);
    await sb.from('corp_contacts').update({ radar: on, missing: on }).eq('chat_id', chat);
    return send(chat, on ? '🔔 Alertas do radar e de faltas <b>ligados</b>.' : '🔕 Alertas do radar e de faltas <b>pausados</b>. O resumo de segunda continua. Para voltar: /alertas');
  }
  if (cmd === 'sair') {
    await sb.from('corp_contacts').delete().eq('chat_id', chat);
    return send(chat, '👋 Este Telegram não recebe mais os avisos. Para voltar, ligue de novo pelo portal.');
  }
  return send(chat, `${HELP}\n\nLigado a: ${mine.map((m) => `<b>${esc(m.supermarkets?.name)}</b>`).join(', ')}`);
}

// deno-lint-ignore no-explicit-any
async function onCallback(cb: any) {
  const chat = cb.message?.chat?.id; const data = String(cb.data || '');
  const answer = (text: string) => tg('answerCallbackQuery', { callback_query_id: cb.id, text, show_alert: false });
  if (data.startsWith('ig:')) {
    const { data: r, error } = await sb.rpc('corp_match_price', { p_chat: chat, p_alert: Number(data.slice(3)) });
    if (error) return answer(error.message.slice(0, 180));
    await answer(r?.already ? 'Esse preço já tinha sido igualado.' : `Preço igualado: ${brl(r.price)}`);
    if (!r?.already) await send(chat, `✅ <b>${esc(r.product)}</b> agora está a <b>${brl(r.price)}</b> no site. Lembre de trocar a etiqueta na loja.`);
    return tg('editMessageReplyMarkup', { chat_id: chat, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [[{ text: 'Ver no portal', url: portal('#radar') }]] } });
  }
  if (data.startsWith('ok:')) {
    const [, store, product] = data.split(':').map(Number);
    const { error } = await sb.rpc('corp_resolve_missing', { p_chat: chat, p_store: store, p_product: product });
    if (error) return answer(error.message.slice(0, 180));
    await answer('Marcado como reposto. Obrigado!');
    return tg('editMessageReplyMarkup', { chat_id: chat, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [[{ text: '✅ Reposto', callback_data: 'x' }]] } });
  }
  return answer('');
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('ok');
  if (!TOKEN) return new Response('falta o segredo CORP_BOT_TOKEN', { status: 500 });
  // agendamento (pg_cron, a cada 15 min): radar, faltas e, na segunda, o resumo
  if (req.headers.get('x-segredo')) {
    const cron = Deno.env.get('NOTIFICAR_SEGREDO');
    if (!cron || req.headers.get('x-segredo') !== cron) return new Response('não autorizado', { status: 401 });
    try { return Response.json({ ...(await runAlerts()), ...(await runDigests()) }); }
    catch (e) { console.error('corp', e); return Response.json({ error: String(e) }, { status: 500 }); }
  }
  if (!SECRET || req.headers.get('x-telegram-bot-api-secret-token') !== SECRET) return new Response('não autorizado', { status: 401 });
  // deno-lint-ignore no-explicit-any
  let up: any; try { up = await req.json(); } catch { return new Response('ok'); }
  try {
    if (up.callback_query) await onCallback(up.callback_query);
    else if (up.message?.chat?.type === 'private' && typeof up.message.text === 'string') await onText(up.message.chat.id, up.message.from?.first_name ?? '', up.message.text);
  } catch (e) { console.error('corp', e); }
  return new Response('ok');
});
