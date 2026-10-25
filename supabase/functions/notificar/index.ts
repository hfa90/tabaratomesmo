// Função "notificar": entrega os avisos no celular mesmo com o site FECHADO (Web Push).
// Roda a cada 15 minutos (agendada pelo pg_cron, arquivo supabase/agendar-avisos.sql).
//
// 1. Pede ao banco o que avisar agora: push_collect() — preços que baixaram do que a pessoa
//    acompanha, lista da família que alguém mudou e avisos dos supermercados (perto, preferidos, todos).
//    As regras (8h às 21h, no máximo 3 por dia, 1 de mercado por dia) ficam no banco.
// 2. Envia cada aviso pelo serviço de push do navegador (Google, Apple, Mozilla…).
// 3. Devolve o resultado: inscrições que morreram (404/410) são apagadas.
//
// Segredos (Supabase › Edge Functions › Secrets):
//   VAPID_PUBLIC_KEY   — a mesma de js/config.js (VAPID_PUBLIC_KEY)
//   VAPID_PRIVATE_KEY  — a chave privada (nunca vai para o site nem para o GitHub)
//   NOTIFICAR_SEGREDO  — senha que o agendamento manda no cabeçalho x-segredo
// Publicar:  supabase functions deploy notificar --no-verify-jwt
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

type Msg = { id: number; endpoint: string; p256dh: string; auth: string; title: string; body: string; url: string; tag: string; campaign_id?: number };

Deno.serve(async (req) => {
  const secret = Deno.env.get('NOTIFICAR_SEGREDO');
  if (!secret || req.headers.get('x-segredo') !== secret) return json({ error: 'não autorizado' }, 401);

  const pub = Deno.env.get('VAPID_PUBLIC_KEY'), priv = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!pub || !priv) return json({ error: 'faltam VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY nos segredos' }, 500);
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'https://hfa90.github.io/tabaratomesmo/', pub, priv);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data, error } = await sb.rpc('push_collect', { p_limit: 500 });
  if (error) return json({ error: error.message }, 500);
  const list = (data ?? []) as Msg[];

  const results: { id: number; ok: boolean; status?: number }[] = [];
  // em lotes de 20 para não estourar o tempo da função
  for (let i = 0; i < list.length; i += 20) {
    const part = list.slice(i, i + 20);
    results.push(...await Promise.all(part.map(async (m) => {
      try {
        await webpush.sendNotification(
          { endpoint: m.endpoint, keys: { p256dh: m.p256dh, auth: m.auth } },
          JSON.stringify({ title: m.title, body: m.body, url: m.url, tag: m.tag, campaign_id: m.campaign_id ?? null }),
          { TTL: 6 * 3600, urgency: 'normal' },
        );
        return { id: m.id, ok: true };
      } catch (e) {
        return { id: m.id, ok: false, status: (e as { statusCode?: number }).statusCode ?? 0 };
      }
    })));
  }
  if (results.length) await sb.rpc('push_result', { p: results });
  return json({ enviados: results.filter((r) => r.ok).length, falharam: results.filter((r) => !r.ok).length });
});
