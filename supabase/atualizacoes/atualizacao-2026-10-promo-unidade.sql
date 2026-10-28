-- =====================================================================
-- Promoção por unidade e Mapa de unidades no portal do supermercado
--   1. promotions.store_id: a promoção pode valer só numa unidade (loja) da rede. Não muda o preço da rede
--      na comparação (v_products ignora); o site mostra à parte pela v_store_promos ("só na unidade X",
--      bairro e distância). Vazio = todas as unidades.
--   2. market_save_store: o supermercado cadastra e corrige as próprias unidades (portal › Mapa de unidades).
--      Só as lojas da própria rede; o banco recusa mexer nas de outra.
-- Rode uma vez no Supabase › SQL Editor (pode rodar de novo sem problema).
-- Precisa de atualizacao-2026-10-mapa-unidades.sql.
-- =====================================================================

-- ---------------------------------------------------------------- 1. promoção numa unidade
alter table public.promotions add column if not exists store_id int references public.stores(id) on delete cascade;
create index if not exists promotions_store on public.promotions (store_id) where store_id is not null;

create or replace function public.promotions_before()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.kind = 'exclusiva' and coalesce(trim(new.code), '') = '' then
    new.code := 'TB' || upper(substr(md5(random()::text), 1, 5));
  end if;
  if new.kind = 'geral' then new.code := null; end if;
  if new.store_id is not null and not exists (select 1 from stores where id = new.store_id and supermarket_id = new.supermarket_id) then
    raise exception 'Esta unidade não é do supermercado da promoção.';
  end if;
  return new;
end $$;
drop trigger if exists promotions_before on public.promotions;
create trigger promotions_before before insert or update on public.promotions
  for each row execute function public.promotions_before();

create or replace view public.v_products with (security_invoker = true) as
with latest as (
  select distinct on (pr.product_id, pr.supermarket_id)
         pr.product_id, pr.supermarket_id, pr.price, pr.collected_at, pr.source
  from public.prices pr
  order by pr.product_id, pr.supermarket_id, pr.collected_at desc
),
live as (
  select l.*, pm.promo_price, pm.kind as promo_kind, pm.code as promo_code, pm.title as promo_title,
         pm.ends_at as promo_ends, pm.max_per_client,
         least(l.price, coalesce(pm.promo_price, l.price)) as eff
  from latest l
  left join public.market_products mp on mp.supermarket_id = l.supermarket_id and mp.product_id = l.product_id
  left join lateral (select * from public.promotions x
                      where x.product_id = l.product_id and x.supermarket_id = l.supermarket_id
                        and x.active and now() between x.starts_at and x.ends_at and x.promo_price < l.price
                        and x.store_id is null   -- promoção de uma unidade só não muda o preço da rede
                        and public.setting_on('promos_enabled')
                      order by x.promo_price limit 1) pm on true
  join public.supermarkets sm on sm.id = l.supermarket_id and sm.active
  where coalesce(mp.active, true)
),
past as (
  select distinct on (product_id, supermarket_id)
         product_id, supermarket_id, price
  from public.prices
  where collected_at <= now() - interval '7 days'
  order by product_id, supermarket_id, collected_at desc
)
select
  p.id, p.name, p.brand, p.unit, p.emoji, p.image_url, p.ean,
  c.slug as category_slug, c.name as category_name,
  min(l.eff)  as min_price,
  max(l.eff)  as max_price,
  max(l.collected_at) as updated_at,
  round(((avg(l.price) filter (where pa.price is not null))
        / nullif(avg(pa.price), 0) - 1) * 100, 1) as change_pct,
  jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'market_id', l.supermarket_id,
      'price',     l.eff,
      'regular',   case when l.promo_price is not null then l.price end,
      'prev',      pa.price,
      'at',        l.collected_at,
      'src',       l.source,
      'promo',     case when l.promo_price is not null then jsonb_build_object(
                     'kind', l.promo_kind, 'code', l.promo_code, 'title', l.promo_title,
                     'ends', l.promo_ends, 'max', l.max_per_client) end
    )) order by l.eff) as prices,
  coalesce(p.image_url, (select mp.image_url from public.market_products mp
                          where mp.product_id = p.id and mp.image_url is not null and mp.active
                          order by mp.updated_at desc limit 1)) as photo
from public.products p
join public.categories c on c.id = p.category_id
join live l on l.product_id = p.id
left join past pa on pa.product_id = l.product_id and pa.supermarket_id = l.supermarket_id
where p.active
group by p.id, c.slug, c.name;
grant select on public.v_products to anon, authenticated;

-- promoções que valem só numa unidade: o site mostra à parte, com o bairro e a distância
create or replace view public.v_store_promos with (security_invoker = true) as
select x.id, x.product_id, x.supermarket_id as market_id, st.id as store_id, st.name as store, st.neighborhood,
       st.lat, st.lng, x.promo_price as price, lt.price as regular, x.kind, x.code, x.title, x.ends_at as ends, x.max_per_client as max
  from public.promotions x
  join public.stores st on st.id = x.store_id
  join public.supermarkets sm on sm.id = x.supermarket_id and sm.active
  join public.products p on p.id = x.product_id and p.active
  join lateral (select pr.price from public.prices pr where pr.product_id = x.product_id and pr.supermarket_id = x.supermarket_id
                 order by pr.collected_at desc limit 1) lt on true
 where x.store_id is not null and x.active and now() between x.starts_at and x.ends_at
   and x.promo_price < lt.price and public.setting_on('promos_enabled');
grant select on public.v_store_promos to anon, authenticated;

-- ---------------------------------------------------------------- 2. lojas: administração e o próprio supermercado
-- gravação comum (sem conferir quem é: só as duas funções abaixo chamam)
create or replace function public._store_upsert(p jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v_osm text := nullif(trim(coalesce(p->>'osm_ref', '')), ''); v_other text; v_id int := nullif(p->>'id', '')::int;
begin
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Informe o nome da unidade.'; end if;
  if (p->>'lat') is null or (p->>'lng') is null then raise exception 'Informe a posição da unidade.'; end if;
  if v_osm is not null and v_osm !~ '^(node|way|relation)/[0-9]+$' then raise exception 'Referência do OpenStreetMap inválida.'; end if;
  if v_osm is not null then
    select s.name || ' (' || m.name || ')' into v_other from stores s join supermarkets m on m.id = s.supermarket_id
     where s.osm_ref = v_osm and s.id is distinct from v_id;
    if v_other is not null then raise exception 'Esta unidade do mapa já está cadastrada: %.', v_other; end if;
  end if;
  if v_id is null then
    insert into stores (supermarket_id, name, address, neighborhood, lat, lng, approx, opening_hours, osm_ref)
    values ((p->>'supermarket_id')::smallint, trim(p->>'name'), nullif(p->>'address', ''), nullif(p->>'neighborhood', ''),
            (p->>'lat')::float8, (p->>'lng')::float8, coalesce((p->>'approx')::boolean, false), nullif(p->>'opening_hours', ''), v_osm)
    returning id into v_id;
  else
    update stores set name = trim(p->>'name'), address = nullif(p->>'address', ''), neighborhood = nullif(p->>'neighborhood', ''),
      lat = (p->>'lat')::float8, lng = (p->>'lng')::float8, approx = coalesce((p->>'approx')::boolean, approx),
      opening_hours = case when p ? 'opening_hours' then nullif(p->>'opening_hours', '') else opening_hours end,
      osm_ref = case when p ? 'osm_ref' then v_osm else osm_ref end
    where id = v_id;
  end if;
  return v_id;
end $$;
revoke all on function public._store_upsert(jsonb) from public, anon, authenticated;

create or replace function public.admin_save_store(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  perform _store_upsert(p);
  perform admin_note('salvar loja', p);
end $$;
revoke all on function public.admin_save_store(jsonb) from public, anon;
grant execute on function public.admin_save_store(jsonb) to authenticated;

-- o supermercado cadastra e corrige só as próprias unidades
create or replace function public.market_save_store(p jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v_mid smallint := nullif(p->>'supermarket_id', '')::smallint; v_id int := nullif(p->>'id', '')::int;
begin
  if v_mid is null or not is_market_member(v_mid) then raise exception 'Você não tem acesso a este supermercado.'; end if;
  if v_id is not null and not exists (select 1 from stores where id = v_id and supermarket_id = v_mid) then
    raise exception 'Esta unidade não é do seu supermercado.';
  end if;
  return _store_upsert(p || jsonb_build_object('supermarket_id', v_mid));
end $$;
revoke all on function public.market_save_store(jsonb) from public, anon;
grant execute on function public.market_save_store(jsonb) to authenticated;

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
    ('Mapa de unidades (OpenStreetMap)', 'col', 'stores.osm_ref'),
    ('Promoção por unidade e mapa no portal', 'col', 'promotions.store_id'),
    ('Promoção por unidade e mapa no portal', 'table', 'public.v_store_promos'),
    ('Promoção por unidade e mapa no portal', 'func', 'public.market_save_store(jsonb)')
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
