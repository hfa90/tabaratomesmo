-- =====================================================================
-- Outubro/2026 — três partes (rode uma vez no Supabase › SQL Editor;
-- pode rodar de novo sem problema):
--   1. Sincronizar a conta entre aparelhos (user_state)
--   2. Portal: "Clientes" — de onde vêm, se vão à loja mais perto, dias e horários
--   3. Portal: "Campanhas" — aviso no celular, janela na tela e vitrine de produtos
-- =====================================================================


-- =====================================================================
-- 1. SINCRONIZAR ENTRE APARELHOS
-- Cada "chave" do aparelho (lista, carrinho, ranchos, notas, preferências…)
-- vira uma linha. Só a própria pessoa lê e grava as suas linhas.
-- =====================================================================
create table if not exists public.user_state (
  user_id    uuid not null references auth.users(id) on delete cascade,
  key        text not null check (key ~ '^tb\.[A-Za-z.]{1,40}$'),
  value      jsonb,
  device     text,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.user_state enable row level security;
do $$ begin
  drop policy if exists "own state" on public.user_state;
  create policy "own state" on public.user_state for all
    using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
end $$;
grant select, insert, update, delete on public.user_state to authenticated;
-- mudanças chegam na hora nos outros aparelhos (Realtime)
do $$ begin
  alter publication supabase_realtime add table public.user_state;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- "Zerar meu histórico" também apaga o que estava sincronizado
-- (as colunas abaixo vêm de atualizacao-2026-10-zerar-historico.sql; repetidas aqui para este arquivo funcionar sozinho)
alter table public.profiles add column if not exists history_reset_at timestamptz;
alter table public.profiles add column if not exists history_gen int not null default 0;
create or replace function public.reset_my_history()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_gen int;
begin
  if v_uid is null then raise exception 'Entre na sua conta para zerar o histórico.'; end if;
  update public.profiles
     set history_reset_at = now(), history_gen = history_gen + 1, updated_at = now()
   where id = v_uid
  returning history_gen into v_gen;
  delete from public.favorites where user_id = v_uid;
  delete from public.user_state where user_id = v_uid;
  return jsonb_build_object('reset_at', now(), 'gen', coalesce(v_gen, 0));
end $$;
revoke all on function public.reset_my_history() from public, anon;
grant execute on function public.reset_my_history() to authenticated;


-- =====================================================================
-- Eventos: loja visitada e campanhas
-- =====================================================================
alter table public.events add column if not exists store_id int;
alter table public.events add column if not exists campaign_id bigint;
create index if not exists events_campaign on public.events (campaign_id, kind) where campaign_id is not null;
alter table public.events drop constraint if exists events_kind_check;
alter table public.events add constraint events_kind_check check (kind in
  ('search','view','add','route','rancho_done','bought','promo_view','ad_view','ad_reveal','ad_click','cart_item','queue_open','store_visit','scan','tool',
   'camp_view','camp_click','camp_close','camp_notify','screen','push_on','push_open'));

create or replace function public.track(p_events jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  e jsonb; n int := 0; pf profiles; v_nb text; v_age text;
  kinds text[] := array['search','view','add','route','rancho_done','bought','promo_view','ad_view','ad_reveal','ad_click','cart_item','queue_open','store_visit','scan','tool',
                        'camp_view','camp_click','camp_close','camp_notify','screen','push_on','push_open'];
begin
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 50 then return 0; end if;
  if not setting_on('tracking_enabled') then return 0; end if;
  if auth.uid() is not null then select * into pf from profiles where id = auth.uid(); end if;
  if coalesce(pf.blocked, false) then return 0; end if;
  v_age := case when pf.birth_date is null then null
                when age(pf.birth_date) < interval '25 years' then '18-24'
                when age(pf.birth_date) < interval '35 years' then '25-34'
                when age(pf.birth_date) < interval '45 years' then '35-44'
                when age(pf.birth_date) < interval '60 years' then '45-59'
                else '60+' end;
  for e in select * from jsonb_array_elements(p_events) loop
    continue when not (coalesce(e->>'kind', '') = any (kinds));
    v_nb := coalesce(nullif(pf.neighborhood, ''), nullif(left(e->>'neighborhood', 60), ''));
    insert into events (kind, session_id, user_id, product_id, supermarket_id, query, results,
                        neighborhood, zone, gender, age_band, value, ad_id, store_id, campaign_id)
    values (e->>'kind', left(e->>'session', 40), auth.uid(),
            (select id from products where id = nullif(e->>'product_id', '')::int),
            (select id from supermarkets where id = nullif(e->>'market_id', '')::smallint),
            nullif(lower(left(trim(e->>'query'), 60)), ''), nullif(e->>'results', '')::int,
            v_nb, zone_of(v_nb), nullif(pf.gender, 'nao_informar'), v_age,
            nullif(e->>'value', '')::numeric, nullif(e->>'ad_id', '')::bigint,
            (select id from stores where id = nullif(e->>'store_id', '')::int),
            nullif(e->>'campaign_id', '')::bigint);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.track(jsonb) from public;
grant execute on function public.track(jsonb) to anon, authenticated;


-- =====================================================================
-- 2. CLIENTES (portal): de onde vêm, loja mais perto de casa, dias e horários
-- "Visita" = chegou à loja com o site aberto, marcou que comprou ou mandou a nota.
-- Bairros só aparecem com 3 pessoas ou mais (privacidade).
-- =====================================================================
create or replace function public._km(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
returns double precision language sql immutable as $$
  select 6371 * 2 * asin(sqrt(power(sin(radians(b_lat - a_lat) / 2), 2) +
         cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2)))
$$;

create or replace function public.market_customers(p_market smallint, p_days int default 90)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(7, least(p_days, 365)));
  k int := 3;
  out jsonb;
begin
  if not (is_market_member(p_market) or is_master()) then raise exception 'Sem permissão para este supermercado.'; end if;
  with v as (
    select e.user_id, coalesce(e.user_id::text, e.session_id) who, e.created_at at, e.store_id, e.neighborhood nb
      from events e where e.supermarket_id = p_market and e.kind in ('store_visit', 'bought') and e.created_at >= v_since
    union all
    select r.user_id, r.user_id::text, coalesce(r.issued_at, r.created_at), r.store_id, pf.neighborhood
      from receipts r left join profiles pf on pf.id = r.user_id
     where r.supermarket_id = p_market and coalesce(r.issued_at, r.created_at) >= v_since
  ), vh as (  -- visita + casa da pessoa (endereço de casa ou o centro do bairro)
    select v.*, coalesce(pf.neighborhood, v.nb) bairro, b.zone,
           coalesce(pf.home_lat, b.lat) hlat, coalesce(pf.home_lng, b.lng) hlng
      from v left join profiles pf on pf.id = v.user_id
      left join bairros b on lower(b.name) = lower(coalesce(pf.neighborhood, v.nb))
  ), near as (  -- para visitas com loja conhecida: era a loja mais perto de casa?
    select vh.who, s.id store_id, _km(vh.hlat, vh.hlng, s.lat, s.lng) km,
           (select s2.id from stores s2 where s2.supermarket_id = p_market order by _km(vh.hlat, vh.hlng, s2.lat, s2.lng) limit 1) own_nearest,
           (select s3.supermarket_id from stores s3 join supermarkets m3 on m3.id = s3.supermarket_id and m3.active
              order by _km(vh.hlat, vh.hlng, s3.lat, s3.lng) limit 1) any_nearest_market,
           (select min(_km(vh.hlat, vh.hlng, s4.lat, s4.lng)) from stores s4 where s4.supermarket_id <> p_market) other_km
      from vh join stores s on s.id = vh.store_id
     where vh.hlat is not null and s.lat is not null
  )
  select jsonb_build_object(
    'visits',  (select count(*) from vh),
    'people',  (select count(distinct who) from vh),
    'fans',    (select count(*) from profiles where p_market = any(preferred_markets)),
    'bairros', coalesce((select jsonb_agg(x order by x.visits desc) from (
        select vh.bairro name, max(vh.zone) zone, max(b.lat) lat, max(b.lng) lng, count(*) visits, count(distinct vh.who) people
          from vh left join bairros b on lower(b.name) = lower(vh.bairro)
         where vh.bairro is not null group by vh.bairro having count(distinct vh.who) >= k) x), '[]'),
    'zones',   coalesce((select jsonb_agg(x order by x.visits desc) from (
        select coalesce(zone, 'Não informado') zone, count(*) visits, count(distinct who) people from vh group by 1) x), '[]'),
    'weekday', coalesce((select jsonb_agg(jsonb_build_object('dow', d, 'visits', n) order by d) from (
        select extract(dow from at at time zone 'America/Manaus')::int d, count(*) n from vh group by 1) x), '[]'),
    'monthday', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'visits', n) order by d) from (
        select extract(day from at at time zone 'America/Manaus')::int d, count(*) n from vh group by 1) x), '[]'),
    'hours',   coalesce((select jsonb_agg(jsonb_build_object('h', h, 'visits', n) order by h) from (
        select extract(hour from at at time zone 'America/Manaus')::int h, count(*) n from vh group by 1) x), '[]'),
    'nearest', (select jsonb_build_object(
        'known', count(*),
        'own_nearest', count(*) filter (where store_id = own_nearest),
        'any_nearest', count(*) filter (where any_nearest_market = p_market),
        'avg_km', round(avg(km)::numeric, 1),
        'passed_other', count(*) filter (where other_km < km - 0.3)) from near),
    'stores',  coalesce((select jsonb_agg(x order by x.visits desc) from (
        select s.id, s.name, s.neighborhood, s.lat, s.lng, count(vh.*) visits
          from stores s left join vh on vh.store_id = s.id
         where s.supermarket_id = p_market group by s.id) x), '[]')
  ) into out;
  return out;
end $$;
revoke all on function public.market_customers(smallint, int) from public, anon;
grant execute on function public.market_customers(smallint, int) to authenticated;


-- =====================================================================
-- 3. CAMPANHAS DOS SUPERMERCADOS
--   kind:     'aviso' (notificação no celular) · 'janela' (popup na tela) · 'vitrine' (faixa de produtos nas ofertas)
--   audience: 'todos' · 'preferem' (o mercado está entre os preferidos da pessoa) · 'perto' (a até radius_km de uma loja)
-- Regras para não incomodar ficam no aparelho (js/campanhas.js) e aqui:
-- no máximo 3 campanhas ativas por mercado ao mesmo tempo.
-- =====================================================================
create table if not exists public.market_campaigns (
  id             bigserial primary key,
  supermarket_id smallint not null references public.supermarkets(id) on delete cascade,
  kind           text not null check (kind in ('aviso', 'janela', 'vitrine')),
  title          text not null check (length(title) between 3 and 70),
  body           text check (length(body) <= 180),
  image_url      text,
  product_ids    int[] not null default '{}',
  cta            text not null default 'ofertas' check (cta in ('ofertas', 'rota', 'produtos')),
  audience       text not null default 'todos' check (audience in ('todos', 'preferem', 'perto')),
  radius_km      numeric(4,1) not null default 2 check (radius_km between 0.5 and 10),
  starts_at      timestamptz not null default now(),
  ends_at        timestamptz not null default now() + interval '7 days',
  status         text not null default 'ativa' check (status in ('ativa', 'pausada', 'encerrada', 'bloqueada')),
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists market_campaigns_live on public.market_campaigns (status, ends_at);
alter table public.market_campaigns enable row level security;
do $$ begin
  drop policy if exists "public live" on public.market_campaigns;
  create policy "public live" on public.market_campaigns for select
    using (status = 'ativa' and now() between starts_at and ends_at and setting_on('campaigns_enabled'));
end $$;
grant select on public.market_campaigns to anon, authenticated;
insert into public.app_settings (key, value, label) values
  ('campaigns_enabled', 'true', 'Supermercados podem mostrar campanhas (aviso, janela e vitrine)')
on conflict (key) do nothing;

create or replace function public.campaign_save(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_mid smallint := (p->>'supermarket_id')::smallint; v_id bigint := nullif(p->>'id', '')::bigint; v_live int;
begin
  if not (is_market_member(v_mid) or is_master()) then raise exception 'Sem permissão para este supermercado.'; end if;
  if v_id is null then
    select count(*) into v_live from market_campaigns where supermarket_id = v_mid and status = 'ativa' and ends_at > now();
    if v_live >= 3 then raise exception 'Você já tem 3 campanhas ativas. Pause ou encerre uma para criar outra.'; end if;
    insert into market_campaigns (supermarket_id, kind, title, body, image_url, product_ids, cta, audience, radius_km, starts_at, ends_at)
    values (v_mid, p->>'kind', trim(p->>'title'), nullif(trim(p->>'body'), ''), nullif(p->>'image_url', ''),
            coalesce((select array_agg(x::int) from jsonb_array_elements_text(p->'product_ids') x), '{}'),
            coalesce(p->>'cta', 'ofertas'), coalesce(p->>'audience', 'todos'), coalesce((p->>'radius_km')::numeric, 2),
            coalesce((p->>'starts_at')::timestamptz, now()), coalesce((p->>'ends_at')::timestamptz, now() + interval '7 days'))
    returning id into v_id;
  else
    update market_campaigns set kind = p->>'kind', title = trim(p->>'title'), body = nullif(trim(p->>'body'), ''),
           image_url = nullif(p->>'image_url', ''),
           product_ids = coalesce((select array_agg(x::int) from jsonb_array_elements_text(p->'product_ids') x), '{}'),
           cta = coalesce(p->>'cta', 'ofertas'), audience = coalesce(p->>'audience', 'todos'),
           radius_km = coalesce((p->>'radius_km')::numeric, 2),
           starts_at = coalesce((p->>'starts_at')::timestamptz, starts_at), ends_at = coalesce((p->>'ends_at')::timestamptz, ends_at),
           updated_at = now()
     where id = v_id and supermarket_id = v_mid and status <> 'bloqueada';
  end if;
  return v_id;
end $$;

create or replace function public.campaign_status(p_id bigint, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_mid smallint;
begin
  select supermarket_id into v_mid from market_campaigns where id = p_id;
  if v_mid is null then raise exception 'Campanha não encontrada.'; end if;
  if p_status = 'bloqueada' or (select status from market_campaigns where id = p_id) = 'bloqueada' then
    if not is_master() then raise exception 'Só a administração pode bloquear ou liberar campanhas.'; end if;
  elsif not (is_market_member(v_mid) or is_master()) then raise exception 'Sem permissão para este supermercado.'; end if;
  if p_status = 'ativa' and (select count(*) from market_campaigns where supermarket_id = v_mid and status = 'ativa' and ends_at > now() and id <> p_id) >= 3 then
    raise exception 'Já há 3 campanhas ativas. Pause outra antes.';
  end if;
  update market_campaigns set status = p_status, updated_at = now() where id = p_id;
end $$;

-- lista do portal (ou da administração, com p_market nulo) com os números de cada campanha
create or replace function public.campaigns_list(p_market smallint default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if p_market is null then
    if not is_master() then raise exception 'Sem permissão.'; end if;
  elsif not (is_market_member(p_market) or is_master()) then raise exception 'Sem permissão para este supermercado.'; end if;
  return coalesce((select jsonb_agg(x order by x.created_at desc) from (
    select c.*, s.name market_name,
           (select count(*) from events e where e.campaign_id = c.id and e.kind = 'camp_view') views,
           (select count(*) from events e where e.campaign_id = c.id and e.kind = 'camp_click') clicks,
           (select count(*) from events e where e.campaign_id = c.id and e.kind = 'camp_notify') notified,
           (select count(distinct coalesce(e.user_id::text, e.session_id)) from events e where e.campaign_id = c.id and e.kind = 'camp_view') people
      from market_campaigns c join supermarkets s on s.id = c.supermarket_id
     where p_market is null or c.supermarket_id = p_market
     order by c.created_at desc limit 100) x), '[]');
end $$;

revoke all on function public.campaign_save(jsonb) from public, anon;
revoke all on function public.campaign_status(bigint, text) from public, anon;
revoke all on function public.campaigns_list(smallint) from public, anon;
grant execute on function public.campaign_save(jsonb) to authenticated;
grant execute on function public.campaign_status(bigint, text) to authenticated;
grant execute on function public.campaigns_list(smallint) to authenticated;
