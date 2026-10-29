-- ============================================================================
--  Correção: dados de uma conta aparecendo em outra no mesmo aparelho
--  O site agora marca de quem são os dados guardados no navegador (js/dono.js) e limpa tudo ao sair
--  ou ao entrar com outra conta. Aqui no banco, falta um detalhe: a inscrição de avisos (push) do
--  aparelho continuava presa à conta anterior quando o aparelho voltava a se inscrever sem conta.
--  Rode uma vez no SQL Editor do Supabase. Pode rodar de novo sem problema.
-- ============================================================================
create or replace function public.push_subscribe(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_end text := p->>'endpoint';
begin
  if v_end is null or v_end !~ '^https://' or length(v_end) > 600 then raise exception 'Inscrição inválida.'; end if;
  insert into push_subscriptions as s (endpoint, p256dh, auth, user_id, device, prefs, markets, watch_ids, lat, lng, family_code, family_by)
  values (v_end, left(p->>'p256dh', 200), left(p->>'auth', 100), auth.uid(), left(p->>'device', 40),
          case when jsonb_typeof(p->'prefs') = 'object' then p->'prefs' else '{"precos": true, "campanhas": true, "familia": true}' end,
          coalesce((select array_agg(distinct x::smallint) from jsonb_array_elements_text(case when jsonb_typeof(p->'markets') = 'array' then p->'markets' else '[]' end) x limit 20), '{}'),
          coalesce((select array_agg(distinct x::int) from (select x from jsonb_array_elements_text(case when jsonb_typeof(p->'watch_ids') = 'array' then p->'watch_ids' else '[]' end) x limit 120) y), '{}'),
          round((p->>'lat')::numeric, 2), round((p->>'lng')::numeric, 2),
          nullif(upper(left(p->>'family_code', 12)), ''), nullif(left(p->>'family_by', 40), ''))
  on conflict (endpoint) do update set
    p256dh = excluded.p256dh, auth = excluded.auth,
    -- antes: coalesce(auth.uid(), s.user_id) → o aparelho sem conta seguia com a conta de quem saiu
    user_id = auth.uid(), device = excluded.device, prefs = excluded.prefs,
    markets = excluded.markets, watch_ids = excluded.watch_ids, lat = excluded.lat, lng = excluded.lng,
    family_code = excluded.family_code, family_by = excluded.family_by,
    family_seen = case when excluded.family_code is distinct from s.family_code then null else s.family_seen end,
    fails = 0, updated_at = now()
  returning id into v_id;
  return v_id;
end $$;
