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
  v_limit int := 15;
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
create or replace view public.v_products with (security_invoker = true) as
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
 ('baratao-da-carne', 'Baratão da Carne',  'assets/logos/baratao-da-carne.png', '#8B1A1A'),
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
