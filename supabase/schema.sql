-- =====================================================================
--  Tá Barato Mesmo? — schema Supabase
--  Cole este arquivo inteiro no SQL Editor do projeto e clique em RUN.
--  Pode ser executado mais de uma vez (idempotente para estrutura;
--  o seed só roda se as tabelas estiverem vazias).
-- =====================================================================

-- ---------- TABELAS ---------------------------------------------------
create table if not exists public.supermarkets (
  id          smallserial primary key,
  slug        text unique not null,
  name        text not null,
  logo_url    text,                 -- caminho/URL da logomarca oficial
  color       text default '#0E3B2E',
  website     text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.stores (
  id             serial primary key,
  supermarket_id smallint not null references public.supermarkets(id) on delete cascade,
  name           text not null,
  address        text,
  neighborhood   text,
  lat            double precision not null,
  lng            double precision not null,
  approx         boolean not null default true,  -- true = coordenada aproximada, confirmar
  opening_hours  text,
  created_at     timestamptz not null default now()
);

create table if not exists public.categories (
  id    smallserial primary key,
  slug  text unique not null,
  name  text not null,
  icon  text,
  sort  int not null default 0
);

create table if not exists public.products (
  id          serial primary key,
  name        text not null,
  brand       text,
  unit        text,
  category_id smallint references public.categories(id),
  emoji       text,
  image_url   text,
  ean         text unique,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.prices (
  id             bigserial primary key,
  product_id     int not null references public.products(id) on delete cascade,
  supermarket_id smallint not null references public.supermarkets(id) on delete cascade,
  price          numeric(10,2) not null check (price > 0),
  collected_at   timestamptz not null default now(),
  source         text not null default 'coleta'
);
create index if not exists prices_lookup_idx
  on public.prices (product_id, supermarket_id, collected_at desc);
create index if not exists prices_date_idx on public.prices (collected_at desc);

create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  full_name         text,
  phone             text,
  birth_date        date,
  neighborhood      text,
  cep               text,
  preferred_markets smallint[] default '{}',
  accepts_offers    boolean default false,
  completed_at      timestamptz,
  comparisons_used  int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.favorites (
  user_id    uuid not null references auth.users(id) on delete cascade,
  product_id int  not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create table if not exists public.price_reports (
  id             bigserial primary key,
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_id     int not null references public.products(id) on delete cascade,
  supermarket_id smallint not null references public.supermarkets(id) on delete cascade,
  price          numeric(10,2) not null check (price > 0),
  note           text,
  status         text not null default 'pendente' check (status in ('pendente','aprovado','rejeitado')),
  created_at     timestamptz not null default now()
);

-- ---------- ADMINISTRAÇÃO: configurações e administradores master --------
-- Configurações que o administrador liga e desliga em admin.html
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  label       text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
insert into public.app_settings (key, value, label) values
 ('anon_comparisons',  '3',    'Comparações sem cadastro'),
 ('quick_comparisons', '15',   'Comparações com cadastro rápido'),
 ('collab_enabled',    'true', 'Usuários podem informar preços'),
 ('promos_enabled',    'true', 'Promoções dos mercados aparecem no site'),
 ('portal_enabled',    'true', 'Área do supermercado liberada'),
 ('tracking_enabled',  'true', 'Coleta de métricas de uso'),
 ('banner',            '""',   'Aviso no topo do site (vazio = sem aviso)')
on conflict (key) do nothing;

create or replace function public.setting(p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select value from app_settings where key = p_key
$$;
create or replace function public.setting_on(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::boolean from app_settings where key = p_key), true)
$$;

-- Administradores master (por e-mail da conta)
create table if not exists public.platform_admins (
  email      text primary key,
  added_by   text,
  created_at timestamptz not null default now()
);
insert into public.platform_admins (email, added_by) values ('haydenfernandes.ti@gmail.com', 'instalação')
on conflict (email) do nothing;

create or replace function public.is_master()
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from platform_admins pa join auth.users u on lower(u.email) = lower(pa.email)
                 where u.id = auth.uid())
$$;

alter table public.app_settings enable row level security;
alter table public.platform_admins enable row level security;  -- sem políticas: só funções leem
do $$ begin
  drop policy if exists "public read" on public.app_settings;
  create policy "public read" on public.app_settings for select using (true);
end $$;
grant select on public.app_settings to anon, authenticated;

alter table public.profiles add column if not exists blocked boolean not null default false;
alter table public.supermarkets add column if not exists portal_enabled boolean not null default true;

-- ---------- PERFIL AUTOMÁTICO NO CADASTRO ------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Impede o usuário de mexer no contador e na data de conclusão pelo REST
create or replace function public.protect_profile_fields()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Só as funções register_comparison/complete_profile (que ligam app.trusted)
  -- podem alterar o contador e a data de conclusão.
  if coalesce(current_setting('app.trusted', true), '') <> 'on'
     and coalesce(auth.role(), '') in ('authenticated', 'anon') then
    new.comparisons_used := old.comparisons_used;
    new.completed_at     := old.completed_at;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- ---------- FUNÇÕES (RPC) ---------------------------------------------
-- Limite de comparações para quem fez só o cadastro rápido.
create or replace function public.register_comparison()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_limit int := coalesce((public.setting('quick_comparisons') #>> '{}')::int, 15);
  p public.profiles;
begin
  if auth.uid() is null then
    return jsonb_build_object('allowed', false, 'reason', 'anon');
  end if;
  perform set_config('app.trusted', 'on', true);
  select * into p from public.profiles where id = auth.uid();
  if not found then
    insert into public.profiles (id) values (auth.uid()) returning * into p;
  end if;
  if p.blocked then
    return jsonb_build_object('allowed', false, 'completed', false, 'reason', 'blocked', 'used', p.comparisons_used, 'limit', 0);
  end if;
  if p.completed_at is not null then
    update public.profiles set comparisons_used = comparisons_used + 1 where id = p.id;
    return jsonb_build_object('allowed', true, 'completed', true, 'used', p.comparisons_used + 1, 'limit', null);
  end if;
  -- cada preço informado pelo usuário libera +2 comparações
  v_limit := v_limit + 2 * (select count(*) from public.price_reports where user_id = p.id);
  if p.comparisons_used >= v_limit then
    return jsonb_build_object('allowed', false, 'completed', false, 'used', p.comparisons_used, 'limit', v_limit, 'reason', 'incomplete');
  end if;
  update public.profiles set comparisons_used = comparisons_used + 1 where id = p.id;
  return jsonb_build_object('allowed', true, 'completed', false, 'used', p.comparisons_used + 1, 'limit', v_limit);
end $$;

create or replace function public.complete_profile(
  p_full_name text, p_phone text, p_birth_date date, p_neighborhood text,
  p_cep text, p_preferred_markets smallint[], p_accepts_offers boolean)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare r public.profiles;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(trim(p_full_name),'') = '' or coalesce(trim(p_phone),'') = ''
     or p_birth_date is null or coalesce(trim(p_neighborhood),'') = '' then
    raise exception 'Preencha nome, telefone, data de nascimento e bairro';
  end if;
  perform set_config('app.trusted', 'on', true);
  update public.profiles set
    full_name = p_full_name, phone = p_phone, birth_date = p_birth_date,
    neighborhood = p_neighborhood, cep = p_cep,
    preferred_markets = coalesce(p_preferred_markets, '{}'),
    accepts_offers = coalesce(p_accepts_offers, false),
    completed_at = coalesce(completed_at, now())
  where id = auth.uid()
  returning * into r;
  return r;
end $$;

revoke all on function public.register_comparison() from public, anon;
revoke all on function public.complete_profile(text,text,date,text,text,smallint[],boolean) from public, anon;
grant execute on function public.register_comparison() to authenticated;
grant execute on function public.complete_profile(text,text,date,text,text,smallint[],boolean) to authenticated;

-- ---------- VIEW: produto + preço atual em cada mercado ---------------
-- (versão final, com promoções e fotos, mais abaixo na seção do portal)
drop view if exists public.v_products;
create view public.v_products with (security_invoker = true) as
with latest as (
  select distinct on (product_id, supermarket_id)
         product_id, supermarket_id, price, collected_at, source
  from public.prices
  order by product_id, supermarket_id, collected_at desc
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
  min(l.price)  as min_price,
  max(l.price)  as max_price,
  max(l.collected_at) as updated_at,
  round(((avg(l.price) filter (where pa.price is not null))
        / nullif(avg(pa.price), 0) - 1) * 100, 1) as change_pct,
  jsonb_agg(jsonb_build_object(
      'market_id', l.supermarket_id,
      'price',     l.price,
      'prev',      pa.price,
      'at',        l.collected_at,
      'src',       l.source
    ) order by l.price) as prices
from public.products p
join public.categories c on c.id = p.category_id
join latest l on l.product_id = p.id
left join past pa on pa.product_id = l.product_id and pa.supermarket_id = l.supermarket_id
where p.active
group by p.id, c.slug, c.name;

-- ---------- RLS --------------------------------------------------------
alter table public.supermarkets  enable row level security;
alter table public.stores        enable row level security;
alter table public.categories    enable row level security;
alter table public.products      enable row level security;
alter table public.prices        enable row level security;
alter table public.profiles      enable row level security;
alter table public.favorites     enable row level security;
alter table public.price_reports enable row level security;

do $$ begin
  -- leitura pública do catálogo
  drop policy if exists "public read" on public.supermarkets;
  create policy "public read" on public.supermarkets for select using (true);
  drop policy if exists "public read" on public.stores;
  create policy "public read" on public.stores for select using (true);
  drop policy if exists "public read" on public.categories;
  create policy "public read" on public.categories for select using (true);
  drop policy if exists "public read" on public.products;
  create policy "public read" on public.products for select using (true);
  drop policy if exists "public read" on public.prices;
  create policy "public read" on public.prices for select using (true);

  -- perfil: só o dono
  drop policy if exists "own profile read" on public.profiles;
  create policy "own profile read" on public.profiles for select to authenticated using (id = (select auth.uid()));
  drop policy if exists "own profile update" on public.profiles;
  create policy "own profile update" on public.profiles for update to authenticated
    using (id = (select auth.uid())) with check (id = (select auth.uid()));

  -- favoritos: só o dono
  drop policy if exists "own favorites" on public.favorites;
  create policy "own favorites" on public.favorites for all to authenticated
    using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

  -- denúncias/atualizações de preço enviadas por usuários
  drop policy if exists "own reports read" on public.price_reports;
  create policy "own reports read" on public.price_reports for select to authenticated using (user_id = (select auth.uid()));
  drop policy if exists "own reports insert" on public.price_reports;
  create policy "own reports insert" on public.price_reports for insert to authenticated with check (user_id = (select auth.uid()));
end $$;

grant select on public.supermarkets, public.stores, public.categories,
               public.products, public.prices, public.v_products to anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, delete on public.favorites to authenticated;
grant select, insert on public.price_reports to authenticated;
grant usage on sequence public.price_reports_id_seq to authenticated;

-- Realtime: avisa o site quando um preço novo entra
do $$ begin
  alter publication supabase_realtime add table public.prices;
exception when duplicate_object then null; when undefined_object then null;
end $$;


-- =====================================================================
--  RANCHO DO MÊS, COLABORAÇÃO E DIAS DAS PROTEÍNAS
-- =====================================================================

-- Casa e transporte do usuário (usados no cálculo "vale a pena?")
alter table public.profiles
  add column if not exists home_lat double precision,
  add column if not exists home_lng double precision,
  add column if not exists home_label text,
  add column if not exists transport text default 'carro',
  add column if not exists cost_per_km numeric(6,2),
  add column if not exists show_in_ranking boolean not null default true;

-- Listas mensais (rancho)
create table if not exists public.shopping_lists (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name         text not null default 'Rancho do mês',
  month        date not null default date_trunc('month', now())::date,
  status       text not null default 'aberta' check (status in ('aberta','concluida')),
  best_market  smallint references public.supermarkets(id),
  best_total   numeric(10,2),
  savings      numeric(10,2),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz
);
create unique index if not exists shopping_lists_user_month on public.shopping_lists (user_id, month);

create table if not exists public.shopping_list_items (
  list_id    uuid not null references public.shopping_lists(id) on delete cascade,
  product_id int  not null references public.products(id) on delete cascade,
  qty        numeric(8,2) not null default 1 check (qty > 0),
  checked    boolean not null default false,
  primary key (list_id, product_id)
);
create index if not exists shopping_list_items_product on public.shopping_list_items (product_id);

alter table public.shopping_lists      enable row level security;
alter table public.shopping_list_items enable row level security;
do $$ begin
  drop policy if exists "own lists" on public.shopping_lists;
  create policy "own lists" on public.shopping_lists for all to authenticated
    using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  drop policy if exists "own list items" on public.shopping_list_items;
  create policy "own list items" on public.shopping_list_items for all to authenticated
    using (exists (select 1 from public.shopping_lists l where l.id = list_id and l.user_id = (select auth.uid())))
    with check (exists (select 1 from public.shopping_lists l where l.id = list_id and l.user_id = (select auth.uid())));
end $$;
grant select, insert, update, delete on public.shopping_lists, public.shopping_list_items to authenticated;

-- Preços enviados pela comunidade
alter table public.price_reports
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists store_id int references public.stores(id),
  add column if not exists at_store boolean not null default false,
  add column if not exists points int not null default 0,
  add column if not exists confirmed_by uuid;
create index if not exists price_reports_match on public.price_reports (product_id, supermarket_id, created_at desc);
create index if not exists price_reports_user on public.price_reports (user_id, created_at desc);

create or replace function public.km_between(lat1 float8, lng1 float8, lat2 float8, lng2 float8)
returns float8 language sql immutable as $$
  select 6371 * 2 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2)
       + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

-- Antes de gravar: valida, detecta se a pessoa está na loja e calcula os pontos
create or replace function public.price_report_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_store record; v_prev numeric; v_recent boolean;
begin
  new.user_id := coalesce(auth.uid(), new.user_id);
  if not setting_on('collab_enabled') then raise exception 'O envio de preços está pausado no momento.'; end if;
  if (select blocked from profiles where id = new.user_id) then raise exception 'Sua conta não pode enviar preços.'; end if;
  new.status := 'pendente';
  new.confirmed_by := null;
  if (select count(*) from price_reports where user_id = new.user_id and created_at > now() - interval '1 day') >= 60 then
    raise exception 'Você atingiu o limite de 60 preços por dia. Obrigado pela ajuda!';
  end if;
  if new.lat is not null and new.lng is not null then
    select s.id, km_between(new.lat, new.lng, s.lat, s.lng) as km into v_store
    from stores s where s.supermarket_id = new.supermarket_id order by 2 limit 1;
    if v_store.km is not null and v_store.km <= 0.5 then
      new.store_id := v_store.id; new.at_store := true;
    end if;
  end if;
  select price into v_prev from prices
   where product_id = new.product_id and supermarket_id = new.supermarket_id
   order by collected_at desc limit 1;
  if v_prev is not null and (new.price < v_prev * 0.4 or new.price > v_prev * 2.5) then
    raise exception 'Esse valor está muito diferente do último preço registrado (R$ %). Confira e tente de novo.', v_prev;
  end if;
  v_recent := exists (select 1 from prices where product_id = new.product_id
                      and supermarket_id = new.supermarket_id and collected_at > now() - interval '3 days');
  new.points := 10
    + case when new.at_store then 5 else 0 end      -- estava na loja
    + case when not v_recent then 5 else 0 end      -- atualizou preço antigo
    + case when v_prev is null then 10 else 0 end;  -- primeiro preço do item nesse mercado
  return new;
end $$;

-- Depois de gravar: se outra pessoa confirmou o mesmo preço (±3% em 48h), ou se
-- quem enviou está na loja e já tem 3 envios aprovados, o preço entra no site.
create or replace function public.price_report_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_other price_reports; v_match boolean; v_trusted boolean;
begin
  select * into v_other from price_reports r
   where r.product_id = new.product_id and r.supermarket_id = new.supermarket_id
     and r.user_id <> new.user_id and r.id <> new.id
     and r.created_at > now() - interval '48 hours'
     and abs(r.price - new.price) <= new.price * 0.03
   order by r.created_at desc limit 1;
  v_match := found;
  v_trusted := new.at_store and (select count(*) from price_reports
                                  where user_id = new.user_id and status = 'aprovado') >= 3;
  if v_match or v_trusted then
    insert into prices (product_id, supermarket_id, price, source)
    values (new.product_id, new.supermarket_id,
            round(case when v_match then (v_other.price + new.price) / 2 else new.price end, 2), 'comunidade');
    update price_reports set status = 'aprovado', points = points + 5,
           confirmed_by = case when v_match then new.user_id else confirmed_by end
     where id = new.id or (v_match and id = v_other.id);
  end if;
  return null;
end $$;

drop trigger if exists price_reports_before on public.price_reports;
create trigger price_reports_before before insert on public.price_reports
  for each row execute function public.price_report_before();
drop trigger if exists price_reports_after on public.price_reports;
create trigger price_reports_after after insert on public.price_reports
  for each row execute function public.price_report_after();

-- O que falta coletar num mercado: sem preço ou preço antigo, priorizando o que
-- mais gente tem no rancho.
create or replace function public.report_targets(p_market smallint, p_limit int default 6)
returns table (product_id int, last_price numeric, last_at timestamptz, demand bigint)
language sql stable security definer set search_path = public as $$
  with latest as (
    select distinct on (pr.product_id) pr.product_id, pr.price, pr.collected_at
    from prices pr where pr.supermarket_id = p_market
    order by pr.product_id, pr.collected_at desc
  ), dem as (
    select i.product_id, count(distinct l.user_id) as n
    from shopping_list_items i join shopping_lists l on l.id = i.list_id
    where l.month >= date_trunc('month', now()) - interval '1 month'
    group by i.product_id
  )
  select p.id, l.price, l.collected_at, coalesce(d.n, 0)
  from products p
  left join latest l on l.product_id = p.id
  left join dem d on d.product_id = p.id
  where p.active
  order by (l.collected_at is null or l.collected_at < now() - interval '3 days') desc,
           coalesce(d.n, 0) desc, l.collected_at nulls first, random()
  limit greatest(1, least(p_limit, 20));
$$;

-- Meu impacto: pontos, envios, aprovados e quantas pessoas têm esses itens no rancho
create or replace function public.my_impact()
returns jsonb language sql stable security definer set search_path = public as $$
  with mine as (
    select * from price_reports where user_id = auth.uid()
  ), month_pts as (
    select user_id, sum(points) pts from price_reports
    where created_at >= date_trunc('month', now()) group by user_id
  )
  select jsonb_build_object(
    'reports',  (select count(*) from mine),
    'approved', (select count(*) from mine where status = 'aprovado'),
    'points',   coalesce((select sum(points) from mine), 0),
    'month_points', coalesce((select pts from month_pts where user_id = auth.uid()), 0),
    'helped',   (select count(distinct l.user_id) from shopping_list_items i
                   join shopping_lists l on l.id = i.list_id
                  where l.user_id <> auth.uid()
                    and i.product_id in (select product_id from mine)),
    'rank',     (select count(*) + 1 from month_pts
                  where pts > coalesce((select pts from month_pts where user_id = auth.uid()), 0))
  );
$$;

-- Ranking do mês (só primeiro nome + inicial; respeita show_in_ranking)
create or replace function public.leaderboard(p_neighborhood text default null, p_limit int default 10)
returns table (name text, neighborhood text, points bigint, reports bigint, is_me boolean)
language sql stable security definer set search_path = public as $$
  select trim(split_part(coalesce(nullif(pf.full_name, ''), 'Fiscal'), ' ', 1) || ' ' ||
              coalesce(left(nullif(split_part(pf.full_name, ' ', 2), ''), 1) || '.', '')),
         pf.neighborhood, sum(r.points), count(*), r.user_id = auth.uid()
  from price_reports r join profiles pf on pf.id = r.user_id
  where r.created_at >= date_trunc('month', now())
    and pf.show_in_ranking
    and (p_neighborhood is null or pf.neighborhood ilike p_neighborhood)
  group by r.user_id, pf.full_name, pf.neighborhood
  order by sum(r.points) desc
  limit greatest(1, least(p_limit, 50));
$$;

-- Números da comunidade para a página inicial
create or replace function public.community_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'reports_7d',      (select count(*) from price_reports where created_at > now() - interval '7 days'),
    'contributors_30d',(select count(distinct user_id) from price_reports where created_at > now() - interval '30 days'),
    'community_prices',(select count(*) from prices where source = 'comunidade' and collected_at > now() - interval '30 days')
  );
$$;

revoke all on function public.report_targets(smallint, int) from public;
revoke all on function public.my_impact() from public, anon;
revoke all on function public.leaderboard(text, int) from public;
revoke all on function public.community_stats() from public;
grant execute on function public.report_targets(smallint, int) to anon, authenticated;
grant execute on function public.my_impact() to authenticated;
grant execute on function public.leaderboard(text, int) to anon, authenticated;
grant execute on function public.community_stats() to anon, authenticated;
grant select, insert on public.price_reports to authenticated;

-- Preço médio das proteínas por dia da semana (0 = domingo), por produto e mercado.
-- idx = % acima/abaixo da média daquele produto naquele mercado.
create or replace view public.v_protein_weekday with (security_invoker = true) as
with base as (
  select pr.product_id, pr.supermarket_id, pr.price,
         extract(dow from pr.collected_at at time zone 'America/Manaus')::int as dow
  from public.prices pr
  join public.products p on p.id = pr.product_id
  join public.categories c on c.id = p.category_id
  where c.slug = 'carnes' and pr.collected_at > now() - interval '60 days'
), avg_pm as (
  select product_id, supermarket_id, avg(price) as a from base group by 1, 2
)
select b.product_id, b.supermarket_id, b.dow,
       round(avg(b.price), 2) as avg_price,
       round((avg(b.price) / a.a - 1) * 100, 1) as idx,
       count(*) as samples
from base b join avg_pm a using (product_id, supermarket_id)
group by b.product_id, b.supermarket_id, b.dow, a.a;
grant select on public.v_protein_weekday to anon, authenticated;

-- =====================================================================
--  SEED (dados iniciais de demonstração)
--  Coordenadas das lojas são APROXIMADAS (approx = true). Confirme os
--  endereços reais e atualize lat/lng. Preços são simulados para teste.
-- =====================================================================
do $seed$
begin
if (select count(*) from public.supermarkets) > 0 then
  raise notice 'Seed ignorado: já existem supermercados.';
  return;
end if;

insert into public.supermarkets (slug, name, logo_url, color) values
 ('nova-era',         'Nova Era',          'assets/logos/nova-era.png',         '#C8102E'),
 ('db',               'Supermercados DB',  'assets/logos/db.png',               '#00529B'),
 ('veneza',           'Veneza',            'assets/logos/veneza.png',           '#E87722'),
 ('baratao-da-carne', 'Baratão da Carne',  'assets/logos/baratao-da-carne.png', '#8B4A2B'),
 ('coema',            'Coema',             'assets/logos/coema.png',            '#007A3D');

insert into public.stores (supermarket_id, name, neighborhood, lat, lng)
select s.id, x.name, x.bairro, x.lat, x.lng
from (values
 ('nova-era','Nova Era Cidade Nova','Cidade Nova',-3.0380,-59.9905),
 ('nova-era','Nova Era Flores','Flores',-3.0735,-60.0160),
 ('nova-era','Nova Era Compensa','Compensa',-3.1050,-60.0540),
 ('nova-era','Nova Era Japiim','Japiim',-3.1160,-59.9870),
 ('db','DB Adrianópolis','Adrianópolis',-3.0995,-60.0110),
 ('db','DB Ponta Negra','Ponta Negra',-3.0705,-60.0930),
 ('db','DB Parque Dez','Parque Dez',-3.0880,-60.0150),
 ('veneza','Veneza Centro','Centro',-3.1300,-60.0230),
 ('veneza','Veneza Alvorada','Alvorada',-3.0820,-60.0430),
 ('veneza','Veneza São José','São José Operário',-3.0830,-59.9440),
 ('baratao-da-carne','Baratão da Carne Cachoeirinha','Cachoeirinha',-3.1175,-60.0090),
 ('baratao-da-carne','Baratão da Carne Coroado','Coroado',-3.0950,-59.9840),
 ('baratao-da-carne','Baratão da Carne Novo Israel','Novo Israel',-3.0460,-60.0230),
 ('coema','Coema Torquato','Torquato Tapajós',-3.0600,-60.0280),
 ('coema','Coema Grande Vitória','Gilberto Mestrinho',-3.0700,-59.9290)
) as x(slug,name,bairro,lat,lng)
join public.supermarkets s on s.slug = x.slug;

insert into public.categories (slug, name, icon, sort) values
 ('mercearia','Mercearia','🥫',1), ('carnes','Carnes e peixes','🥩',2),
 ('hortifruti','Hortifrúti','🥬',3), ('laticinios','Frios e laticínios','🧀',4),
 ('bebidas','Bebidas','🥤',5), ('limpeza','Limpeza','🧴',6), ('higiene','Higiene','🧼',7);

create temp table _seed (name text, brand text, unit text, cat text, emoji text, base numeric) on commit drop;
insert into _seed values
 ('Arroz tipo 1','Tio João','5 kg','mercearia','🍚',28.90),
 ('Feijão carioca','Camil','1 kg','mercearia','🫘',8.49),
 ('Açúcar cristal','União','1 kg','mercearia','🧂',5.29),
 ('Café torrado e moído','Pilão','500 g','mercearia','☕',21.90),
 ('Óleo de soja','Soya','900 ml','mercearia','🫗',7.49),
 ('Macarrão espaguete','Galo','500 g','mercearia','🍝',4.99),
 ('Farinha de mandioca','Uarini','1 kg','mercearia','🌾',14.90),
 ('Sal refinado','Cisne','1 kg','mercearia','🧂',2.99),
 ('Leite em pó integral','Ninho','380 g','mercearia','🥛',19.90),
 ('Achocolatado em pó','Nescau','370 g','mercearia','🍫',9.49),
 ('Biscoito cream cracker','Vitarella','350 g','mercearia','🍘',5.49),
 ('Molho de tomate','Heinz','300 g','mercearia','🍅',3.99),
 ('Sardinha em óleo','Gomes da Costa','125 g','mercearia','🐟',6.49),
 ('Milho verde','Quero','170 g','mercearia','🌽',3.49),
 ('Picanha bovina','Granel','1 kg','carnes','🥩',69.90),
 ('Alcatra bovina','Granel','1 kg','carnes','🥩',44.90),
 ('Carne moída de patinho','Granel','1 kg','carnes','🍖',39.90),
 ('Frango inteiro congelado','Granel','1 kg','carnes','🍗',12.90),
 ('Peito de frango','Granel','1 kg','carnes','🍗',18.90),
 ('Linguiça toscana','Sadia','1 kg','carnes','🌭',24.90),
 ('Tambaqui inteiro','Granel','1 kg','carnes','🐟',22.90),
 ('Jaraqui','Granel','1 kg','carnes','🐟',12.90),
 ('Ovos brancos','Granja','30 un','carnes','🥚',22.90),
 ('Leite UHT integral','Italac','1 L','laticinios','🥛',5.49),
 ('Manteiga com sal','Aviação','200 g','laticinios','🧈',14.90),
 ('Queijo muçarela fatiado','Granel','1 kg','laticinios','🧀',49.90),
 ('Iogurte natural','Nestlé','170 g','laticinios','🥣',3.29),
 ('Requeijão cremoso','Catupiry','200 g','laticinios','🧀',10.90),
 ('Banana prata','Granel','1 kg','hortifruti','🍌',6.99),
 ('Tomate','Granel','1 kg','hortifruti','🍅',8.99),
 ('Cebola','Granel','1 kg','hortifruti','🧅',6.49),
 ('Batata inglesa','Granel','1 kg','hortifruti','🥔',7.49),
 ('Polpa de cupuaçu','Granel','1 kg','hortifruti','🥭',16.90),
 ('Açaí médio','Granel','1 L','hortifruti','🫐',22.00),
 ('Refrigerante','Coca-Cola','2 L','bebidas','🥤',10.99),
 ('Guaraná','Baré','2 L','bebidas','🥤',7.99),
 ('Cerveja lata','Skol','350 ml','bebidas','🍺',3.49),
 ('Água mineral sem gás','Crystal','1,5 L','bebidas','💧',2.99),
 ('Suco de uva','Del Valle','1 L','bebidas','🧃',7.99),
 ('Detergente líquido','Ypê','500 ml','limpeza','🧽',2.79),
 ('Sabão em pó','Omo','1,6 kg','limpeza','🧺',24.90),
 ('Amaciante','Comfort','1 L','limpeza','🫧',15.90),
 ('Água sanitária','Qboa','2 L','limpeza','🧴',7.49),
 ('Papel higiênico folha dupla','Neve','12 un','higiene','🧻',22.90),
 ('Creme dental','Colgate','90 g','higiene','🪥',4.99),
 ('Sabonete em barra','Dove','90 g','higiene','🧼',3.99),
 ('Shampoo','Seda','325 ml','higiene','🧴',12.90);

insert into public.products (name, brand, unit, category_id, emoji)
select s.name, s.brand, s.unit, c.id, s.emoji
from _seed s join public.categories c on c.slug = s.cat;

perform setseed(0.42);

-- histórico de 30 dias: coleta a cada 2 dias, com tendência por produto/mercado
insert into public.prices (product_id, supermarket_id, price, collected_at, source)
select p.id, m.id,
  round( (sd.base
     * case m.slug when 'nova-era' then 1.00 when 'db' then 1.04 when 'veneza' then 0.99
                   when 'baratao-da-carne' then case when sd.cat = 'carnes' then 0.90 else 1.03 end
                   when 'coema' then 0.96 end
     * mk.noise
     * (1 - mk.trend * d.n / 30.0)
     * case when d.n <= 4 and mk.shock_on < 0.4 then 1 + mk.shock else 1 end
     -- proteínas: cada rede tem um dia da semana de oferta (simulado)
     * case when sd.cat = 'carnes' then
         case extract(dow from now() - (d.n || ' days')::interval)::int
           when mk.promo_dow then 0.91
           when (mk.promo_dow + 1) % 7 then 0.96
           else 1 end
       else 1 end
     * (1 + (random() - 0.5) * 0.02)
   )::numeric, 2),
  now() - (d.n || ' days')::interval - interval '3 hours',
  'seed'
from public.products p
join _seed sd on sd.name = p.name and sd.brand = p.brand
cross join public.supermarkets m
cross join lateral (select
    0.94 + (abs(hashtext(p.id || ':' || m.id)) % 1000) / 1000.0 * 0.12           as noise,
    ((abs(hashtext('t' || p.id || ':' || m.id)) % 1000) / 1000.0 - 0.5) * 0.28  as trend,
    (abs(hashtext('c' || p.id || ':' || m.id)) % 1000) / 1000.0                as carries,
    ((abs(hashtext('s' || p.id || ':' || m.id)) % 1000) / 1000.0 - 0.5) * 0.30  as shock,
    (abs(hashtext('o' || p.id)) % 1000) / 1000.0                               as shock_on,
    (abs(hashtext('dow' || m.slug)) % 7)                                       as promo_dow) mk
cross join generate_series(0, case when sd.cat = 'carnes' then 34 else 30 end,
                                case when sd.cat = 'carnes' then 1 else 2 end) as d(n)
where mk.carries < case when m.slug = 'baratao-da-carne' and sd.cat not in ('carnes','mercearia','bebidas')
                        then 0.35 else 0.9 end;

raise notice 'Seed concluído.';
end $seed$;

-- =====================================================================
--  ATUALIZAÇÃO DO SEED (para quem rodou a primeira versão do schema):
--  recria o histórico de demonstração das proteínas com coleta diária e
--  um dia de oferta por rede, para o quadro "melhores dias".
--  Só mexe em preços com source = 'seed'.
-- =====================================================================
do $prot$
begin
  if (select count(*) from public.prices pr
        join public.products p on p.id = pr.product_id
        join public.categories c on c.id = p.category_id
       where c.slug = 'carnes' and pr.source = 'seed') between 1 and 1000 then
    create temp table _base on commit drop as
      select pr.product_id, pr.supermarket_id, avg(pr.price) as base
      from public.prices pr
      join public.products p on p.id = pr.product_id
      join public.categories c on c.id = p.category_id
      where c.slug = 'carnes' and pr.source = 'seed'
      group by 1, 2;
    delete from public.prices pr using public.products p, public.categories c
     where p.id = pr.product_id and c.id = p.category_id and c.slug = 'carnes' and pr.source = 'seed';
    insert into public.prices (product_id, supermarket_id, price, collected_at, source)
    select b.product_id, b.supermarket_id,
      round((b.base
        * (1 - ((abs(hashtext('t' || b.product_id || ':' || b.supermarket_id)) % 1000) / 1000.0 - 0.5) * 0.2 * d.n / 34.0)
        * case extract(dow from now() - (d.n || ' days')::interval)::int
            when abs(hashtext('dow' || m.slug)) % 7 then 0.91
            when (abs(hashtext('dow' || m.slug)) % 7 + 1) % 7 then 0.96
            else 1 end
        * (1 + (random() - 0.5) * 0.02))::numeric, 2),
      now() - (d.n || ' days')::interval - interval '3 hours', 'seed'
    from _base b
    join public.supermarkets m on m.id = b.supermarket_id
    cross join generate_series(0, 34) as d(n);
    raise notice 'Histórico das proteínas atualizado.';
  end if;
end $prot$;

-- Cores das redes alinhadas às logomarcas oficiais (usadas em gráficos e barras)
update public.supermarkets set color = v.color
from (values ('nova-era','#C21A19'), ('db','#D99A00'), ('veneza','#2E3A87'), ('baratao-da-carne','#8B4A2B'), ('coema','#009A51')) as v(slug, color)
where supermarkets.slug = v.slug;

-- =====================================================================
--  PORTAL DOS SUPERMERCADOS, PROMOÇÕES, FOTOS E MÉTRICAS
--  (página parceiros.html)
-- =====================================================================

-- ---------- Perfil: sexo (para métricas agregadas) ---------------------
alter table public.profiles
  add column if not exists gender text check (gender in ('feminino','masculino','outro','nao_informar'));

drop function if exists public.complete_profile(text,text,date,text,text,smallint[],boolean);
create or replace function public.complete_profile(
  p_full_name text, p_phone text, p_birth_date date, p_neighborhood text,
  p_cep text, p_preferred_markets smallint[], p_accepts_offers boolean, p_gender text default null)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare r public.profiles;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(trim(p_full_name),'') = '' or coalesce(trim(p_phone),'') = ''
     or p_birth_date is null or coalesce(trim(p_neighborhood),'') = '' then
    raise exception 'Preencha nome, telefone, data de nascimento e bairro';
  end if;
  perform set_config('app.trusted', 'on', true);
  update public.profiles set
    full_name = p_full_name, phone = p_phone, birth_date = p_birth_date,
    neighborhood = p_neighborhood, cep = p_cep,
    preferred_markets = coalesce(p_preferred_markets, '{}'),
    accepts_offers = coalesce(p_accepts_offers, false),
    gender = case when p_gender in ('feminino','masculino','outro','nao_informar') then p_gender else gender end,
    completed_at = coalesce(completed_at, now())
  where id = auth.uid()
  returning * into r;
  return r;
end $$;
revoke all on function public.complete_profile(text,text,date,text,text,smallint[],boolean,text) from public, anon;
grant execute on function public.complete_profile(text,text,date,text,text,smallint[],boolean,text) to authenticated;

-- ---------- Bairros e zonas de Manaus ----------------------------------
create table if not exists public.bairros (
  name text primary key,
  zone text not null,
  lat  double precision,
  lng  double precision
);
alter table public.bairros enable row level security;
do $$ begin
  drop policy if exists "public read" on public.bairros;
  create policy "public read" on public.bairros for select using (true);
end $$;
grant select on public.bairros to anon, authenticated;
insert into public.bairros (name, zone, lat, lng) values
 ('Adrianópolis','Centro-Sul',-3.1010,-60.0120), ('Aleixo','Centro-Sul',-3.0900,-59.9950),
 ('Alvorada','Centro-Oeste',-3.0820,-60.0430), ('Cachoeirinha','Sul',-3.1180,-60.0110),
 ('Centro','Sul',-3.1316,-60.0233), ('Chapada','Centro-Sul',-3.0960,-60.0270),
 ('Cidade de Deus','Norte',-3.0280,-59.9560), ('Cidade Nova','Norte',-3.0360,-59.9880),
 ('Compensa','Oeste',-3.1070,-60.0560), ('Coroado','Leste',-3.0950,-59.9850),
 ('Dom Pedro','Centro-Oeste',-3.0880,-60.0350), ('Educandos','Sul',-3.1400,-60.0100),
 ('Flores','Centro-Sul',-3.0730,-60.0150), ('Gilberto Mestrinho','Leste',-3.0700,-59.9300),
 ('Japiim','Sul',-3.1180,-59.9850), ('Jorge Teixeira','Leste',-3.0430,-59.9330),
 ('Lago Azul','Norte',-3.0050,-60.0350), ('Novo Aleixo','Norte',-3.0570,-59.9700),
 ('Novo Israel','Norte',-3.0450,-60.0250), ('Parque 10 de Novembro','Centro-Sul',-3.0870,-60.0130),
 ('Petrópolis','Sul',-3.1140,-59.9930), ('Planalto','Centro-Oeste',-3.0700,-60.0450),
 ('Ponta Negra','Oeste',-3.0700,-60.0950), ('Redenção','Centro-Oeste',-3.0670,-60.0500),
 ('Santo Antônio','Oeste',-3.1270,-60.0500), ('São José Operário','Leste',-3.0820,-59.9420),
 ('Tarumã','Oeste',-3.0300,-60.0700), ('Zumbi dos Palmares','Leste',-3.0880,-59.9520)
on conflict (name) do update set zone = excluded.zone, lat = excluded.lat, lng = excluded.lng;

create or replace function public.zone_of(p_neighborhood text)
returns text language sql stable set search_path = public as $$
  select zone from bairros where lower(name) = lower(trim(p_neighborhood)) limit 1
$$;

-- ---------- Quem administra cada supermercado --------------------------
create table if not exists public.market_members (
  user_id        uuid not null references auth.users(id) on delete cascade,
  supermarket_id smallint not null references public.supermarkets(id) on delete cascade,
  role           text not null default 'editor' check (role in ('admin','editor')),
  suspended      boolean not null default false,
  created_at     timestamptz not null default now(),
  primary key (user_id, supermarket_id)
);
alter table public.market_members add column if not exists suspended boolean not null default false;
-- Código de convite: você gera um por mercado e envia ao responsável.
--   insert into public.market_invites (supermarket_id) values (1) returning code;
create table if not exists public.market_invites (
  code           text primary key default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  supermarket_id smallint not null references public.supermarkets(id) on delete cascade,
  role           text not null default 'admin',
  uses_left      int not null default 5,
  expires_at     timestamptz not null default now() + interval '30 days',
  created_at     timestamptz not null default now()
);
alter table public.market_members enable row level security;
alter table public.market_invites enable row level security;
do $$ begin
  drop policy if exists "own membership" on public.market_members;
  create policy "own membership" on public.market_members for select to authenticated using (user_id = (select auth.uid()));
end $$;
grant select on public.market_members to authenticated;

create or replace function public.is_market_member(p_market smallint)
returns boolean language sql stable security definer set search_path = public as $$
  select setting_on('portal_enabled') and exists (
    select 1 from market_members m join supermarkets s on s.id = m.supermarket_id
    left join profiles pf on pf.id = m.user_id
    where m.user_id = auth.uid() and m.supermarket_id = p_market
      and not m.suspended and s.active and s.portal_enabled and not coalesce(pf.blocked, false))
$$;
grant execute on function public.is_market_member(smallint) to authenticated;

create or replace function public.join_market(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v market_invites;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta primeiro.'; end if;
  select * into v from market_invites where code = upper(trim(p_code)) for update;
  if not found or v.expires_at < now() or v.uses_left <= 0 then
    raise exception 'Código inválido ou expirado. Peça um novo à equipe do Tá Barato Mesmo?.';
  end if;
  insert into market_members (user_id, supermarket_id, role) values (auth.uid(), v.supermarket_id, v.role)
  on conflict (user_id, supermarket_id) do nothing;
  update market_invites set uses_left = uses_left - 1 where code = v.code;
  return jsonb_build_object('supermarket_id', v.supermarket_id);
end $$;

drop function if exists public.my_markets();
create or replace function public.my_markets()
returns table (id smallint, name text, slug text, logo_url text, color text, role text, blocked text)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.slug, s.logo_url, s.color, m.role,
         case when not setting_on('portal_enabled') then 'A área do supermercado está temporariamente fechada.'
              when not s.active then 'Este supermercado está desativado no site.'
              when not s.portal_enabled then 'O acesso deste supermercado ao portal está suspenso.'
              when m.suspended then 'Seu acesso a este supermercado está suspenso.' end
  from market_members m join supermarkets s on s.id = m.supermarket_id
  where m.user_id = auth.uid() order by s.name
$$;
revoke all on function public.join_market(text) from public, anon;
revoke all on function public.my_markets() from public, anon;
grant execute on function public.join_market(text) to authenticated;
grant execute on function public.my_markets() to authenticated;

-- ---------- Produtos de cada mercado (foto, código interno, ativo) -------
alter table public.products
  add column if not exists created_by_market smallint references public.supermarkets(id),
  add column if not exists updated_at timestamptz default now();

create table if not exists public.market_products (
  supermarket_id smallint not null references public.supermarkets(id) on delete cascade,
  product_id     int not null references public.products(id) on delete cascade,
  sku            text,
  image_url      text,
  active         boolean not null default true,
  updated_at     timestamptz not null default now(),
  primary key (supermarket_id, product_id)
);
alter table public.market_products enable row level security;
do $$ begin
  drop policy if exists "public read" on public.market_products;
  create policy "public read" on public.market_products for select using (true);
end $$;
grant select on public.market_products to anon, authenticated;

-- ---------- Promoções ----------------------------------------------------
-- kind = 'exclusiva': vale só para quem vem pelo Tá Barato Mesmo? (mostra o código no caixa)
-- kind = 'geral':     promoção da loja, vale para todo mundo
create table if not exists public.promotions (
  id             bigserial primary key,
  supermarket_id smallint not null references public.supermarkets(id) on delete cascade,
  product_id     int not null references public.products(id) on delete cascade,
  kind           text not null default 'geral' check (kind in ('exclusiva','geral')),
  promo_price    numeric(10,2) not null check (promo_price > 0),
  title          text,
  code           text,
  max_per_client int,
  starts_at      timestamptz not null default now(),
  ends_at        timestamptz not null default now() + interval '7 days',
  active         boolean not null default true,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists promotions_live on public.promotions (product_id, supermarket_id, ends_at);
alter table public.promotions enable row level security;
do $$ begin
  drop policy if exists "public read live" on public.promotions;
  create policy "public read live" on public.promotions for select using (active and now() between starts_at and ends_at);
  drop policy if exists "members read" on public.promotions;
  create policy "members read" on public.promotions for select to authenticated using (public.is_market_member(supermarket_id));
  drop policy if exists "members write" on public.promotions;
  create policy "members write" on public.promotions for all to authenticated
    using (public.is_market_member(supermarket_id)) with check (public.is_market_member(supermarket_id));
end $$;
grant select on public.promotions to anon, authenticated;
grant insert, update, delete on public.promotions to authenticated;
grant usage on sequence public.promotions_id_seq to authenticated;

-- código padrão das promoções exclusivas
create or replace function public.promotions_before()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.kind = 'exclusiva' and coalesce(trim(new.code), '') = '' then
    new.code := 'TB' || upper(substr(md5(random()::text), 1, 5));
  end if;
  if new.kind = 'geral' then new.code := null; end if;
  return new;
end $$;
drop trigger if exists promotions_before on public.promotions;
create trigger promotions_before before insert or update on public.promotions
  for each row execute function public.promotions_before();

-- ---------- Fotos dos produtos (Storage) ---------------------------------
-- Pasta = id do supermercado: produtos/<supermarket_id>/<arquivo>.webp
do $$ begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('produtos', 'produtos', true, 3145728, array['image/jpeg','image/png','image/webp'])
  on conflict (id) do nothing;
exception when undefined_table then raise notice 'Storage indisponível: crie o bucket "produtos" (público) no painel.';
end $$;
do $$ begin
  drop policy if exists "produtos public read" on storage.objects;
  create policy "produtos public read" on storage.objects for select using (bucket_id = 'produtos');
  drop policy if exists "produtos members write" on storage.objects;
  create policy "produtos members write" on storage.objects for insert to authenticated
    with check (bucket_id = 'produtos' and public.is_market_member(((storage.foldername(name))[1])::smallint));
  drop policy if exists "produtos members update" on storage.objects;
  create policy "produtos members update" on storage.objects for update to authenticated
    using (bucket_id = 'produtos' and public.is_market_member(((storage.foldername(name))[1])::smallint));
  drop policy if exists "produtos members delete" on storage.objects;
  create policy "produtos members delete" on storage.objects for delete to authenticated
    using (bucket_id = 'produtos' and public.is_market_member(((storage.foldername(name))[1])::smallint));
exception when undefined_table or undefined_function or invalid_schema_name then
  raise notice 'Storage indisponível: políticas de fotos não criadas.';
end $$;

-- ---------- Cadastro e edição de produtos pelo mercado -------------------
create or replace function public.market_save_product(
  p_market smallint, p_product_id int, p_name text, p_brand text, p_unit text,
  p_category text, p_ean text, p_emoji text, p_price numeric,
  p_image_url text default null, p_sku text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id int := p_product_id; v_cat smallint; v_owner smallint; v_last numeric; v_new boolean := false;
  v_ean text := nullif(regexp_replace(coalesce(p_ean, ''), '\D', '', 'g'), '');
begin
  if not is_market_member(p_market) then raise exception 'Sem permissão para este supermercado.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Informe o nome do produto.'; end if;
  if p_price is not null and (p_price <= 0 or p_price > 100000) then raise exception 'Preço inválido.'; end if;
  select id into v_cat from categories
   where slug = lower(trim(p_category)) or lower(name) = lower(trim(p_category)) limit 1;

  if v_id is null and v_ean is not null then select id into v_id from products where ean = v_ean; end if;
  if v_id is null then
    select id into v_id from products
     where lower(name) = lower(trim(p_name))
       and lower(coalesce(brand, '')) = lower(coalesce(trim(p_brand), ''))
       and lower(coalesce(unit, '')) = lower(coalesce(trim(p_unit), ''))
     limit 1;
  end if;

  if v_id is null then
    if v_cat is null then raise exception 'Categoria "%" não existe.', coalesce(p_category, ''); end if;
    insert into products (name, brand, unit, category_id, emoji, ean, image_url, created_by_market)
    values (trim(p_name), nullif(trim(p_brand), ''), nullif(trim(p_unit), ''), v_cat,
            coalesce(nullif(p_emoji, ''), '🛒'), v_ean, nullif(p_image_url, ''), p_market)
    returning id into v_id;
    v_new := true;
  else
    select created_by_market into v_owner from products where id = v_id;
    if v_owner = p_market then
      update products set name = trim(p_name), brand = nullif(trim(p_brand), ''), unit = nullif(trim(p_unit), ''),
             category_id = coalesce(v_cat, category_id), emoji = coalesce(nullif(p_emoji, ''), emoji),
             ean = coalesce(v_ean, ean), active = true, updated_at = now()
       where id = v_id;
    end if;
    if nullif(p_image_url, '') is not null then
      update products set image_url = p_image_url where id = v_id and (image_url is null or v_owner = p_market);
    end if;
  end if;

  insert into market_products (supermarket_id, product_id, sku, image_url, active, updated_at)
  values (p_market, v_id, nullif(trim(p_sku), ''), nullif(p_image_url, ''), true, now())
  on conflict (supermarket_id, product_id) do update set
    sku = coalesce(excluded.sku, market_products.sku),
    image_url = coalesce(excluded.image_url, market_products.image_url),
    active = true, updated_at = now();

  if p_price is not null then
    select price into v_last from prices where product_id = v_id and supermarket_id = p_market
     order by collected_at desc limit 1;
    if v_last is distinct from round(p_price, 2) then
      insert into prices (product_id, supermarket_id, price, source) values (v_id, p_market, round(p_price, 2), 'mercado');
    end if;
  end if;
  return jsonb_build_object('product_id', v_id, 'created', v_new);
end $$;

create or replace function public.market_remove_product(p_market smallint, p_product int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_market_member(p_market) then raise exception 'Sem permissão para este supermercado.'; end if;
  insert into market_products (supermarket_id, product_id, active) values (p_market, p_product, false)
  on conflict (supermarket_id, product_id) do update set active = false, updated_at = now();
  update promotions set active = false where supermarket_id = p_market and product_id = p_product;
end $$;

-- Produtos do mercado com preço atual, posição no ranking de preço e promoção
create or replace function public.market_catalog(p_market smallint)
returns table (product_id int, name text, brand text, unit text, category text, emoji text, ean text,
               sku text, image_url text, own boolean, price numeric, price_at timestamptz,
               min_other numeric, avg_other numeric, rank int, n_markets int, active boolean,
               promo_id bigint, promo_price numeric, promo_kind text, promo_ends timestamptz)
language sql stable security definer set search_path = public as $$
  with latest as (
    select distinct on (pr.product_id, pr.supermarket_id) pr.product_id, pr.supermarket_id, pr.price, pr.collected_at
    from prices pr order by pr.product_id, pr.supermarket_id, pr.collected_at desc
  ), live as (
    select l.* from latest l
    left join market_products mp on mp.supermarket_id = l.supermarket_id and mp.product_id = l.product_id
    where coalesce(mp.active, true)
  ), ranked as (
    select product_id, supermarket_id, price,
           rank() over (partition by product_id order by price)::int as rk,
           count(*) over (partition by product_id)::int as n
    from live
  )
  select p.id, p.name, p.brand, p.unit, c.slug, p.emoji, p.ean, mp.sku,
         coalesce(mp.image_url, p.image_url), p.created_by_market = p_market,
         l.price, l.collected_at,
         (select min(price) from live o where o.product_id = p.id and o.supermarket_id <> p_market),
         (select round(avg(price), 2) from live o where o.product_id = p.id and o.supermarket_id <> p_market),
         r.rk, r.n, coalesce(mp.active, true),
         pm.id, pm.promo_price, pm.kind, pm.ends_at
  from products p
  join categories c on c.id = p.category_id
  join latest l on l.product_id = p.id and l.supermarket_id = p_market
  left join market_products mp on mp.product_id = p.id and mp.supermarket_id = p_market
  left join ranked r on r.product_id = p.id and r.supermarket_id = p_market
  left join lateral (select * from promotions x where x.product_id = p.id and x.supermarket_id = p_market
                       and x.active and x.ends_at > now() order by x.starts_at desc limit 1) pm on true
  where is_market_member(p_market)
  order by coalesce(mp.active, true) desc, p.name
$$;

-- Importação em massa (planilha). Cada linha: ean, nome, marca, unidade, categoria,
-- preco, preco_promo, tipo_promo, inicio_promo, fim_promo, foto_url, sku, emoji
create or replace function public.market_import(p_market smallint, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; i int := 0; ok int := 0; created int := 0; promos int := 0; errs jsonb := '[]'::jsonb;
  res jsonb; v_pid int; v_promo numeric; v_kind text; v_start timestamptz; v_end timestamptz;
begin
  if not is_market_member(p_market) then raise exception 'Sem permissão para este supermercado.'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'Envie no máximo 2.000 linhas por vez.'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      res := market_save_product(p_market, null, r->>'nome', r->>'marca', r->>'unidade', r->>'categoria',
                                 r->>'ean', r->>'emoji', nullif(r->>'preco', '')::numeric,
                                 nullif(r->>'foto_url', ''), r->>'sku');
      v_pid := (res->>'product_id')::int;
      ok := ok + 1; if (res->>'created')::boolean then created := created + 1; end if;
      v_promo := nullif(r->>'preco_promo', '')::numeric;
      if v_promo is not null then
        v_kind := case when lower(coalesce(r->>'tipo_promo', '')) like 'exclusiv%' then 'exclusiva' else 'geral' end;
        v_start := coalesce(nullif(r->>'inicio_promo', '')::timestamptz, now());
        v_end := coalesce(nullif(r->>'fim_promo', '')::timestamptz + interval '23 hours 59 minutes', now() + interval '7 days');
        update promotions set active = false where supermarket_id = p_market and product_id = v_pid and active;
        insert into promotions (supermarket_id, product_id, kind, promo_price, starts_at, ends_at)
        values (p_market, v_pid, v_kind, v_promo, v_start, v_end);
        promos := promos + 1;
      end if;
    exception when others then
      errs := errs || jsonb_build_object('linha', coalesce((r->>'_linha')::int, i), 'erro', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('total', i, 'ok', ok, 'created', created, 'promos', promos, 'errors', errs);
end $$;

revoke all on function public.market_save_product(smallint,int,text,text,text,text,text,text,numeric,text,text) from public, anon;
revoke all on function public.market_remove_product(smallint,int) from public, anon;
revoke all on function public.market_catalog(smallint) from public, anon;
revoke all on function public.market_import(smallint,jsonb) from public, anon;
grant execute on function public.market_save_product(smallint,int,text,text,text,text,text,text,numeric,text,text) to authenticated;
grant execute on function public.market_remove_product(smallint,int) to authenticated;
grant execute on function public.market_catalog(smallint) to authenticated;
grant execute on function public.market_import(smallint,jsonb) to authenticated;

-- ---------- Catálogo público com promoções, fotos e itens removidos -------
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

-- ---------- Rancho: onde a pessoa comprou de verdade ---------------------
alter table public.shopping_lists
  add column if not exists bought_market smallint references public.supermarkets(id),
  add column if not exists spent numeric(10,2),
  add column if not exists base_total numeric(10,2),
  add column if not exists items_count int;

-- ---------- Eventos anônimos de uso (base das métricas) -------------------
-- Nada de dado pessoal: guardamos bairro/zona, sexo e faixa etária só de
-- quem tem cadastro completo, e os painéis só mostram grupos com 5+ pessoas.
create table if not exists public.events (
  id             bigserial primary key,
  created_at     timestamptz not null default now(),
  kind           text not null check (kind in ('search','view','add','route','rancho_done','bought','promo_view')),
  session_id     text,
  user_id        uuid,
  product_id     int references public.products(id) on delete set null,
  supermarket_id smallint references public.supermarkets(id) on delete set null,
  query          text,
  results        int,
  neighborhood   text,
  zone           text,
  gender         text,
  age_band       text,
  value          numeric(10,2)
);
create index if not exists events_kind_time on public.events (kind, created_at desc);
create index if not exists events_market on public.events (supermarket_id, created_at desc);
create index if not exists events_product on public.events (product_id, created_at desc);
alter table public.events enable row level security;  -- sem políticas: ninguém lê direto

create or replace function public.track(p_events jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  e jsonb; n int := 0; pf profiles; v_nb text; v_age text;
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
    continue when coalesce(e->>'kind', '') not in ('search','view','add','route','rancho_done','bought','promo_view');
    v_nb := coalesce(nullif(pf.neighborhood, ''), nullif(left(e->>'neighborhood', 60), ''));
    insert into events (kind, session_id, user_id, product_id, supermarket_id, query, results,
                        neighborhood, zone, gender, age_band, value)
    values (e->>'kind', left(e->>'session', 40), auth.uid(),
            (select id from products where id = nullif(e->>'product_id', '')::int),
            (select id from supermarkets where id = nullif(e->>'market_id', '')::smallint),
            nullif(lower(left(trim(e->>'query'), 60)), ''), nullif(e->>'results', '')::int,
            v_nb, zone_of(v_nb), nullif(pf.gender, 'nao_informar'), v_age,
            nullif(e->>'value', '')::numeric);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.track(jsonb) from public;
grant execute on function public.track(jsonb) to anon, authenticated;

-- ---------- Painel de métricas do supermercado ---------------------------
create or replace function public.market_dashboard(p_market smallint, p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(p_days, 365)));
  v_prev  timestamptz := now() - make_interval(days => 2 * greatest(1, least(p_days, 365)));
  k int := 5;  -- tamanho mínimo de grupo para mostrar dados demográficos
  out jsonb;
begin
  if not is_market_member(p_market) then raise exception 'Sem permissão para este supermercado.'; end if;
  with ev as (select *, coalesce(user_id::text, session_id) as who from events where created_at >= v_since),
  evp as (select * from events where created_at >= v_prev and created_at < v_since),
  latest as (
    select distinct on (pr.product_id, pr.supermarket_id) pr.product_id, pr.supermarket_id, pr.price
    from prices pr order by pr.product_id, pr.supermarket_id, pr.collected_at desc
  ),
  live as (
    select l.* from latest l left join market_products mp
      on mp.supermarket_id = l.supermarket_id and mp.product_id = l.product_id
    where coalesce(mp.active, true)
  ),
  mine as (select l.product_id, l.price, (select min(price) from live o where o.product_id = l.product_id) as best,
                  (select avg(price) from live o where o.product_id = l.product_id and o.supermarket_id <> p_market) as avg_other
           from live l where l.supermarket_id = p_market),
  wins as (  -- "vendas" estimadas: ranchos concluídos que saem mais baratos aqui + compras confirmadas + rotas abertas
    select s.id, s.name, s.color,
      count(*) filter (where e.kind = 'bought'      and e.created_at >= now() - interval '1 day')  as bought_d,
      count(*) filter (where e.kind = 'bought'      and e.created_at >= now() - interval '7 days') as bought_w,
      count(*) filter (where e.kind = 'bought')                                                    as bought_m,
      count(*) filter (where e.kind = 'rancho_done' and e.created_at >= now() - interval '1 day')  as best_d,
      count(*) filter (where e.kind = 'rancho_done' and e.created_at >= now() - interval '7 days') as best_w,
      count(*) filter (where e.kind = 'rancho_done')                                               as best_m,
      count(*) filter (where e.kind = 'route'       and e.created_at >= now() - interval '1 day')  as route_d,
      count(*) filter (where e.kind = 'route'       and e.created_at >= now() - interval '7 days') as route_w,
      count(*) filter (where e.kind = 'route')                                                     as route_m,
      coalesce(sum(e.value) filter (where e.kind = 'bought'), 0)                                   as spent_m
    from supermarkets s left join events e on e.supermarket_id = s.id and e.created_at >= now() - interval '30 days'
    where s.active group by s.id
  )
  select jsonb_build_object(
    'period_days', p_days,
    'kpis', jsonb_build_object(
      'searches',      (select count(*) from ev where kind = 'search'),
      'searches_prev', (select count(*) from evp where kind = 'search'),
      'people',        (select count(distinct who) from ev),
      'people_prev',   (select count(distinct coalesce(user_id::text, session_id)) from evp),
      'views',         (select count(*) from ev where kind = 'view' and product_id in (select product_id from mine)),
      'adds',          (select count(*) from ev where kind = 'add' and product_id in (select product_id from mine)),
      'routes',        (select count(*) from ev where kind = 'route' and supermarket_id = p_market),
      'routes_prev',   (select count(*) from evp where kind = 'route' and supermarket_id = p_market),
      'ranchos',       (select count(*) from ev where kind = 'rancho_done'),
      'rancho_wins',   (select count(*) from ev where kind = 'rancho_done' and supermarket_id = p_market),
      'bought',        (select count(*) from ev where kind = 'bought' and supermarket_id = p_market),
      'products',      (select count(*) from mine),
      'cheapest',      (select count(*) from mine where price <= best),
      'price_index',   (select round(avg(price / nullif(avg_other, 0)) * 100, 1) from mine where avg_other is not null),
      'promos_live',   (select count(*) from promotions where supermarket_id = p_market and active and now() between starts_at and ends_at)
    ),
    'top_searches', coalesce((select jsonb_agg(x) from (
        select query, count(*) n, count(distinct who) people, round(avg(results)) results
        from ev where kind = 'search' and query is not null group by query order by 2 desc limit 15) x), '[]'),
    'no_results', coalesce((select jsonb_agg(x) from (
        select query, count(*) n from ev where kind = 'search' and coalesce(results, 0) = 0 and query is not null
        group by query order by 2 desc limit 10) x), '[]'),
    'top_products', coalesce((select jsonb_agg(x) from (
        select p.id, p.name, p.brand, p.unit, p.emoji,
               count(*) filter (where e.kind = 'view') views, count(*) filter (where e.kind = 'add') adds,
               m.price my_price, m.best, (m.price <= m.best) is_best
        from ev e join products p on p.id = e.product_id left join mine m on m.product_id = p.id
        where e.kind in ('view','add') group by p.id, m.price, m.best order by count(*) desc limit 15) x), '[]'),
    'top_brands', coalesce((select jsonb_agg(x) from (
        select coalesce(nullif(p.brand, ''), 'Sem marca') brand, count(*) n,
               count(*) filter (where e.kind = 'add') adds
        from ev e join products p on p.id = e.product_id
        where e.kind in ('view','add') and coalesce(p.brand, '') not in ('', 'Granel')
        group by 1 order by 2 desc limit 10) x), '[]'),
    'top_categories', coalesce((select jsonb_agg(x) from (
        select c.name, c.icon, count(*) n from ev e join products p on p.id = e.product_id join categories c on c.id = p.category_id
        where e.kind in ('view','add') group by c.id order by 3 desc) x), '[]'),
    'ranking', coalesce((select jsonb_agg(w order by (w.bought_m * 3 + w.best_m * 2 + w.route_m) desc) from wins w), '[]'),
    'zones', coalesce((select jsonb_agg(x) from (
        select coalesce(zone, 'Não informada') zone,
               count(*) filter (where kind = 'search') searches,
               count(*) filter (where kind = 'add') adds,
               count(*) filter (where kind = 'rancho_done') ranchos,
               count(*) filter (where kind = 'route' and supermarket_id = p_market) routes_me,
               count(distinct who) people
        from ev group by 1 order by count(*) desc) x), '[]'),
    'neighborhoods', coalesce((select jsonb_agg(x) from (
        select neighborhood, zone, count(*) filter (where kind = 'search') searches,
               count(*) filter (where kind in ('add','rancho_done')) ranchos, count(distinct who) people
        from ev where neighborhood is not null group by 1, 2 having count(distinct who) >= k
        order by count(*) desc limit 12) x), '[]'),
    'gender', coalesce((select jsonb_agg(x) from (
        select gender, count(distinct who) people,
               count(*) filter (where kind = 'rancho_done') ranchos, count(*) filter (where kind = 'add') adds
        from ev where gender is not null group by 1 having count(distinct who) >= k order by 2 desc) x), '[]'),
    'age', coalesce((select jsonb_agg(x order by x.age_band) from (
        select age_band, count(distinct who) people, count(*) filter (where kind in ('add','rancho_done')) ranchos
        from ev where age_band is not null group by 1 having count(distinct who) >= k) x), '[]'),
    'hours', coalesce((select jsonb_agg(x) from (
        select extract(dow from created_at at time zone 'America/Manaus')::int dow,
               extract(hour from created_at at time zone 'America/Manaus')::int h, count(*) n
        from ev where kind in ('search','view','add') group by 1, 2) x), '[]'),
    'daily', coalesce((select jsonb_agg(x order by x.d) from (
        select (created_at at time zone 'America/Manaus')::date d,
               count(*) filter (where kind = 'search') searches,
               count(*) filter (where kind = 'view' and product_id in (select product_id from mine)) views,
               count(*) filter (where kind = 'add' and product_id in (select product_id from mine)) adds,
               count(*) filter (where kind = 'route' and supermarket_id = p_market) routes
        from ev group by 1) x), '[]'),
    'opportunities', coalesce((select jsonb_agg(x) from (
        select p.id, p.name, p.brand, p.unit, p.emoji, m.price my_price, m.best, round(m.price - m.best, 2) gap,
               (select count(distinct l.user_id) from shopping_list_items i join shopping_lists l on l.id = i.list_id
                 where i.product_id = p.id and l.month >= date_trunc('month', now()) - interval '1 month')
             + (select count(*) from ev where kind = 'add' and product_id = p.id) demand
        from mine m join products p on p.id = m.product_id
        where m.price > m.best order by demand desc, (m.price - m.best) / m.best desc limit 12) x), '[]'),
    'promos', coalesce((select jsonb_agg(x) from (
        select pm.id, p.name, p.emoji, pm.kind, pm.promo_price, pm.code, pm.starts_at, pm.ends_at,
               (select count(*) from events e where e.product_id = pm.product_id and e.kind = 'view' and e.created_at >= pm.starts_at) views,
               (select count(*) from events e where e.product_id = pm.product_id and e.kind = 'add' and e.created_at >= pm.starts_at) adds
        from promotions pm join products p on p.id = pm.product_id
        where pm.supermarket_id = p_market and pm.active and pm.ends_at > now() order by pm.ends_at) x), '[]')
  ) into out;
  return out;
end $$;
revoke all on function public.market_dashboard(smallint, int) from public, anon;
grant execute on function public.market_dashboard(smallint, int) to authenticated;

-- =====================================================================
--  ADMINISTRADOR MASTER (página admin.html)
--  Todas as funções abaixo conferem is_master() antes de qualquer coisa.
-- =====================================================================
create table if not exists public.admin_log (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  admin      text,
  action     text not null,
  detail     jsonb
);
alter table public.admin_log enable row level security;

create or replace function public.admin_guard()
returns text language plpgsql stable security definer set search_path = public, auth as $$
declare v text;
begin
  if not is_master() then raise exception 'Acesso restrito ao administrador master.'; end if;
  select email into v from auth.users where id = auth.uid();
  return v;
end $$;

create or replace function public.admin_note(p_action text, p_detail jsonb)
returns void language sql security definer set search_path = public, auth as $$
  insert into admin_log (admin, action, detail) select email, p_action, p_detail from auth.users where id = auth.uid();
$$;

create or replace function public.am_i_master()
returns boolean language sql stable security definer set search_path = public, auth as $$ select is_master() $$;

-- ---------- Visão geral e métricas de toda a plataforma -----------------
create or replace function public.admin_overview(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(p_days, 365)));
  v_prev  timestamptz := now() - make_interval(days => 2 * greatest(1, least(p_days, 365)));
  out jsonb;
begin
  perform admin_guard();
  with ev as (select *, coalesce(user_id::text, session_id) who from events where created_at >= v_since),
  evp as (select *, coalesce(user_id::text, session_id) who from events where created_at >= v_prev and created_at < v_since),
  pf as (select p.*, u.created_at as signed_up, u.last_sign_in_at, zone_of(p.neighborhood) zone,
                case when p.birth_date is null then null
                     when age(p.birth_date) < interval '25 years' then '18-24'
                     when age(p.birth_date) < interval '35 years' then '25-34'
                     when age(p.birth_date) < interval '45 years' then '35-44'
                     when age(p.birth_date) < interval '60 years' then '45-59' else '60+' end age_band
         from profiles p join auth.users u on u.id = p.id)
  select jsonb_build_object(
    'kpis', jsonb_build_object(
      'users',            (select count(*) from pf),
      'users_new',        (select count(*) from pf where signed_up >= v_since),
      'users_new_prev',   (select count(*) from pf where signed_up >= v_prev and signed_up < v_since),
      'users_complete',   (select count(*) from pf where completed_at is not null),
      'users_active',     (select count(*) from pf where last_sign_in_at >= v_since),
      'users_blocked',    (select count(*) from pf where blocked),
      'visitors',         (select count(distinct who) from ev),
      'visitors_prev',    (select count(distinct who) from evp),
      'searches',         (select count(*) from ev where kind = 'search'),
      'searches_prev',    (select count(*) from evp where kind = 'search'),
      'views',            (select count(*) from ev where kind = 'view'),
      'adds',             (select count(*) from ev where kind = 'add'),
      'ranchos',          (select count(*) from ev where kind = 'rancho_done'),
      'bought',           (select count(*) from ev where kind = 'bought'),
      'spent',            (select coalesce(sum(value), 0) from ev where kind = 'bought'),
      'routes',           (select count(*) from ev where kind = 'route'),
      'savings',          (select coalesce(sum(savings), 0) from shopping_lists where completed_at >= v_since),
      'savings_all',      (select coalesce(sum(savings), 0) from shopping_lists),
      'lists',            (select count(*) from shopping_lists where updated_at >= v_since),
      'reports',          (select count(*) from price_reports where created_at >= v_since),
      'reports_pending',  (select count(*) from price_reports where status = 'pendente'),
      'products',         (select count(*) from products where active),
      'markets',          (select count(*) from supermarkets where active),
      'members',          (select count(*) from market_members where not suspended),
      'promos_live',      (select count(*) from promotions where active and now() between starts_at and ends_at)
    ),
    'daily', coalesce((select jsonb_agg(x order by x.d) from (
        select d::date d,
          (select count(*) from pf where signed_up::date = d::date) signups,
          (select count(distinct who) from ev where (created_at at time zone 'America/Manaus')::date = d::date) visitors,
          (select count(*) from ev where kind = 'search' and (created_at at time zone 'America/Manaus')::date = d::date) searches,
          (select count(*) from ev where kind in ('rancho_done') and (created_at at time zone 'America/Manaus')::date = d::date) ranchos
        from generate_series((v_since at time zone 'America/Manaus')::date, (now() at time zone 'America/Manaus')::date, interval '1 day') d) x), '[]'),
    'zones', coalesce((select jsonb_agg(x order by x.users desc) from (
        select z.zone,
          (select count(*) from pf where pf.zone = z.zone) users,
          (select count(*) from ev where ev.zone = z.zone and kind = 'search') searches,
          (select count(*) from ev where ev.zone = z.zone and kind = 'rancho_done') ranchos,
          (select count(*) from ev where ev.zone = z.zone and kind = 'add') adds,
          (select count(distinct who) from ev where ev.zone = z.zone) visitors
        from (select distinct zone from bairros) z) x), '[]'),
    'neighborhoods', coalesce((select jsonb_agg(x) from (
        select coalesce(neighborhood, 'Não informado') neighborhood, zone_of(neighborhood) zone, count(*) users,
               count(*) filter (where completed_at is not null) complete
        from pf group by 1, 2 order by 3 desc limit 25) x), '[]'),
    'gender', coalesce((select jsonb_agg(x) from (
        select coalesce(gender, 'sem dado') gender, count(*) users,
               (select count(*) from ev where ev.gender = pf.gender and kind = 'rancho_done') ranchos
        from pf group by gender order by 2 desc) x), '[]'),
    'age', coalesce((select jsonb_agg(x order by x.age_band) from (
        select coalesce(age_band, 'sem dado') age_band, count(*) users from pf group by 1) x), '[]'),
    'top_searches', coalesce((select jsonb_agg(x) from (
        select query, count(*) n, count(distinct who) people from ev where kind = 'search' and query is not null
        group by 1 order by 2 desc limit 20) x), '[]'),
    'no_results', coalesce((select jsonb_agg(x) from (
        select query, count(*) n from ev where kind = 'search' and coalesce(results, 0) = 0 and query is not null
        group by 1 order by 2 desc limit 15) x), '[]'),
    'top_products', coalesce((select jsonb_agg(x) from (
        select p.id, p.name, p.brand, p.emoji, count(*) filter (where e.kind = 'view') views, count(*) filter (where e.kind = 'add') adds
        from ev e join products p on p.id = e.product_id where e.kind in ('view','add') group by p.id order by count(*) desc limit 15) x), '[]'),
    'hours', coalesce((select jsonb_agg(x) from (
        select extract(dow from created_at at time zone 'America/Manaus')::int dow,
               extract(hour from created_at at time zone 'America/Manaus')::int h, count(*) n
        from ev group by 1, 2) x), '[]'),
    'markets', coalesce((select jsonb_agg(x order by x.score desc) from (
        select s.id, s.name, s.color, s.logo_url, s.active, s.portal_enabled,
          (select count(*) from ev where kind = 'bought' and supermarket_id = s.id) bought,
          (select coalesce(sum(value), 0) from ev where kind = 'bought' and supermarket_id = s.id) spent,
          (select count(*) from ev where kind = 'rancho_done' and supermarket_id = s.id) rancho_wins,
          (select count(*) from ev where kind = 'route' and supermarket_id = s.id) routes,
          (select count(*) from ev where kind in ('view','add') and supermarket_id = s.id) interest,
          (select count(*) from market_products mp where mp.supermarket_id = s.id and mp.active)
            + (select count(distinct product_id) from prices pr where pr.supermarket_id = s.id
                 and not exists (select 1 from market_products mp where mp.supermarket_id = s.id and mp.product_id = pr.product_id)) products,
          (select count(*) from promotions pm where pm.supermarket_id = s.id and pm.active and now() between pm.starts_at and pm.ends_at) promos,
          (select max(collected_at) from prices pr where pr.supermarket_id = s.id) last_price,
          (select count(*) from ev where kind = 'bought' and supermarket_id = s.id) * 3
            + (select count(*) from ev where kind = 'rancho_done' and supermarket_id = s.id) * 2
            + (select count(*) from ev where kind = 'route' and supermarket_id = s.id) score
        from supermarkets s) x), '[]'),
    'reports_by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from price_reports group by 1) x), '{}')
  ) into out;
  return out;
end $$;

-- ---------- Supermercados -----------------------------------------------
create or replace function public.admin_markets()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_guard();
  return coalesce((select jsonb_agg(x order by x.name) from (
    select s.*, (select count(*) from market_members m where m.supermarket_id = s.id) members,
           (select count(*) from market_members m where m.supermarket_id = s.id and m.suspended) members_suspended,
           (select count(*) from market_invites i where i.supermarket_id = s.id and i.uses_left > 0 and i.expires_at > now()) invites,
           (select count(*) from stores st where st.supermarket_id = s.id) stores_count
    from supermarkets s) x), '[]');
end $$;

create or replace function public.admin_save_market(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id smallint := nullif(p->>'id', '')::smallint; r supermarkets;
begin
  perform admin_guard();
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Informe o nome do supermercado.'; end if;
  if v_id is null then
    insert into supermarkets (slug, name, logo_url, color, website, active, portal_enabled)
    values (coalesce(nullif(trim(p->>'slug'), ''), lower(regexp_replace(unaccent_safe(p->>'name'), '[^a-zA-Z0-9]+', '-', 'g'))),
            trim(p->>'name'), nullif(p->>'logo_url', ''), coalesce(nullif(p->>'color', ''), '#0F5A3E'), nullif(p->>'website', ''),
            coalesce((p->>'active')::boolean, true), coalesce((p->>'portal_enabled')::boolean, true))
    returning * into r;
  else
    update supermarkets set name = trim(p->>'name'), slug = coalesce(nullif(trim(p->>'slug'), ''), slug),
      logo_url = nullif(p->>'logo_url', ''), color = coalesce(nullif(p->>'color', ''), color), website = nullif(p->>'website', ''),
      active = coalesce((p->>'active')::boolean, active), portal_enabled = coalesce((p->>'portal_enabled')::boolean, portal_enabled)
    where id = v_id returning * into r;
  end if;
  perform admin_note('salvar mercado', to_jsonb(r));
  return to_jsonb(r);
exception when unique_violation then
  raise exception 'Já existe um supermercado com esse identificador (slug). Escolha outro.';
end $$;

create or replace function public.unaccent_safe(t text)
returns text language sql immutable as $$
  select translate(coalesce(t, ''), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')
$$;

create or replace function public.admin_set_market_flag(p_market smallint, p_flag text, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  if p_flag = 'active' then update supermarkets set active = p_on where id = p_market;
  elsif p_flag = 'portal_enabled' then update supermarkets set portal_enabled = p_on where id = p_market;
  else raise exception 'Opção desconhecida.'; end if;
  perform admin_note('mercado ' || p_flag, jsonb_build_object('market', p_market, 'on', p_on));
end $$;

create or replace function public.admin_delete_market(p_market smallint, p_confirm text)
returns void language plpgsql security definer set search_path = public as $$
declare v supermarkets;
begin
  perform admin_guard();
  select * into v from supermarkets where id = p_market;
  if not found then raise exception 'Supermercado não encontrado.'; end if;
  if p_confirm is distinct from v.slug then raise exception 'Digite % para confirmar.', v.slug; end if;
  delete from supermarkets where id = p_market;
  perform admin_note('excluir mercado', to_jsonb(v));
end $$;

-- lojas
create or replace function public.admin_save_store(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  if nullif(p->>'id', '') is null then
    insert into stores (supermarket_id, name, address, neighborhood, lat, lng, approx, opening_hours)
    values ((p->>'supermarket_id')::smallint, p->>'name', nullif(p->>'address', ''), nullif(p->>'neighborhood', ''),
            (p->>'lat')::float8, (p->>'lng')::float8, coalesce((p->>'approx')::boolean, false), nullif(p->>'opening_hours', ''));
  else
    update stores set name = p->>'name', address = nullif(p->>'address', ''), neighborhood = nullif(p->>'neighborhood', ''),
      lat = (p->>'lat')::float8, lng = (p->>'lng')::float8, approx = coalesce((p->>'approx')::boolean, approx),
      opening_hours = nullif(p->>'opening_hours', '')
    where id = (p->>'id')::int;
  end if;
  perform admin_note('salvar loja', p);
end $$;

create or replace function public.admin_delete_store(p_store int)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  delete from stores where id = p_store;
  perform admin_note('excluir loja', jsonb_build_object('store', p_store));
end $$;

-- ---------- Acessos ao portal ---------------------------------------------
create or replace function public.admin_market_access(p_market smallint)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform admin_guard();
  return jsonb_build_object(
    'members', coalesce((select jsonb_agg(x order by x.created_at) from (
       select m.user_id, u.email, p.full_name, m.role, m.suspended, m.created_at, u.last_sign_in_at
       from market_members m join auth.users u on u.id = m.user_id left join profiles p on p.id = m.user_id
       where m.supermarket_id = p_market) x), '[]'),
    'invites', coalesce((select jsonb_agg(x order by x.created_at desc) from (
       select code, role, uses_left, expires_at, created_at, (uses_left > 0 and expires_at > now()) valid
       from market_invites where supermarket_id = p_market) x), '[]'),
    'stores', coalesce((select jsonb_agg(x order by x.name) from (select * from stores where supermarket_id = p_market) x), '[]'));
end $$;

create or replace function public.admin_create_invite(p_market smallint, p_role text default 'admin', p_uses int default 5, p_days int default 30)
returns text language plpgsql security definer set search_path = public as $$
declare v text;
begin
  perform admin_guard();
  insert into market_invites (supermarket_id, role, uses_left, expires_at)
  values (p_market, case when p_role = 'editor' then 'editor' else 'admin' end, greatest(1, least(p_uses, 100)),
          now() + make_interval(days => greatest(1, least(p_days, 365))))
  returning code into v;
  perform admin_note('gerar convite', jsonb_build_object('market', p_market, 'code', v, 'role', p_role));
  return v;
end $$;

create or replace function public.admin_delete_invite(p_code text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  delete from market_invites where code = p_code;
  perform admin_note('excluir convite', jsonb_build_object('code', p_code));
end $$;

create or replace function public.admin_set_member(p_user uuid, p_market smallint, p_role text, p_suspended boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  update market_members set role = coalesce(nullif(p_role, ''), role), suspended = coalesce(p_suspended, suspended)
  where user_id = p_user and supermarket_id = p_market;
  perform admin_note('alterar acesso', jsonb_build_object('user', p_user, 'market', p_market, 'role', p_role, 'suspended', p_suspended));
end $$;

create or replace function public.admin_remove_member(p_user uuid, p_market smallint)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  delete from market_members where user_id = p_user and supermarket_id = p_market;
  perform admin_note('remover acesso', jsonb_build_object('user', p_user, 'market', p_market));
end $$;

create or replace function public.admin_add_member(p_email text, p_market smallint, p_role text default 'admin')
returns void language plpgsql security definer set search_path = public, auth as $$
declare v uuid;
begin
  perform admin_guard();
  select id into v from auth.users where lower(email) = lower(trim(p_email));
  if v is null then raise exception 'Nenhuma conta com o e-mail %. Gere um código de convite e envie para a pessoa.', p_email; end if;
  insert into market_members (user_id, supermarket_id, role) values (v, p_market, case when p_role = 'editor' then 'editor' else 'admin' end)
  on conflict (user_id, supermarket_id) do update set role = excluded.role, suspended = false;
  perform admin_note('adicionar acesso', jsonb_build_object('email', p_email, 'market', p_market));
end $$;

-- ---------- Usuários ------------------------------------------------------
create or replace function public.admin_users(p_q text default null, p_filter text default 'all', p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare q text := nullif(lower(trim(p_q)), '');
begin
  perform admin_guard();
  return jsonb_build_object(
    'total', (select count(*) from profiles p join auth.users u on u.id = p.id
               where (q is null or lower(u.email) like '%' || q || '%' or lower(coalesce(p.full_name, '')) like '%' || q || '%' or lower(coalesce(p.neighborhood, '')) like '%' || q || '%')
                 and (p_filter = 'all' or (p_filter = 'blocked' and p.blocked) or (p_filter = 'complete' and p.completed_at is not null)
                      or (p_filter = 'quick' and p.completed_at is null) or (p_filter = 'markets' and exists (select 1 from market_members m where m.user_id = p.id)))),
    'rows', coalesce((select jsonb_agg(x) from (
      select p.id, u.email, p.full_name, p.phone, p.neighborhood, zone_of(p.neighborhood) zone, p.gender, p.birth_date,
             p.completed_at, p.blocked, p.comparisons_used, u.created_at, u.last_sign_in_at,
             (select count(*) from price_reports r where r.user_id = p.id) reports,
             (select coalesce(sum(points), 0) from price_reports r where r.user_id = p.id) points,
             (select count(*) from shopping_lists l where l.user_id = p.id) lists,
             (select coalesce(sum(savings), 0) from shopping_lists l where l.user_id = p.id) savings,
             (select string_agg(s.name, ', ') from market_members m join supermarkets s on s.id = m.supermarket_id where m.user_id = p.id) markets,
             exists (select 1 from platform_admins a where lower(a.email) = lower(u.email)) is_admin
      from profiles p join auth.users u on u.id = p.id
      where (q is null or lower(u.email) like '%' || q || '%' or lower(coalesce(p.full_name, '')) like '%' || q || '%' or lower(coalesce(p.neighborhood, '')) like '%' || q || '%')
        and (p_filter = 'all' or (p_filter = 'blocked' and p.blocked) or (p_filter = 'complete' and p.completed_at is not null)
             or (p_filter = 'quick' and p.completed_at is null) or (p_filter = 'markets' and exists (select 1 from market_members m where m.user_id = p.id)))
      order by u.created_at desc limit greatest(1, least(p_limit, 500)) offset greatest(0, p_offset)) x), '[]'));
end $$;

create or replace function public.admin_set_user(p_user uuid, p_blocked boolean default null, p_reset_comparisons boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  perform set_config('app.trusted', 'on', true);
  update profiles set blocked = coalesce(p_blocked, blocked),
         comparisons_used = case when p_reset_comparisons then 0 else comparisons_used end
  where id = p_user;
  perform admin_note('alterar usuário', jsonb_build_object('user', p_user, 'blocked', p_blocked, 'reset', p_reset_comparisons));
end $$;

-- ---------- Preços enviados pela comunidade (moderação) -------------------
create or replace function public.admin_reports(p_status text default 'pendente', p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform admin_guard();
  return coalesce((select jsonb_agg(x) from (
    select r.id, r.created_at, r.price, r.status, r.at_store, r.points, r.note, u.email, p.name product, p.brand, p.unit, p.emoji,
           s.name market, r.supermarket_id, r.product_id,
           (select price from prices pr where pr.product_id = r.product_id and pr.supermarket_id = r.supermarket_id order by collected_at desc limit 1) current_price
    from price_reports r join products p on p.id = r.product_id join supermarkets s on s.id = r.supermarket_id
    left join auth.users u on u.id = r.user_id
    where p_status = 'all' or r.status = p_status
    order by r.created_at desc limit greatest(1, least(p_limit, 500))) x), '[]');
end $$;

create or replace function public.admin_review_report(p_id bigint, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare r price_reports;
begin
  perform admin_guard();
  select * into r from price_reports where id = p_id;
  if not found then raise exception 'Envio não encontrado.'; end if;
  if p_approve then
    if r.status <> 'aprovado' then
      insert into prices (product_id, supermarket_id, price, source) values (r.product_id, r.supermarket_id, r.price, 'comunidade');
    end if;
    update price_reports set status = 'aprovado' where id = p_id;
  else
    update price_reports set status = 'rejeitado' where id = p_id;
  end if;
  perform admin_note(case when p_approve then 'aprovar preço' else 'rejeitar preço' end, jsonb_build_object('report', p_id));
end $$;

-- ---------- Produtos e promoções ------------------------------------------
create or replace function public.admin_products(p_q text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(lower(trim(p_q)), '');
begin
  perform admin_guard();
  return coalesce((select jsonb_agg(x order by x.name) from (
    select p.id, p.name, p.brand, p.unit, p.emoji, p.ean, p.active, p.image_url, c.name category, s.name created_by,
           (select count(distinct supermarket_id) from prices pr where pr.product_id = p.id) markets,
           (select max(collected_at) from prices pr where pr.product_id = p.id) last_price
    from products p left join categories c on c.id = p.category_id left join supermarkets s on s.id = p.created_by_market
    where q is null or lower(p.name || ' ' || coalesce(p.brand, '') || ' ' || coalesce(p.ean, '')) like '%' || q || '%'
    limit 500) x), '[]');
end $$;

create or replace function public.admin_set_product(p_id int, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  update products set active = p_active where id = p_id;
  perform admin_note('produto ativo', jsonb_build_object('product', p_id, 'on', p_active));
end $$;

create or replace function public.admin_promotions()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_guard();
  return coalesce((select jsonb_agg(x order by x.created_at desc) from (
    select pm.*, p.name product, p.emoji, s.name market
    from promotions pm join products p on p.id = pm.product_id join supermarkets s on s.id = pm.supermarket_id
    order by pm.created_at desc limit 300) x), '[]');
end $$;

create or replace function public.admin_set_promotion(p_id bigint, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  update promotions set active = p_active where id = p_id;
  perform admin_note('promoção ativa', jsonb_build_object('promo', p_id, 'on', p_active));
end $$;

-- ---------- Configurações e administradores --------------------------------
create or replace function public.admin_set_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  update app_settings set value = p_value, updated_at = now(), updated_by = auth.uid() where key = p_key;
  if not found then raise exception 'Configuração % não existe.', p_key; end if;
  perform admin_note('configuração', jsonb_build_object('key', p_key, 'value', p_value));
end $$;

create or replace function public.admin_admins()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform admin_guard();
  return coalesce((select jsonb_agg(x order by x.created_at) from (
    select a.email, a.added_by, a.created_at, u.last_sign_in_at, (u.id is not null) has_account
    from platform_admins a left join auth.users u on lower(u.email) = lower(a.email)) x), '[]');
end $$;

create or replace function public.admin_add_admin(p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare me text := admin_guard();
begin
  if trim(coalesce(p_email, '')) !~ '^\S+@\S+\.\S+$' then raise exception 'E-mail inválido.'; end if;
  insert into platform_admins (email, added_by) values (lower(trim(p_email)), me) on conflict do nothing;
  perform admin_note('adicionar admin', jsonb_build_object('email', p_email));
end $$;

create or replace function public.admin_remove_admin(p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare me text := admin_guard();
begin
  if lower(p_email) = lower(me) then raise exception 'Você não pode remover a si mesmo.'; end if;
  if (select count(*) from platform_admins) <= 1 then raise exception 'Precisa haver pelo menos um administrador.'; end if;
  delete from platform_admins where lower(email) = lower(p_email);
  perform admin_note('remover admin', jsonb_build_object('email', p_email));
end $$;

create or replace function public.admin_log_list(p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_guard();
  return coalesce((select jsonb_agg(x) from (select * from admin_log order by id desc limit greatest(1, least(p_limit, 500))) x), '[]');
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'admin_guard()', 'admin_note(text,jsonb)', 'am_i_master()', 'admin_overview(int)', 'admin_markets()', 'admin_save_market(jsonb)',
    'admin_set_market_flag(smallint,text,boolean)', 'admin_delete_market(smallint,text)', 'admin_save_store(jsonb)', 'admin_delete_store(int)',
    'admin_market_access(smallint)', 'admin_create_invite(smallint,text,int,int)', 'admin_delete_invite(text)',
    'admin_set_member(uuid,smallint,text,boolean)', 'admin_remove_member(uuid,smallint)', 'admin_add_member(text,smallint,text)',
    'admin_users(text,text,int,int)', 'admin_set_user(uuid,boolean,boolean)', 'admin_reports(text,int)', 'admin_review_report(bigint,boolean)',
    'admin_products(text)', 'admin_set_product(int,boolean)', 'admin_promotions()', 'admin_set_promotion(bigint,boolean)',
    'admin_set_setting(text,jsonb)', 'admin_admins()', 'admin_add_admin(text)', 'admin_remove_admin(text)', 'admin_log_list(int)', 'is_master()']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.admin_note(text,jsonb) from authenticated;
