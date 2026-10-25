// Função "leitor-ia": lê fotos e PDFs com IA (Claude, da Anthropic) e devolve dados estruturados.
//   kind = "encarte"  → todos os produtos e preços de uma página de encarte/folheto
//   kind = "etiqueta" → produto + preço de uma foto tirada na prateleira
//   kind = "nota"     → itens de uma nota fiscal fotografada (quando o QR não lê)
//   kind = "receita"  → ingredientes de um prato por pessoa (texto, sem imagem), para Planejar refeições
//
// Publicar:  supabase functions deploy leitor-ia
// Segredo:   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//            (opcional) supabase secrets set IA_MODEL=claude-sonnet-5-5
//
// Entrada (POST, com o login do usuário no Authorization):
//   { kind, images: [{ data: "<base64>", media_type: "image/jpeg" }], supermarket_id?, categories?: ["mercearia", ...], page?: 1 }
// Saída: { reading_id, result, photo_url? }
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
const fail = (error: string, code: string, status = 400) => json({ error, code }, status);

const URL_ = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = Deno.env.get('IA_MODEL') || 'claude-sonnet-5-5';

// ---------------------------------------------------------------- formatos de saída (tool use)
const ITEM_ENCARTE = {
  type: 'object',
  properties: {
    nome: { type: 'string', description: 'Nome do produto sem marca e sem tamanho, ex.: "Arroz tipo 1", "Picanha bovina", "Leite UHT integral"' },
    marca: { type: ['string', 'null'], description: 'Marca, ex.: "Tio João". null se não houver (carnes, hortifrúti a granel)' },
    tamanho: { type: ['string', 'null'], description: 'Embalagem normalizada: "5kg", "1kg", "500g", "1L", "350ml", "12un", "kg" (vendido por quilo)' },
    preco: { type: 'number', description: 'Preço que o cliente paga na oferta, em reais (ex.: 4.99). Se for "por kg", o preço do quilo.' },
    preco_de: { type: ['number', 'null'], description: 'Preço "de" riscado/anterior, se aparecer. null se não aparecer.' },
    por_kg: { type: 'boolean', description: 'true se o preço é por quilo' },
    oferta: { type: ['string', 'null'], description: 'Condição especial: "Leve 3 pague 2", "A partir de 3 un", "Preço clube/cartão", "Só no Pix". null se for preço normal.' },
    preco_condicional: { type: 'boolean', description: 'true se o preço só vale com condição (cartão da loja, app, clube, quantidade mínima)' },
    categoria: { type: 'string', description: 'Uma das categorias informadas' },
    ean: { type: ['string', 'null'], description: 'Código de barras se estiver impresso (só dígitos)' },
    confianca: { type: 'number', description: '0 a 1: quanto você tem certeza do nome E do preço deste item' },
  },
  required: ['nome', 'preco', 'categoria', 'confianca', 'por_kg', 'preco_condicional'],
};
const TOOLS: Record<string, any> = {
  encarte: {
    name: 'registrar_encarte',
    description: 'Registra todos os produtos com preço encontrados na página do encarte.',
    input_schema: {
      type: 'object',
      properties: {
        supermercado: { type: ['string', 'null'], description: 'Nome do supermercado que aparece no encarte' },
        validade_inicio: { type: ['string', 'null'], description: 'Início da validade das ofertas, AAAA-MM-DD' },
        validade_fim: { type: ['string', 'null'], description: 'Fim da validade, AAAA-MM-DD' },
        observacoes: { type: ['string', 'null'], description: 'Avisos gerais (ex.: "ofertas válidas só na loja do Centro")' },
        itens: { type: 'array', items: ITEM_ENCARTE },
      },
      required: ['itens'],
    },
  },
  etiqueta: {
    name: 'registrar_etiqueta',
    description: 'Registra o produto e o preço vistos na foto da prateleira.',
    input_schema: {
      type: 'object',
      properties: {
        legivel: { type: 'boolean', description: 'false se não dá para ler o preço com segurança' },
        nome: { type: ['string', 'null'], description: 'Nome do produto sem marca e sem tamanho' },
        marca: { type: ['string', 'null'] },
        tamanho: { type: ['string', 'null'], description: '"1kg", "500g", "2L", "kg" se vendido por quilo' },
        preco: { type: ['number', 'null'], description: 'Preço da etiqueta que vale para 1 unidade, sem condição especial' },
        preco_promocional: { type: ['number', 'null'], description: 'Preço com condição (atacado, clube, leve X), se houver' },
        condicao: { type: ['string', 'null'], description: 'Condição do preço promocional' },
        ean: { type: ['string', 'null'], description: 'Código de barras impresso na etiqueta ou na embalagem (só dígitos)' },
        texto_etiqueta: { type: ['string', 'null'], description: 'Descrição exatamente como impressa na etiqueta' },
        supermercado: { type: ['string', 'null'], description: 'Nome da rede se aparecer na etiqueta' },
        confianca: { type: 'number', description: '0 a 1' },
        motivo: { type: ['string', 'null'], description: 'Se ilegível ou duvidoso, por quê (curto, para o usuário)' },
      },
      required: ['legivel', 'confianca'],
    },
  },
  nota: {
    name: 'registrar_nota',
    description: 'Registra os dados de uma nota fiscal (NFC-e/cupom) fotografada.',
    input_schema: {
      type: 'object',
      properties: {
        legivel: { type: 'boolean' },
        loja: { type: ['string', 'null'] },
        cnpj: { type: ['string', 'null'], description: 'Só dígitos' },
        data: { type: ['string', 'null'], description: 'DD/MM/AAAA HH:MM' },
        chave: { type: ['string', 'null'], description: 'Chave de acesso com 44 dígitos, só dígitos' },
        total: { type: ['number', 'null'] },
        itens: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Descrição como impressa' },
              code: { type: ['string', 'null'] },
              qty: { type: 'number' },
              unit: { type: ['string', 'null'] },
              unit_price: { type: 'number' },
              total: { type: ['number', 'null'] },
            },
            required: ['name', 'qty', 'unit_price'],
          },
        },
        confianca: { type: 'number' },
      },
      required: ['legivel', 'itens', 'confianca'],
    },
  },
  receita: {
    name: 'registrar_receita',
    description: 'Registra os ingredientes de 1 porção (1 pessoa adulta) do prato pedido.',
    input_schema: {
      type: 'object',
      properties: {
        nome: { type: 'string', description: 'Nome do prato, corrigido e curto' },
        ingredientes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              nome: { type: 'string', description: 'Ingrediente como se compra no mercado, ex.: "Feijão preto", "Peito de frango"' },
              quantidade: { type: 'number', description: 'Quantidade para 1 pessoa' },
              unidade: { type: 'string', enum: ['g', 'ml', 'un'] },
              busca: { type: 'string', description: 'Termo curto para achar no supermercado, sem acento, ex.: "feijao preto", "peito de frango"' },
            },
            required: ['nome', 'quantidade', 'unidade', 'busca'],
          },
        },
      },
      required: ['nome', 'ingredientes'],
    },
  },
};

function prompt(kind: string, categories: string[], hint: string) {
  const today = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Manaus' });
  if (kind === 'encarte') return `Você lê encartes de supermercado de Manaus (Brasil) com precisão de conferente. Hoje é ${today}.
Extraia TODOS os produtos que têm preço nesta página, um item por produto/variação de preço.
Regras:
- Centavos pequenos ou sobrescritos fazem parte do preço: "4⁹⁹" ou "4,⁹⁹" = 4.99; "R$ 12,9" = 12.90.
- Se o preço é por quilo ("kg", "o kg", "/kg"), preencha por_kg=true e tamanho="kg".
- Separe nome, marca e tamanho. Ex.: "Arroz Tio João Tipo 1 5kg" → nome "Arroz tipo 1", marca "Tio João", tamanho "5kg".
- Um anúncio com vários sabores/variações ao mesmo preço vira UM item (cite as variações no nome entre parênteses só se forem poucas).
- "De R$ X por R$ Y": preco = Y, preco_de = X.
- Preço só com cartão da loja, app, clube, Pix ou quantidade mínima: preco_condicional=true e explique em "oferta".
- Não invente: se o preço não está legível, não inclua o item. Se o nome é incerto, baixe a confiança.
- Ignore textos decorativos, logos, chamadas sem preço e avisos legais.
- Categoria: escolha uma destas: ${categories.join(', ')}.
- Datas da validade no formato AAAA-MM-DD (se só houver dia/mês, use o ano de hoje).${hint ? `\nDica do usuário: ${hint}` : ''}
Responda chamando a ferramenta registrar_encarte.`;
  if (kind === 'etiqueta') return `Foto tirada por um cliente na prateleira de um supermercado em Manaus. Identifique o produto e o preço.
Regras:
- O preço vem da ETIQUETA da prateleira (ou etiqueta colada no produto). Centavos pequenos fazem parte: "7⁹⁹" = 7.99.
- Se a etiqueta mostra dois preços (ex.: "varejo" e "atacado a partir de 6 un", ou preço normal e "clube"), "preco" é o que vale para 1 unidade sem condição e o outro vai em "preco_promocional" com a "condicao".
- Use a embalagem para nome, marca e tamanho; use a etiqueta para conferir. Etiquetas costumam ter o código de barras (EAN) impresso: copie os dígitos se estiverem nítidos.
- Se a etiqueta não está visível, está cortada, desfocada, ou não dá para saber de qual produto é o preço, responda legivel=false com o motivo curto em português simples.
- Não chute. Confiança alta só se nome e preço estão claros.${hint ? `\nO cliente disse: ${hint}` : ''}
Responda chamando a ferramenta registrar_etiqueta.`;
  if (kind === 'receita') return `Você é cozinheiro(a) de casa em Manaus (Brasil). Prato pedido: "${hint}".
Liste os ingredientes que se compram no supermercado para 1 porção de adulto (almoço/jantar normal), com quantidades realistas de cozinha doméstica:
- arroz cru ~80 g, feijão cru ~60 g, carne/frango/peixe 150–250 g (com osso, mais), massa seca ~100 g.
- Use g para sólidos, ml para líquidos e un só para coisas contadas (ovos, pães, bananas, limões).
- Inclua temperos básicos (sal, alho, cebola, óleo) em quantidades pequenas. Não inclua água.
- Se o pedido não for comida, devolva ingredientes vazios.
Responda chamando a ferramenta registrar_receita.`;
  return `Foto de uma nota fiscal de supermercado (NFC-e / cupom) do Brasil. Copie os dados exatamente como impressos.
- itens: descrição, código, quantidade, unidade, valor unitário e total de cada linha. Desconto em linha separada: abata do item.
- A chave de acesso tem 44 dígitos (pode estar em blocos de 4): devolva só os dígitos.
- Se não for uma nota fiscal ou estiver ilegível, legivel=false.
Responda chamando a ferramenta registrar_nota.`;
}

async function askClaude(kind: string, images: Array<{ data: string; media_type: string }>, categories: string[], hint: string) {
  const content: any[] = images.map((im) => im.media_type === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: im.data } }
    : { type: 'image', source: { type: 'base64', media_type: im.media_type || 'image/jpeg', data: im.data } });
  content.push({ type: 'text', text: prompt(kind, categories, hint) });
  const tool = TOOLS[kind];
  // os modelos novos não aceitam forçar a ferramenta (tool_choice "tool") nem "temperature":
  // pedimos a ferramenta no texto, com tool_choice "auto", e tentamos de novo se vier só texto
  const call = async (msgs: any[]) => {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: kind === 'encarte' ? 16000 : 2000, tools: [tool], tool_choice: { type: 'auto' }, messages: msgs }),
    });
    if (!r.ok) {
      const t = await r.text();
      throw Object.assign(new Error(`IA respondeu ${r.status}`), { detail: t.slice(0, 400), status: r.status });
    }
    return r.json();
  };
  const msgs: any[] = [{ role: 'user', content }];
  let out = await call(msgs);
  let use = (out.content || []).find((c: any) => c.type === 'tool_use');
  if (!use && out.stop_reason !== 'max_tokens') {
    msgs.push({ role: 'assistant', content: out.content }, { role: 'user', content: [{ type: 'text', text: `Agora chame a ferramenta ${tool.name} com o resultado. Não responda em texto.` }] });
    out = await call(msgs);
    use = (out.content || []).find((c: any) => c.type === 'tool_use');
  }
  let input = use?.input;
  if (!input) { // último recurso: JSON escrito no texto
    const txt = (out.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
    const m = txt.match(/\{[\s\S]*\}/);
    try { input = m ? JSON.parse(m[0]) : null; } catch { input = null; }
  }
  if (!input) throw new Error('A IA não devolveu o formato esperado.');
  return { result: input, usage: out.usage, truncated: out.stop_reason === 'max_tokens' };
}

// ---------------------------------------------------------------- limpeza do resultado
const num = (v: unknown) => { const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; };
const digits = (v: unknown) => { const d = String(v ?? '').replace(/\D/g, ''); return d.length >= 8 ? d : null; };
function tidy(kind: string, r: any) {
  if (kind === 'encarte') {
    const seen = new Set<string>();
    r.itens = (r.itens || []).map((i: any) => ({ ...i, preco: num(i.preco), preco_de: num(i.preco_de), ean: digits(i.ean), confianca: Math.max(0, Math.min(1, Number(i.confianca) || 0)) }))
      .filter((i: any) => i.preco && i.nome && i.preco < 100000)
      .map((i: any) => (i.preco_de && i.preco_de <= i.preco ? { ...i, preco_de: null } : i))
      .filter((i: any) => { const k = `${i.nome}|${i.marca}|${i.tamanho}|${i.preco}`.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  } else if (kind === 'etiqueta') {
    r.preco = num(r.preco); r.preco_promocional = num(r.preco_promocional); r.ean = digits(r.ean);
    if (!r.preco && r.preco_promocional && !r.condicao) { r.preco = r.preco_promocional; r.preco_promocional = null; }
    if (!r.preco) r.legivel = false;
  } else if (kind === 'receita') {
    r.ingredientes = (r.ingredientes || []).map((i: any) => ({ ...i, quantidade: Math.round((Number(i.quantidade) || 0) * 100) / 100 }))
      .filter((i: any) => i.nome && i.quantidade > 0 && i.quantidade < 5000 && ['g', 'ml', 'un'].includes(i.unidade)).slice(0, 25);
  } else {
    r.chave = (String(r.chave || '').replace(/\D/g, '').match(/\d{44}/) || [null])[0];
    r.cnpj = digits(r.cnpj);
    r.itens = (r.itens || []).map((i: any) => ({ ...i, unit_price: num(i.unit_price), total: num(i.total), qty: Number(i.qty) || 1 })).filter((i: any) => i.unit_price);
  }
  return r;
}

// ---------------------------------------------------------------- servidor
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail('Use POST.', 'metodo', 405);
  if (!KEY) return fail('O leitor com IA ainda não foi configurado (falta ANTHROPIC_API_KEY).', 'sem_chave', 503);

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  const asUser = createClient(URL_, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
  const { data: u } = await admin.auth.getUser(jwt);
  const user = u?.user;
  if (!user) return fail('Entre na sua conta para usar o leitor.', 'login', 401);

  let body: any;
  try { body = await req.json(); } catch { return fail('Pedido inválido.', 'pedido'); }
  const kind = String(body.kind || '');
  if (!TOOLS[kind]) return fail('Tipo de leitura inválido.', 'pedido');
  const images = (Array.isArray(body.images) ? body.images : []).slice(0, kind === 'encarte' ? 4 : 2)
    .filter((i: any) => typeof i?.data === 'string' && i.data.length > 100);
  const text = String(body.text || '').trim().slice(0, 120);
  if (kind === 'receita' ? text.length < 3 : !images.length) return fail(kind === 'receita' ? 'Diga qual é o prato.' : 'Envie pelo menos uma imagem.', 'pedido');
  const totalB64 = images.reduce((s: number, i: any) => s + i.data.length, 0);
  if (totalB64 > 24_000_000) return fail('Arquivo grande demais. Envie páginas menores.', 'tamanho', 413);

  // liga/desliga e limites
  const { data: st } = await admin.from('app_settings').select('key, value').in('key', ['ia_enabled', 'ia_daily_limit']);
  const S = Object.fromEntries((st || []).map((r: any) => [r.key, r.value]));
  if (S.ia_enabled === false || S.ia_enabled === 'false') return fail('O leitor com IA está pausado no momento.', 'pausado', 503);
  const { data: prof } = await admin.from('profiles').select('blocked').eq('id', user.id).maybeSingle();
  if (prof?.blocked) return fail('Sua conta não pode usar o leitor.', 'bloqueado', 403);

  if (kind === 'encarte') {
    const { data: can } = await asUser.rpc('can_import_encarte', { p_market: body.supermarket_id ?? null });
    if (!can) return fail('Só a administração e os supermercados parceiros podem importar encartes.', 'permissao', 403);
  }
  const limit = kind === 'encarte' ? 400 : Number(S.ia_daily_limit ?? 30) || 30;
  const since = new Date(Date.now() - 864e5).toISOString();
  const { count } = await admin.from('ia_readings').select('id', { count: 'exact', head: true })
    .eq('user_id', user.id).eq('kind', kind).gte('created_at', since);
  if ((count ?? 0) >= limit) return fail(`Você chegou ao limite de ${limit} leituras por dia. Amanhã tem mais!`, 'limite', 429);

  const categories = Array.isArray(body.categories) && body.categories.length
    ? body.categories.map(String).slice(0, 30)
    : ['mercearia', 'carnes', 'hortifruti', 'laticinios', 'bebidas', 'limpeza', 'higiene'];

  let res;
  try { res = await askClaude(kind, images, categories, kind === 'receita' ? text : String(body.hint || '').slice(0, 300)); }
  catch (e: any) {
    console.error('IA', e?.message, e?.detail);
    const busy = e?.status === 429 || e?.status === 529;
    return fail(busy ? 'A IA está ocupada agora. Tente de novo em alguns segundos.' : 'Não consegui ler a imagem agora. Tente de novo.', busy ? 'ocupado' : 'ia', busy ? 503 : 502);
  }
  const result = tidy(kind, res.result);

  // guarda a foto da etiqueta como prova do preço
  let photo_path: string | null = null, photo_url: string | null = null;
  if (kind === 'etiqueta' && images[0]?.media_type?.startsWith('image/')) {
    try {
      const bin = Uint8Array.from(atob(images[0].data), (c) => c.charCodeAt(0));
      photo_path = `${user.id}/ia-${Date.now().toString(36)}.jpg`;
      const up = await admin.storage.from('etiquetas').upload(photo_path, bin, { contentType: images[0].media_type, cacheControl: '31536000' });
      if (up.error) photo_path = null;
      else photo_url = admin.storage.from('etiquetas').getPublicUrl(photo_path).data.publicUrl;
    } catch { photo_path = null; }
  }

  const { data: row, error } = await admin.from('ia_readings')
    .insert({ user_id: user.id, kind, result: { ...result, page: body.page ?? null, model: MODEL, usage: res.usage }, photo_path })
    .select('id').single();
  if (error) console.error('ia_readings', error.message);

  return json({ reading_id: row?.id ?? null, result, photo_url, truncated: res.truncated });
});
