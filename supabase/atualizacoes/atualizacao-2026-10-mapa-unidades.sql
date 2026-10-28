-- =====================================================================
-- Mapa de unidades (admin.html#unidades)
--   O administrador vê no mapa os supermercados de Manaus do OpenStreetMap e cadastra cada unidade
--   com um toque. stores.osm_ref guarda de qual ponto do OpenStreetMap a loja veio ("node/123",
--   "way/456"), para não cadastrar a mesma unidade duas vezes.
--   Dados do OpenStreetMap: © colaboradores do OpenStreetMap, licença ODbL (créditos no mapa do site).
-- Rode uma vez no Supabase › SQL Editor (pode rodar de novo sem problema).
-- =====================================================================
alter table public.stores add column if not exists osm_ref text;
create unique index if not exists stores_osm_ref_key on public.stores (osm_ref) where osm_ref is not null;

create or replace function public.admin_save_store(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_osm text := nullif(trim(coalesce(p->>'osm_ref', '')), ''); v_other text;
begin
  perform admin_guard();
  if v_osm is not null and v_osm !~ '^(node|way|relation)/[0-9]+$' then raise exception 'Referência do OpenStreetMap inválida.'; end if;
  if v_osm is not null then
    select s.name || ' (' || m.name || ')' into v_other from stores s join supermarkets m on m.id = s.supermarket_id
     where s.osm_ref = v_osm and s.id is distinct from nullif(p->>'id', '')::int;
    if v_other is not null then raise exception 'Esta unidade do mapa já está cadastrada: %.', v_other; end if;
  end if;
  if nullif(p->>'id', '') is null then
    insert into stores (supermarket_id, name, address, neighborhood, lat, lng, approx, opening_hours, osm_ref)
    values ((p->>'supermarket_id')::smallint, p->>'name', nullif(p->>'address', ''), nullif(p->>'neighborhood', ''),
            (p->>'lat')::float8, (p->>'lng')::float8, coalesce((p->>'approx')::boolean, false), nullif(p->>'opening_hours', ''), v_osm);
  else
    update stores set name = p->>'name', address = nullif(p->>'address', ''), neighborhood = nullif(p->>'neighborhood', ''),
      lat = (p->>'lat')::float8, lng = (p->>'lng')::float8, approx = coalesce((p->>'approx')::boolean, approx),
      opening_hours = case when p ? 'opening_hours' then nullif(p->>'opening_hours', '') else opening_hours end,
      osm_ref = case when p ? 'osm_ref' then v_osm else osm_ref end
    where id = (p->>'id')::int;
  end if;
  perform admin_note('salvar loja', p);
end $$;
revoke all on function public.admin_save_store(jsonb) from public, anon;
grant execute on function public.admin_save_store(jsonb) to authenticated;

-- ---------------------------------------------------------------- Saúde do banco
create or replace function public.db_health()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out jsonb; v_job boolean := null; v_tgjob boolean := null;
begin
  if not is_master() then raise exception 'Só a administração.'; end if;
  if to_regclass('cron.job') is not null then
    execute 'select exists (select 1 from cron.job where jobname = ''tb-notificar'' and active)' into v_job;
    execute 'select exists (select 1 from cron.job where jobname = ''tb-telegram-avisos'' and active)' into v_tgjob;
  end if;
  with req(grp, kind, name) as (values
    ('Base (schema.sql)', 'table', 'public.v_products'),
    ('Base (schema.sql)', 'table', 'public.events'),
    ('Base (schema.sql)', 'func', 'public.track(jsonb)'),
    ('Base (schema.sql)', 'func', 'public.admin_overview(integer)'),
    ('Notas e leitor com IA', 'table', 'public.receipts'),
    ('Notas e leitor com IA', 'table', 'public.ia_readings'),
    ('Zerar histórico', 'col', 'profiles.history_reset_at'),
    ('Zerar histórico', 'func', 'public.reset_my_history()'),
    ('Lista da família', 'table', 'public.shared_lists'),
    ('Sincronizar aparelhos e campanhas', 'table', 'public.user_state'),
    ('Sincronizar aparelhos e campanhas', 'table', 'public.market_campaigns'),
    ('Zerar em todos os aparelhos', 'col', 'user_state.gen'),
    ('Zerar em todos os aparelhos', 'col', 'profiles.history_gen'),
    ('Datas especiais', 'table', 'public.special_events'),
    ('Datas especiais', 'func', 'public.market_event_products_set(text,smallint,jsonb)'),
    ('Uso, avisos e privacidade', 'col', 'events.device_id'),
    ('Uso, avisos e privacidade', 'table', 'public.push_subscriptions'),
    ('Uso, avisos e privacidade', 'func', 'public.push_collect(integer)'),
    ('Uso, avisos e privacidade', 'func', 'public.my_data_export()'),
    ('Uso, avisos e privacidade', 'col', 'supermarkets.shop_url'),
    ('Robô do Telegram', 'table', 'public.tg_contacts'),
    ('Robô do Telegram', 'func', 'public.tg_link_consume(text,bigint,text,text)'),
    ('Avisos de preço no Telegram', 'table', 'public.tg_price_refs'),
    ('Avisos de preço no Telegram', 'func', 'public.tg_alerts_collect(integer,timestamptz)'),
    ('Mapa de unidades (OpenStreetMap)', 'col', 'stores.osm_ref')
  ), chk as (
    select grp, kind, name, case kind
      when 'table' then to_regclass(name) is not null
      when 'func' then to_regprocedure(name) is not null
      when 'col' then exists (select 1 from information_schema.columns c where c.table_schema = 'public'
                                and c.table_name = split_part(name, '.', 1) and c.column_name = split_part(name, '.', 2))
    end ok from req
  )
  select jsonb_build_object(
    'checks', (select jsonb_agg(to_jsonb(chk)) from chk),
    'extensions', jsonb_build_object(
      'pg_cron', exists (select 1 from pg_extension where extname = 'pg_cron'),
      'pg_net', exists (select 1 from pg_extension where extname = 'pg_net')),
    'push_job', v_job,
    'push_subs', (select count(*) from push_subscriptions),
    'events_30d', (select count(*) from events where created_at >= now() - interval '30 days'),
    'telegram_contacts', (select count(*) from tg_contacts),
    'telegram_linked', (select count(*) from tg_contacts where user_id is not null),
    'telegram_job', v_tgjob
  ) into out;
  return out;
end $$;
revoke all on function public.db_health() from public, anon;
grant execute on function public.db_health() to authenticated;
