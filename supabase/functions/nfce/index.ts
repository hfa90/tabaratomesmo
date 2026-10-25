// Função "nfce": lê a página de consulta da NFC-e (o link do QR da nota) e devolve os itens em JSON.
// O navegador não consegue abrir a página da Sefaz direto (bloqueio de CORS), por isso passa por aqui.
// Publicar: Supabase › Edge Functions › Deploy a new function › nome "nfce" › cole este arquivo.
// Ou pela linha de comando: supabase functions deploy nfce
//
// Entrada:  POST { "url": "https://sistemas.sefaz.am.gov.br/nfceweb/consultarNFCe.jsp?p=..." }
// Saída:    { chave, store: { name, cnpj }, date, total, items: [{ name, code, qty, unit, unit_price, total }] }
//
// Gravar a nota (página "Minhas notas"): POST { url, save: true, supermarket_id?, matches: [{ i, product_id }] }
//   A função lê a Sefaz de novo aqui no servidor (os preços nunca vêm do navegador) e grava pela
//   função SQL receipt_ingest. Exige o login do usuário no Authorization.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });

// só páginas de Sefaz (.gov.br); nada de buscar endereços quaisquer
function allowed(u: URL) {
  return u.protocol === 'https:' || u.protocol === 'http:'
    ? /\.gov\.br$/i.test(u.hostname) && /(sefaz|fazenda|nfce|sef\.|sefa\.|sefin|set\.)/i.test(u.hostname + u.pathname)
    : false;
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const clean = (s = '') => s
  .replace(/<[^>]+>/g, ' ')
  .replace(/&(#\d+|[a-z]+);/gi, (_, e) => (e[0] === '#' ? String.fromCharCode(Number(e.slice(1))) : ENT[e.toLowerCase()] ?? ' '))
  .replace(/\s+/g, ' ').trim();
const money = (s = '') => {
  const m = clean(s).match(/-?\d{1,3}(?:\.\d{3})*,\d{2,4}|-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const v = m[0].includes(',') ? Number(m[0].replace(/\./g, '').replace(',', '.')) : Number(m[0]);
  return Number.isFinite(v) ? v : null;
};
const pick = (html: string, re: RegExp) => { const m = html.match(re); return m ? m[1] : ''; };

function parse(html: string): any {
  const items: Array<Record<string, any>> = [];
  // layout padrão do portal da NFC-e (Sefaz AM e vários estados): <tr id="Item + 1">…</tr>
  const rows = html.split(/<tr[^>]*id=["']?Item\s*\+?\s*\d+["']?[^>]*>/i).slice(1);
  for (const raw of rows) {
    const r = raw.split(/<\/tr>/i)[0];
    const name = clean(pick(r, /class=["'][^"']*txtTit2?[^"']*["'][^>]*>([\s\S]*?)<\/span>/i));
    if (!name) continue;
    const code = clean(pick(r, /class=["']RCod["'][^>]*>([\s\S]*?)<\/span>/i)).replace(/[^\d]/g, '') || null;
    const qty = money(pick(r, /class=["']Rqtd["'][^>]*>([\s\S]*?)<\/span>/i)) ?? 1;
    const unit = clean(pick(r, /class=["']RUN["'][^>]*>([\s\S]*?)<\/span>/i)).replace(/^UN:\s*/i, '') || null;
    const unit_price = money(pick(r, /class=["']RvlUnit["'][^>]*>([\s\S]*?)<\/span>/i));
    const total = money(pick(r, /class=["']valor["'][^>]*>([\s\S]*?)<\/span>/i));
    items.push({ name, code, qty, unit, unit_price: unit_price ?? (total != null && qty ? Math.round((total / qty) * 100) / 100 : null), total });
  }
  const storeName = clean(pick(html, /id=["']u20["'][^>]*>([\s\S]*?)<\/div>/i)) || clean(pick(html, /class=["']txtTopo["'][^>]*>([\s\S]*?)<\/div>/i));
  const cnpj = (clean(html).match(/CNPJ:?\s*([\d./-]{14,18})/i) || [])[1] || null;
  const total = money(pick(html, /class=["'][^"']*totalNumb txtMax[^"']*["'][^>]*>([\s\S]*?)<\/span>/i))
    ?? money(pick(html, /Valor a pagar[\s\S]{0,80}?class=["'][^"']*totalNumb[^"']*["'][^>]*>([\s\S]*?)<\/span>/i));
  const date = (clean(html).match(/Emiss[ãa]o:?\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}(?::\d{2})?)/i) || [])[1] || null;
  return { store: { name: storeName || null, cnpj }, date, total, items, chave: chaveFrom(html) };
}

// chave de acesso (44 dígitos): no parâmetro p= do QR, em chNFe=, ou escrita na página
function chaveFrom(html: string, url?: URL) {
  const tries = [url?.searchParams.get('p'), url?.searchParams.get('chNFe'), url?.search, clean(html).match(/Chave de acesso:?\s*([\d\s]{44,60})/i)?.[1]];
  for (const t of tries) { const m = String(t || '').replace(/\s/g, '').match(/\d{44}/); if (m) return m[0]; }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  let url: URL; let body: any = {};
  try {
    body = await req.json();
    url = new URL(String(body.url || '').trim());
  } catch { return json({ error: 'Link inválido.', code: 'host' }, 400); }
  if (!allowed(url)) return json({ error: 'Esse link não é de uma consulta de NFC-e da Sefaz.', code: 'host' }, 400);

  let html = '';
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (TaBaratoMesmo; consulta NFC-e)', 'Accept': 'text/html' } });
    clearTimeout(t);
    if (!r.ok) return json({ error: `A Sefaz respondeu ${r.status}.`, code: 'sefaz' }, 502);
    const buf = new Uint8Array(await r.arrayBuffer());
    const cs = (r.headers.get('content-type') || '').match(/charset=([\w-]+)/i)?.[1]?.toLowerCase();
    html = new TextDecoder(cs && cs !== 'utf8' ? cs : 'utf-8').decode(buf);
    if (!cs && html.includes('�')) html = new TextDecoder('iso-8859-1').decode(buf);
  } catch (e) {
    return json({ error: 'A Sefaz não respondeu a tempo.', code: 'sefaz', detail: String(e) }, 504);
  }

  const out = parse(html);
  out.chave = chaveFrom(html, url) || out.chave;
  if (!out.items.length) {
    const why = /captcha|recaptcha/i.test(html) ? 'A Sefaz pediu verificação (captcha) para esta nota.' : 'Não encontrei os itens nesta página da Sefaz.';
    return json({ error: why, code: 'layout' }, 422);
  }
  if (!body.save) return json(out);

  // ---- gravar: preços reais da nota, conferidos aqui no servidor
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: u } = await admin.auth.getUser(jwt);
  if (!u?.user) return json({ error: 'Entre na sua conta para enviar a nota.', code: 'login' }, 401);
  const pick = new Map<number, number>();
  for (const m of Array.isArray(body.matches) ? body.matches : []) {
    const i = Number(m?.i), pid = Number(m?.product_id);
    if (Number.isInteger(i) && i >= 0 && i < out.items.length && Number.isInteger(pid) && pid > 0) pick.set(i, pid);
  }
  const payload = { ...out, supermarket_id: body.supermarket_id ?? null, items: out.items.map((it, i) => ({ ...it, product_id: pick.get(i) ?? null })) };
  const { data, error } = await admin.rpc('receipt_ingest', { p_user: u.user.id, p: payload });
  if (error) {
    const dup = /já foi enviada/i.test(error.message);
    return json({ error: error.message, code: dup ? 'duplicada' : 'gravar' }, dup ? 409 : 400);
  }
  return json({ ...out, saved: data });
});
