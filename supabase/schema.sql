-- =====================================================================
--  Tá Barato Mesmo? — schema Supabase
--  Cole este arquivo inteiro no SQL Editor do projeto e clique em RUN.
--  Pode ser executado mais de uma vez (idempotente para estrutura;
--  o seed só roda se as tabelas estiverem vazias).
--  Já inclui TODAS as atualizações (pasta supabase/atualizacoes/). Banco novo: rode só este.
--  Banco antigo: pode rodar este arquivo inteiro de novo, ou só as atualizações que faltam
--  (admin.html › Saúde do banco mostra quais).
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
 ('anon_comparisons',  '10',    'Comparações sem cadastro'),
 ('quick_comparisons', '15',   'Comparações com cadastro rápido'),
 ('collab_enabled',    'true', 'Usuários podem informar preços'),
 ('promos_enabled',    'true', 'Promoções dos mercados aparecem no site'),
 ('portal_enabled',    'true', 'Área do supermercado liberada'),
 ('tracking_enabled',  'true', 'Coleta de métricas de uso'),
 ('banner',            '""',   'Aviso no topo do site (vazio = sem aviso)'),
 ('welcome_enabled',   'true', 'Boas-vindas quando a pessoa chega numa loja'),
 ('welcome_radius',    '150',  'Distância da loja para dar boas-vindas (metros)')
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
-- (depois do "zerar histórico" a chave passa a ser user_id, month, gen: não recria a antiga num banco que já tem gen)
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'shopping_lists' and column_name = 'gen') then
    create unique index if not exists shopping_lists_user_month on public.shopping_lists (user_id, month);
  end if;
end $$;

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
-- promoção que vale só numa unidade (loja) da rede; vazio = todas (atualizacao-2026-10-promo-unidade.sql)
alter table public.promotions add column if not exists store_id int references public.stores(id) on delete cascade;
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
  kind           text not null,
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
alter table public.events add column if not exists ad_id bigint;
alter table public.events drop constraint if exists events_kind_check;
alter table public.events add constraint events_kind_check check (kind in
  ('search','view','add','route','rancho_done','bought','promo_view','ad_view','ad_reveal','ad_click','cart_item','queue_open','store_visit','scan','tool',
   'camp_view','camp_click','camp_close','camp_notify','screen','push_on','push_open'));
create index if not exists events_ad on public.events (ad_id, kind) where ad_id is not null;
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
    continue when coalesce(e->>'kind', '') not in ('search','view','add','route','rancho_done','bought','promo_view','ad_view','ad_reveal','ad_click','cart_item','queue_open','store_visit','scan','tool');
    v_nb := coalesce(nullif(pf.neighborhood, ''), nullif(left(e->>'neighborhood', 60), ''));
    insert into events (kind, session_id, user_id, product_id, supermarket_id, query, results,
                        neighborhood, zone, gender, age_band, value, ad_id)
    values (e->>'kind', left(e->>'session', 40), auth.uid(),
            (select id from products where id = nullif(e->>'product_id', '')::int),
            (select id from supermarkets where id = nullif(e->>'market_id', '')::smallint),
            nullif(lower(left(trim(e->>'query'), 60)), ''), nullif(e->>'results', '')::int,
            v_nb, zone_of(v_nb), nullif(pf.gender, 'nao_informar'), v_age,
            nullif(e->>'value', '')::numeric, nullif(e->>'ad_id', '')::bigint);
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
      'visits',        (select count(distinct who) from ev where kind = 'store_visit' and supermarket_id = p_market),
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
      'visits',           (select count(*) from ev where kind = 'store_visit'),
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

-- =====================================================================
--  PUBLICIDADE: planos, espaços e campanhas dos supermercados
--  O mercado pede no portal, o administrador aprova, marca como pago e a
--  campanha entra no ar sozinha no horário agendado.
-- =====================================================================
create table if not exists public.ad_plans (
  id         serial primary key,
  name       text not null,
  hours      int  not null check (hours between 1 and 2160),
  price      numeric(10,2) not null check (price >= 0),
  blurb      text,
  active     boolean not null default true,
  sort       int not null default 0
);
create table if not exists public.ad_slots (
  key            text primary key,
  name           text not null,
  description    text,
  multiplier     numeric(4,2) not null default 1,
  max_concurrent int not null default 1 check (max_concurrent between 1 and 10),
  active         boolean not null default true,
  sort           int not null default 0
);
insert into public.ad_plans (name, hours, price, blurb, sort)
select * from (values
  ('Relâmpago', 6, 39.00, '6 horas seguidas, ideal para a oferta do dia', 1),
  ('Diário', 24, 89.00, '24 horas no ar', 2),
  ('Fim de semana', 72, 199.00, '3 dias, de sexta a domingo', 3),
  ('Semanal', 168, 389.00, '7 dias no ar', 4),
  ('Mensal', 720, 1190.00, '30 dias no ar, o melhor custo por dia', 5)) v(name, hours, price, blurb, sort)
where not exists (select 1 from public.ad_plans);
insert into public.ad_slots (key, name, description, multiplier, max_concurrent, sort) values
  ('home',    'Destaque da página inicial', 'Logo abaixo da busca, a primeira coisa que as pessoas veem.', 1.50, 1, 1),
  ('grid',    'Entre os produtos',          'Um card de curiosidade no meio da lista de ofertas.', 1.00, 2, 2),
  ('rancho',  'Rancho do mês',              'No resumo de quem está montando a lista do mês.', 1.20, 1, 3),
  ('carrinho','Carrinho',                   'Na tela de quem está comprando agora, dentro da loja.', 1.30, 1, 4),
  ('fila',    'Fila do caixa',              'No modo fila, enquanto a pessoa espera para pagar.', 0.80, 2, 5)
on conflict (key) do nothing;

create table if not exists public.ad_campaigns (
  id             bigserial primary key,
  supermarket_id smallint not null references public.supermarkets(id) on delete cascade,
  slot           text not null references public.ad_slots(key),
  plan_id        int references public.ad_plans(id),
  title          text not null check (char_length(title) between 6 and 40),
  teaser         text check (char_length(teaser) <= 70),
  body           text check (char_length(body) <= 120),
  image_url      text not null,
  cta            text not null default 'Ver oferta' check (char_length(cta) <= 20),
  target_type    text not null default 'none' check (target_type in ('none','product','store','url')),
  target_value   text,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  price          numeric(10,2) not null default 0,
  status         text not null default 'pendente' check (status in ('pendente','aprovada','recusada','pausada','cancelada')),
  paid           boolean not null default false,
  reject_reason  text,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  reviewed_at    timestamptz,
  check (ends_at > starts_at)
);
create index if not exists ad_campaigns_live on public.ad_campaigns (slot, starts_at, ends_at) where status = 'aprovada';
alter table public.ad_plans enable row level security;
alter table public.ad_slots enable row level security;
alter table public.ad_campaigns enable row level security;  -- leitura só pelas funções
do $$ begin
  drop policy if exists "public read" on public.ad_plans;
  create policy "public read" on public.ad_plans for select using (true);
  drop policy if exists "public read" on public.ad_slots;
  create policy "public read" on public.ad_slots for select using (true);
end $$;
grant select on public.ad_plans, public.ad_slots to anon, authenticated;
insert into public.app_settings (key, value, label) values ('ads_enabled', 'true', 'Publicidade aparece no site')
on conflict (key) do nothing;

-- imagens das campanhas: produtos/<supermarket_id>/ads-... (mesmo bucket e regras das fotos)

-- Anúncios no ar agora (só o necessário para exibir)
-- (a publicidade inteligente, no fim do arquivo, muda as colunas: apaga antes para o arquivo rodar de novo)
drop function if exists public.ads_live();
create or replace function public.ads_live()
returns table (id bigint, slot text, title text, teaser text, body text, image_url text, cta text,
               target_type text, target_value text, supermarket_id smallint, market text, ends_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.slot, c.title, c.teaser, c.body, c.image_url, c.cta, c.target_type, c.target_value,
         c.supermarket_id, s.name, c.ends_at
  from ad_campaigns c join supermarkets s on s.id = c.supermarket_id join ad_slots sl on sl.key = c.slot
  where setting_on('ads_enabled') and c.status = 'aprovada' and c.paid and s.active and sl.active
    and now() between c.starts_at and c.ends_at
$$;
grant execute on function public.ads_live() to anon, authenticated;

-- Quantas vagas o espaço tem no período (para o mercado escolher o horário)
create or replace function public.ad_availability(p_slot text, p_start timestamptz, p_end timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'max', (select max_concurrent from ad_slots where key = p_slot),
    'taken', (select count(*) from ad_campaigns where slot = p_slot and status in ('aprovada','pendente')
               and starts_at < p_end and ends_at > p_start))
$$;
grant execute on function public.ad_availability(text, timestamptz, timestamptz) to authenticated;

create or replace function public.ad_quote(p_slot text, p_plan int)
returns numeric language sql stable security definer set search_path = public as $$
  select round(p.price * s.multiplier) from ad_plans p, ad_slots s where p.id = p_plan and s.key = p_slot
$$;
grant execute on function public.ad_quote(text, int) to anon, authenticated;

-- Pedido do supermercado
create or replace function public.market_ad_request(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_m smallint := (p->>'supermarket_id')::smallint;
  v_plan ad_plans; v_slot ad_slots; v_start timestamptz := (p->>'starts_at')::timestamptz; v_end timestamptz;
  v_taken int; r ad_campaigns;
begin
  if not is_market_member(v_m) then raise exception 'Sem permissão para este supermercado.'; end if;
  select * into v_plan from ad_plans where id = (p->>'plan_id')::int and active;
  if not found then raise exception 'Escolha um plano.'; end if;
  select * into v_slot from ad_slots where key = p->>'slot' and active;
  if not found then raise exception 'Escolha um espaço.'; end if;
  if v_start < now() - interval '10 minutes' then raise exception 'Escolha um início no futuro.'; end if;
  v_end := v_start + make_interval(hours => v_plan.hours);
  select count(*) into v_taken from ad_campaigns where slot = v_slot.key and status in ('aprovada','pendente')
     and starts_at < v_end and ends_at > v_start;
  if v_taken >= v_slot.max_concurrent then
    raise exception 'O espaço “%” já está reservado nesse período. Escolha outro horário ou outro espaço.', v_slot.name;
  end if;
  if coalesce(p->>'image_url', '') = '' then raise exception 'Envie a imagem do anúncio.'; end if;
  insert into ad_campaigns (supermarket_id, slot, plan_id, title, teaser, body, image_url, cta, target_type, target_value, starts_at, ends_at, price)
  values (v_m, v_slot.key, v_plan.id, trim(p->>'title'), nullif(trim(p->>'teaser'), ''), nullif(trim(p->>'body'), ''), p->>'image_url',
          coalesce(nullif(trim(p->>'cta'), ''), 'Ver oferta'), coalesce(nullif(p->>'target_type', ''), 'none'), nullif(p->>'target_value', ''),
          v_start, v_end, round(v_plan.price * v_slot.multiplier))
  returning * into r;
  return to_jsonb(r);
end $$;

create or replace function public.market_ads(p_market smallint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_market_member(p_market) then raise exception 'Sem permissão para este supermercado.'; end if;
  return coalesce((select jsonb_agg(x order by x.starts_at desc) from (
    select c.*, pl.name plan_name, sl.name slot_name,
      (select count(*) from events e where e.ad_id = c.id and e.kind = 'ad_view') views,
      (select count(*) from events e where e.ad_id = c.id and e.kind = 'ad_reveal') reveals,
      (select count(*) from events e where e.ad_id = c.id and e.kind = 'ad_click') clicks
    from ad_campaigns c left join ad_plans pl on pl.id = c.plan_id left join ad_slots sl on sl.key = c.slot
    where c.supermarket_id = p_market) x), '[]');
end $$;

create or replace function public.market_ad_cancel(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v ad_campaigns;
begin
  select * into v from ad_campaigns where id = p_id;
  if not found or not is_market_member(v.supermarket_id) then raise exception 'Sem permissão.'; end if;
  if v.status = 'aprovada' and v.starts_at <= now() then raise exception 'A campanha já começou. Fale com a equipe para pausar.'; end if;
  update ad_campaigns set status = 'cancelada' where id = p_id;
end $$;

revoke all on function public.market_ad_request(jsonb) from public, anon;
revoke all on function public.market_ads(smallint) from public, anon;
revoke all on function public.market_ad_cancel(bigint) from public, anon;
grant execute on function public.market_ad_request(jsonb) to authenticated;
grant execute on function public.market_ads(smallint) to authenticated;
grant execute on function public.market_ad_cancel(bigint) to authenticated;

-- Administração da publicidade
create or replace function public.admin_ads(p_status text default 'all')
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_guard();
  return jsonb_build_object(
    'campaigns', coalesce((select jsonb_agg(x order by x.created_at desc) from (
      select c.*, s.name market, s.color, s.logo_url, pl.name plan_name, sl.name slot_name,
        (select count(*) from events e where e.ad_id = c.id and e.kind = 'ad_view') views,
        (select count(*) from events e where e.ad_id = c.id and e.kind = 'ad_reveal') reveals,
        (select count(*) from events e where e.ad_id = c.id and e.kind = 'ad_click') clicks
      from ad_campaigns c join supermarkets s on s.id = c.supermarket_id
      left join ad_plans pl on pl.id = c.plan_id left join ad_slots sl on sl.key = c.slot
      where p_status = 'all' or c.status = p_status or (p_status = 'live' and c.status = 'aprovada' and now() between c.starts_at and c.ends_at)
      limit 300) x), '[]'),
    'revenue', jsonb_build_object(
      'paid_month', (select coalesce(sum(price), 0) from ad_campaigns where paid and created_at >= date_trunc('month', now())),
      'paid_total', (select coalesce(sum(price), 0) from ad_campaigns where paid),
      'to_receive', (select coalesce(sum(price), 0) from ad_campaigns where status = 'aprovada' and not paid),
      'pending',    (select count(*) from ad_campaigns where status = 'pendente'),
      'live',       (select count(*) from ad_campaigns where status = 'aprovada' and paid and now() between starts_at and ends_at)),
    'plans', coalesce((select jsonb_agg(x order by x.sort) from (select * from ad_plans) x), '[]'),
    'slots', coalesce((select jsonb_agg(x order by x.sort) from (select * from ad_slots) x), '[]'));
end $$;

create or replace function public.admin_ad_set(p_id bigint, p_action text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  if p_action = 'aprovar' then update ad_campaigns set status = 'aprovada', reject_reason = null, reviewed_at = now() where id = p_id;
  elsif p_action = 'recusar' then update ad_campaigns set status = 'recusada', reject_reason = p_reason, reviewed_at = now() where id = p_id;
  elsif p_action = 'pausar' then update ad_campaigns set status = 'pausada' where id = p_id;
  elsif p_action = 'retomar' then update ad_campaigns set status = 'aprovada' where id = p_id;
  elsif p_action = 'pago' then update ad_campaigns set paid = true where id = p_id;
  elsif p_action = 'nao_pago' then update ad_campaigns set paid = false where id = p_id;
  elsif p_action = 'excluir' then delete from ad_campaigns where id = p_id;
  else raise exception 'Ação desconhecida.'; end if;
  perform admin_note('publicidade ' || p_action, jsonb_build_object('campaign', p_id, 'reason', p_reason));
end $$;

create or replace function public.admin_save_ad_plan(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  if nullif(p->>'id', '') is null then
    insert into ad_plans (name, hours, price, blurb, active, sort)
    values (p->>'name', (p->>'hours')::int, (p->>'price')::numeric, nullif(p->>'blurb', ''), coalesce((p->>'active')::boolean, true), coalesce((p->>'sort')::int, 99));
  else
    update ad_plans set name = coalesce(p->>'name', name), hours = coalesce((p->>'hours')::int, hours), price = coalesce((p->>'price')::numeric, price),
      blurb = coalesce(p->>'blurb', blurb), active = coalesce((p->>'active')::boolean, active) where id = (p->>'id')::int;
  end if;
  perform admin_note('plano de publicidade', p);
end $$;

create or replace function public.admin_save_ad_slot(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  update ad_slots set multiplier = coalesce((p->>'multiplier')::numeric, multiplier), max_concurrent = coalesce((p->>'max_concurrent')::int, max_concurrent),
    active = coalesce((p->>'active')::boolean, active) where key = p->>'key';
  perform admin_note('espaço de publicidade', p);
end $$;

do $$
declare f text;
begin
  foreach f in array array['admin_ads(text)', 'admin_ad_set(bigint,text,text)', 'admin_save_ad_plan(jsonb)', 'admin_save_ad_slot(jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- =====================================================================
--  CARRINHO: fotos de etiqueta enviadas quando o preço falado não bate
--  com o do site ou o produto ainda não existe
-- =====================================================================
create table if not exists public.shelf_photos (
  id             bigserial primary key,
  created_at     timestamptz not null default now(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  supermarket_id smallint references public.supermarkets(id) on delete set null,
  product_id     int references public.products(id) on delete set null,
  spoken         text,
  name           text,
  size           text,
  price          numeric(10,2),
  site_price     numeric(10,2),
  photo_url      text not null,
  lat            double precision,
  lng            double precision,
  status         text not null default 'pendente' check (status in ('pendente','aprovada','recusada')),
  reviewed_at    timestamptz
);
alter table public.shelf_photos enable row level security;
do $$ begin
  drop policy if exists "own insert" on public.shelf_photos;
  create policy "own insert" on public.shelf_photos for insert to authenticated with check (user_id = (select auth.uid()));
  drop policy if exists "own read" on public.shelf_photos;
  create policy "own read" on public.shelf_photos for select to authenticated using (user_id = (select auth.uid()));
end $$;
grant select, insert on public.shelf_photos to authenticated;
grant usage on sequence public.shelf_photos_id_seq to authenticated;

do $$ begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('etiquetas', 'etiquetas', true, 3145728, array['image/jpeg','image/png','image/webp'])
  on conflict (id) do nothing;
exception when undefined_table then raise notice 'Storage indisponível: crie o bucket "etiquetas" (público) no painel.';
end $$;
do $$ begin
  drop policy if exists "etiquetas public read" on storage.objects;
  create policy "etiquetas public read" on storage.objects for select using (bucket_id = 'etiquetas');
  drop policy if exists "etiquetas own write" on storage.objects;
  create policy "etiquetas own write" on storage.objects for insert to authenticated
    with check (bucket_id = 'etiquetas' and (storage.foldername(name))[1] = (select auth.uid())::text);
exception when undefined_table or undefined_function or invalid_schema_name then
  raise notice 'Storage indisponível: políticas de etiquetas não criadas.';
end $$;

create or replace function public.admin_shelf_photos(p_status text default 'pendente')
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform admin_guard();
  return coalesce((select jsonb_agg(x order by x.created_at desc) from (
    select f.*, u.email, s.name market, p.name product, p.brand, p.unit, p.emoji
    from shelf_photos f left join auth.users u on u.id = f.user_id left join supermarkets s on s.id = f.supermarket_id
    left join products p on p.id = f.product_id
    where p_status = 'all' or f.status = p_status limit 200) x), '[]');
end $$;

create or replace function public.admin_review_photo(p_id bigint, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare f shelf_photos;
begin
  perform admin_guard();
  select * into f from shelf_photos where id = p_id;
  if not found then raise exception 'Foto não encontrada.'; end if;
  if p_approve and f.product_id is not null and f.supermarket_id is not null and f.price is not null and f.status <> 'aprovada' then
    insert into prices (product_id, supermarket_id, price, source) values (f.product_id, f.supermarket_id, f.price, 'comunidade');
  end if;
  update shelf_photos set status = case when p_approve then 'aprovada' else 'recusada' end, reviewed_at = now() where id = p_id;
  perform admin_note(case when p_approve then 'aprovar foto de etiqueta' else 'recusar foto de etiqueta' end, jsonb_build_object('photo', p_id));
end $$;

do $$
declare f text;
begin
  foreach f in array array['admin_shelf_photos(text)', 'admin_review_photo(bigint,boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;


-- =====================================================================
--  Ajudantes do mercado: códigos de barras ensinados pelos usuários
--  Quando a pessoa lê um código que o site não conhece, ela escolhe o
--  produto ("me ensina: qual é?"). Duas pessoas diferentes indicando o
--  mesmo produto para o mesmo código gravam o EAN no produto sozinhas.
-- =====================================================================
create table if not exists public.ean_suggestions (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  ean         text not null check (ean ~ '^[0-9]{8,14}$'),
  product_id  int not null references public.products(id) on delete cascade,
  user_id     uuid not null default auth.uid(),
  unique (ean, product_id, user_id)
);
alter table public.ean_suggestions enable row level security;
drop policy if exists ean_sugg_insert on public.ean_suggestions;
create policy ean_sugg_insert on public.ean_suggestions for insert to authenticated with check (user_id = auth.uid());
drop policy if exists ean_sugg_admin on public.ean_suggestions;
create policy ean_sugg_admin on public.ean_suggestions for select to authenticated using (is_master());

create or replace function public.ean_suggestion_apply()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_norm text := ltrim(new.ean, '0');
begin
  if exists (select 1 from products where ltrim(coalesce(ean, ''), '0') = v_norm) then return new; end if;
  if (select count(distinct user_id) from ean_suggestions where ltrim(ean, '0') = v_norm and product_id = new.product_id) >= 2 then
    update products set ean = new.ean where id = new.product_id and ean is null;
  end if;
  return new;
end $$;
drop trigger if exists ean_suggestion_apply on public.ean_suggestions;
create trigger ean_suggestion_apply after insert on public.ean_suggestions for each row execute function public.ean_suggestion_apply();

-- =====================================================================
--  Dias e formas de pagamento com desconto (cadastro no portal do mercado)
--  Ex.: "Terça do Hortifrúti" 15% em hortifruti às terças;
--       "5% no Pix" na loja toda, todos os dias, pagando com Pix.
-- =====================================================================
create table if not exists public.market_deals (
  id             bigserial primary key,
  supermarket_id smallint not null references public.supermarkets(id) on delete cascade,
  title          text check (char_length(title) <= 60),
  weekdays       smallint[] not null default '{}',          -- 0 = domingo … 6 = sábado; vazio = todos os dias
  category_slug  text references public.categories(slug) on update cascade on delete set null, -- vazio = loja toda
  payment        text check (payment in ('pix','debito','credito','cartao_loja','dinheiro','vale','app_loja')), -- vazio = qualquer forma
  discount_pct   numeric(4,1) not null check (discount_pct > 0 and discount_pct <= 90),
  note           text check (char_length(note) <= 120),
  starts_on      date not null default current_date,
  ends_on        date,
  active         boolean not null default true,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  check (weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  check (ends_on is null or ends_on >= starts_on)
);
create index if not exists market_deals_market on public.market_deals (supermarket_id) where active;
alter table public.market_deals enable row level security;
do $$ begin
  drop policy if exists "public read deals" on public.market_deals;
  create policy "public read deals" on public.market_deals for select using (active and (ends_on is null or ends_on >= current_date));
  drop policy if exists "members read deals" on public.market_deals;
  create policy "members read deals" on public.market_deals for select to authenticated using (public.is_market_member(supermarket_id));
  drop policy if exists "members write deals" on public.market_deals;
  create policy "members write deals" on public.market_deals for all to authenticated
    using (public.is_market_member(supermarket_id)) with check (public.is_market_member(supermarket_id));
  drop policy if exists "master deals" on public.market_deals;
  create policy "master deals" on public.market_deals for all to authenticated using (public.is_master()) with check (public.is_master());
end $$;
grant select on public.market_deals to anon, authenticated;
grant insert, update, delete on public.market_deals to authenticated;
grant usage on sequence public.market_deals_id_seq to authenticated;


-- =====================================================================
--  Tá Barato Mesmo? — atualização de outubro/2026
--  • Notas fiscais (NFC-e) enviadas pelos usuários: preços reais, na data
--    e no supermercado certos, com pontos e comparações extras para quem envia
--  • Leitor com IA: encartes (foto/PDF), foto da etiqueta na prateleira
--  • Importação de encarte revisada (admin e portal do mercado)
--  Pode rodar mais de uma vez (idempotente). Rode no SQL Editor depois do schema.sql.
-- =====================================================================

-- ---------- CNPJ dos mercados e lojas (para reconhecer a nota) -----------
-- cnpj_raiz = 8 primeiros dígitos do CNPJ (iguais em todas as lojas da rede)
alter table public.supermarkets add column if not exists cnpj_raiz text[] not null default '{}';
alter table public.stores add column if not exists cnpj text;
create index if not exists stores_cnpj on public.stores (cnpj) where cnpj is not null;

insert into public.app_settings (key, value, label) values
  ('receipts_enabled', 'true', 'Usuários podem enviar notas fiscais'),
  ('ia_enabled', 'true', 'Leitor com IA (encarte, etiqueta, nota por foto)'),
  ('ia_daily_limit', '30', 'Leituras com IA por usuário por dia')
on conflict (key) do nothing;

-- ---------- Notas fiscais ------------------------------------------------
create table if not exists public.receipts (
  id              bigserial primary key,
  created_at      timestamptz not null default now(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  chave           text unique check (chave ~ '^[0-9]{44}$'),   -- chave de acesso: a mesma nota não entra duas vezes
  source          text not null default 'qr' check (source in ('qr', 'foto_ia')),
  supermarket_id  smallint references public.supermarkets(id) on delete set null,
  store_id        int references public.stores(id) on delete set null,
  market_confirmed boolean not null default false,              -- mercado reconhecido pelo CNPJ (e não só escolhido pela pessoa)
  cnpj            text,
  store_name      text,
  issued_at       timestamptz,
  total           numeric(10,2),
  items_count     int not null default 0,
  matched_count   int not null default 0,
  prices_added    int not null default 0,
  stale_updated   int not null default 0,
  points          int not null default 0,
  status          text not null default 'verificada' check (status in ('verificada', 'pendente', 'recusada'))
);
create index if not exists receipts_user on public.receipts (user_id, created_at desc);
create index if not exists receipts_cnpj on public.receipts (left(cnpj, 8)) where cnpj is not null;

create table if not exists public.receipt_items (
  id          bigserial primary key,
  receipt_id  bigint not null references public.receipts(id) on delete cascade,
  name        text not null,
  code        text,
  qty         numeric(12,3),
  unit        text,
  unit_price  numeric(10,2),
  total       numeric(10,2),
  product_id  int references public.products(id) on delete set null,
  price_added boolean not null default false
);
create index if not exists receipt_items_receipt on public.receipt_items (receipt_id);
create index if not exists receipt_items_unmatched on public.receipt_items (lower(name)) where product_id is null;

alter table public.receipts enable row level security;
alter table public.receipt_items enable row level security;
do $$ begin
  drop policy if exists "own receipts" on public.receipts;
  create policy "own receipts" on public.receipts for select to authenticated using (user_id = (select auth.uid()));
  drop policy if exists "own receipt items" on public.receipt_items;
  create policy "own receipt items" on public.receipt_items for select to authenticated
    using (exists (select 1 from public.receipts r where r.id = receipt_id and r.user_id = (select auth.uid())));
end $$;
grant select on public.receipts, public.receipt_items to authenticated;

-- ---------- Leituras com IA (prova da foto da etiqueta) ------------------
create table if not exists public.ia_readings (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('etiqueta', 'nota', 'encarte')),
  result      jsonb not null default '{}',
  photo_path  text
);
create index if not exists ia_readings_user on public.ia_readings (user_id, created_at desc);
alter table public.ia_readings enable row level security;
do $$ begin
  drop policy if exists "own readings" on public.ia_readings;
  create policy "own readings" on public.ia_readings for select to authenticated using (user_id = (select auth.uid()));
end $$;
grant select on public.ia_readings to authenticated;

alter table public.price_reports add column if not exists ia_reading_id uuid references public.ia_readings(id) on delete set null;
alter table public.price_reports add column if not exists photo_url text;

-- ---------- Encartes importados ------------------------------------------
create table if not exists public.encarte_imports (
  id             bigserial primary key,
  created_at     timestamptz not null default now(),
  user_id        uuid default auth.uid(),
  supermarket_id smallint references public.supermarkets(id) on delete cascade,
  file_name      text,
  starts_at      date,
  ends_at        date,
  rows_total     int,
  prices         int,
  promos         int,
  created        int
);
alter table public.encarte_imports enable row level security;
do $$ begin
  drop policy if exists "members read" on public.encarte_imports;
  create policy "members read" on public.encarte_imports for select to authenticated
    using (public.is_master() or public.is_market_member(supermarket_id));
end $$;
grant select on public.encarte_imports to authenticated;

-- =====================================================================
--  Preço enviado com foto lida pela IA: vira prova.
--  Se a leitura da IA é desta pessoa, recente e tem o mesmo preço, e ela está
--  na loja (GPS), o preço entra no site na hora. Fora da loja, vai para a
--  moderação com a foto.
-- =====================================================================
create or replace function public.ia_evidence_ok(p_reading uuid, p_user uuid, p_price numeric)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from ia_readings r
                  where r.id = p_reading and r.user_id = p_user and r.kind = 'etiqueta'
                    and r.created_at > now() - interval '2 hours'
                    and abs(coalesce((r.result->>'preco')::numeric, -1) - p_price) <= 0.01)
$$;
revoke all on function public.ia_evidence_ok(uuid, uuid, numeric) from public, anon, authenticated;

create or replace function public.price_report_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_store record; v_prev numeric; v_recent boolean; v_photo boolean := false;
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
  -- leitura da IA que não confere com o preço enviado não vale como prova
  if new.ia_reading_id is not null then
    v_photo := ia_evidence_ok(new.ia_reading_id, new.user_id, new.price);
    if not v_photo then new.ia_reading_id := null; end if;
  end if;
  select price into v_prev from prices
   where product_id = new.product_id and supermarket_id = new.supermarket_id
   order by collected_at desc limit 1;
  -- sem foto, valor muito fora do último preço é recusado; com foto lida pela IA, vai para a moderação
  if v_prev is not null and (new.price < v_prev * 0.4 or new.price > v_prev * 2.5) and not v_photo then
    raise exception 'Esse valor está muito diferente do último preço registrado (R$ %). Confira e tente de novo.', v_prev;
  end if;
  v_recent := exists (select 1 from prices where product_id = new.product_id
                      and supermarket_id = new.supermarket_id and collected_at > now() - interval '3 days');
  new.points := 10
    + case when new.at_store then 5 else 0 end      -- estava na loja
    + case when not v_recent then 5 else 0 end      -- atualizou preço antigo
    + case when v_prev is null then 10 else 0 end   -- primeiro preço do item nesse mercado
    + case when v_photo then 5 else 0 end;          -- mandou foto da etiqueta
  return new;
end $$;

create or replace function public.price_report_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_other price_reports; v_match boolean; v_trusted boolean; v_prev numeric; v_sane boolean;
begin
  select * into v_other from price_reports r
   where r.product_id = new.product_id and r.supermarket_id = new.supermarket_id
     and r.user_id <> new.user_id and r.id <> new.id
     and r.created_at > now() - interval '48 hours'
     and abs(r.price - new.price) <= new.price * 0.03
   order by r.created_at desc limit 1;
  v_match := found;
  select price into v_prev from prices where product_id = new.product_id and supermarket_id = new.supermarket_id
   order by collected_at desc limit 1;
  v_sane := v_prev is null or (new.price between v_prev * 0.4 and v_prev * 2.5);
  v_trusted := new.at_store and (
       (select count(*) from price_reports where user_id = new.user_id and status = 'aprovado') >= 3
    or (new.ia_reading_id is not null and v_sane));   -- foto da etiqueta lida pela IA + GPS na loja
  if v_match or v_trusted then
    insert into prices (product_id, supermarket_id, price, source)
    values (new.product_id, new.supermarket_id,
            round(case when v_match then (v_other.price + new.price) / 2 else new.price end, 2),
            case when new.ia_reading_id is not null and not v_match then 'foto' else 'comunidade' end);
    update price_reports set status = 'aprovado', points = points + 5,
           confirmed_by = case when v_match then new.user_id else confirmed_by end
     where id = new.id or (v_match and id = v_other.id);
  end if;
  return null;
end $$;

-- Publica os preços de uma nota já gravada (mercado confirmado pelo CNPJ, nota com até 30 dias).
-- Usada na gravação e de novo quando o CNPJ da rede é confirmado depois (pela comunidade ou pelo admin).
create or replace function public.receipt_publish(p_receipt bigint)
returns int language plpgsql security definer set search_path = public as $$
declare r receipts; it receipt_items; v_prev record; v_added int := 0; v_stale int := 0;
begin
  select * into r from receipts where id = p_receipt;
  if not found or not r.market_confirmed or r.supermarket_id is null or r.issued_at < now() - interval '30 days' then return 0; end if;
  for it in select * from receipt_items where receipt_id = p_receipt and product_id is not null and not price_added and unit_price > 0 loop
    select price, collected_at into v_prev from prices
     where product_id = it.product_id and supermarket_id = r.supermarket_id order by collected_at desc limit 1;
    if v_prev.price is not null and (it.unit_price < v_prev.price * 0.4 or it.unit_price > v_prev.price * 2.5) then continue; end if;
    -- mesmo preço já registrado perto da mesma hora (outra nota do mesmo dia): não duplica
    if exists (select 1 from prices where product_id = it.product_id and supermarket_id = r.supermarket_id and price = it.unit_price
                 and collected_at between r.issued_at - interval '12 hours' and r.issued_at + interval '12 hours') then
      update receipt_items set price_added = true where id = it.id; continue;
    end if;
    insert into prices (product_id, supermarket_id, price, collected_at, source) values (it.product_id, r.supermarket_id, it.unit_price, r.issued_at, 'nota');
    update receipt_items set price_added = true where id = it.id;
    v_added := v_added + 1;
    if v_prev.collected_at is null or v_prev.collected_at < r.issued_at - interval '3 days' then v_stale := v_stale + 1; end if;
  end loop;
  update receipts set prices_added = prices_added + v_added, stale_updated = stale_updated + v_stale,
         points = case when v_stale > 0 then least(150, points + 3 * v_stale) else points end
   where id = p_receipt;
  return v_added;
end $$;
revoke all on function public.receipt_publish(bigint) from public, anon, authenticated;

-- =====================================================================
--  Gravar a nota (chamada só pela função "nfce", com a chave de serviço,
--  depois de ler a página da Sefaz ela mesma: os itens não vêm do navegador)
-- =====================================================================
create or replace function public.receipt_ingest(p_user uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_chave text := nullif(regexp_replace(coalesce(p->>'chave', ''), '\D', '', 'g'), '');
  v_cnpj text := nullif(regexp_replace(coalesce(p->'store'->>'cnpj', ''), '\D', '', 'g'), '');
  v_market smallint; v_store int; v_confirmed boolean := false; v_choice smallint := nullif(p->>'supermarket_id', '')::smallint;
  v_issued timestamptz; v_old boolean; v_id bigint; it jsonb; v_pid int; v_price numeric;
  v_matched int := 0; v_added int := 0; v_stale int := 0; v_items int := 0; v_points int; v_ex receipts;
  v_ean text;
begin
  if p_user is null then raise exception 'Entre na sua conta para enviar a nota.'; end if;
  if not setting_on('receipts_enabled') then raise exception 'O envio de notas está pausado no momento.'; end if;
  if (select blocked from profiles where id = p_user) then raise exception 'Sua conta não pode enviar notas.'; end if;
  if v_chave is null or length(v_chave) <> 44 then raise exception 'Não encontrei a chave de acesso desta nota.'; end if;

  select * into v_ex from receipts where chave = v_chave;
  if found then
    if v_ex.user_id = p_user then
      return jsonb_build_object('duplicate', 'mine', 'receipt_id', v_ex.id, 'points', v_ex.points, 'prices_added', v_ex.prices_added,
                                'supermarket_id', v_ex.supermarket_id, 'market_confirmed', v_ex.market_confirmed);
    end if;
    raise exception 'Esta nota já foi enviada por outra pessoa.' using errcode = 'P0002';
  end if;
  if (select count(*) from receipts where user_id = p_user and created_at > now() - interval '1 day') >= 15 then
    raise exception 'Você já enviou 15 notas hoje. Amanhã tem mais!';
  end if;

  -- mercado e loja pelo CNPJ
  if v_cnpj is not null then
    select s.id, s.supermarket_id into v_store, v_market from stores s where regexp_replace(coalesce(s.cnpj, ''), '\D', '', 'g') = v_cnpj limit 1;
    if v_market is null then
      select id into v_market from supermarkets where left(v_cnpj, 8) = any (cnpj_raiz) limit 1;
    end if;
  end if;
  v_confirmed := v_market is not null;
  if v_market is null then v_market := v_choice; end if;

  -- data de emissão (dd/mm/aaaa hh:mm[:ss], horário de Manaus) ou ISO
  begin
    v_issued := case
      when p->>'date' ~ '^\d{2}/\d{2}/\d{4} \d{2}:\d{2}' then
        (regexp_replace(left(p->>'date', 16), '^(\d{2})/(\d{2})/(\d{4}) (\d{2}:\d{2})$', '\3-\2-\1 \4'))::timestamp at time zone 'America/Manaus'
      when p->>'date' ~ '^\d{2}/\d{2}/\d{4}' then
        (regexp_replace(left(p->>'date', 10), '^(\d{2})/(\d{2})/(\d{4})$', '\3-\2-\1 12:00'))::timestamp at time zone 'America/Manaus'
      when p->>'date' is not null then (p->>'date')::timestamptz end;
  exception when others then v_issued := null; end;
  if v_issued is null or v_issued > now() + interval '1 day' then v_issued := now(); end if;
  v_old := v_issued < now() - interval '30 days';

  insert into receipts (user_id, chave, source, supermarket_id, store_id, market_confirmed, cnpj, store_name, issued_at, total)
  values (p_user, v_chave, 'qr', v_market, v_store, v_confirmed, v_cnpj, left(p->'store'->>'name', 120), v_issued,
          nullif(p->>'total', '')::numeric)
  returning id into v_id;

  for it in select * from jsonb_array_elements(coalesce(p->'items', '[]')) loop
    v_items := v_items + 1;
    v_pid := nullif(it->>'product_id', '')::int;
    if v_pid is not null and not exists (select 1 from products where id = v_pid and active) then v_pid := null; end if;
    v_price := round(nullif(it->>'unit_price', '')::numeric, 2);
    insert into receipt_items (receipt_id, name, code, qty, unit, unit_price, total, product_id)
    values (v_id, left(coalesce(it->>'name', '?'), 160), left(it->>'code', 20), nullif(it->>'qty', '')::numeric,
            left(it->>'unit', 10), v_price, nullif(it->>'total', '')::numeric, v_pid);
    if v_pid is null then continue; end if;
    v_matched := v_matched + 1;

    -- código de barras da nota ensina o EAN do produto (conta como 1 voto)
    v_ean := regexp_replace(coalesce(it->>'code', ''), '\D', '', 'g');
    if length(v_ean) in (8, 12, 13, 14) and v_ean ~ '^(0?78|0?79)' then
      begin
        insert into ean_suggestions (ean, product_id, user_id) values (v_ean, v_pid, p_user) on conflict do nothing;
      exception when others then null; end;
    end if;

  end loop;

  v_points := case when v_old then 5 else least(150, 20 + 2 * v_matched) end;
  update receipts set items_count = v_items, matched_count = v_matched, points = v_points,
         status = case when v_confirmed then 'verificada' else 'pendente' end
   where id = v_id;
  perform receipt_publish(v_id);

  -- aprende o CNPJ da rede quando 2 pessoas diferentes dizem que é o mesmo mercado
  if not v_confirmed and v_market is not null and v_cnpj is not null
     and (select count(distinct user_id) from receipts where left(cnpj, 8) = left(v_cnpj, 8) and supermarket_id = v_market and not market_confirmed) >= 2
     and not exists (select 1 from supermarkets where left(v_cnpj, 8) = any (cnpj_raiz)) then
    update supermarkets set cnpj_raiz = array_append(cnpj_raiz, left(v_cnpj, 8)) where id = v_market;
    -- as notas desse CNPJ que apontavam para este mercado passam a valer (e publicam os preços)
    update receipts set market_confirmed = true, status = 'verificada'
     where left(cnpj, 8) = left(v_cnpj, 8) and supermarket_id = v_market and not market_confirmed;
    perform receipt_publish(id) from receipts where left(cnpj, 8) = left(v_cnpj, 8) and supermarket_id = v_market;
  end if;

  select prices_added, stale_updated, points, market_confirmed into v_added, v_stale, v_points, v_confirmed from receipts where id = v_id;

  return jsonb_build_object('receipt_id', v_id, 'supermarket_id', v_market, 'market_confirmed', v_confirmed,
    'items', v_items, 'matched', v_matched, 'prices_added', v_added, 'stale_updated', v_stale, 'points', v_points, 'old', v_old);
end $$;
revoke all on function public.receipt_ingest(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.receipt_ingest(uuid, jsonb) to service_role;

-- Minhas notas (para a página "Minhas notas")
create or replace function public.my_receipts(p_limit int default 50)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.issued_at desc nulls last), '[]') from (
    select r.id, r.chave, r.supermarket_id, r.store_name, r.issued_at, r.total, r.items_count, r.matched_count,
           r.prices_added, r.points, r.status, r.market_confirmed,
           (select jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.qty, 'unit_price', i.unit_price, 'total', i.total, 'product_id', i.product_id) order by i.id)
              from receipt_items i where i.receipt_id = r.id) as items
    from receipts r where r.user_id = auth.uid()
    order by r.issued_at desc nulls last limit greatest(1, least(p_limit, 200))) x
$$;
revoke all on function public.my_receipts(int) from public, anon;
grant execute on function public.my_receipts(int) to authenticated;

-- ---------- Pontos das notas entram no impacto e no ranking --------------
create or replace function public.my_impact()
returns jsonb language sql stable security definer set search_path = public as $$
  with mine as (
    select * from price_reports where user_id = auth.uid()
  ), pts as (
    select user_id, points, created_at from price_reports
    union all select user_id, points, created_at from receipts where status <> 'recusada'
  ), month_pts as (
    select user_id, sum(points) pts from pts where created_at >= date_trunc('month', now()) group by user_id
  )
  select jsonb_build_object(
    'reports',  (select count(*) from mine),
    'approved', (select count(*) from mine where status = 'aprovado'),
    'receipts', (select count(*) from receipts where user_id = auth.uid()),
    'receipt_prices', coalesce((select sum(prices_added) from receipts where user_id = auth.uid()), 0),
    'points',   coalesce((select sum(points) from pts where user_id = auth.uid()), 0),
    'month_points', coalesce((select pts from month_pts where user_id = auth.uid()), 0),
    'helped',   (select count(distinct l.user_id) from shopping_list_items i
                   join shopping_lists l on l.id = i.list_id
                  where l.user_id <> auth.uid()
                    and i.product_id in (select product_id from mine
                                         union select ri.product_id from receipt_items ri join receipts r on r.id = ri.receipt_id
                                          where r.user_id = auth.uid() and ri.price_added)),
    'rank',     (select count(*) + 1 from month_pts
                  where pts > coalesce((select pts from month_pts where user_id = auth.uid()), 0))
  );
$$;

create or replace function public.leaderboard(p_neighborhood text default null, p_limit int default 10)
returns table (name text, neighborhood text, points bigint, reports bigint, is_me boolean)
language sql stable security definer set search_path = public as $$
  with pts as (
    select user_id, points from price_reports where created_at >= date_trunc('month', now())
    union all select user_id, points from receipts where created_at >= date_trunc('month', now()) and status <> 'recusada'
  )
  select trim(split_part(coalesce(nullif(pf.full_name, ''), 'Fiscal'), ' ', 1) || ' ' ||
              coalesce(left(nullif(split_part(pf.full_name, ' ', 2), ''), 1) || '.', '')),
         pf.neighborhood, sum(r.points)::bigint, count(*)::bigint, r.user_id = auth.uid()
  from pts r join profiles pf on pf.id = r.user_id
  where pf.show_in_ranking
    and (p_neighborhood is null or pf.neighborhood ilike p_neighborhood)
  group by r.user_id, pf.full_name, pf.neighborhood
  order by sum(r.points) desc
  limit greatest(1, least(p_limit, 50));
$$;

-- ---------- Cada nota verificada libera +10 comparações ------------------
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
  -- cada preço informado libera +2 comparações; cada nota fiscal, +10
  v_limit := v_limit + 2 * (select count(*) from public.price_reports where user_id = p.id)
                     + 10 * (select count(*) from public.receipts where user_id = p.id and status <> 'recusada');
  if p.comparisons_used >= v_limit then
    return jsonb_build_object('allowed', false, 'completed', false, 'used', p.comparisons_used, 'limit', v_limit, 'reason', 'incomplete');
  end if;
  update public.profiles set comparisons_used = comparisons_used + 1 where id = p.id;
  return jsonb_build_object('allowed', true, 'completed', false, 'used', p.comparisons_used + 1, 'limit', v_limit);
end $$;

-- =====================================================================
--  Encarte: aplicar os itens revisados (admin master ou membro do mercado)
--  linha: { product_id?, nome, marca, unidade, categoria, ean, preco, preco_de, oferta }
--  • com preco_de maior que preco → promoção geral com a validade do encarte
--  • sem preco_de → preço novo do mercado (fonte "encarte")
--  • sem product_id → acha pelo EAN/nome ou cria o produto
-- =====================================================================
create or replace function public.encarte_apply(p_market smallint, p_rows jsonb, p_starts date default null,
                                                p_ends date default null, p_file text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_pid int; v_cat smallint; v_ean text; v_price numeric; v_de numeric; v_last numeric;
  v_start timestamptz := coalesce(p_starts::timestamptz, now());
  v_end timestamptz := coalesce(p_ends::timestamptz + interval '23 hours 59 minutes', now() + interval '7 days');
  n int := 0; n_prices int := 0; n_promos int := 0; n_created int := 0; errs jsonb := '[]';
begin
  if not (is_master() or is_market_member(p_market)) then raise exception 'Sem permissão para este supermercado.'; end if;
  if jsonb_array_length(p_rows) > 1500 then raise exception 'Envie no máximo 1.500 itens por vez.'; end if;
  if v_end <= v_start then v_end := v_start + interval '1 day'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    n := n + 1;
    begin
      v_price := round(nullif(r->>'preco', '')::numeric, 2);
      v_de := round(nullif(r->>'preco_de', '')::numeric, 2);
      if v_price is null or v_price <= 0 or v_price > 100000 then raise exception 'Preço inválido.'; end if;
      v_pid := nullif(r->>'product_id', '')::int;
      v_ean := nullif(regexp_replace(coalesce(r->>'ean', ''), '\D', '', 'g'), '');
      if v_pid is null and v_ean is not null then select id into v_pid from products where ltrim(ean, '0') = ltrim(v_ean, '0'); end if;
      if v_pid is null then
        if coalesce(trim(r->>'nome'), '') = '' then raise exception 'Item sem nome.'; end if;
        select id into v_pid from products
         where lower(name) = lower(trim(r->>'nome')) and lower(coalesce(brand, '')) = lower(coalesce(trim(r->>'marca'), ''))
           and lower(coalesce(unit, '')) = lower(coalesce(trim(r->>'unidade'), '')) limit 1;
      end if;
      if v_pid is null then
        select id into v_cat from categories where slug = lower(trim(r->>'categoria')) or lower(name) = lower(trim(r->>'categoria')) limit 1;
        if v_cat is null then select id into v_cat from categories where slug = 'mercearia'; end if;
        insert into products (name, brand, unit, category_id, emoji, ean, created_by_market)
        values (trim(r->>'nome'), nullif(trim(r->>'marca'), ''), nullif(trim(r->>'unidade'), ''), v_cat,
                coalesce(nullif(r->>'emoji', ''), (select icon from categories where id = v_cat), '🛒'), v_ean, p_market)
        returning id into v_pid;
        n_created := n_created + 1;
      elsif v_ean is not null then
        update products set ean = v_ean where id = v_pid and ean is null
          and not exists (select 1 from products where ltrim(ean, '0') = ltrim(v_ean, '0'));
      end if;

      insert into market_products (supermarket_id, product_id, active, updated_at) values (p_market, v_pid, true, now())
      on conflict (supermarket_id, product_id) do update set active = true, updated_at = now();

      select price into v_last from prices where product_id = v_pid and supermarket_id = p_market order by collected_at desc limit 1;
      if v_de is not null and v_de > v_price then
        if v_last is distinct from v_de then
          insert into prices (product_id, supermarket_id, price, collected_at, source) values (v_pid, p_market, v_de, now(), 'encarte');
          n_prices := n_prices + 1;
        end if;
        update promotions set active = false where supermarket_id = p_market and product_id = v_pid and active and kind = 'geral';
        insert into promotions (supermarket_id, product_id, kind, promo_price, title, starts_at, ends_at)
        values (p_market, v_pid, 'geral', v_price, nullif(left(r->>'oferta', 60), ''), v_start, v_end);
        n_promos := n_promos + 1;
      elsif v_last is distinct from v_price then
        insert into prices (product_id, supermarket_id, price, collected_at, source) values (v_pid, p_market, v_price, greatest(v_start, now() - interval '1 day'), 'encarte');
        n_prices := n_prices + 1;
      end if;
    exception when others then
      errs := errs || jsonb_build_object('linha', n, 'nome', r->>'nome', 'erro', sqlerrm);
    end;
  end loop;
  insert into encarte_imports (supermarket_id, file_name, starts_at, ends_at, rows_total, prices, promos, created)
  values (p_market, left(p_file, 200), p_starts, p_ends, n, n_prices, n_promos, n_created);
  if is_master() then perform admin_note('importar encarte', jsonb_build_object('market', p_market, 'itens', n, 'promos', n_promos)); end if;
  return jsonb_build_object('total', n, 'prices', n_prices, 'promos', n_promos, 'created', n_created, 'errors', errs);
end $$;
revoke all on function public.encarte_apply(smallint, jsonb, date, date, text) from public, anon;
grant execute on function public.encarte_apply(smallint, jsonb, date, date, text) to authenticated;

-- Quem pode usar o leitor de encarte (a função de IA confere antes de gastar)
create or replace function public.can_import_encarte(p_market smallint default null)
returns boolean language sql stable security definer set search_path = public as $$
  select is_master() or (p_market is not null and is_market_member(p_market))
      or (p_market is null and exists (select 1 from market_members where user_id = auth.uid() and not suspended))
$$;
grant execute on function public.can_import_encarte(smallint) to authenticated;

-- =====================================================================
--  Administração: notas fiscais
-- =====================================================================
create or replace function public.admin_receipts_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_guard();
  return jsonb_build_object(
    'total',        (select count(*) from receipts),
    'last_7d',      (select count(*) from receipts where created_at > now() - interval '7 days'),
    'users_30d',    (select count(distinct user_id) from receipts where created_at > now() - interval '30 days'),
    'prices_added', coalesce((select sum(prices_added) from receipts), 0),
    'unknown_cnpj', coalesce((select jsonb_agg(x order by x.notas desc) from (
        select u.raiz, u.loja, u.notas,
               (select r2.supermarket_id from receipts r2 where left(r2.cnpj, 8) = u.raiz and r2.supermarket_id is not null
                 group by r2.supermarket_id order by count(*) desc limit 1) sugestao
        from (select left(r.cnpj, 8) raiz, max(r.store_name) loja, count(*) notas
                from receipts r
               where r.cnpj is not null and not exists (select 1 from supermarkets s where left(r.cnpj, 8) = any (s.cnpj_raiz))
               group by left(r.cnpj, 8) limit 30) u) x), '[]'),
    'unmatched',    coalesce((select jsonb_agg(x order by x.vezes desc) from (
        select upper(i.name) nome, count(*) vezes, round(avg(i.unit_price), 2) preco_medio
        from receipt_items i join receipts r on r.id = i.receipt_id
        where i.product_id is null and r.created_at > now() - interval '60 days'
        group by upper(i.name) having count(*) >= 1 order by count(*) desc limit 40) x), '[]'),
    'encartes',     coalesce((select jsonb_agg(x order by x.created_at desc) from (
        select e.created_at, s.name market, e.file_name, e.rows_total, e.prices, e.promos, e.created
        from encarte_imports e left join supermarkets s on s.id = e.supermarket_id order by e.created_at desc limit 15) x), '[]')
  );
end $$;

create or replace function public.admin_set_cnpj(p_market smallint, p_raiz text)
returns void language plpgsql security definer set search_path = public as $$
declare v text := left(regexp_replace(coalesce(p_raiz, ''), '\D', '', 'g'), 8);
begin
  perform admin_guard();
  if length(v) <> 8 then raise exception 'Informe os 8 primeiros dígitos do CNPJ.'; end if;
  update supermarkets set cnpj_raiz = array_remove(cnpj_raiz, v);
  update supermarkets set cnpj_raiz = array_append(cnpj_raiz, v) where id = p_market;
  -- notas antigas desse CNPJ passam a contar como do mercado confirmado
  update receipts set supermarket_id = p_market, market_confirmed = true, status = 'verificada'
   where left(cnpj, 8) = v and not market_confirmed;
  perform receipt_publish(id) from receipts where left(cnpj, 8) = v;
  perform admin_note('definir CNPJ da rede', jsonb_build_object('market', p_market, 'raiz', v));
end $$;

do $$
declare f text;
begin
  foreach f in array array['admin_receipts_overview()', 'admin_set_cnpj(smallint,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- fotos de etiqueta enviadas pela função de IA ficam no bucket "etiquetas" (já criado no schema)

-- Moderação: mostra a foto da etiqueta e a observação de cada preço enviado
create or replace function public.admin_reports(p_status text default 'pendente', p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform admin_guard();
  return coalesce((select jsonb_agg(x) from (
    select r.id, r.created_at, r.price, r.status, r.at_store, r.points, r.note, r.photo_url, (r.ia_reading_id is not null) as ia_photo,
           u.email, p.name product, p.brand, p.unit, p.emoji, s.name market, r.supermarket_id, r.product_id,
           (select price from prices pr where pr.product_id = r.product_id and pr.supermarket_id = r.supermarket_id order by collected_at desc limit 1) current_price
    from price_reports r join products p on p.id = r.product_id join supermarkets s on s.id = r.supermarket_id
    left join auth.users u on u.id = r.user_id
    where p_status = 'all' or r.status = p_status
    order by r.created_at desc limit greatest(1, least(p_limit, 500))) x), '[]');
end $$;

-- Planejar refeições: leitura "receita" (IA calcula ingredientes de um prato que a base não conhece)
do $$ begin
  alter table public.ia_readings drop constraint if exists ia_readings_kind_check;
  alter table public.ia_readings add constraint ia_readings_kind_check check (kind in ('etiqueta', 'nota', 'encarte', 'receita'));
end $$;


-- #####################################################################
-- (incluído de atualizacao-2026-10-zerar-historico.sql)
-- #####################################################################
-- =====================================================================
-- "Zerar meu histórico" (Você › Preferências)
-- Rode uma vez no Supabase › SQL Editor (pode rodar de novo sem problema).
--
-- A pessoa recomeça como se fosse nova: lista do mês, ranchos, economia,
-- notas, pontos, ranking e favoritos somem PARA ELA.
-- Nada que os supermercados e a administração usam é apagado:
--   • listas (shopping_lists), notas (receipts), preços enviados (price_reports)
--     e métricas de uso (events) continuam no banco e nos painéis;
--   • o perfil guarda a data do recomeço (history_reset_at) e uma "geração"
--     (history_gen); o site da pessoa só mostra o que veio depois.
-- Só os favoritos são apagados de verdade (não aparecem em painel nenhum).
-- =====================================================================

alter table public.profiles add column if not exists history_reset_at timestamptz;
alter table public.profiles add column if not exists history_gen int not null default 0;

-- cada recomeço abre uma "geração" nova de listas: a lista antiga do mês fica guardada
-- (para os painéis) e a pessoa pode montar outra no mesmo mês
alter table public.shopping_lists add column if not exists gen int not null default 0;
drop index if exists public.shopping_lists_user_month;
create unique index if not exists shopping_lists_user_month_gen on public.shopping_lists (user_id, month, gen);

-- ---------------------------------------------------------------- recomeçar
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
  return jsonb_build_object('reset_at', now(), 'gen', coalesce(v_gen, 0));
end $$;
revoke all on function public.reset_my_history() from public, anon;
grant execute on function public.reset_my_history() to authenticated;

-- data do último recomeço da pessoa (ou o começo dos tempos)
create or replace function public._reset_at(p_uid uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select coalesce((select history_reset_at from public.profiles where id = p_uid), '-infinity'::timestamptz);
$$;
revoke all on function public._reset_at(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- "Minhas notas" só depois do recomeço
create or replace function public.my_receipts(p_limit int default 50)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.issued_at desc nulls last), '[]') from (
    select r.id, r.chave, r.supermarket_id, r.store_name, r.issued_at, r.total, r.items_count, r.matched_count,
           r.prices_added, r.points, r.status, r.market_confirmed,
           (select jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.qty, 'unit_price', i.unit_price, 'total', i.total, 'product_id', i.product_id) order by i.id)
              from receipt_items i where i.receipt_id = r.id) as items
    from receipts r where r.user_id = auth.uid() and r.created_at >= public._reset_at(auth.uid())
    order by r.issued_at desc nulls last limit greatest(1, least(p_limit, 200))) x
$$;
revoke all on function public.my_receipts(int) from public, anon;
grant execute on function public.my_receipts(int) to authenticated;

-- ---------------------------------------------------------------- pontos e impacto só depois do recomeço
create or replace function public.my_impact()
returns jsonb language sql stable security definer set search_path = public as $$
  with since as (select public._reset_at(auth.uid()) t),
  mine as (
    select * from price_reports where user_id = auth.uid() and created_at >= (select t from since)
  ), myrec as (
    select * from receipts where user_id = auth.uid() and created_at >= (select t from since)
  ), pts as (
    -- pontos de cada pessoa contam a partir do recomeço dela
    select pr.user_id, pr.points, pr.created_at from price_reports pr where pr.created_at >= public._reset_at(pr.user_id)
    union all select r.user_id, r.points, r.created_at from receipts r where r.status <> 'recusada' and r.created_at >= public._reset_at(r.user_id)
  ), month_pts as (
    select user_id, sum(points) pts from pts where created_at >= date_trunc('month', now()) group by user_id
  )
  select jsonb_build_object(
    'reports',  (select count(*) from mine),
    'approved', (select count(*) from mine where status = 'aprovado'),
    'receipts', (select count(*) from myrec),
    'receipt_prices', coalesce((select sum(prices_added) from myrec), 0),
    'points',   coalesce((select sum(points) from pts where user_id = auth.uid()), 0),
    'month_points', coalesce((select pts from month_pts where user_id = auth.uid()), 0),
    'helped',   (select count(distinct l.user_id) from shopping_list_items i
                   join shopping_lists l on l.id = i.list_id
                  where l.user_id <> auth.uid()
                    and i.product_id in (select product_id from mine
                                         union select ri.product_id from receipt_items ri join myrec r on r.id = ri.receipt_id
                                          where ri.price_added)),
    'rank',     (select count(*) + 1 from month_pts
                  where pts > coalesce((select pts from month_pts where user_id = auth.uid()), 0))
  );
$$;
revoke all on function public.my_impact() from public, anon;
grant execute on function public.my_impact() to authenticated;

create or replace function public.leaderboard(p_neighborhood text default null, p_limit int default 10)
returns table (name text, neighborhood text, points bigint, reports bigint, is_me boolean)
language sql stable security definer set search_path = public as $$
  with pts as (
    select pr.user_id, pr.points from price_reports pr
     where pr.created_at >= date_trunc('month', now()) and pr.created_at >= public._reset_at(pr.user_id)
    union all select r.user_id, r.points from receipts r
     where r.created_at >= date_trunc('month', now()) and r.status <> 'recusada' and r.created_at >= public._reset_at(r.user_id)
  )
  select trim(split_part(coalesce(nullif(pf.full_name, ''), 'Fiscal'), ' ', 1) || ' ' ||
              coalesce(left(nullif(split_part(pf.full_name, ' ', 2), ''), 1) || '.', '')),
         pf.neighborhood, sum(r.points)::bigint, count(*)::bigint, r.user_id = auth.uid()
  from pts r join profiles pf on pf.id = r.user_id
  where pf.show_in_ranking
    and (p_neighborhood is null or pf.neighborhood ilike p_neighborhood)
  group by r.user_id, pf.full_name, pf.neighborhood
  order by sum(r.points) desc
  limit greatest(1, least(p_limit, 50));
$$;
revoke all on function public.leaderboard(text, int) from public;
grant execute on function public.leaderboard(text, int) to anon, authenticated;


-- #####################################################################
-- (incluído de atualizacao-2026-10-lista-familia.sql)
-- #####################################################################
-- =====================================================================
-- Lista da família (compartilhada ao vivo)
-- Rode uma vez no Supabase › SQL Editor (pode rodar de novo sem problema).
--
-- Cada lista tem um código de 8 letras (ex.: K7QM-2XPA). Quem tem o código
-- vê e mexe na lista; a tabela não pode ser lida direto (sem políticas de RLS):
-- tudo passa pelas funções abaixo, que exigem o código.
-- As mudanças chegam na hora pelo canal "Broadcast" do Realtime (não precisa
-- ligar nada: já vem ativo no Supabase).
-- =====================================================================

create table if not exists public.shared_lists (
  code        text primary key,
  name        text,
  month       text,
  items       jsonb not null default '[]'::jsonb,   -- [{ "product_id": 1, "qty": 2 }]
  checked     jsonb not null default '[]'::jsonb,   -- [1, 5, 9]
  members     int   not null default 1,
  updated_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.shared_lists enable row level security;
-- sem políticas de propósito: ninguém lista ou lê a tabela inteira

-- letra aleatória (sem 0/O, 1/I/L) para o código
create or replace function public._shared_code() returns text
language plpgsql volatile set search_path = public as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  hex text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  c text := '';
  i int;
begin
  for i in 0..7 loop
    c := c || substr(alphabet, 1 + (('x' || substr(hex, i * 2 + 1, 2))::bit(8)::int % length(alphabet)), 1);
  end loop;
  return c;
end $$;

create or replace function public.shared_list_create(p_name text, p_month text, p_items jsonb, p_checked jsonb, p_by text default null)
returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 500 then raise exception 'Lista grande demais'; end if;
  loop
    c := public._shared_code();
    exit when not exists (select 1 from public.shared_lists where code = c);
  end loop;
  insert into public.shared_lists (code, name, month, items, checked, updated_by)
  values (c, left(p_name, 60), left(p_month, 7), coalesce(p_items, '[]'::jsonb), coalesce(p_checked, '[]'::jsonb), left(p_by, 40));
  return c;
end $$;

create or replace function public.shared_list_get(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('code', code, 'name', name, 'month', month, 'items', items, 'checked', checked,
                            'members', members, 'updated_by', updated_by, 'updated_at', updated_at)
  from public.shared_lists where code = upper(replace(p_code, '-', ''));
$$;

create or replace function public.shared_list_join(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  update public.shared_lists set members = least(members + 1, 50) where code = upper(replace(p_code, '-', ''));
  select public.shared_list_get(p_code) into r;
  if r is null then raise exception 'Código não encontrado'; end if;
  return r;
end $$;

create or replace function public.shared_list_put(p_code text, p_name text, p_month text, p_items jsonb, p_checked jsonb, p_by text default null)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare t timestamptz;
begin
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 500 then raise exception 'Lista grande demais'; end if;
  update public.shared_lists
     set name = coalesce(left(p_name, 60), name), month = coalesce(left(p_month, 7), month),
         items = coalesce(p_items, '[]'::jsonb), checked = coalesce(p_checked, '[]'::jsonb),
         updated_by = left(p_by, 40), updated_at = now()
   where code = upper(replace(p_code, '-', ''))
  returning updated_at into t;
  if t is null then raise exception 'Código não encontrado'; end if;
  return t;
end $$;

revoke all on function public._shared_code() from public, anon, authenticated;
grant execute on function public.shared_list_create(text, text, jsonb, jsonb, text) to anon, authenticated;
grant execute on function public.shared_list_get(text)  to anon, authenticated;
grant execute on function public.shared_list_join(text) to anon, authenticated;
grant execute on function public.shared_list_put(text, text, text, jsonb, jsonb, text) to anon, authenticated;


-- #####################################################################
-- (incluído de atualizacao-2026-10-sync-clientes-campanhas.sql)
-- #####################################################################
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


-- #####################################################################
-- (incluído de atualizacao-2026-10-zerar-todos-aparelhos.sql)
-- #####################################################################
-- =====================================================================
-- "Zerar meu histórico" vale para TODOS os aparelhos da conta.
-- Rode uma vez no Supabase › SQL Editor (pode rodar de novo sem problema).
--
-- Problema: depois de zerar num celular, outro aparelho (ou aba) que ainda tinha a lista
-- antiga a reenviava para a conta. Agora o banco recusa dados de quem está numa "época"
-- anterior ao zerar (profiles.history_gen). O aparelho recusado se limpa sozinho.
-- =====================================================================
alter table public.user_state add column if not exists gen int;

create or replace function public._user_state_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare g int;
begin
  select history_gen into g from profiles where id = new.user_id;
  if coalesce(g, 0) > 0 and coalesce(new.gen, -1) <> g then
    raise exception 'historico_zerado: esta conta foi zerada em outro aparelho';
  end if;
  return new;
end $$;
drop trigger if exists user_state_guard on public.user_state;
create trigger user_state_guard before insert or update on public.user_state
  for each row execute function public._user_state_guard();

-- listas do mês de uma época antiga também não entram mais
create or replace function public._shopping_list_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare g int;
begin
  select history_gen into g from profiles where id = new.user_id;
  if coalesce(new.gen, 0) < coalesce(g, 0) then
    raise exception 'historico_zerado: esta conta foi zerada em outro aparelho';
  end if;
  return new;
end $$;
drop trigger if exists shopping_list_guard on public.shopping_lists;
create trigger shopping_list_guard before insert or update on public.shopping_lists
  for each row execute function public._shopping_list_guard();


-- #####################################################################
-- (incluído de atualizacao-2026-10-datas-especiais.sql)
-- #####################################################################
-- =====================================================================
-- Datas especiais (páginas temáticas): Black Friday, Natal, Halloween, Réveillon,
-- Dia das Mães, Dia dos Pais e Dia dos Namorados.
-- Rode uma vez no Supabase › SQL Editor (pode rodar de novo sem problema).
--
-- • Só a ADMINISTRAÇÃO cria, liga e desliga as páginas (admin.html › Datas especiais).
-- • Os SUPERMERCADOS só escolhem os produtos (e um preço especial, se quiserem)
--   para as datas que a administração ligou (parceiros.html › Datas especiais).
-- • O site mostra a página e o banner só enquanto a data está ligada e no período.
-- =====================================================================

create table if not exists public.special_events (
  slug        text primary key check (slug ~ '^[a-z0-9-]{3,40}$'),
  theme       text not null check (theme in ('blackfriday', 'natal', 'halloween', 'reveillon', 'maes', 'pais', 'namorados')),
  title       text not null check (length(title) between 3 and 60),
  subtitle    text check (length(subtitle) <= 140),
  banner_text text check (length(banner_text) <= 80),
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  active      boolean not null default false,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (ends_at > starts_at)
);
alter table public.special_events enable row level security;
do $$ begin
  drop policy if exists "public live" on public.special_events;
  create policy "public live" on public.special_events for select
    using (active and now() between starts_at and ends_at);
end $$;
grant select on public.special_events to anon, authenticated;

create table if not exists public.special_event_products (
  event_slug     text not null references public.special_events(slug) on delete cascade,
  supermarket_id smallint not null references public.supermarkets(id) on delete cascade,
  product_id     int not null references public.products(id) on delete cascade,
  special_price  numeric(10,2) check (special_price is null or special_price > 0),
  sort           int not null default 0,
  created_at     timestamptz not null default now(),
  primary key (event_slug, supermarket_id, product_id)
);
create index if not exists special_event_products_event on public.special_event_products (event_slug);
alter table public.special_event_products enable row level security;
do $$ begin
  drop policy if exists "public live" on public.special_event_products;
  create policy "public live" on public.special_event_products for select
    using (exists (select 1 from public.special_events e where e.slug = event_slug and e.active and now() between e.starts_at and e.ends_at));
end $$;
grant select on public.special_event_products to anon, authenticated;

-- ---------------------------------------------------------------- administração
create or replace function public.admin_events()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_master() then raise exception 'Só a administração.'; end if;
  return coalesce((select jsonb_agg(x order by x.starts_at desc) from (
    select e.*, (select count(*) from special_event_products p where p.event_slug = e.slug) products,
           (select count(distinct p.supermarket_id) from special_event_products p where p.event_slug = e.slug) markets
      from special_events e) x), '[]');
end $$;

create or replace function public.admin_event_save(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_slug text := lower(trim(p->>'slug'));
begin
  if not is_master() then raise exception 'Só a administração pode criar ou mudar datas especiais.'; end if;
  insert into special_events (slug, theme, title, subtitle, banner_text, starts_at, ends_at, active)
  values (v_slug, p->>'theme', trim(p->>'title'), nullif(trim(p->>'subtitle'), ''), nullif(trim(p->>'banner_text'), ''),
          (p->>'starts_at')::timestamptz, (p->>'ends_at')::timestamptz, coalesce((p->>'active')::boolean, false))
  on conflict (slug) do update set theme = excluded.theme, title = excluded.title, subtitle = excluded.subtitle,
     banner_text = excluded.banner_text, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
     active = excluded.active, updated_at = now();
  return v_slug;
end $$;

create or replace function public.admin_event_delete(p_slug text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_master() then raise exception 'Só a administração.'; end if;
  delete from special_events where slug = p_slug;
end $$;

-- ---------------------------------------------------------------- supermercados: escolhem os produtos
-- datas que a administração ligou e que ainda não acabaram (o mercado prepara antes de começar)
create or replace function public.market_events(p_market smallint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_market_member(p_market) or is_master()) then raise exception 'Sem permissão para este supermercado.'; end if;
  return coalesce((select jsonb_agg(x order by x.starts_at) from (
    select e.slug, e.theme, e.title, e.subtitle, e.starts_at, e.ends_at,
           coalesce((select jsonb_agg(jsonb_build_object('product_id', p.product_id, 'special_price', p.special_price) order by p.sort)
                       from special_event_products p where p.event_slug = e.slug and p.supermarket_id = p_market), '[]') items
      from special_events e where e.active and e.ends_at > now()) x), '[]');
end $$;

create or replace function public.market_event_products_set(p_slug text, p_market smallint, p_items jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; it jsonb;
begin
  if not (is_market_member(p_market) or is_master()) then raise exception 'Sem permissão para este supermercado.'; end if;
  if not exists (select 1 from special_events where slug = p_slug and active and ends_at > now()) then
    raise exception 'Esta data especial não está ligada pela administração.';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]')) > 24 then raise exception 'No máximo 24 produtos por data especial.'; end if;
  delete from special_event_products where event_slug = p_slug and supermarket_id = p_market;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    insert into special_event_products (event_slug, supermarket_id, product_id, special_price, sort)
    values (p_slug, p_market, (it->>'product_id')::int, nullif(it->>'special_price', '')::numeric, n)
    on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.admin_events() from public, anon;
revoke all on function public.admin_event_save(jsonb) from public, anon;
revoke all on function public.admin_event_delete(text) from public, anon;
revoke all on function public.market_events(smallint) from public, anon;
revoke all on function public.market_event_products_set(text, smallint, jsonb) from public, anon;
grant execute on function public.admin_events() to authenticated;
grant execute on function public.admin_event_save(jsonb) to authenticated;
grant execute on function public.admin_event_delete(text) to authenticated;
grant execute on function public.market_events(smallint) to authenticated;
grant execute on function public.market_event_products_set(text, smallint, jsonb) to authenticated;


-- #####################################################################
-- (incluído de atualizacao-2026-10-push-uso-lgpd.sql)
-- #####################################################################
-- =====================================================================
-- Rodada de outubro/2026 (parte final):
--   1. Painel de uso (quais telas e ferramentas as pessoas usam, quem volta)
--   2. Avisos no celular com o site FECHADO (Web Push + função "notificar")
--   3. Privacidade / LGPD: baixar meus dados e excluir minha conta
--   4. Link "comprar no site/app do mercado" (shop_url)
--   5. Saúde do banco (admin vê o que falta rodar)
-- Rode uma vez no Supabase › SQL Editor (pode rodar de novo sem problema).
-- Depois siga o README, seção "Avisos com o site fechado", para publicar a função e o agendamento.
-- =====================================================================

-- =====================================================================
-- 1. USO: eventos de tela e um identificador do aparelho (aleatório, sem nome)
-- =====================================================================
alter table public.events add column if not exists device_id text;
create index if not exists events_usage on public.events (created_at, kind);
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
                        neighborhood, zone, gender, age_band, value, ad_id, store_id, campaign_id, device_id)
    values (e->>'kind', left(e->>'session', 40), auth.uid(),
            (select id from products where id = nullif(e->>'product_id', '')::int),
            (select id from supermarkets where id = nullif(e->>'market_id', '')::smallint),
            nullif(lower(left(trim(e->>'query'), 60)), ''), nullif(e->>'results', '')::int,
            v_nb, zone_of(v_nb), nullif(pf.gender, 'nao_informar'), v_age,
            nullif(e->>'value', '')::numeric, nullif(e->>'ad_id', '')::bigint,
            (select id from stores where id = nullif(e->>'store_id', '')::int),
            nullif(e->>'campaign_id', '')::bigint,
            nullif(left(e->>'device', 40), ''));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.track(jsonb) from public;
grant execute on function public.track(jsonb) to anon, authenticated;

-- Painel de uso (admin.html › Uso). "Pessoa" = conta, ou o aparelho quando não entrou na conta.
create or replace function public.admin_usage(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_days int := greatest(7, least(coalesce(p_days, 30), 180));
  v_since timestamptz := now() - make_interval(days => v_days);
  out jsonb;
begin
  if not is_master() then raise exception 'Só a administração.'; end if;
  with ev as (
    select created_at, kind, query, coalesce(user_id::text, device_id, session_id) who
      from events where created_at >= now() - interval '120 days' and coalesce(user_id::text, device_id, session_id) is not null
  ),
  firsts as (select who, min(created_at) first_at from ev group by who),
  feat as (
    select case
             when kind = 'screen' then coalesce(query, 'outra')
             when kind = 'tool' then 'ferramenta:' || coalesce(split_part(query, ':', 1), 'outra')
             when kind = 'scan' then 'ferramenta:leitor'
             when kind = 'queue_open' then 'ferramenta:fila'
             when kind = 'search' then 'acao:busca'
             when kind = 'add' then 'acao:adicionou'
             when kind = 'route' then 'acao:rota'
             when kind = 'rancho_done' then 'acao:rancho'
             when kind = 'bought' then 'acao:comprou'
             when kind = 'push_on' then 'acao:ativou_avisos'
             when kind = 'push_open' then 'acao:abriu_aviso'
             else null end name, who
      from ev where created_at >= v_since
  ),
  weeks as (
    select date_trunc('week', created_at)::date wk, count(distinct who) people
      from ev where created_at >= now() - interval '8 weeks' group by 1
  ),
  news as (
    select date_trunc('week', first_at)::date wk, count(*) n from firsts where first_at >= now() - interval '8 weeks' group by 1
  ),
  coh as (
    select date_trunc('week', f.first_at)::date wk, f.who,
           array_agg(distinct ((date_trunc('week', e.created_at)::date - date_trunc('week', f.first_at)::date) / 7)) w
      from firsts f join ev e on e.who = f.who
     where f.first_at >= now() - interval '8 weeks'
     group by 1, 2
  )
  select jsonb_build_object(
    'days', v_days,
    'active_1', (select count(distinct who) from ev where created_at >= now() - interval '1 day'),
    'active_7', (select count(distinct who) from ev where created_at >= now() - interval '7 days'),
    'active_30', (select count(distinct who) from ev where created_at >= now() - interval '30 days'),
    'new_7', (select count(*) from firsts where first_at >= now() - interval '7 days'),
    'with_account_7', (select count(distinct who) from ev e where created_at >= now() - interval '7 days' and who ~ '^[0-9a-f]{8}-'),
    'returned', (select round(100.0 * count(*) filter (where back) / nullif(count(*), 0))
                   from (select who, bool_or(created_at >= now() - interval '7 days') back
                           from ev where created_at >= now() - interval '14 days'
                          group by who having min(created_at) < now() - interval '7 days') x),
    'push_subs', (select count(*) from push_subscriptions),
    'features', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'people', people, 'uses', uses) order by people desc)
                            from (select name, count(distinct who) people, count(*) uses from feat where name is not null group by name) f), '[]'),
    'weeks', coalesce((select jsonb_agg(jsonb_build_object('week', w.wk, 'people', w.people, 'new', coalesce(n.n, 0)) order by w.wk)
                         from weeks w left join news n on n.wk = w.wk), '[]'),
    'cohorts', coalesce((select jsonb_agg(jsonb_build_object('week', wk, 'size', size, 'w1', w1, 'w2', w2, 'w3', w3) order by wk)
                           from (select wk, count(*) size,
                                        count(*) filter (where 1 = any(w)) w1,
                                        count(*) filter (where 2 = any(w)) w2,
                                        count(*) filter (where 3 = any(w)) w3
                                   from coh group by wk) c), '[]')
  ) into out;
  return out;
end $$;

-- =====================================================================
-- 2. AVISOS COM O SITE FECHADO (Web Push)
-- O aparelho manda a "inscrição" do navegador + o que acompanhar (favoritos e itens comprados,
-- mercados preferidos, lista da família, posição aproximada). A função "notificar" (Edge Function)
-- roda a cada 15 min: pede ao banco o que avisar (push_collect) e entrega pelo Web Push.
-- Regras: 8h às 21h (Manaus), no máximo 3 avisos por dia por aparelho e 1 de mercado por dia.
-- =====================================================================
create table if not exists public.push_subscriptions (
  id           bigserial primary key,
  endpoint     text not null unique check (endpoint ~ '^https://'),
  p256dh       text not null,
  auth         text not null,
  user_id      uuid references auth.users(id) on delete cascade,
  device       text,
  prefs        jsonb not null default '{"precos": true, "campanhas": true, "familia": true}',
  markets      smallint[] not null default '{}',
  watch_ids    int[] not null default '{}',
  refs         jsonb not null default '{}',     -- { "id do produto": menor preço já avisado }
  lat          numeric(6,2),                     -- posição arredondada (~1 km), só para "perto do mercado"
  lng          numeric(6,2),
  family_code  text,
  family_by    text,
  family_seen  timestamptz,
  pushes_day   date,
  pushes_today int not null default 0,
  last_push_at timestamptz,
  fails        int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
-- sem políticas: só as funções abaixo leem e gravam

create table if not exists public.push_log (
  sub_id  bigint not null references public.push_subscriptions(id) on delete cascade,
  ref     text not null,
  sent_at timestamptz not null default now(),
  primary key (sub_id, ref)
);
alter table public.push_log enable row level security;

insert into public.app_settings (key, value, label) values
  ('push_enabled', 'true', 'Avisos no celular com o site fechado'),
  ('privacy_contact', '""', 'Contato para pedidos sobre dados pessoais (LGPD)')
on conflict (key) do nothing;

-- o aparelho se inscreve (com ou sem conta) e atualiza o que acompanha
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
    user_id = auth.uid(), device = excluded.device, prefs = excluded.prefs,
    markets = excluded.markets, watch_ids = excluded.watch_ids, lat = excluded.lat, lng = excluded.lng,
    family_code = excluded.family_code, family_by = excluded.family_by,
    family_seen = case when excluded.family_code is distinct from s.family_code then null else s.family_seen end,
    fails = 0, updated_at = now()
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.push_unsubscribe(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint;
$$;

-- chamado só pela função "notificar" (chave de serviço): monta os avisos e já marca como enviados
create or replace function public.push_collect(p_limit int default 500)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s push_subscriptions; out jsonb := '[]'; v_refs jsonb; drops jsonb; r record; ref numeric;
  v_today date := (now() at time zone 'America/Manaus')::date;
  v_hour int := extract(hour from now() at time zone 'America/Manaus');
  fl shared_lists; cp record; v_msg jsonb; v_today_n int;
begin
  if not setting_on('push_enabled') or v_hour < 8 or v_hour >= 21 then return out; end if;

  drop table if exists _tb_mins;
  create temp table _tb_mins on commit drop as
    select v.id, v.name, v.min_price, (v.prices->0->>'market_id')::smallint mid from v_products v;

  for s in select * from push_subscriptions where fails < 5 order by coalesce(last_push_at, 'epoch') limit greatest(1, least(p_limit, 2000)) loop
    v_msg := null;
    v_today_n := case when s.pushes_day = v_today then s.pushes_today else 0 end;

    -- lista da família: alguém mexeu (e não foi esta pessoa)
    if s.family_code is not null and coalesce((s.prefs->>'familia')::boolean, true) then
      select * into fl from shared_lists where code = s.family_code;
      if found then
        if s.family_seen is not null and fl.updated_at > s.family_seen and fl.updated_by is distinct from s.family_by then
          v_msg := jsonb_build_object('title', coalesce(fl.updated_by, 'Alguém') || ' mexeu na ' || coalesce('lista "' || fl.name || '"', 'lista da família'),
                                      'body', 'Toque para ver o que foi marcado ou incluído.', 'url', './#lista', 'tag', 'tb-familia');
        end if;
        update push_subscriptions set family_seen = fl.updated_at where id = s.id;
      end if;
    end if;

    -- preços que baixaram do que a pessoa acompanha (favoritos e o que já comprou)
    v_refs := s.refs; drops := '[]';
    if coalesce((s.prefs->>'precos')::boolean, true) and cardinality(s.watch_ids) > 0 then
      for r in select m.id, m.name, m.min_price, sm.name market from _tb_mins m left join supermarkets sm on sm.id = m.mid
                where m.id = any(s.watch_ids) loop
        ref := (v_refs->>r.id::text)::numeric;
        if ref is null or r.min_price > ref then
          v_refs := jsonb_set(v_refs, array[r.id::text], to_jsonb(r.min_price));
        elsif ref - r.min_price >= 0.10 and r.min_price <= ref * 0.97 then
          drops := drops || jsonb_build_object('name', r.name, 'from', ref, 'to', r.min_price, 'market', r.market);
          v_refs := jsonb_set(v_refs, array[r.id::text], to_jsonb(r.min_price));
        end if;
      end loop;
      update push_subscriptions set refs = v_refs where id = s.id;
      if v_msg is null and jsonb_array_length(drops) > 0 then
        v_msg := case when jsonb_array_length(drops) = 1 then
          jsonb_build_object('title', 'Baixou: ' || (drops->0->>'name'),
                             'body', 'De R$ ' || replace(to_char((drops->0->>'from')::numeric, 'FM999990.00'), '.', ',') ||
                                     ' por R$ ' || replace(to_char((drops->0->>'to')::numeric, 'FM999990.00'), '.', ',') ||
                                     coalesce(' no ' || (drops->0->>'market'), '') || '.',
                             'url', './#ofertas', 'tag', 'tb-preco')
        else
          jsonb_build_object('title', jsonb_array_length(drops) || ' produtos que você acompanha baixaram',
                             'body', (select string_agg(d->>'name', ', ') from (select d from jsonb_array_elements(drops) d limit 3) x),
                             'url', './#ofertas', 'tag', 'tb-preco')
        end;
      end if;
    end if;

    -- aviso de supermercado (um por dia, só o que a pessoa ainda não recebeu)
    if v_msg is null and coalesce((s.prefs->>'campanhas')::boolean, true) and setting_on('campaigns_enabled')
       and not exists (select 1 from push_log l where l.sub_id = s.id and l.ref like 'camp:%' and l.sent_at >= now() - interval '20 hours') then
      select c.id, c.title, c.body, c.supermarket_id, sm.name market into cp
        from market_campaigns c join supermarkets sm on sm.id = c.supermarket_id and sm.active
       where c.kind = 'aviso' and c.status = 'ativa' and now() between c.starts_at and c.ends_at
         and not exists (select 1 from push_log l where l.sub_id = s.id and l.ref = 'camp:' || c.id)
         and (c.audience = 'todos'
              or (c.audience = 'preferem' and c.supermarket_id = any(s.markets))
              or (c.audience = 'perto' and s.lat is not null and exists (
                    select 1 from stores st where st.supermarket_id = c.supermarket_id
                       and _km(s.lat::float8, s.lng::float8, st.lat, st.lng) <= c.radius_km)))
       order by (c.audience = 'perto') desc, c.created_at desc limit 1;
      if found then
        v_msg := jsonb_build_object('title', cp.market || ': ' || cp.title, 'body', coalesce(cp.body, 'Toque para ver as ofertas.'),
                                    'url', './#ofertas', 'tag', 'tb-camp-' || cp.id, 'campaign_id', cp.id);
        insert into push_log (sub_id, ref) values (s.id, 'camp:' || cp.id) on conflict do nothing;
        insert into events (kind, supermarket_id, campaign_id, device_id) values ('camp_notify', cp.supermarket_id, cp.id, s.device);
      end if;
    end if;

    if v_msg is not null and v_today_n < 3 then
      out := out || (v_msg || jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth));
      update push_subscriptions set pushes_day = v_today, pushes_today = v_today_n + 1, last_push_at = now() where id = s.id;
    end if;
  end loop;
  return out;
end $$;

-- resultado da entrega: 404/410 = inscrição morreu (apaga); outros erros contam falha
create or replace function public.push_result(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare x jsonb;
begin
  for x in select * from jsonb_array_elements(coalesce(p, '[]')) loop
    if (x->>'status')::int in (404, 410) then delete from push_subscriptions where id = (x->>'id')::bigint;
    elsif (x->>'ok')::boolean then update push_subscriptions set fails = 0 where id = (x->>'id')::bigint;
    else update push_subscriptions set fails = fails + 1 where id = (x->>'id')::bigint;
    end if;
  end loop;
end $$;

revoke all on function public.push_subscribe(jsonb) from public;
revoke all on function public.push_unsubscribe(text) from public;
revoke all on function public.push_collect(int) from public, anon, authenticated;
revoke all on function public.push_result(jsonb) from public, anon, authenticated;
grant execute on function public.push_subscribe(jsonb) to anon, authenticated;
grant execute on function public.push_unsubscribe(text) to anon, authenticated;
grant execute on function public.push_collect(int) to service_role;
grant execute on function public.push_result(jsonb) to service_role;

-- =====================================================================
-- 3. PRIVACIDADE (LGPD): baixar meus dados e excluir minha conta
-- O que os supermercados já viram em números agregados continua lá, mas sem ligação com a pessoa.
-- =====================================================================
create or replace function public.my_data_export()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); out jsonb; t record; rows jsonb;
begin
  if v_uid is null then raise exception 'Entre na sua conta para baixar seus dados.'; end if;
  out := jsonb_build_object(
    'gerado_em', now(),
    'conta', (select jsonb_build_object('id', u.id, 'email', u.email, 'criada_em', u.created_at) from auth.users u where u.id = v_uid),
    'perfil', (select to_jsonb(p) from profiles p where p.id = v_uid));
  for t in select c.table_name from information_schema.columns c
            join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
           where c.table_schema = 'public' and c.column_name = 'user_id'
             and c.table_name not in ('events', 'push_subscriptions')
           order by 1 loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from (select * from public.%I where user_id = $1 limit 5000) x', t.table_name)
      into rows using v_uid;
    if jsonb_array_length(rows) > 0 then out := out || jsonb_build_object(t.table_name, rows); end if;
  end loop;
  out := out || jsonb_build_object(
    'avisos_no_celular', (select coalesce(jsonb_agg(jsonb_build_object('aparelho', device, 'preferencias', prefs, 'mercados', markets,
                                   'produtos_acompanhados', watch_ids, 'posicao_aproximada', case when lat is null then null else jsonb_build_object('lat', lat, 'lng', lng) end,
                                   'criado_em', created_at)), '[]') from push_subscriptions where user_id = v_uid),
    'uso', jsonb_build_object(
      'total_eventos', (select count(*) from events where user_id = v_uid),
      'primeiro', (select min(created_at) from events where user_id = v_uid),
      'ultimo', (select max(created_at) from events where user_id = v_uid),
      'ultimos_500', (select coalesce(jsonb_agg(jsonb_build_object('quando', created_at, 'tipo', kind, 'busca', query, 'produto', product_id, 'mercado', supermarket_id)), '[]')
                        from (select * from events where user_id = v_uid order by created_at desc limit 500) e)));
  return out;
end $$;

create or replace function public.delete_my_account(p_confirm text)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); t record;
begin
  if v_uid is null then raise exception 'Entre na sua conta.'; end if;
  if upper(trim(coalesce(p_confirm, ''))) <> 'EXCLUIR' then raise exception 'Digite EXCLUIR para confirmar.'; end if;
  if is_master() then raise exception 'A conta de administração master não pode ser excluída por aqui.'; end if;
  -- números de uso continuam (sem ligação com a pessoa)
  update events set user_id = null where user_id = v_uid;
  for t in select c.table_name, c.is_nullable from information_schema.columns c
            join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
           where c.table_schema = 'public' and c.column_name = 'user_id' and c.table_name <> 'events' loop
    if t.table_name = 'encarte_imports' and t.is_nullable = 'YES' then
      execute format('update public.%I set user_id = null where user_id = $1', t.table_name) using v_uid;
    else
      execute format('delete from public.%I where user_id = $1', t.table_name) using v_uid;
    end if;
  end loop;
  delete from auth.users where id = v_uid; -- perfil, favoritos, listas etc. saem em cascata
end $$;

revoke all on function public.my_data_export() from public, anon;
revoke all on function public.delete_my_account(text) from public, anon;
grant execute on function public.my_data_export() to authenticated;
grant execute on function public.delete_my_account(text) to authenticated;

-- =====================================================================
-- 4. COMPRAR NO SITE/APP DO MERCADO
-- =====================================================================
alter table public.supermarkets add column if not exists shop_url text check (shop_url is null or shop_url ~ '^https://');

create or replace function public.admin_save_market(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id smallint := nullif(p->>'id', '')::smallint; r supermarkets;
begin
  perform admin_guard();
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Informe o nome do supermercado.'; end if;
  if v_id is null then
    insert into supermarkets (slug, name, logo_url, color, website, shop_url, active, portal_enabled)
    values (coalesce(nullif(trim(p->>'slug'), ''), lower(regexp_replace(unaccent_safe(p->>'name'), '[^a-zA-Z0-9]+', '-', 'g'))),
            trim(p->>'name'), nullif(p->>'logo_url', ''), coalesce(nullif(p->>'color', ''), '#0F5A3E'), nullif(p->>'website', ''),
            nullif(trim(p->>'shop_url'), ''),
            coalesce((p->>'active')::boolean, true), coalesce((p->>'portal_enabled')::boolean, true))
    returning * into r;
  else
    update supermarkets set name = trim(p->>'name'), slug = coalesce(nullif(trim(p->>'slug'), ''), slug),
      logo_url = nullif(p->>'logo_url', ''), color = coalesce(nullif(p->>'color', ''), color), website = nullif(p->>'website', ''),
      shop_url = case when p ? 'shop_url' then nullif(trim(p->>'shop_url'), '') else shop_url end,
      active = coalesce((p->>'active')::boolean, active), portal_enabled = coalesce((p->>'portal_enabled')::boolean, portal_enabled)
    where id = v_id returning * into r;
  end if;
  perform admin_note('salvar mercado', to_jsonb(r));
  return to_jsonb(r);
exception when unique_violation then
  raise exception 'Já existe um supermercado com esse identificador (slug). Escolha outro.';
end $$;

-- o próprio supermercado também pode informar o link da loja online (portal › Minha loja)
create or replace function public.market_set_shop_url(p_market smallint, p_url text)
returns text language plpgsql security definer set search_path = public as $$
declare v text := nullif(trim(p_url), '');
begin
  if not (is_market_member(p_market) or is_master()) then raise exception 'Sem permissão para este supermercado.'; end if;
  if v is not null and v !~ '^https://' then raise exception 'O link precisa começar com https://'; end if;
  update supermarkets set shop_url = v where id = p_market;
  return v;
end $$;
revoke all on function public.market_set_shop_url(smallint, text) from public, anon;
grant execute on function public.market_set_shop_url(smallint, text) to authenticated;

-- =====================================================================
-- 5. SAÚDE DO BANCO: o admin vê o que está instalado e o que falta rodar
-- =====================================================================
create or replace function public.db_health()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out jsonb; v_job boolean := null;
begin
  if not is_master() then raise exception 'Só a administração.'; end if;
  if to_regclass('cron.job') is not null then
    execute 'select exists (select 1 from cron.job where jobname = ''tb-notificar'' and active)' into v_job;
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
    ('Uso, avisos e privacidade', 'col', 'supermarkets.shop_url')
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
    'events_30d', (select count(*) from events where created_at >= now() - interval '30 days')
  ) into out;
  return out;
end $$;

revoke all on function public.admin_usage(int) from public, anon;
revoke all on function public.db_health() from public, anon;
grant execute on function public.admin_usage(int) to authenticated;
grant execute on function public.db_health() to authenticated;


-- =====================================================================
-- (incluído de atualizacao-2026-10-telegram.sql)
-- =====================================================================
-- Robô do Telegram (@tabaratomesmo_bot)
--   • A pessoa pergunta "quanto tá o óleo?", manda a foto ou o link da nota fiscal
--     e mexe na Lista do mês pelo Telegram, sem abrir o site.
--   • Ligar a conta: o site gera um código de uso único (Você › Conta › Telegram)
--     e abre t.me/tabaratomesmo_bot?start=<código>. O robô troca o código pelo vínculo.
-- Rode uma vez no Supabase › SQL Editor (pode rodar de novo sem problema).
-- Depois siga o README, seção "Robô do Telegram", para publicar a função.
-- =====================================================================

-- quem conversa com o robô (uma conversa por conta)
create table if not exists public.tg_contacts (
  chat_id      bigint primary key,
  user_id      uuid references auth.users(id) on delete cascade,
  first_name   text,
  username     text,
  linked_at    timestamptz,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create unique index if not exists tg_contacts_user_idx on public.tg_contacts (user_id) where user_id is not null;
alter table public.tg_contacts enable row level security;
do $$ begin
  drop policy if exists "own telegram" on public.tg_contacts;
  create policy "own telegram" on public.tg_contacts for select using (user_id = (select auth.uid()));
end $$;
grant select on public.tg_contacts to authenticated;

-- códigos para ligar a conta (valem 15 minutos, uma vez)
create table if not exists public.tg_link_codes (
  code       text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz
);
alter table public.tg_link_codes enable row level security;  -- só pelas funções abaixo

-- mensagens já recebidas: o Telegram reenvia quando demoramos, e assim nada é respondido duas vezes
create table if not exists public.tg_updates (
  update_id bigint primary key,
  chat_id   bigint,
  at        timestamptz not null default now()
);
create index if not exists tg_updates_chat_idx on public.tg_updates (chat_id, at desc);
alter table public.tg_updates enable row level security;     -- só a função "telegram" (service_role)

-- ---------------------------------------------------------------- para o site
create or replace function public.telegram_link_code()
returns text language plpgsql security definer set search_path = public as $$
declare v_code text; b bytea; i int; letters constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
begin
  if auth.uid() is null then raise exception 'Entre na sua conta para ligar o Telegram.'; end if;
  delete from tg_link_codes where user_id = auth.uid() or expires_at < now() - interval '1 day';
  -- código curto para digitar no Telegram se o link não ligar sozinho: 3 letras + 3 números ("KQM482")
  loop
    b := uuid_send(gen_random_uuid()); v_code := '';
    for i in 0..2 loop v_code := v_code || substr(letters, 1 + get_byte(b, i) % 24, 1); end loop;
    v_code := v_code || lpad((((get_byte(b, 3) << 8) | get_byte(b, 4)) % 1000)::text, 3, '0');
    exit when not exists (select 1 from tg_link_codes where code = v_code);
  end loop;
  insert into tg_link_codes (code, user_id, expires_at) values (v_code, auth.uid(), now() + interval '15 minutes');
  return v_code;
end $$;

create or replace function public.telegram_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('linked', true, 'name', first_name, 'username', username, 'linked_at', linked_at)
                     from tg_contacts where user_id = auth.uid()), jsonb_build_object('linked', false));
$$;

create or replace function public.telegram_unlink()
returns void language sql security definer set search_path = public as $$
  update tg_contacts set user_id = null, linked_at = null where user_id = auth.uid();
$$;

revoke all on function public.telegram_link_code() from public, anon;
revoke all on function public.telegram_status() from public, anon;
revoke all on function public.telegram_unlink() from public, anon;
grant execute on function public.telegram_link_code() to authenticated;
grant execute on function public.telegram_status() to authenticated;
grant execute on function public.telegram_unlink() to authenticated;

-- ---------------------------------------------------------------- para o robô (só service_role)
create or replace function public.tg_link_consume(p_code text, p_chat bigint, p_first text default null, p_username text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_name text;
  v_code text := case when p_code ~ '^L[a-f0-9]{32}$' then p_code else upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')) end;
begin
  update tg_link_codes set used_at = now()
   where code = v_code and used_at is null and expires_at > now()
  returning user_id into v_user;
  if v_user is null then return jsonb_build_object('ok', false); end if;
  update tg_contacts set user_id = null, linked_at = null where user_id = v_user and chat_id <> p_chat;
  insert into tg_contacts (chat_id, user_id, first_name, username, linked_at, last_seen_at)
  values (p_chat, v_user, p_first, p_username, now(), now())
  on conflict (chat_id) do update set user_id = excluded.user_id, linked_at = now(), last_seen_at = now(),
    first_name = coalesce(excluded.first_name, tg_contacts.first_name), username = coalesce(excluded.username, tg_contacts.username);
  select full_name into v_name from profiles where id = v_user;
  return jsonb_build_object('ok', true, 'user_id', v_user, 'name', v_name);
end $$;
revoke all on function public.tg_link_consume(text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.tg_link_consume(text, bigint, text, text) to service_role;

-- ---------------------------------------------------------------- Saúde do banco: mostra se esta atualização falta
create or replace function public.db_health()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out jsonb; v_job boolean := null;
begin
  if not is_master() then raise exception 'Só a administração.'; end if;
  if to_regclass('cron.job') is not null then
    execute 'select exists (select 1 from cron.job where jobname = ''tb-notificar'' and active)' into v_job;
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
    ('Robô do Telegram', 'func', 'public.tg_link_consume(text,bigint,text,text)')
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
    'telegram_linked', (select count(*) from tg_contacts where user_id is not null)
  ) into out;
  return out;
end $$;
revoke all on function public.db_health() from public, anon;
grant execute on function public.db_health() to authenticated;

-- =====================================================================
-- (incluído de atualizacao-2026-10-telegram-avisos.sql)
-- =====================================================================
-- Avisos de preço pelo Telegram (@tabaratomesmo_bot)
--   Para quem ligou a conta ao robô: quando o menor preço de um produto que a pessoa acompanha
--   (favoritos, Lista do mês e o que ela comprou nas notas dos últimos 120 dias) muda 3% e R$ 0,10 ou mais,
--   o robô manda foto, preço anterior e novo, mercado, até quando vale e o link do produto.
--   Regras: só das 8h às 21h (Manaus), no máximo 3 por vez e 6 por dia; /avisos pausa ou volta.
--   A primeira vez que um produto é visto só guarda o preço (não avisa).
-- Rode uma vez no Supabase › SQL Editor (pode rodar de novo sem problema).
-- Depois: agendamento 'tb-telegram-avisos' (README, seção "Robô do Telegram").
-- Precisa de atualizacao-2026-10-telegram.sql.
-- =====================================================================
alter table public.tg_contacts add column if not exists alerts boolean not null default true;
alter table public.tg_contacts add column if not exists alerts_day date;
alter table public.tg_contacts add column if not exists alerts_today int not null default 0;
alter table public.tg_contacts add column if not exists last_alert_at timestamptz;

-- o último preço avisado (ou visto) de cada produto, por conversa
create table if not exists public.tg_price_refs (
  chat_id    bigint not null references public.tg_contacts(chat_id) on delete cascade,
  product_id int not null references public.products(id) on delete cascade,
  price      numeric(10,2) not null,
  market     smallint,
  updated_at timestamptz not null default now(),
  primary key (chat_id, product_id)
);
alter table public.tg_price_refs enable row level security;  -- só a função "telegram" (service_role)

insert into public.app_settings (key, value, label) values
  ('telegram_alerts', 'true', 'Avisos de preço pelo Telegram')
on conflict (key) do nothing;

create or replace function public.tg_link_consume(p_code text, p_chat bigint, p_first text default null, p_username text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_name text;
  v_code text := case when p_code ~ '^L[a-f0-9]{32}$' then p_code else upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')) end;
begin
  update tg_link_codes set used_at = now()
   where code = v_code and used_at is null and expires_at > now()
  returning user_id into v_user;
  if v_user is null then return jsonb_build_object('ok', false); end if;
  update tg_contacts set user_id = null, linked_at = null where user_id = v_user and chat_id <> p_chat;
  -- outra conta nesta conversa: os preços de referência dos avisos recomeçam
  delete from tg_price_refs where chat_id = p_chat
     and exists (select 1 from tg_contacts where chat_id = p_chat and user_id is distinct from v_user);
  insert into tg_contacts (chat_id, user_id, first_name, username, linked_at, last_seen_at)
  values (p_chat, v_user, p_first, p_username, now(), now())
  on conflict (chat_id) do update set user_id = excluded.user_id, linked_at = now(), last_seen_at = now(),
    first_name = coalesce(excluded.first_name, tg_contacts.first_name), username = coalesce(excluded.username, tg_contacts.username);
  select full_name into v_name from profiles where id = v_user;
  return jsonb_build_object('ok', true, 'user_id', v_user, 'name', v_name);
end $$;

-- chamado só pela função "telegram" (agendamento a cada 15 min): monta os avisos e já guarda os novos preços
create or replace function public.tg_alerts_collect(p_limit int default 300, p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c tg_contacts; r record; out jsonb := '[]';
  v_today date := (p_now at time zone 'America/Manaus')::date;
  v_hour int := extract(hour from p_now at time zone 'America/Manaus');
  v_n int; v_sent int; v_diff numeric;
begin
  if not setting_on('telegram_alerts') or v_hour < 8 or v_hour >= 21 then return out; end if;
  for c in select * from tg_contacts where user_id is not null and alerts
            order by coalesce(last_alert_at, 'epoch') limit greatest(1, least(p_limit, 2000)) loop
    v_n := case when c.alerts_day = v_today then c.alerts_today else 0 end;
    v_sent := 0;
    continue when v_n >= 6;
    for r in
      with follow as (
        select product_id as id from favorites where user_id = c.user_id
        union
        select (x->>0)::int from user_state us,
               jsonb_array_elements(case when jsonb_typeof(us.value) = 'array' then us.value else '[]' end) x
         where us.user_id = c.user_id and us.key = 'tb.list' and jsonb_typeof(x) = 'array' and (x->>0) ~ '^\d+$'
        union
        select ri.product_id from receipt_items ri join receipts rc on rc.id = ri.receipt_id
         where rc.user_id = c.user_id and ri.product_id is not null and rc.created_at > now() - interval '120 days'
      )
      select v.id, v.name, v.brand, v.unit, v.photo, v.min_price, v.prices->0 as best,
             f.price as ref_price, f.market as ref_market
        from follow fo join v_products v on v.id = fo.id
        left join tg_price_refs f on f.chat_id = c.chat_id and f.product_id = v.id
       order by f.price is null, v.id
       limit 400
    loop
      if r.ref_price is null then
        insert into tg_price_refs (chat_id, product_id, price, market)
        values (c.chat_id, r.id, r.min_price, (r.best->>'market_id')::smallint) on conflict do nothing;
        continue;
      end if;
      v_diff := r.min_price - r.ref_price;
      continue when abs(v_diff) < 0.10 or abs(v_diff) < r.ref_price * 0.03;
      -- passou do limite desta vez ou do dia: fica para depois (a referência não muda)
      continue when v_sent >= 3 or v_n + v_sent >= 6;
      out := out || jsonb_build_object('chat_id', c.chat_id, 'product_id', r.id, 'name', r.name, 'brand', r.brand,
                                       'unit', r.unit, 'photo', r.photo, 'from', r.ref_price, 'to', r.min_price,
                                       'from_market', r.ref_market, 'best', r.best);
      update tg_price_refs set price = r.min_price, market = (r.best->>'market_id')::smallint, updated_at = now()
       where chat_id = c.chat_id and product_id = r.id;
      v_sent := v_sent + 1;
    end loop;
    if v_sent > 0 then
      update tg_contacts set alerts_day = v_today, alerts_today = v_n + v_sent, last_alert_at = p_now where chat_id = c.chat_id;
    end if;
  end loop;
  return out;
end $$;
drop function if exists public.tg_alerts_collect(int);
revoke all on function public.tg_alerts_collect(int, timestamptz) from public, anon, authenticated;
grant execute on function public.tg_alerts_collect(int, timestamptz) to service_role;

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
    ('Avisos de preço no Telegram', 'func', 'public.tg_alerts_collect(integer,timestamptz)')
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

-- =====================================================================
-- (incluído de atualizacao-2026-10-mapa-unidades.sql)
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

-- =====================================================================
-- (incluído de atualizacao-2026-10-promo-unidade.sql)
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


-- #####################################################################
-- (incluído de atualizacao-2026-10-parceiros-vendas.sql)
-- #####################################################################
-- =====================================================================
--  Tá Barato Mesmo? — Parceiros: página com as cores de cada mercado,
--  vendas comprovadas por nota, "Cubra a diferença", previsão de demanda
--  e queima de perecíveis.
--  Rode uma vez no Supabase › SQL Editor (pode rodar de novo sem problema).
--  O schema.sql já inclui este arquivo para instalações novas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. MARCA: cores da página de cada supermercado no portal (parceiros.html?m=slug)
-- ---------------------------------------------------------------------
alter table public.supermarkets add column if not exists brand_primary text;
alter table public.supermarkets add column if not exists brand_accent text;
do $$ begin
  alter table public.supermarkets add constraint supermarkets_brand_hex
    check ((brand_primary is null or brand_primary ~ '^#[0-9a-fA-F]{6}$') and (brand_accent is null or brand_accent ~ '^#[0-9a-fA-F]{6}$'));
exception when duplicate_object then null; end $$;
-- cores tiradas das logomarcas (só onde ainda não foram escolhidas)
update public.supermarkets s set brand_primary = x.p, brand_accent = x.a
  from (values ('nova-era', '#C21A19', '#F29100'), ('db', '#009A3E', '#E2231A'), ('veneza', '#1F2F6B', '#00A3D9'),
               ('baratao-da-carne', '#C8202F', '#2E7D32'), ('coema', '#009048', '#E30613')) x(slug, p, a)
 where s.slug = x.slug and s.brand_primary is null;

create or replace function public.admin_set_market_brand(p_market smallint, p_primary text, p_accent text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  if p_primary is not null and p_primary !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Cor principal inválida (use #RRGGBB).'; end if;
  if p_accent is not null and p_accent !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Cor de destaque inválida (use #RRGGBB).'; end if;
  update supermarkets set brand_primary = nullif(p_primary, ''), brand_accent = nullif(p_accent, '') where id = p_market;
  perform admin_note('cores do mercado', jsonb_build_object('id', p_market, 'primary', p_primary, 'accent', p_accent));
end $$;
revoke all on function public.admin_set_market_brand(smallint, text, text) from public, anon;
grant execute on function public.admin_set_market_brand(smallint, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. CHAVES DA ADMINISTRAÇÃO
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value, label) values
  ('partner_double_points', 'true', 'Pontos em dobro para nota de mercado parceiro'),
  ('cover_enabled', 'true', 'Cubra a diferença (contraoferta no rancho)'),
  ('clearance_enabled', 'true', 'Queima de perecíveis')
on conflict (key) do nothing;

-- mercado parceiro = portal ligado e pelo menos uma pessoa ativa com acesso
create or replace function public.is_partner_market(p_market smallint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from supermarkets s where s.id = p_market and s.active and s.portal_enabled)
     and exists (select 1 from market_members m where m.supermarket_id = p_market and not m.suspended)
$$;
grant execute on function public.is_partner_market(smallint) to anon, authenticated;

-- lista pública dos parceiros (o site mostra o selo "pontos em dobro")
create or replace function public.partner_markets()
returns smallint[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(s.id order by s.id), '{}') from supermarkets s
   where setting_on('partner_double_points') and is_partner_market(s.id)
$$;
grant execute on function public.partner_markets() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. EVENTOS NOVOS (cupom do "cubra a diferença" e queima de perecíveis)
-- ---------------------------------------------------------------------
alter table public.events drop constraint if exists events_kind_check;
alter table public.events add constraint events_kind_check check (kind in
  ('search','view','add','route','rancho_done','bought','promo_view','ad_view','ad_reveal','ad_click','cart_item','queue_open','store_visit','scan','tool',
   'camp_view','camp_click','camp_close','camp_notify','screen','push_on','push_open',
   'cover_view','cover_accept','clear_view','clear_claim','clear_notify'));
create index if not exists events_user_time on public.events (user_id, created_at) where user_id is not null;
create index if not exists receipts_market_time on public.receipts (supermarket_id, issued_at);

-- o site manda os eventos novos
create or replace function public.track(p_events jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  e jsonb; n int := 0; pf profiles; v_nb text; v_age text;
  kinds text[] := array['search','view','add','route','rancho_done','bought','promo_view','ad_view','ad_reveal','ad_click','cart_item','queue_open','store_visit','scan','tool',
                        'camp_view','camp_click','camp_close','camp_notify','screen','push_on','push_open',
                        'cover_view','cover_accept','clear_view','clear_claim','clear_notify'];
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
                        neighborhood, zone, gender, age_band, value, ad_id, store_id, campaign_id, device_id)
    values (e->>'kind', left(e->>'session', 40), auth.uid(),
            (select id from products where id = nullif(e->>'product_id', '')::int),
            (select id from supermarkets where id = nullif(e->>'market_id', '')::smallint),
            nullif(lower(left(trim(e->>'query'), 60)), ''), nullif(e->>'results', '')::int,
            v_nb, zone_of(v_nb), nullif(pf.gender, 'nao_informar'), v_age,
            nullif(e->>'value', '')::numeric, nullif(e->>'ad_id', '')::bigint,
            (select id from stores where id = nullif(e->>'store_id', '')::int),
            nullif(e->>'campaign_id', '')::bigint,
            nullif(left(e->>'device', 40), ''));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.track(jsonb) from public;
grant execute on function public.track(jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. CUBRA A DIFERENÇA
-- Quando a pessoa conclui o rancho e outro mercado ganhou por pouco, o mercado que perdeu
-- pode oferecer um cupom que cobre a diferença. Ele define as regras; só paga o cupom usado
-- (validado no caixa pelo portal ou comprovado pela nota fiscal enviada no site).
-- ---------------------------------------------------------------------
create table if not exists public.market_cover_rules (
  supermarket_id smallint primary key references public.supermarkets(id) on delete cascade,
  active         boolean not null default false,
  max_diff       numeric(8,2) not null default 20 check (max_diff between 1 and 500),     -- cobre diferenças de até R$ X
  min_total      numeric(10,2) not null default 150 check (min_total >= 0),             -- só ranchos a partir de R$ X (no seu mercado)
  budget_month   numeric(10,2) not null default 500 check (budget_month between 0 and 100000),
  extra          numeric(6,2) not null default 1 check (extra between 0 and 50),        -- além da diferença (ex.: +R$ 1 para ganhar de verdade)
  valid_days     int not null default 4 check (valid_days between 1 and 15),
  min_spend_pct  int not null default 80 check (min_spend_pct between 30 and 100),     -- compra mínima: % do rancho no seu mercado
  updated_by     uuid default auth.uid(),
  updated_at     timestamptz not null default now()
);
alter table public.market_cover_rules enable row level security;

create table if not exists public.cover_coupons (
  id             bigserial primary key,
  code           text not null unique,
  supermarket_id smallint not null references public.supermarkets(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  best_market    smallint references public.supermarkets(id) on delete set null,
  best_total     numeric(10,2) not null,
  my_total       numeric(10,2) not null,
  diff           numeric(10,2) not null,
  value          numeric(8,2) not null check (value > 0),
  min_spend      numeric(10,2) not null default 0,
  items          int not null default 0,
  status         text not null default 'oferta' check (status in ('oferta','aceito','recusado','usado')),
  created_at     timestamptz not null default now(),
  accepted_at    timestamptz,
  expires_at     timestamptz not null,
  used_at        timestamptz,
  used_via       text check (used_via in ('caixa','nota')),
  receipt_id     bigint references public.receipts(id) on delete set null,
  receipt_total  numeric(10,2)
);
create index if not exists cover_coupons_market on public.cover_coupons (supermarket_id, created_at);
create index if not exists cover_coupons_user on public.cover_coupons (user_id, created_at);
alter table public.cover_coupons enable row level security;
do $$ begin
  drop policy if exists "own coupons" on public.cover_coupons;
  create policy "own coupons" on public.cover_coupons for select to authenticated using (user_id = (select auth.uid()));
end $$;
grant select on public.cover_coupons to authenticated;

-- início do mês em Manaus
create or replace function public._month_start()
returns timestamptz language sql stable as $$
  select (date_trunc('month', now() at time zone 'America/Manaus')) at time zone 'America/Manaus'
$$;

-- quanto do orçamento do mês já está comprometido (cupons aceitos ainda válidos + usados)
create or replace function public._cover_spent(p_market smallint)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(value), 0) from cover_coupons
   where supermarket_id = p_market and created_at >= _month_start()
     and (status = 'usado' or (status = 'aceito' and expires_at >= now()))
$$;

-- total de uma lista em cada mercado, com os preços de agora (o servidor calcula: não confia no aparelho)
-- p_items: [{ "product_id": 1, "qty": 2 }, …]
create or replace function public._list_totals(p_items jsonb)
returns table (supermarket_id smallint, total numeric, priced int, n int)
language sql stable security definer set search_path = public as $$
  with it as (
    select (x->>'product_id')::int pid, greatest(0.01, least(coalesce(nullif(x->>'qty', '')::numeric, 1), 99)) qty
      from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]' end) x
     where (x->>'product_id') ~ '^\d+$' limit 300
  ), pr as (
    select it.pid, it.qty, (e->>'market_id')::smallint mid, (e->>'price')::numeric price
      from it join v_products v on v.id = it.pid cross join lateral jsonb_array_elements(v.prices) e
  )
  select mid, round(sum(price * qty), 2), count(*)::int, (select count(*)::int from it) from pr group by mid
$$;

create or replace function public._cover_code()
returns text language plpgsql volatile as $$
declare c text;
begin
  loop
    c := 'TB' || upper(substr(translate(md5(random()::text || clock_timestamp()::text), '01', 'XY'), 1, 6));
    exit when not exists (select 1 from cover_coupons where code = c);
  end loop;
  return c;
end $$;

-- chamado pelo site quando a pessoa conclui o rancho. Devolve a melhor contraoferta (ou null).
create or replace function public.cover_offer(p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); best record; c record; r market_cover_rules; v_diff numeric; v_value numeric;
  v_n int; ex cover_coupons; out cover_coupons; v_exp timestamptz;
begin
  if v_uid is null or not setting_on('cover_enabled') then return null; end if;
  if coalesce((select blocked from profiles where id = v_uid), false) then return null; end if;
  -- já tem uma oferta/cupom válido deste mês? devolve o mesmo (não fica gerando cupom a cada clique)
  select * into ex from cover_coupons where user_id = v_uid and created_at >= _month_start()
     and status in ('oferta', 'aceito') and expires_at >= now() order by created_at desc limit 1;
  if found then
    return to_jsonb(ex) - 'user_id' - case when ex.status = 'oferta' then 'code' else '' end
           || jsonb_build_object('market_name', (select name from supermarkets where id = ex.supermarket_id),
                                 'best_name', (select name from supermarkets where id = ex.best_market));
  end if;
  -- no máximo 3 ofertas novas por pessoa por dia
  if (select count(*) from cover_coupons where user_id = v_uid and created_at > now() - interval '1 day') >= 3 then return null; end if;

  create temp table if not exists _tb_tot (supermarket_id smallint, total numeric, priced int, n int) on commit drop;
  truncate _tb_tot;
  insert into _tb_tot select * from _list_totals(p_items);
  select max(n) into v_n from _tb_tot;
  if coalesce(v_n, 0) < 5 then return null; end if; -- rancho de verdade: pelo menos 5 produtos
  -- o vencedor: menor total entre os mercados que têm quase tudo (90% dos itens)
  select t.*, s.name into best from _tb_tot t join supermarkets s on s.id = t.supermarket_id and s.active
   where t.priced >= ceil(t.n * 0.9) order by t.total limit 1;
  if not found then return null; end if;

  for c in
    select t.*, s.name from _tb_tot t join supermarkets s on s.id = t.supermarket_id and s.active
     where t.supermarket_id <> best.supermarket_id and t.priced >= ceil(t.n * 0.9) and is_partner_market(t.supermarket_id)
     order by t.total
  loop
    select * into r from market_cover_rules where supermarket_id = c.supermarket_id and active;
    continue when not found;
    -- compara só os itens que existem nos dois mercados (justo para os dois lados)
    select round(sum(case when (e->>'market_id')::smallint = c.supermarket_id then (e->>'price')::numeric * q.qty else 0 end)
               - sum(case when (e->>'market_id')::smallint = best.supermarket_id then (e->>'price')::numeric * q.qty else 0 end), 2)
      into v_diff
      from (select (x->>'product_id')::int pid, greatest(0.01, least(coalesce(nullif(x->>'qty', '')::numeric, 1), 99)) qty
              from jsonb_array_elements(p_items) x where (x->>'product_id') ~ '^\d+$' limit 300) q
      join v_products v on v.id = q.pid cross join lateral jsonb_array_elements(v.prices) e
     where v.prices @> jsonb_build_array(jsonb_build_object('market_id', c.supermarket_id))
       and v.prices @> jsonb_build_array(jsonb_build_object('market_id', best.supermarket_id));
    continue when v_diff is null or v_diff <= 0.5 or v_diff > r.max_diff or c.total < r.min_total;
    continue when exists (select 1 from cover_coupons where user_id = v_uid and supermarket_id = c.supermarket_id
                            and created_at >= _month_start() and status in ('aceito', 'usado'));
    v_value := ceil(v_diff) + r.extra;
    continue when _cover_spent(c.supermarket_id) + v_value > r.budget_month;
    -- vale até o fim do dia, daqui a N dias (horário de Manaus)
    v_exp := ((date_trunc('day', now() at time zone 'America/Manaus') + make_interval(days => r.valid_days) + interval '23 hours 59 minutes') at time zone 'America/Manaus');
    insert into cover_coupons (code, supermarket_id, user_id, best_market, best_total, my_total, diff, value, min_spend, items, expires_at)
    values (_cover_code(), c.supermarket_id, v_uid, best.supermarket_id, best.total, c.total, v_diff, v_value,
            round(c.total * r.min_spend_pct / 100.0, 2), v_n, v_exp)
    returning * into out;
    return to_jsonb(out) - 'user_id' - 'code' || jsonb_build_object('market_name', c.name, 'best_name', best.name);
  end loop;
  return null;
end $$;

-- "Quero o cupom": confere de novo o orçamento e mostra o código
create or replace function public.cover_accept(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x cover_coupons; r market_cover_rules;
begin
  select * into x from cover_coupons where id = p_id and user_id = auth.uid() for update;
  if not found then raise exception 'Cupom não encontrado.'; end if;
  if x.status = 'aceito' then return to_jsonb(x) - 'user_id'; end if;
  if x.status <> 'oferta' or x.expires_at < now() then raise exception 'Esta oferta não vale mais.'; end if;
  select * into r from market_cover_rules where supermarket_id = x.supermarket_id and active;
  if not found or _cover_spent(x.supermarket_id) + x.value > r.budget_month then
    raise exception 'O supermercado encerrou estas ofertas por este mês.';
  end if;
  update cover_coupons set status = 'aceito', accepted_at = now() where id = p_id returning * into x;
  return to_jsonb(x) - 'user_id';
end $$;

create or replace function public.cover_decline(p_id bigint)
returns void language sql security definer set search_path = public as $$
  update cover_coupons set status = 'recusado' where id = p_id and user_id = auth.uid() and status = 'oferta';
$$;

-- cupons da pessoa (página Você e relatório do rancho)
create or replace function public.my_cover_coupons()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(c) - 'user_id' - case when c.status = 'oferta' then 'code' else '' end
                            || jsonb_build_object('market_name', s.name, 'best_name', b.name) order by c.created_at desc), '[]')
    from (select * from cover_coupons where user_id = auth.uid() and created_at > now() - interval '60 days' order by created_at desc limit 20) c
    join supermarkets s on s.id = c.supermarket_id left join supermarkets b on b.id = c.best_market
$$;

-- portal: regras + números do mês
create or replace function public.market_cover_get(p_market smallint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r market_cover_rules; ms timestamptz := _month_start();
begin
  if not (is_market_member(p_market) or is_master()) then raise exception 'Sem permissão para este supermercado.'; end if;
  select * into r from market_cover_rules where supermarket_id = p_market;
  return jsonb_build_object(
    'enabled', setting_on('cover_enabled'),
    'partner', is_partner_market(p_market),
    'rules', coalesce(to_jsonb(r), jsonb_build_object('supermarket_id', p_market, 'active', false, 'max_diff', 20, 'min_total', 150,
                      'budget_month', 500, 'extra', 1, 'valid_days', 4, 'min_spend_pct', 80)),
    'month', (select jsonb_build_object(
        'offers', count(*), 'accepted', count(*) filter (where status in ('aceito', 'usado')),
        'used', count(*) filter (where status = 'usado'),
        'used_value', coalesce(sum(value) filter (where status = 'usado'), 0),
        'pending_value', coalesce(sum(value) filter (where status = 'aceito' and expires_at >= now()), 0),
        'receipts_value', coalesce(sum(receipt_total) filter (where status = 'usado'), 0),
        'ranchos_value', coalesce(sum(my_total) filter (where status = 'usado'), 0),
        'avg_diff', round(avg(diff), 2))
      from cover_coupons where supermarket_id = p_market and created_at >= ms),
    'spent', _cover_spent(p_market),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', case when status in ('aceito','usado') then code end,
                          'value', value, 'diff', diff, 'my_total', my_total, 'min_spend', min_spend, 'status',
                          case when status in ('oferta','aceito') and expires_at < now() then 'expirado' else status end,
                          'created_at', created_at, 'expires_at', expires_at, 'used_at', used_at, 'used_via', used_via,
                          'best_name', (select name from supermarkets where id = best_market)) order by created_at desc)
                        from (select * from cover_coupons where supermarket_id = p_market order by created_at desc limit 40) z), '[]')
  );
end $$;

create or replace function public.market_cover_save(p_market smallint, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r market_cover_rules;
begin
  if not is_market_member(p_market) then raise exception 'Sem permissão para este supermercado.'; end if;
  insert into market_cover_rules as m (supermarket_id, active, max_diff, min_total, budget_month, extra, valid_days, min_spend_pct, updated_by, updated_at)
  values (p_market, coalesce((p->>'active')::boolean, false), coalesce((p->>'max_diff')::numeric, 20), coalesce((p->>'min_total')::numeric, 150),
          coalesce((p->>'budget_month')::numeric, 500), coalesce((p->>'extra')::numeric, 1), coalesce((p->>'valid_days')::int, 4),
          coalesce((p->>'min_spend_pct')::int, 80), auth.uid(), now())
  on conflict (supermarket_id) do update set active = excluded.active, max_diff = excluded.max_diff, min_total = excluded.min_total,
    budget_month = excluded.budget_month, extra = excluded.extra, valid_days = excluded.valid_days, min_spend_pct = excluded.min_spend_pct,
    updated_by = excluded.updated_by, updated_at = now()
  returning * into r;
  return to_jsonb(r);
end $$;

-- caixa: valida o código que a pessoa mostrou
create or replace function public.market_cover_redeem(p_market smallint, p_code text, p_total numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x cover_coupons;
begin
  if not is_market_member(p_market) then raise exception 'Sem permissão para este supermercado.'; end if;
  select * into x from cover_coupons where code = upper(trim(p_code)) for update;
  if not found or x.supermarket_id <> p_market then raise exception 'Cupom não encontrado para o seu supermercado.'; end if;
  if x.status = 'usado' then raise exception 'Este cupom já foi usado em %.', to_char(x.used_at at time zone 'America/Manaus', 'DD/MM HH24:MI'); end if;
  if x.status <> 'aceito' then raise exception 'Este cupom não foi ativado pela pessoa.'; end if;
  if x.expires_at < now() then raise exception 'Este cupom venceu em %.', to_char(x.expires_at at time zone 'America/Manaus', 'DD/MM'); end if;
  if p_total is not null and p_total < x.min_spend then
    raise exception 'A compra mínima para este cupom é R$ %.', replace(to_char(x.min_spend, 'FM999990.00'), '.', ',');
  end if;
  update cover_coupons set status = 'usado', used_at = now(), used_via = 'caixa', receipt_total = p_total where id = x.id returning * into x;
  return jsonb_build_object('value', x.value, 'code', x.code, 'min_spend', x.min_spend);
end $$;

revoke all on function public._cover_spent(smallint) from public, anon, authenticated;
revoke all on function public._list_totals(jsonb) from public, anon, authenticated;
revoke all on function public.cover_offer(jsonb) from public, anon;
revoke all on function public.cover_accept(bigint) from public, anon;
revoke all on function public.cover_decline(bigint) from public, anon;
revoke all on function public.my_cover_coupons() from public, anon;
revoke all on function public.market_cover_get(smallint) from public, anon;
revoke all on function public.market_cover_save(smallint, jsonb) from public, anon;
revoke all on function public.market_cover_redeem(smallint, text, numeric) from public, anon;
grant execute on function public.cover_offer(jsonb) to authenticated;
grant execute on function public.cover_accept(bigint) to authenticated;
grant execute on function public.cover_decline(bigint) to authenticated;
grant execute on function public.my_cover_coupons() to authenticated;
grant execute on function public.market_cover_get(smallint) to authenticated;
grant execute on function public.market_cover_save(smallint, jsonb) to authenticated;
grant execute on function public.market_cover_redeem(smallint, text, numeric) to authenticated;

-- ---------------------------------------------------------------------
-- 5. NOTA FISCAL: pontos em dobro no parceiro e cupom comprovado pela nota
-- ---------------------------------------------------------------------
create or replace function public.receipt_ingest(p_user uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_chave text := nullif(regexp_replace(coalesce(p->>'chave', ''), '\D', '', 'g'), '');
  v_cnpj text := nullif(regexp_replace(coalesce(p->'store'->>'cnpj', ''), '\D', '', 'g'), '');
  v_market smallint; v_store int; v_confirmed boolean := false; v_choice smallint := nullif(p->>'supermarket_id', '')::smallint;
  v_issued timestamptz; v_old boolean; v_id bigint; it jsonb; v_pid int; v_price numeric;
  v_matched int := 0; v_added int := 0; v_stale int := 0; v_items int := 0; v_points int; v_ex receipts;
  v_ean text; v_partner boolean := false; v_cp cover_coupons;
begin
  if p_user is null then raise exception 'Entre na sua conta para enviar a nota.'; end if;
  if not setting_on('receipts_enabled') then raise exception 'O envio de notas está pausado no momento.'; end if;
  if (select blocked from profiles where id = p_user) then raise exception 'Sua conta não pode enviar notas.'; end if;
  if v_chave is null or length(v_chave) <> 44 then raise exception 'Não encontrei a chave de acesso desta nota.'; end if;

  select * into v_ex from receipts where chave = v_chave;
  if found then
    if v_ex.user_id = p_user then
      return jsonb_build_object('duplicate', 'mine', 'receipt_id', v_ex.id, 'points', v_ex.points, 'prices_added', v_ex.prices_added,
                                'supermarket_id', v_ex.supermarket_id, 'market_confirmed', v_ex.market_confirmed);
    end if;
    raise exception 'Esta nota já foi enviada por outra pessoa.' using errcode = 'P0002';
  end if;
  if (select count(*) from receipts where user_id = p_user and created_at > now() - interval '1 day') >= 15 then
    raise exception 'Você já enviou 15 notas hoje. Amanhã tem mais!';
  end if;

  -- mercado e loja pelo CNPJ
  if v_cnpj is not null then
    select s.id, s.supermarket_id into v_store, v_market from stores s where regexp_replace(coalesce(s.cnpj, ''), '\D', '', 'g') = v_cnpj limit 1;
    if v_market is null then
      select id into v_market from supermarkets where left(v_cnpj, 8) = any (cnpj_raiz) limit 1;
    end if;
  end if;
  v_confirmed := v_market is not null;
  if v_market is null then v_market := v_choice; end if;

  -- data de emissão (dd/mm/aaaa hh:mm[:ss], horário de Manaus) ou ISO
  begin
    v_issued := case
      when p->>'date' ~ '^\d{2}/\d{2}/\d{4} \d{2}:\d{2}' then
        (regexp_replace(left(p->>'date', 16), '^(\d{2})/(\d{2})/(\d{4}) (\d{2}:\d{2})$', '\3-\2-\1 \4'))::timestamp at time zone 'America/Manaus'
      when p->>'date' ~ '^\d{2}/\d{2}/\d{4}' then
        (regexp_replace(left(p->>'date', 10), '^(\d{2})/(\d{2})/(\d{4})$', '\3-\2-\1 12:00'))::timestamp at time zone 'America/Manaus'
      when p->>'date' is not null then (p->>'date')::timestamptz end;
  exception when others then v_issued := null; end;
  if v_issued is null or v_issued > now() + interval '1 day' then v_issued := now(); end if;
  v_old := v_issued < now() - interval '30 days';

  insert into receipts (user_id, chave, source, supermarket_id, store_id, market_confirmed, cnpj, store_name, issued_at, total)
  values (p_user, v_chave, 'qr', v_market, v_store, v_confirmed, v_cnpj, left(p->'store'->>'name', 120), v_issued,
          nullif(p->>'total', '')::numeric)
  returning id into v_id;

  for it in select * from jsonb_array_elements(coalesce(p->'items', '[]')) loop
    v_items := v_items + 1;
    v_pid := nullif(it->>'product_id', '')::int;
    if v_pid is not null and not exists (select 1 from products where id = v_pid and active) then v_pid := null; end if;
    v_price := round(nullif(it->>'unit_price', '')::numeric, 2);
    insert into receipt_items (receipt_id, name, code, qty, unit, unit_price, total, product_id)
    values (v_id, left(coalesce(it->>'name', '?'), 160), left(it->>'code', 20), nullif(it->>'qty', '')::numeric,
            left(it->>'unit', 10), v_price, nullif(it->>'total', '')::numeric, v_pid);
    if v_pid is null then continue; end if;
    v_matched := v_matched + 1;

    -- código de barras da nota ensina o EAN do produto (conta como 1 voto)
    v_ean := regexp_replace(coalesce(it->>'code', ''), '\D', '', 'g');
    if length(v_ean) in (8, 12, 13, 14) and v_ean ~ '^(0?78|0?79)' then
      begin
        insert into ean_suggestions (ean, product_id, user_id) values (v_ean, v_pid, p_user) on conflict do nothing;
      exception when others then null; end;
    end if;

  end loop;

  v_points := case when v_old then 5 else least(150, 20 + 2 * v_matched) end;
  update receipts set items_count = v_items, matched_count = v_matched, points = v_points,
         status = case when v_confirmed then 'verificada' else 'pendente' end
   where id = v_id;
  perform receipt_publish(v_id);

  -- nota de mercado parceiro (reconhecido pelo CNPJ) vale pontos em dobro
  if v_confirmed and not v_old and setting_on('partner_double_points') and is_partner_market(v_market) then
    v_partner := true;
    update receipts set points = least(300, points * 2) where id = v_id;
  end if;

  -- "Cubra a diferença": a nota comprova o uso do cupom (mesmo mercado, dentro da validade, compra mínima)
  if v_confirmed then
    select * into v_cp from cover_coupons
     where user_id = p_user and supermarket_id = v_market and status = 'aceito'
       and v_issued between coalesce(accepted_at, created_at) - interval '1 hour' and expires_at
       and coalesce(nullif(p->>'total', '')::numeric, 0) >= min_spend
     order by value desc limit 1 for update;
    if found then
      update cover_coupons set status = 'usado', used_at = now(), used_via = 'nota', receipt_id = v_id,
             receipt_total = nullif(p->>'total', '')::numeric where id = v_cp.id;
    end if;
  end if;

  -- aprende o CNPJ da rede quando 2 pessoas diferentes dizem que é o mesmo mercado
  if not v_confirmed and v_market is not null and v_cnpj is not null
     and (select count(distinct user_id) from receipts where left(cnpj, 8) = left(v_cnpj, 8) and supermarket_id = v_market and not market_confirmed) >= 2
     and not exists (select 1 from supermarkets where left(v_cnpj, 8) = any (cnpj_raiz)) then
    update supermarkets set cnpj_raiz = array_append(cnpj_raiz, left(v_cnpj, 8)) where id = v_market;
    -- as notas desse CNPJ que apontavam para este mercado passam a valer (e publicam os preços)
    update receipts set market_confirmed = true, status = 'verificada'
     where left(cnpj, 8) = left(v_cnpj, 8) and supermarket_id = v_market and not market_confirmed;
    perform receipt_publish(id) from receipts where left(cnpj, 8) = left(v_cnpj, 8) and supermarket_id = v_market;
  end if;

  select prices_added, stale_updated, points, market_confirmed into v_added, v_stale, v_points, v_confirmed from receipts where id = v_id;

  return jsonb_build_object('receipt_id', v_id, 'supermarket_id', v_market, 'market_confirmed', v_confirmed,
    'items', v_items, 'matched', v_matched, 'prices_added', v_added, 'stale_updated', v_stale, 'points', v_points, 'old', v_old,
    'partner_bonus', v_partner, 'coupon_used', case when v_cp.id is not null then jsonb_build_object('code', v_cp.code, 'value', v_cp.value) end);
end $$;
revoke all on function public.receipt_ingest(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.receipt_ingest(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------
-- 6. VENDAS COMPROVADAS COM NOTA FISCAL
-- A pessoa viu algo do mercado no site (campanha, promoção, rota, anúncio, cupom, queima) e, em até
-- N dias, mandou uma nota com o CNPJ desse mercado. Cada nota conta uma vez só, para o último
-- contato antes dela ("último toque"). Só entra quem estava com a conta aberta (é assim que a nota
-- se liga ao que a pessoa viu). Números de grupos com menos de 3 compradores ficam escondidos.
-- ---------------------------------------------------------------------
create or replace function public.market_sales_proof(p_market smallint, p_days int default 30, p_window int default 7)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_from timestamptz := now() - make_interval(days => greatest(1, least(p_days, 365)));
  v_win interval := make_interval(days => greatest(1, least(p_window, 30)));
  out jsonb;
begin
  if not (is_market_member(p_market) or is_master()) then raise exception 'Sem permissão para este supermercado.'; end if;

  create temp table if not exists _tb_ex (user_id uuid, person text, t timestamptz, src text, ref bigint) on commit drop;
  create temp table if not exists _tb_att (receipt_id bigint, user_id uuid, issued_at timestamptz, total numeric, src text, ref bigint, t timestamptz) on commit drop;
  truncate _tb_ex; truncate _tb_att;

  -- contatos com o mercado (com conta ou não: os sem conta só contam como "viram")
  insert into _tb_ex
  select e.user_id, coalesce(e.user_id::text, e.device_id, e.session_id), e.created_at,
         case when e.kind like 'camp_%' then 'campanha'
              when e.kind = 'promo_view' then 'promocao'
              when e.kind = 'route' then 'rota'
              when e.kind like 'ad_%' then 'publicidade'
              when e.kind like 'cover_%' then 'cubra'
              when e.kind like 'clear_%' then 'queima' end,
         case when e.kind like 'camp_%' or e.kind like 'cover_%' or e.kind like 'clear_%' then e.campaign_id
              when e.kind like 'ad_%' then e.ad_id
              when e.kind = 'promo_view' then e.product_id end
    from events e
   where e.created_at >= v_from - v_win
     and e.kind in ('camp_view','camp_click','promo_view','route','ad_view','ad_click','cover_view','cover_accept','clear_view','clear_claim')
     and (e.supermarket_id = p_market
          or (e.kind like 'camp_%' and e.campaign_id in (select id from market_campaigns where supermarket_id = p_market))
          or (e.kind like 'ad_%' and e.ad_id in (select id from ad_campaigns where supermarket_id = p_market)));

  -- cada nota confirmada pelo CNPJ vai para o último contato da mesma pessoa nos N dias antes dela
  insert into _tb_att
  select distinct on (r.id) r.id, r.user_id, r.issued_at, r.total, x.src, x.ref, x.t
    from receipts r join _tb_ex x on x.user_id = r.user_id and x.t <= r.issued_at and x.t >= r.issued_at - v_win
   where r.supermarket_id = p_market and r.market_confirmed and r.issued_at >= v_from and r.total > 0
   order by r.id, x.t desc;

  with ex as (select * from _tb_ex where t >= v_from),
  logged as (select distinct user_id from ex where user_id is not null),
  -- controle: quem usou o site no período com a conta aberta e NÃO teve contato com o mercado
  active as (select distinct e.user_id from events e where e.created_at >= v_from and e.user_id is not null
               and not exists (select 1 from logged l where l.user_id = e.user_id)),
  ctrl_buy as (select count(distinct r.user_id) n from receipts r join active a on a.user_id = r.user_id
                where r.supermarket_id = p_market and r.market_confirmed and r.issued_at >= v_from),
  hide as (select (select count(distinct user_id) from _tb_att) < 3 h),
  by_src as (
    select s.src,
           (select count(distinct person) from ex where ex.src = s.src) people,
           (select count(distinct user_id) from ex where ex.src = s.src and user_id is not null) logged,
           count(distinct a.user_id) buyers, count(a.receipt_id) receipts, coalesce(sum(a.total), 0) revenue
      from (values ('campanha'), ('promocao'), ('rota'), ('publicidade'), ('cubra'), ('queima')) s(src)
      left join _tb_att a on a.src = s.src
     group by s.src),
  camps as (
    select c.id, c.title, c.kind, c.starts_at, c.ends_at,
           (select count(distinct person) from ex where ex.src = 'campanha' and ex.ref = c.id) people,
           (select count(distinct user_id) from ex where ex.src = 'campanha' and ex.ref = c.id and user_id is not null) logged,
           count(distinct a.user_id) buyers, count(a.receipt_id) receipts, coalesce(sum(a.total), 0) revenue
      from market_campaigns c left join _tb_att a on a.src = 'campanha' and a.ref = c.id
     where c.supermarket_id = p_market and c.ends_at >= v_from
     group by c.id order by c.starts_at desc limit 20),
  -- prova direta: a nota tem o produto da promoção pelo preço da promoção
  promo_hits as (
    select pm.id promo_id, pm.kind, pm.code, p.name product, count(distinct r.id) receipts, count(distinct r.user_id) buyers,
           coalesce(sum(ri.qty), 0) units, coalesce(sum(ri.total), 0) value
      from promotions pm join products p on p.id = pm.product_id
      join receipt_items ri on ri.product_id = pm.product_id and ri.unit_price <= pm.promo_price + 0.01
      join receipts r on r.id = ri.receipt_id and r.supermarket_id = p_market and r.market_confirmed
                     and r.issued_at between pm.starts_at and pm.ends_at + interval '1 day'
     where pm.supermarket_id = p_market and pm.ends_at >= v_from
     group by pm.id, p.name order by count(distinct r.id) desc limit 15),
  daily as (
    select (issued_at at time zone 'America/Manaus')::date d, count(*) receipts, sum(total) revenue
      from _tb_att group by 1 order by 1)
  select jsonb_build_object(
    'days', p_days, 'window', p_window, 'hidden', (select h from hide),
    'totals', jsonb_build_object(
      'people', (select count(distinct person) from ex),
      'logged', (select count(*) from logged),
      'buyers', (select count(distinct user_id) from _tb_att),
      'receipts', (select count(*) from _tb_att),
      'revenue', case when (select h from hide) then null else (select coalesce(sum(total), 0) from _tb_att) end,
      'ticket', case when (select h from hide) then null else (select round(avg(total), 2) from _tb_att) end,
      'conv', (select round(100.0 * count(distinct user_id) / nullif((select count(*) from logged), 0), 1) from _tb_att),
      'ctrl_conv', (select round(100.0 * n / nullif((select count(*) from active), 0), 1) from ctrl_buy),
      'all_receipts', (select count(*) from receipts where supermarket_id = p_market and market_confirmed and issued_at >= v_from),
      'all_revenue', (select coalesce(sum(total), 0) from receipts where supermarket_id = p_market and market_confirmed and issued_at >= v_from)),
    'by_source', (select jsonb_agg(jsonb_build_object('src', src, 'people', people, 'logged', logged, 'buyers', buyers, 'receipts', receipts,
                    'revenue', case when buyers < 3 then null else revenue end,
                    'ticket', case when buyers < 3 or receipts = 0 then null else round(revenue / receipts, 2) end) order by revenue desc) from by_src),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'kind', kind, 'starts_at', starts_at, 'ends_at', ends_at,
                    'people', people, 'logged', logged, 'buyers', buyers, 'receipts', receipts,
                    'revenue', case when buyers < 3 then null else revenue end,
                    'ticket', case when buyers < 3 or receipts = 0 then null else round(revenue / receipts, 2) end)) from camps), '[]'),
    'promos', coalesce((select jsonb_agg(jsonb_build_object('promo_id', promo_id, 'kind', kind, 'code', code, 'product', product,
                    'receipts', receipts, 'buyers', buyers, 'units', units, 'value', case when buyers < 3 then null else value end)) from promo_hits), '[]'),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'receipts', receipts,
                    'revenue', case when (select h from hide) then null else revenue end)) from daily), '[]')
  ) into out;
  return out;
end $$;
revoke all on function public.market_sales_proof(smallint, int, int) from public, anon;
grant execute on function public.market_sales_proof(smallint, int, int) to authenticated;

-- ---------------------------------------------------------------------
-- 7. PREVISÃO DE DEMANDA PELAS LISTAS
-- O que as pessoas VÃO comprar: listas do mês abertas (conta), listas da família e favoritos/avisos de preço.
-- Para cada produto: em quantas listas está, em quantas o mercado é o mais barato (entre os mercados
-- que aquela pessoa compara) e o "preço a bater" de cada lista, para o simulador do portal.
-- Só produtos em 3 listas ou mais (ninguém é identificado).
-- ---------------------------------------------------------------------
create or replace function public.market_demand(p_market smallint, p_limit int default 40)
returns jsonb language plpgsql security definer set search_path = public as $$
declare out jsonb; v_lists int;
begin
  if not (is_market_member(p_market) or is_master()) then raise exception 'Sem permissão para este supermercado.'; end if;

  create temp table if not exists _tb_li (lid text, pid int, qty numeric, mk smallint[]) on commit drop;
  truncate _tb_li;
  -- listas do mês das contas (sincronizadas), ainda não concluídas, mexidas nos últimos 21 dias
  insert into _tb_li
  select 'u:' || us.user_id, (x->>0)::int, coalesce(nullif(x->>1, '')::numeric, 1),
         coalesce((select array_agg(y::smallint) from user_state en, jsonb_array_elements_text(case when jsonb_typeof(en.value) = 'array' then en.value else '[]' end) y
                    where en.user_id = us.user_id and en.key = 'tb.enabled' and y ~ '^\d+$'), '{}')
    from user_state us, jsonb_array_elements(case when jsonb_typeof(us.value) = 'array' then us.value else '[]' end) x
   where us.key = 'tb.list' and us.updated_at >= now() - interval '21 days'
     and jsonb_typeof(x) = 'array' and (x->>0) ~ '^\d+$'
     and coalesce((select r.value->>'status' from user_state r where r.user_id = us.user_id and r.key = 'tb.rancho'), 'aberta') <> 'concluida';
  -- listas antigas guardadas na conta (sem sincronização)
  insert into _tb_li
  select 'l:' || l.id, i.product_id, i.qty, coalesce(pf.preferred_markets, '{}')
    from shopping_lists l join shopping_list_items i on i.list_id = l.id left join profiles pf on pf.id = l.user_id
   where l.status = 'aberta' and l.updated_at >= now() - interval '21 days' and not i.checked
     and not exists (select 1 from _tb_li t where t.lid = 'u:' || l.user_id);
  -- listas da família
  insert into _tb_li
  select 'f:' || s.code, (x->>'product_id')::int, coalesce(nullif(x->>'qty', '')::numeric, 1), '{}'
    from shared_lists s, jsonb_array_elements(case when jsonb_typeof(s.items) = 'array' then s.items else '[]' end) x
   where s.updated_at >= now() - interval '21 days' and (x->>'product_id') ~ '^\d+$';
  delete from _tb_li where pid not in (select id from products where active);
  select count(distinct lid) into v_lists from _tb_li;

  with prices as (
    select v.id pid, v.name, v.brand, v.unit, v.emoji, v.image_url, (e->>'market_id')::smallint mid, (e->>'price')::numeric price
      from v_products v cross join lateral jsonb_array_elements(v.prices) e
     where v.id in (select distinct pid from _tb_li)
  ),
  -- por lista: o mercado é comparado? qual o menor preço dos OUTROS que a pessoa compara?
  per as (
    select li.lid, li.pid, li.qty,
           (cardinality(li.mk) = 0 or p_market = any(li.mk)) considered,
           (select min(p.price) from prices p where p.pid = li.pid and p.mid <> p_market and (cardinality(li.mk) = 0 or p.mid = any(li.mk))) beat
      from (select lid, pid, max(qty) qty, max(mk) mk from _tb_li group by lid, pid) li
  ),
  watch as (
    select pid, count(distinct who) n from (
      select product_id pid, user_id::text who from favorites
      union select unnest(watch_ids), coalesce(user_id::text, 's' || id) from push_subscriptions where updated_at >= now() - interval '60 days'
    ) w group by pid
  ),
  agg as (
    select pr.pid, pr.name, pr.brand, pr.unit, pr.emoji, pr.image_url, pr.price my_price,
           (select min(o.price) from prices o where o.pid = pr.pid and o.mid <> p_market) min_other,
           (select s.name from prices o join supermarkets s on s.id = o.mid where o.pid = pr.pid and o.mid <> p_market order by o.price limit 1) min_other_name,
           count(per.lid) n_lists, coalesce(sum(per.qty), 0) units,
           count(per.lid) filter (where per.considered) n_considered,
           count(per.lid) filter (where per.considered and (per.beat is null or pr.price <= per.beat)) wins,
           count(per.lid) filter (where per.considered and per.beat is null) free,
           coalesce(jsonb_agg(jsonb_build_array(per.beat, 1)) filter (where per.considered and per.beat is not null), '[]') beats,
           coalesce(max(w.n), 0) n_watch
      from prices pr join per on per.pid = pr.pid left join watch w on w.pid = pr.pid
     where pr.mid = p_market
     group by pr.pid, pr.name, pr.brand, pr.unit, pr.emoji, pr.image_url, pr.price
    having count(per.lid) >= 3
  )
  select jsonb_build_object(
    'lists', v_lists,
    'products', coalesce((select jsonb_agg(jsonb_build_object(
        'product_id', pid, 'name', name, 'brand', brand, 'unit', unit, 'emoji', emoji, 'image_url', image_url,
        'my_price', my_price, 'min_other', min_other, 'min_other_name', min_other_name,
        'n_lists', n_lists, 'units', units, 'n_considered', n_considered, 'wins', wins, 'free', free, 'n_watch', n_watch,
        -- "preço a bater" agrupado: [[preço, quantas listas], …]
        'beats', (select coalesce(jsonb_agg(jsonb_build_array(b, c) order by b desc), '[]')
                    from (select (x->>0)::numeric b, count(*) c from jsonb_array_elements(beats) x group by 1) z)
      ) order by n_lists + n_watch desc, n_lists desc) from (select * from agg order by n_lists + n_watch desc limit greatest(5, least(p_limit, 100))) a), '[]'),
    -- produtos que o mercado nem vende mas aparecem em muitas listas
    'missing', coalesce((select jsonb_agg(jsonb_build_object('product_id', id, 'name', name, 'brand', brand, 'unit', unit, 'n_lists', n) order by n desc)
        from (select p.id, p.name, p.brand, p.unit, count(distinct li.lid) n from _tb_li li join products p on p.id = li.pid
               where not exists (select 1 from prices x where x.pid = li.pid and x.mid = p_market)
               group by p.id having count(distinct li.lid) >= 3 order by n desc limit 10) m), '[]')
  ) into out;
  return out;
end $$;
revoke all on function public.market_demand(smallint, int) from public, anon;
grant execute on function public.market_demand(smallint, int) to authenticated;

-- ---------------------------------------------------------------------
-- 8. QUEIMA DE PERECÍVEIS E PRODUTOS PERTO DO VENCIMENTO
-- O mercado cadastra "iogurte vence sexta, 40% off, 60 unidades"; o site avisa só quem está perto
-- (raio da loja) e acompanha aquele tipo de produto: aviso no celular, Telegram e boas-vindas na loja.
-- ---------------------------------------------------------------------
create table if not exists public.market_clearance (
  id             bigserial primary key,
  supermarket_id smallint not null references public.supermarkets(id) on delete cascade,
  store_id       int references public.stores(id) on delete cascade,             -- vazio = todas as lojas da rede
  product_id     int references public.products(id) on delete set null,
  category_slug  text references public.categories(slug) on update cascade on delete set null,
  title          text not null check (char_length(title) between 3 and 60),
  note           text check (char_length(note) <= 120),
  regular_price  numeric(10,2) not null check (regular_price > 0),
  price          numeric(10,2) not null check (price > 0),
  qty            int not null default 10 check (qty between 1 and 100000),
  expires_on     date not null,                                                  -- vencimento do produto
  ends_at        timestamptz not null,                                           -- a oferta acaba (no máximo no vencimento)
  radius_km      numeric(4,1) not null default 2 check (radius_km between 0.5 and 10),
  status         text not null default 'ativa' check (status in ('ativa','esgotada','encerrada','bloqueada')),
  claims         int not null default 0,                                         -- toques em "Vou buscar"
  notified       int not null default 0,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  check (price < regular_price)
);
create index if not exists market_clearance_live on public.market_clearance (status, ends_at);
alter table public.market_clearance enable row level security;
-- sem políticas: leitura e escrita só pelas funções abaixo

-- público: ofertas no ar (com a loja e a distância, se a pessoa mandar a posição)
create or replace function public.clearance_live(p_lat double precision default null, p_lng double precision default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.km nulls last, x.ends_at), '[]') from (
    select c.id, c.supermarket_id, c.store_id, c.product_id, c.category_slug, c.title, c.note, c.regular_price, c.price,
           round(100 * (1 - c.price / c.regular_price)) pct, c.qty, c.expires_on, c.ends_at, c.radius_km, c.claims,
           st.id sid, st.name store_name, st.lat, st.lng, st.neighborhood,
           case when p_lat is null then null else round(_km(p_lat, p_lng, st.lat, st.lng)::numeric, 2) end km
      from market_clearance c join supermarkets s on s.id = c.supermarket_id and s.active
      cross join lateral (
        select st.* from stores st where st.supermarket_id = c.supermarket_id and (c.store_id is null or st.id = c.store_id)
         order by case when p_lat is null then 0 else _km(p_lat, p_lng, st.lat, st.lng) end limit 1) st
     where c.status = 'ativa' and now() < c.ends_at and setting_on('clearance_enabled')
       and (p_lat is null or _km(p_lat, p_lng, st.lat, st.lng) <= greatest(c.radius_km, 3))
     limit 40) x
$$;
grant execute on function public.clearance_live(double precision, double precision) to anon, authenticated;

-- "Vou buscar"
create or replace function public.clearance_claim(p_id bigint, p_device text default null)
returns int language plpgsql security definer set search_path = public as $$
declare v int; m smallint;
begin
  update market_clearance set claims = claims + 1 where id = p_id and status = 'ativa' and now() < ends_at returning claims, supermarket_id into v, m;
  if v is null then raise exception 'Esta oferta acabou.'; end if;
  insert into events (kind, user_id, supermarket_id, campaign_id, device_id) values ('clear_claim', auth.uid(), m, p_id, left(p_device, 40));
  return v;
end $$;
grant execute on function public.clearance_claim(bigint, text) to anon, authenticated;

create or replace function public.market_clearance_save(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint := nullif(p->>'id', '')::bigint; v_m smallint := (p->>'supermarket_id')::smallint; v_exp date; v_end timestamptz; v_store int;
begin
  if not is_market_member(v_m) then raise exception 'Sem permissão para este supermercado.'; end if;
  if not setting_on('clearance_enabled') then raise exception 'A queima de perecíveis está pausada pela equipe.'; end if;
  v_exp := (p->>'expires_on')::date;
  if v_exp is null or v_exp < (now() at time zone 'America/Manaus')::date then raise exception 'Informe um vencimento de hoje em diante.'; end if;
  v_end := coalesce(nullif(p->>'ends_at', '')::timestamptz, (v_exp + time '21:00') at time zone 'America/Manaus');
  if v_end > (v_exp + time '23:59') at time zone 'America/Manaus' then v_end := (v_exp + time '23:59') at time zone 'America/Manaus'; end if;
  v_store := nullif(p->>'store_id', '')::int;
  if v_store is not null and not exists (select 1 from stores where id = v_store and supermarket_id = v_m) then raise exception 'Essa loja não é do seu supermercado.'; end if;
  if (p->>'price')::numeric >= (p->>'regular_price')::numeric then raise exception 'O preço da queima tem que ser menor que o normal.'; end if;
  if v_id is null then
    if (select count(*) from market_clearance where supermarket_id = v_m and status = 'ativa' and now() < ends_at) >= 15 then
      raise exception 'Você já tem 15 queimas no ar. Encerre alguma antes.';
    end if;
    insert into market_clearance (supermarket_id, store_id, product_id, category_slug, title, note, regular_price, price, qty, expires_on, ends_at, radius_km)
    values (v_m, v_store, nullif(p->>'product_id', '')::int,
            coalesce(nullif(p->>'category_slug', ''), (select c.slug from products pr join categories c on c.id = pr.category_id where pr.id = nullif(p->>'product_id', '')::int)),
            trim(p->>'title'), nullif(trim(p->>'note'), ''), (p->>'regular_price')::numeric, (p->>'price')::numeric,
            coalesce((p->>'qty')::int, 10), v_exp, v_end, coalesce((p->>'radius_km')::numeric, 2))
    returning id into v_id;
  else
    update market_clearance set store_id = v_store, product_id = nullif(p->>'product_id', '')::int,
           category_slug = coalesce(nullif(p->>'category_slug', ''), category_slug), title = trim(p->>'title'), note = nullif(trim(p->>'note'), ''),
           regular_price = (p->>'regular_price')::numeric, price = (p->>'price')::numeric, qty = coalesce((p->>'qty')::int, qty),
           expires_on = v_exp, ends_at = v_end, radius_km = coalesce((p->>'radius_km')::numeric, radius_km)
     where id = v_id and supermarket_id = v_m and status <> 'bloqueada';
    if not found then raise exception 'Queima não encontrada.'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.market_clearance_status(p_id bigint, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare m smallint;
begin
  select supermarket_id into m from market_clearance where id = p_id;
  if m is null or not is_market_member(m) then raise exception 'Sem permissão.'; end if;
  if p_status not in ('ativa', 'esgotada', 'encerrada') then raise exception 'Situação inválida.'; end if;
  update market_clearance set status = p_status where id = p_id and status <> 'bloqueada';
end $$;

-- portal: as queimas e o resultado (dinheiro que ia para o lixo)
create or replace function public.market_clearance_list(p_market smallint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_market_member(p_market) or is_master()) then raise exception 'Sem permissão para este supermercado.'; end if;
  return coalesce((select jsonb_agg(x order by x.live desc, x.created_at desc) from (
    select c.*, (c.status = 'ativa' and now() < c.ends_at) live, st.name store_name, pr.name product_name,
           round(100 * (1 - c.price / c.regular_price)) pct,
           (select count(distinct coalesce(e.user_id::text, e.device_id, e.session_id)) from events e where e.kind = 'clear_view' and e.campaign_id = c.id) views,
           -- unidades comprovadas por nota: o produto na nota deste mercado, no período, pelo preço da queima
           coalesce((select sum(coalesce(ri.qty, 1)) from receipt_items ri join receipts r on r.id = ri.receipt_id
                      where c.product_id is not null and ri.product_id = c.product_id and ri.unit_price <= c.price + 0.05
                        and r.supermarket_id = c.supermarket_id and r.market_confirmed
                        and (c.store_id is null or r.store_id is null or r.store_id = c.store_id)
                        and r.issued_at between c.created_at and c.ends_at + interval '1 day'), 0) proven_units
      from market_clearance c left join stores st on st.id = c.store_id left join products pr on pr.id = c.product_id
     where c.supermarket_id = p_market and c.created_at > now() - interval '120 days'
     order by c.created_at desc limit 60) x), '[]');
end $$;

revoke all on function public.market_clearance_save(jsonb) from public, anon;
revoke all on function public.market_clearance_status(bigint, text) from public, anon;
revoke all on function public.market_clearance_list(smallint) from public, anon;
grant execute on function public.market_clearance_save(jsonb) to authenticated;
grant execute on function public.market_clearance_status(bigint, text) to authenticated;
grant execute on function public.market_clearance_list(smallint) to authenticated;

-- quem "acompanha aquele tipo de produto": o produto ou a categoria dele em favoritos, lista do mês ou avisos de preço
create or replace function public._clear_interest(c market_clearance, p_watch int[], p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  with follow as (
    select unnest(coalesce(p_watch, '{}')) pid
    union select product_id from favorites where p_user is not null and user_id = p_user
    union select (x->>0)::int from user_state us,
                 jsonb_array_elements(case when jsonb_typeof(us.value) = 'array' then us.value else '[]' end) x
           where p_user is not null and us.user_id = p_user and us.key = 'tb.list' and jsonb_typeof(x) = 'array' and (x->>0) ~ '^\d+$'
  )
  select exists (select 1 from follow f join products pr on pr.id = f.pid left join categories ca on ca.id = pr.category_id
                  where f.pid = c.product_id or (c.category_slug is not null and ca.slug = c.category_slug))
$$;

create or replace function public.push_collect(p_limit int default 500)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s push_subscriptions; out jsonb := '[]'; v_refs jsonb; drops jsonb; r record; ref numeric;
  v_today date := (now() at time zone 'America/Manaus')::date;
  v_hour int := extract(hour from now() at time zone 'America/Manaus');
  fl shared_lists; cp record; v_msg jsonb; v_today_n int; cl record;
begin
  if not setting_on('push_enabled') or v_hour < 8 or v_hour >= 21 then return out; end if;

  drop table if exists _tb_mins;
  create temp table _tb_mins on commit drop as
    select v.id, v.name, v.min_price, (v.prices->0->>'market_id')::smallint mid from v_products v;

  for s in select * from push_subscriptions where fails < 5 order by coalesce(last_push_at, 'epoch') limit greatest(1, least(p_limit, 2000)) loop
    v_msg := null;
    v_today_n := case when s.pushes_day = v_today then s.pushes_today else 0 end;

    -- lista da família: alguém mexeu (e não foi esta pessoa)
    if s.family_code is not null and coalesce((s.prefs->>'familia')::boolean, true) then
      select * into fl from shared_lists where code = s.family_code;
      if found then
        if s.family_seen is not null and fl.updated_at > s.family_seen and fl.updated_by is distinct from s.family_by then
          v_msg := jsonb_build_object('title', coalesce(fl.updated_by, 'Alguém') || ' mexeu na ' || coalesce('lista "' || fl.name || '"', 'lista da família'),
                                      'body', 'Toque para ver o que foi marcado ou incluído.', 'url', './#lista', 'tag', 'tb-familia');
        end if;
        update push_subscriptions set family_seen = fl.updated_at where id = s.id;
      end if;
    end if;

    -- preços que baixaram do que a pessoa acompanha (favoritos e o que já comprou)
    v_refs := s.refs; drops := '[]';
    if coalesce((s.prefs->>'precos')::boolean, true) and cardinality(s.watch_ids) > 0 then
      for r in select m.id, m.name, m.min_price, sm.name market from _tb_mins m left join supermarkets sm on sm.id = m.mid
                where m.id = any(s.watch_ids) loop
        ref := (v_refs->>r.id::text)::numeric;
        if ref is null or r.min_price > ref then
          v_refs := jsonb_set(v_refs, array[r.id::text], to_jsonb(r.min_price));
        elsif ref - r.min_price >= 0.10 and r.min_price <= ref * 0.97 then
          drops := drops || jsonb_build_object('name', r.name, 'from', ref, 'to', r.min_price, 'market', r.market);
          v_refs := jsonb_set(v_refs, array[r.id::text], to_jsonb(r.min_price));
        end if;
      end loop;
      update push_subscriptions set refs = v_refs where id = s.id;
      if v_msg is null and jsonb_array_length(drops) > 0 then
        v_msg := case when jsonb_array_length(drops) = 1 then
          jsonb_build_object('title', 'Baixou: ' || (drops->0->>'name'),
                             'body', 'De R$ ' || replace(to_char((drops->0->>'from')::numeric, 'FM999990.00'), '.', ',') ||
                                     ' por R$ ' || replace(to_char((drops->0->>'to')::numeric, 'FM999990.00'), '.', ',') ||
                                     coalesce(' no ' || (drops->0->>'market'), '') || '.',
                             'url', './#ofertas', 'tag', 'tb-preco')
        else
          jsonb_build_object('title', jsonb_array_length(drops) || ' produtos que você acompanha baixaram',
                             'body', (select string_agg(d->>'name', ', ') from (select d from jsonb_array_elements(drops) d limit 3) x),
                             'url', './#ofertas', 'tag', 'tb-preco')
        end;
      end if;
    end if;

    -- queima de perecíveis: perto de uma loja e acompanha aquele tipo de produto (uma por dia)
    if v_msg is null and s.lat is not null and coalesce((s.prefs->>'campanhas')::boolean, true) and setting_on('clearance_enabled')
       and not exists (select 1 from push_log l where l.sub_id = s.id and l.ref like 'clear:%' and l.sent_at >= now() - interval '20 hours') then
      select c.*, sm.name market, st.name store into cl
        from market_clearance c join supermarkets sm on sm.id = c.supermarket_id and sm.active
        join stores st on st.supermarket_id = c.supermarket_id and (c.store_id is null or st.id = c.store_id)
       where c.status = 'ativa' and now() < c.ends_at
         and _km(s.lat::float8, s.lng::float8, st.lat, st.lng) <= c.radius_km
         and not exists (select 1 from push_log l where l.sub_id = s.id and l.ref = 'clear:' || c.id)
         and _clear_interest(c, s.watch_ids, s.user_id)
       order by _km(s.lat::float8, s.lng::float8, st.lat, st.lng), c.ends_at limit 1;
      if found then
        v_msg := jsonb_build_object('title', 'Queima no ' || cl.market || ': ' || cl.title || ' ' || round(100 * (1 - cl.price / cl.regular_price)) || '% off',
                                    'body', 'R$ ' || replace(to_char(cl.price, 'FM999990.00'), '.', ',') || ' (era R$ ' || replace(to_char(cl.regular_price, 'FM999990.00'), '.', ',') ||
                                            '). Vence ' || to_char(cl.expires_on, 'DD/MM') || ' · ' || cl.store || '.',
                                    'url', './#queima', 'tag', 'tb-queima-' || cl.id, 'campaign_id', cl.id);
        insert into push_log (sub_id, ref) values (s.id, 'clear:' || cl.id) on conflict do nothing;
        insert into events (kind, supermarket_id, campaign_id, device_id) values ('clear_notify', cl.supermarket_id, cl.id, s.device);
        update market_clearance set notified = notified + 1 where id = cl.id;
      end if;
    end if;

    -- aviso de supermercado (um por dia, só o que a pessoa ainda não recebeu)
    if v_msg is null and coalesce((s.prefs->>'campanhas')::boolean, true) and setting_on('campaigns_enabled')
       and not exists (select 1 from push_log l where l.sub_id = s.id and l.ref like 'camp:%' and l.sent_at >= now() - interval '20 hours') then
      select c.id, c.title, c.body, c.supermarket_id, sm.name market into cp
        from market_campaigns c join supermarkets sm on sm.id = c.supermarket_id and sm.active
       where c.kind = 'aviso' and c.status = 'ativa' and now() between c.starts_at and c.ends_at
         and not exists (select 1 from push_log l where l.sub_id = s.id and l.ref = 'camp:' || c.id)
         and (c.audience = 'todos'
              or (c.audience = 'preferem' and c.supermarket_id = any(s.markets))
              or (c.audience = 'perto' and s.lat is not null and exists (
                    select 1 from stores st where st.supermarket_id = c.supermarket_id
                       and _km(s.lat::float8, s.lng::float8, st.lat, st.lng) <= c.radius_km)))
       order by (c.audience = 'perto') desc, c.created_at desc limit 1;
      if found then
        v_msg := jsonb_build_object('title', cp.market || ': ' || cp.title, 'body', coalesce(cp.body, 'Toque para ver as ofertas.'),
                                    'url', './#ofertas', 'tag', 'tb-camp-' || cp.id, 'campaign_id', cp.id);
        insert into push_log (sub_id, ref) values (s.id, 'camp:' || cp.id) on conflict do nothing;
        insert into events (kind, supermarket_id, campaign_id, device_id) values ('camp_notify', cp.supermarket_id, cp.id, s.device);
      end if;
    end if;

    if v_msg is not null and v_today_n < 3 then
      out := out || (v_msg || jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth));
      update push_subscriptions set pushes_day = v_today, pushes_today = v_today_n + 1, last_push_at = now() where id = s.id;
    end if;
  end loop;
  return out;
end $$;
revoke all on function public.push_collect(int) from public, anon, authenticated;
grant execute on function public.push_collect(int) to service_role;

-- Telegram: queimas perto da casa de quem ligou a conta e acompanha o tipo de produto (uma por dia)
alter table public.tg_contacts add column if not exists clear_day date;
create or replace function public.tg_clearance_collect(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public as $$
declare c tg_contacts; cl record; out jsonb := '[]'; v_today date := (p_now at time zone 'America/Manaus')::date;
  v_hour int := extract(hour from p_now at time zone 'America/Manaus'); h record;
begin
  if not setting_on('telegram_alerts') or not setting_on('clearance_enabled') or v_hour < 8 or v_hour >= 21 then return out; end if;
  for c in select * from tg_contacts where user_id is not null and alerts and clear_day is distinct from v_today limit 2000 loop
    -- onde a pessoa mora (perfil) ou a última posição aproximada dos avisos do celular
    select coalesce(pf.home_lat, ps.lat::float8) lat, coalesce(pf.home_lng, ps.lng::float8) lng into h
      from profiles pf left join lateral (select lat, lng from push_subscriptions where user_id = c.user_id and lat is not null order by updated_at desc limit 1) ps on true
     where pf.id = c.user_id;
    continue when h.lat is null;
    select x.*, sm.name market, st.name store into cl
      from market_clearance x join supermarkets sm on sm.id = x.supermarket_id and sm.active
      join stores st on st.supermarket_id = x.supermarket_id and (x.store_id is null or st.id = x.store_id)
     where x.status = 'ativa' and p_now < x.ends_at and _km(h.lat, h.lng, st.lat, st.lng) <= x.radius_km
       and _clear_interest(x, '{}', c.user_id)
     order by _km(h.lat, h.lng, st.lat, st.lng) limit 1;
    continue when not found;
    out := out || jsonb_build_object('chat_id', c.chat_id, 'id', cl.id, 'market', cl.market, 'store', cl.store, 'title', cl.title, 'note', cl.note,
                                     'price', cl.price, 'regular', cl.regular_price, 'qty', cl.qty, 'expires_on', cl.expires_on,
                                     'product_id', cl.product_id);
    update tg_contacts set clear_day = v_today where chat_id = c.chat_id;
    update market_clearance set notified = notified + 1 where id = cl.id;
    insert into events (kind, user_id, supermarket_id, campaign_id) values ('clear_notify', c.user_id, cl.supermarket_id, cl.id);
  end loop;
  return out;
end $$;
revoke all on function public.tg_clearance_collect(timestamptz) from public, anon, authenticated;
grant execute on function public.tg_clearance_collect(timestamptz) to service_role;
revoke all on function public._clear_interest(market_clearance, int[], uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 9. SAÚDE DO BANCO: confere esta atualização
-- ---------------------------------------------------------------------
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
    ('Promoção por unidade e mapa no portal', 'func', 'public.market_save_store(jsonb)'),
    ('Parceiros: vendas comprovadas, cubra a diferença, demanda e queima', 'col', 'supermarkets.brand_primary'),
    ('Parceiros: vendas comprovadas, cubra a diferença, demanda e queima', 'func', 'public.market_sales_proof(smallint,integer,integer)'),
    ('Parceiros: vendas comprovadas, cubra a diferença, demanda e queima', 'table', 'public.cover_coupons'),
    ('Parceiros: vendas comprovadas, cubra a diferença, demanda e queima', 'func', 'public.market_demand(smallint,integer)'),
    ('Parceiros: vendas comprovadas, cubra a diferença, demanda e queima', 'table', 'public.market_clearance'),
    ('Parceiros: vendas comprovadas, cubra a diferença, demanda e queima', 'func', 'public.tg_clearance_collect(timestamptz)')
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


-- #####################################################################
-- (incluído de atualizacao-2026-10-publicidade-inteligente.sql)
-- #####################################################################
-- =====================================================================
--  Tá Barato Mesmo? — Publicidade inteligente (outubro/2026)
--  Três formatos novos, sempre de UM produto do supermercado, que só aparecem quando fazem sentido:
--   • busca    — Busca patrocinada: o produto no topo quando alguém procura por ele, pela marca,
--                pela categoria ou pelas palavras que o mercado escolher.
--   • troca    — Sugestão na lista: quem põe na lista um produto parecido (mesma categoria)
--                recebe a sugestão de trocar pelo produto do mercado.
--   • recompra — Hora de repor: quem já comprou esse produto (ou um parecido) vê o anúncio quando
--                costuma estar acabando. A conta é feita NO CELULAR, com as compras guardadas nele:
--                nada sobre a pessoa vai para o mercado.
--  Rode uma vez no Supabase › SQL Editor (pode rodar de novo sem problema).
-- =====================================================================
alter table public.ad_slots add column if not exists smart boolean not null default false;  -- precisa de um produto
alter table public.ad_campaigns add column if not exists keywords text[] not null default '{}';
insert into public.ad_slots (key, name, description, multiplier, max_concurrent, sort, smart) values
  ('busca',    'Busca patrocinada', 'Seu produto no topo quando alguém procura por ele, pela marca, pela categoria ou pelas palavras que você escolher.', 1.40, 3, 6, true),
  ('troca',    'Sugestão na lista', 'Quem põe na lista um produto parecido recebe a sugestão de trocar pelo seu, com o seu preço.', 1.30, 2, 7, true),
  ('recompra', 'Hora de repor',     'Para quem já comprou esse produto ou um parecido, quando costuma estar acabando. A conta é feita no celular da pessoa.', 1.10, 3, 8, true)
on conflict (key) do update set smart = true;

-- Pedido do supermercado (agora com produto e palavras-chave nos formatos inteligentes)
create or replace function public.market_ad_request(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_m smallint := (p->>'supermarket_id')::smallint;
  v_plan ad_plans; v_slot ad_slots; v_start timestamptz := (p->>'starts_at')::timestamptz; v_end timestamptz;
  v_taken int; r ad_campaigns; v_pid int; v_prod products; v_img text; v_title text; v_kw text[] := '{}';
begin
  if not is_market_member(v_m) then raise exception 'Sem permissão para este supermercado.'; end if;
  select * into v_plan from ad_plans where id = (p->>'plan_id')::int and active;
  if not found then raise exception 'Escolha um plano.'; end if;
  select * into v_slot from ad_slots where key = p->>'slot' and active;
  if not found then raise exception 'Escolha um espaço.'; end if;
  if v_start < now() - interval '10 minutes' then raise exception 'Escolha um início no futuro.'; end if;
  v_end := v_start + make_interval(hours => v_plan.hours);
  select count(*) into v_taken from ad_campaigns where slot = v_slot.key and status in ('aprovada','pendente')
     and starts_at < v_end and ends_at > v_start;
  if v_taken >= v_slot.max_concurrent then
    raise exception 'O espaço “%” já está reservado nesse período. Escolha outro horário ou outro espaço.', v_slot.name;
  end if;
  v_img := nullif(p->>'image_url', ''); v_title := nullif(trim(p->>'title'), '');
  if v_slot.smart then
    v_pid := nullif(p->>'target_value', '')::int;
    select * into v_prod from products where id = v_pid and active;
    if not found then raise exception 'Escolha o produto do anúncio.'; end if;
    if not exists (select 1 from prices where product_id = v_pid and supermarket_id = v_m) then
      raise exception 'Este produto ainda não tem preço no seu mercado. Cadastre o preço em Produtos antes.';
    end if;
    if coalesce(trim(p->>'body'), '') = '' then raise exception 'Escreva a mensagem do anúncio.'; end if;
    v_img := coalesce(v_img, v_prod.image_url, '');
    v_title := coalesce(v_title, left(trim(concat_ws(' ', v_prod.name, v_prod.brand)), 40));
    if char_length(v_title) < 6 then v_title := rpad(v_title, 6, ' '); end if;
    select coalesce(array_agg(distinct k), '{}') into v_kw from (
      select lower(left(trim(x), 30)) k from jsonb_array_elements_text(case when jsonb_typeof(p->'keywords') = 'array' then p->'keywords' else '[]' end) x
       where trim(x) <> '' limit 8) z;
  elsif v_img is null then raise exception 'Envie a imagem do anúncio.';
  end if;
  insert into ad_campaigns (supermarket_id, slot, plan_id, title, teaser, body, image_url, cta, target_type, target_value, starts_at, ends_at, price, keywords)
  values (v_m, v_slot.key, v_plan.id, v_title, nullif(trim(p->>'teaser'), ''), nullif(trim(p->>'body'), ''), v_img,
          coalesce(nullif(trim(p->>'cta'), ''), 'Ver oferta'),
          case when v_slot.smart then 'product' else coalesce(nullif(p->>'target_type', ''), 'none') end,
          case when v_slot.smart then v_pid::text else nullif(p->>'target_value', '') end,
          v_start, v_end, round(v_plan.price * v_slot.multiplier), v_kw)
  returning * into r;
  return to_jsonb(r);
end $$;

-- Anúncios no ar (agora com o produto, o preço dele no mercado e as palavras-chave)
drop function if exists public.ads_live();
create or replace function public.ads_live()
returns table (id bigint, slot text, title text, teaser text, body text, image_url text, cta text,
               target_type text, target_value text, supermarket_id smallint, market text, ends_at timestamptz,
               smart boolean, keywords text[], product_id int, category_slug text, price numeric)
language sql stable security definer set search_path = public as $$
  select c.id, c.slot, c.title, c.teaser, c.body, c.image_url, c.cta, c.target_type, c.target_value,
         c.supermarket_id, s.name, c.ends_at, sl.smart, c.keywords,
         case when c.target_type = 'product' then nullif(c.target_value, '')::int end,
         ca.slug,
         (select (e->>'price')::numeric from v_products v, jsonb_array_elements(v.prices) e
           where c.target_type = 'product' and v.id = nullif(c.target_value, '')::int and (e->>'market_id')::smallint = c.supermarket_id limit 1)
  from ad_campaigns c join supermarkets s on s.id = c.supermarket_id join ad_slots sl on sl.key = c.slot
  left join products pr on c.target_type = 'product' and pr.id = nullif(c.target_value, '')::int
  left join categories ca on ca.id = pr.category_id
  where setting_on('ads_enabled') and c.status = 'aprovada' and c.paid and s.active and sl.active
    and now() between c.starts_at and c.ends_at
$$;
grant execute on function public.ads_live() to anon, authenticated;

-- Campanhas do mercado: + quantas vezes o produto foi para a lista a partir do anúncio
create or replace function public.market_ads(p_market smallint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_market_member(p_market) then raise exception 'Sem permissão para este supermercado.'; end if;
  return coalesce((select jsonb_agg(x order by x.starts_at desc) from (
    select c.*, pl.name plan_name, sl.name slot_name, sl.smart,
      (select name from products where c.target_type = 'product' and id = nullif(c.target_value, '')::int) product_name,
      (select count(*) from events e where e.ad_id = c.id and e.kind = 'ad_view') views,
      (select count(*) from events e where e.ad_id = c.id and e.kind = 'ad_reveal') reveals,
      (select count(*) from events e where e.ad_id = c.id and e.kind = 'ad_click') clicks,
      (select count(*) from events e where e.ad_id = c.id and e.kind = 'add') adds
    from ad_campaigns c left join ad_plans pl on pl.id = c.plan_id left join ad_slots sl on sl.key = c.slot
    where c.supermarket_id = p_market) x), '[]');
end $$;
revoke all on function public.market_ad_request(jsonb) from public, anon;
revoke all on function public.market_ads(smallint) from public, anon;
grant execute on function public.market_ad_request(jsonb) to authenticated;
grant execute on function public.market_ads(smallint) to authenticated;

-- saúde do banco confere esta atualização
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
    ('Promoção por unidade e mapa no portal', 'func', 'public.market_save_store(jsonb)'),
    ('Parceiros: vendas comprovadas, cubra a diferença, demanda e queima', 'col', 'supermarkets.brand_primary'),
    ('Parceiros: vendas comprovadas, cubra a diferença, demanda e queima', 'func', 'public.market_sales_proof(smallint,integer,integer)'),
    ('Parceiros: vendas comprovadas, cubra a diferença, demanda e queima', 'table', 'public.cover_coupons'),
    ('Parceiros: vendas comprovadas, cubra a diferença, demanda e queima', 'func', 'public.market_demand(smallint,integer)'),
    ('Parceiros: vendas comprovadas, cubra a diferença, demanda e queima', 'table', 'public.market_clearance'),
    ('Parceiros: vendas comprovadas, cubra a diferença, demanda e queima', 'func', 'public.tg_clearance_collect(timestamptz)'),
    ('Publicidade inteligente (busca, troca, hora de repor)', 'col', 'ad_campaigns.keywords'),
    ('Publicidade inteligente (busca, troca, hora de repor)', 'col', 'ad_slots.smart')
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


-- #####################################################################
-- (incluído de atualizacao-2026-10-dono-mercado.sql)
-- #####################################################################
-- =====================================================================
--  Tá Barato Mesmo? — O que o dono do supermercado quer ver (outubro/2026)
--   1. Resumo da semana no Telegram (@corp_tabaratomesmo_bot) e por e-mail, toda segunda
--   2. Radar da concorrência: aviso na hora quando outro mercado baixa um preço seu, com "Igualar"
--   3. Página da rede para o consumidor com os diferenciais (açougue, entrega, estacionamento…)
--   4. "Não achei na loja": o cliente avisa e o gerente da unidade fica sabendo
--   5. Comparar as lojas da rede entre si
--  Rode uma vez no Supabase › SQL Editor (pode rodar de novo sem problema).
-- =====================================================================

-- chamada feita pelas funções do Supabase com a chave de serviço (robô, agendamentos)
create or replace function public._is_service()
returns boolean language sql stable as $$
  select coalesce(coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                           (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')) = 'service_role', false)
$$;

-- ---------------------------------------------------------------------
-- 3. DIFERENCIAIS DA REDE (página pública e relatório do rancho)
-- ---------------------------------------------------------------------
alter table public.supermarkets add column if not exists services text[] not null default '{}';
alter table public.supermarkets add column if not exists about text;
alter table public.supermarkets add column if not exists whatsapp text;

create or replace function public.market_set_profile(p_market smallint, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ok constant text[] := array['acougue','padaria','peixaria','hortifruti','estacionamento','entrega','retirada','vale','cartao_loja',
  'pix','farmacia','climatizado','acessivel','24h','caixa_rapido','wifi'];
  v_sv text[]; x jsonb; r supermarkets; v_wa text;
begin
  if not (is_market_member(p_market) or is_master()) then raise exception 'Sem permissão para este supermercado.'; end if;
  select coalesce(array_agg(distinct s), '{}') into v_sv
    from jsonb_array_elements_text(case when jsonb_typeof(p->'services') = 'array' then p->'services' else '[]' end) s where s = any(ok);
  v_wa := nullif(regexp_replace(coalesce(p->>'whatsapp', ''), '\D', '', 'g'), '');
  if v_wa is not null and length(v_wa) not between 10 and 13 then raise exception 'WhatsApp inválido: use DDD + número.'; end if;
  update supermarkets set services = v_sv, about = nullif(left(trim(p->>'about'), 280), ''), whatsapp = v_wa
   where id = p_market returning * into r;
  -- horários de cada loja: [{ "store_id": 1, "opening_hours": "Seg a sáb 7h–22h" }]
  for x in select * from jsonb_array_elements(case when jsonb_typeof(p->'hours') = 'array' then p->'hours' else '[]' end) loop
    update stores set opening_hours = nullif(left(trim(x->>'opening_hours'), 120), '')
     where id = (x->>'store_id')::int and supermarket_id = p_market;
  end loop;
  return jsonb_build_object('services', r.services, 'about', r.about, 'whatsapp', r.whatsapp);
end $$;
revoke all on function public.market_set_profile(smallint, jsonb) from public, anon;
grant execute on function public.market_set_profile(smallint, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 4. "NÃO ACHEI NA LOJA"
-- ---------------------------------------------------------------------
create table if not exists public.missing_reports (
  id             bigserial primary key,
  product_id     int not null references public.products(id) on delete cascade,
  store_id       int not null references public.stores(id) on delete cascade,
  supermarket_id smallint not null references public.supermarkets(id) on delete cascade,
  user_id        uuid references auth.users(id) on delete set null,
  device         text,
  created_at     timestamptz not null default now(),
  notified_at    timestamptz,
  resolved_at    timestamptz,
  resolved_by    uuid
);
create index if not exists missing_reports_store on public.missing_reports (store_id, product_id, created_at);
create index if not exists missing_reports_market on public.missing_reports (supermarket_id, created_at);
alter table public.missing_reports enable row level security;  -- só pelas funções

-- o cliente avisa (com ou sem conta). Devolve quantas pessoas avisaram o mesmo nas últimas 24 h.
create or replace function public.report_missing(p_product int, p_store int, p_device text default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_m smallint; v_dev text := nullif(left(p_device, 40), ''); v_n int;
begin
  if auth.uid() is null and v_dev is null then raise exception 'Não deu para registrar agora.'; end if;
  select supermarket_id into v_m from stores where id = p_store;
  if v_m is null then raise exception 'Loja não encontrada.'; end if;
  if not exists (select 1 from products where id = p_product and active) then raise exception 'Produto não encontrado.'; end if;
  -- freio: 8 avisos por dia por pessoa/aparelho; o mesmo produto na mesma loja conta uma vez a cada 12 h
  if (select count(*) from missing_reports where created_at > now() - interval '1 day'
        and ((auth.uid() is not null and user_id = auth.uid()) or (v_dev is not null and device = v_dev))) >= 8 then
    raise exception 'Você já mandou muitos avisos hoje. Obrigado pela ajuda!';
  end if;
  if not exists (select 1 from missing_reports where product_id = p_product and store_id = p_store and created_at > now() - interval '12 hours'
                   and ((auth.uid() is not null and user_id = auth.uid()) or (v_dev is not null and device = v_dev))) then
    insert into missing_reports (product_id, store_id, supermarket_id, user_id, device) values (p_product, p_store, v_m, auth.uid(), v_dev);
  end if;
  select count(*) into v_n from missing_reports where product_id = p_product and store_id = p_store
     and resolved_at is null and created_at > now() - interval '1 day';
  return v_n;
end $$;
grant execute on function public.report_missing(int, int, text) to anon, authenticated;

-- portal: avisos agrupados por loja e produto
create or replace function public.market_missing(p_market smallint, p_days int default 14)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_market_member(p_market) or is_master()) then raise exception 'Sem permissão para este supermercado.'; end if;
  return coalesce((select jsonb_agg(x order by x.open desc, x.last desc) from (
    select r.store_id, st.name store_name, st.neighborhood, r.product_id, p.name product_name, p.brand, p.unit, p.emoji, p.image_url,
           count(*) n, count(*) filter (where r.resolved_at is null) open, max(r.created_at) last, min(r.created_at) first,
           max(r.resolved_at) resolved_at
      from missing_reports r join stores st on st.id = r.store_id join products p on p.id = r.product_id
     where r.supermarket_id = p_market and r.created_at > now() - make_interval(days => greatest(1, least(p_days, 90)))
     group by r.store_id, st.name, st.neighborhood, r.product_id, p.name, p.brand, p.unit, p.emoji, p.image_url
     limit 200) x), '[]');
end $$;
create or replace function public.market_missing_resolve(p_market smallint, p_store int, p_product int)
returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if not is_market_member(p_market) then raise exception 'Sem permissão para este supermercado.'; end if;
  update missing_reports set resolved_at = now(), resolved_by = auth.uid()
   where supermarket_id = p_market and store_id = p_store and product_id = p_product and resolved_at is null;
  get diagnostics v = row_count;
  return v;
end $$;
revoke all on function public.market_missing(smallint, int) from public, anon;
revoke all on function public.market_missing_resolve(smallint, int, int) from public, anon;
grant execute on function public.market_missing(smallint, int) to authenticated;
grant execute on function public.market_missing_resolve(smallint, int, int) to authenticated;

-- ---------------------------------------------------------------------
-- ROBÔ DOS SUPERMERCADOS (@corp_tabaratomesmo_bot): quem recebe o quê
-- ---------------------------------------------------------------------
create table if not exists public.corp_link_codes (
  code           text primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  supermarket_id smallint not null references public.supermarkets(id) on delete cascade,
  expires_at     timestamptz not null
);
create table if not exists public.corp_contacts (
  chat_id        bigint not null,
  supermarket_id smallint not null references public.supermarkets(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  first_name     text,
  weekly         boolean not null default true,   -- resumo da semana (segunda, 8h)
  radar          boolean not null default true,   -- concorrente baixou preço
  missing        boolean not null default true,   -- cliente não achou produto na loja
  linked_at      timestamptz not null default now(),
  primary key (chat_id, supermarket_id)
);
create table if not exists public.corp_emails (
  supermarket_id smallint not null references public.supermarkets(id) on delete cascade,
  email          text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  primary key (supermarket_id, email)
);
create table if not exists public.corp_digest_log (
  supermarket_id smallint not null references public.supermarkets(id) on delete cascade,
  week           date not null,          -- segunda-feira da semana enviada ('1970-01-01' = pedido "enviar agora")
  sent_at        timestamptz,
  requested_by   uuid,
  primary key (supermarket_id, week)
);
alter table public.corp_link_codes enable row level security;
alter table public.corp_contacts enable row level security;
alter table public.corp_emails enable row level security;
alter table public.corp_digest_log enable row level security;

-- o portal gera o código e abre t.me/corp_tabaratomesmo_bot?start=<código>
create or replace function public.market_corp_link_code(p_market smallint)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text; b bytea; i int; letters constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
begin
  if not is_market_member(p_market) then raise exception 'Sem permissão para este supermercado.'; end if;
  delete from corp_link_codes where user_id = auth.uid() or expires_at < now() - interval '1 day';
  loop
    b := uuid_send(gen_random_uuid()); v_code := '';
    for i in 0..2 loop v_code := v_code || substr(letters, 1 + get_byte(b, i) % 24, 1); end loop;
    v_code := v_code || lpad((((get_byte(b, 3) << 8) | get_byte(b, 4)) % 1000)::text, 3, '0');
    exit when not exists (select 1 from corp_link_codes where code = v_code);
  end loop;
  insert into corp_link_codes (code, user_id, supermarket_id, expires_at) values (v_code, auth.uid(), p_market, now() + interval '30 minutes');
  return v_code;
end $$;

-- portal: quem recebe (Telegram e e-mail) e as preferências
create or replace function public.market_corp_get(p_market smallint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_market_member(p_market) or is_master()) then raise exception 'Sem permissão para este supermercado.'; end if;
  return jsonb_build_object(
    'telegram', coalesce((select jsonb_agg(jsonb_build_object('chat_id', c.chat_id, 'first_name', c.first_name, 'email', u.email, 'mine', c.user_id = auth.uid(),
                  'weekly', c.weekly, 'radar', c.radar, 'missing', c.missing, 'linked_at', c.linked_at) order by c.linked_at)
                from corp_contacts c left join auth.users u on u.id = c.user_id where c.supermarket_id = p_market), '[]'),
    'emails', coalesce((select jsonb_agg(email order by created_at) from corp_emails where supermarket_id = p_market), '[]'),
    'last_sent', (select max(sent_at) from corp_digest_log where supermarket_id = p_market),
    'pending_now', exists (select 1 from corp_digest_log where supermarket_id = p_market and week = '1970-01-01' and sent_at is null));
end $$;
create or replace function public.market_corp_set(p_market smallint, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(p->>'email'));
begin
  if not is_market_member(p_market) then raise exception 'Sem permissão para este supermercado.'; end if;
  if p ? 'chat_id' then
    update corp_contacts set weekly = coalesce((p->>'weekly')::boolean, weekly), radar = coalesce((p->>'radar')::boolean, radar),
           missing = coalesce((p->>'missing')::boolean, missing)
     where supermarket_id = p_market and chat_id = (p->>'chat_id')::bigint;
    if (p->>'remove')::boolean then delete from corp_contacts where supermarket_id = p_market and chat_id = (p->>'chat_id')::bigint; end if;
  end if;
  if v_email is not null and v_email <> '' then
    if (p->>'remove')::boolean then delete from corp_emails where supermarket_id = p_market and email = v_email;
    else
      if (select count(*) from corp_emails where supermarket_id = p_market) >= 10 then raise exception 'No máximo 10 e-mails por supermercado.'; end if;
      insert into corp_emails (supermarket_id, email) values (p_market, v_email) on conflict do nothing;
    end if;
  end if;
  if (p->>'send_now')::boolean then
    insert into corp_digest_log (supermarket_id, week, requested_by) values (p_market, '1970-01-01', auth.uid())
    on conflict (supermarket_id, week) do update set sent_at = null, requested_by = auth.uid();
  end if;
end $$;
revoke all on function public.market_corp_link_code(smallint) from public, anon;
revoke all on function public.market_corp_get(smallint) from public, anon;
revoke all on function public.market_corp_set(smallint, jsonb) from public, anon;
grant execute on function public.market_corp_link_code(smallint) to authenticated;
grant execute on function public.market_corp_get(smallint) to authenticated;
grant execute on function public.market_corp_set(smallint, jsonb) to authenticated;

-- robô (chave de serviço): liga o Telegram com o código do portal
create or replace function public.corp_link_consume(p_code text, p_chat bigint, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c corp_link_codes; v_name text;
begin
  select * into c from corp_link_codes where code = upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g')) and expires_at > now();
  if not found then return null; end if;
  if not exists (select 1 from market_members where user_id = c.user_id and supermarket_id = c.supermarket_id and not suspended) then return null; end if;
  insert into corp_contacts (chat_id, supermarket_id, user_id, first_name) values (p_chat, c.supermarket_id, c.user_id, left(p_name, 60))
  on conflict (chat_id, supermarket_id) do update set user_id = excluded.user_id, first_name = excluded.first_name, linked_at = now();
  delete from corp_link_codes where code = c.code;
  select name into v_name from supermarkets where id = c.supermarket_id;
  return jsonb_build_object('supermarket_id', c.supermarket_id, 'market', v_name);
end $$;
-- contatos que ainda valem (acesso ativo ao portal)
create or replace function public.corp_chats(p_market smallint, p_kind text)
returns table (chat_id bigint, user_id uuid, role text) language sql stable security definer set search_path = public as $$
  select c.chat_id, c.user_id, m.role from corp_contacts c
    join market_members m on m.user_id = c.user_id and m.supermarket_id = c.supermarket_id and not m.suspended
    join supermarkets s on s.id = c.supermarket_id and s.active and s.portal_enabled
   where c.supermarket_id = p_market
     and case p_kind when 'weekly' then c.weekly when 'radar' then c.radar when 'missing' then c.missing else true end
$$;
revoke all on function public.corp_link_consume(text, bigint, text) from public, anon, authenticated;
revoke all on function public.corp_chats(smallint, text) from public, anon, authenticated;
grant execute on function public.corp_link_consume(text, bigint, text) to service_role;
grant execute on function public.corp_chats(smallint, text) to service_role;

-- ---------------------------------------------------------------------
-- 2. RADAR DA CONCORRÊNCIA
-- Um concorrente baixou o preço de um produto que você vende e agora está mais barato que você:
-- aviso no robô (com "Igualar"), no portal e no resumo da semana.
-- ---------------------------------------------------------------------
create table if not exists public.radar_alerts (
  id             bigserial primary key,
  supermarket_id smallint not null references public.supermarkets(id) on delete cascade,   -- quem recebe
  product_id     int not null references public.products(id) on delete cascade,
  competitor     smallint not null references public.supermarkets(id) on delete cascade,
  comp_price     numeric(10,2) not null,
  comp_prev      numeric(10,2),
  my_price       numeric(10,2) not null,
  lists          int not null default 0,      -- listas abertas com o produto
  near           text[] not null default '{}', -- suas lojas a até 3 km de uma loja do concorrente
  created_at     timestamptz not null default now(),
  notified_at    timestamptz,
  matched_at     timestamptz,
  matched_by     uuid,
  unique (supermarket_id, product_id, competitor, comp_price)
);
create index if not exists radar_alerts_market on public.radar_alerts (supermarket_id, created_at);
alter table public.radar_alerts enable row level security;

create table if not exists public.market_radar_settings (
  supermarket_id smallint primary key references public.supermarkets(id) on delete cascade,
  min_diff       numeric(6,2) not null default 0.10 check (min_diff >= 0),   -- só avisa se ficou pelo menos R$ X mais caro
  min_lists      int not null default 0 check (min_lists >= 0),               -- só produtos em X listas ou mais
  updated_at     timestamptz not null default now()
);
alter table public.market_radar_settings enable row level security;

-- procura quedas de preço recentes (chamada pelo agendamento a cada 15 min; também roda no portal)
create or replace function public.radar_scan(p_since interval default interval '3 hours')
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  for r in
    with recent as (   -- último preço novo de cada produto/mercado no período
      select distinct on (pr.product_id, pr.supermarket_id) pr.product_id, pr.supermarket_id comp, pr.price, pr.collected_at
        from prices pr where pr.collected_at >= now() - p_since order by pr.product_id, pr.supermarket_id, pr.collected_at desc),
    drops as (
      select rc.*, (select p2.price from prices p2 where p2.product_id = rc.product_id and p2.supermarket_id = rc.comp
                     and p2.collected_at < rc.collected_at order by p2.collected_at desc limit 1) prev
        from recent rc),
    mine as (   -- preço de agora de cada parceiro que vende o produto
      select d.*, me.mid, me.my_price from drops d
      cross join lateral (select (e->>'market_id')::smallint mid, (e->>'price')::numeric my_price
                            from v_products v, jsonb_array_elements(v.prices) e where v.id = d.product_id) me
       where me.mid <> d.comp and d.prev is not null and d.price < d.prev and d.price < me.my_price)
    select mi.*, coalesce(st.min_diff, 0.10) min_diff, coalesce(st.min_lists, 0) min_lists from mine mi
      left join market_radar_settings st on st.supermarket_id = mi.mid
     where is_partner_market(mi.mid)
  loop
    continue when r.my_price - r.price < r.min_diff;
    -- a concorrência no preço novo ainda é a de agora (o concorrente pode ter subido de novo)
    continue when not exists (select 1 from v_products v, jsonb_array_elements(v.prices) e
                               where v.id = r.product_id and (e->>'market_id')::smallint = r.comp and (e->>'price')::numeric = r.price);
    insert into radar_alerts (supermarket_id, product_id, competitor, comp_price, comp_prev, my_price, lists, near)
    select r.mid, r.product_id, r.comp, r.price, r.prev, r.my_price,
           (select count(*) from user_state us, jsonb_array_elements(case when jsonb_typeof(us.value) = 'array' then us.value else '[]' end) x
             where us.key = 'tb.list' and us.updated_at > now() - interval '21 days' and jsonb_typeof(x) = 'array' and (x->>0) ~ '^\d+$' and (x->>0)::int = r.product_id)
           + (select count(*) from shared_lists s, jsonb_array_elements(case when jsonb_typeof(s.items) = 'array' then s.items else '[]' end) x
               where s.updated_at > now() - interval '21 days' and (x->>'product_id') ~ '^\d+$' and (x->>'product_id')::int = r.product_id),
           coalesce((select array_agg(distinct coalesce(nullif(a.neighborhood, ''), a.name)) from stores a
                      where a.supermarket_id = r.mid and exists (select 1 from stores b where b.supermarket_id = r.comp and _km(a.lat, a.lng, b.lat, b.lng) <= 3)), '{}')
    on conflict do nothing;
    if found then n := n + 1; end if;
  end loop;
  delete from radar_alerts a where a.lists < coalesce((select min_lists from market_radar_settings s where s.supermarket_id = a.supermarket_id), 0)
     and a.notified_at is null and a.created_at > now() - interval '1 hour';
  return n;
end $$;

-- robô: alertas novos para mandar (com os contatos de cada mercado); marca como avisados
create or replace function public.radar_collect()
returns jsonb language plpgsql security definer set search_path = public as $$
declare out jsonb;
begin
  with pick as (
    select a.* from radar_alerts a where a.notified_at is null and a.created_at > now() - interval '1 day' order by a.lists desc limit 200),
  upd as (update radar_alerts set notified_at = now() where id in (select id from pick) returning id)
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'supermarket_id', p.supermarket_id, 'market', me.name, 'competitor', c.name,
           'product_id', p.product_id, 'product', concat_ws(' ', pr.name, pr.brand, pr.unit), 'comp_price', p.comp_price, 'comp_prev', p.comp_prev,
           'my_price', p.my_price, 'lists', p.lists, 'near', p.near,
           'chats', (select coalesce(jsonb_agg(chat_id), '[]') from corp_chats(p.supermarket_id, 'radar')))), '[]')
    into out
    from pick p join supermarkets me on me.id = p.supermarket_id join supermarkets c on c.id = p.competitor join products pr on pr.id = p.product_id;
  return out;
end $$;

-- botão "Igualar" no robô: confere quem tocou e grava o preço do mercado
create or replace function public.corp_match_price(p_chat bigint, p_alert bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a radar_alerts; c record; v_name text;
begin
  select * into a from radar_alerts where id = p_alert;
  if not found then raise exception 'Alerta não encontrado.'; end if;
  select * into c from corp_chats(a.supermarket_id, null) x where x.chat_id = p_chat limit 1;
  if not found then raise exception 'Este Telegram não está ligado ao portal deste supermercado.'; end if;
  if a.matched_at is not null then return jsonb_build_object('already', true, 'price', a.comp_price); end if;
  insert into prices (product_id, supermarket_id, price, source) values (a.product_id, a.supermarket_id, a.comp_price, 'mercado');
  update radar_alerts set matched_at = now(), matched_by = c.user_id where id = p_alert;
  select concat_ws(' ', name, brand, unit) into v_name from products where id = a.product_id;
  return jsonb_build_object('price', a.comp_price, 'product', v_name);
end $$;
revoke all on function public.radar_scan(interval) from public, anon, authenticated;
revoke all on function public.radar_collect() from public, anon, authenticated;
revoke all on function public.corp_match_price(bigint, bigint) from public, anon, authenticated;
grant execute on function public.radar_scan(interval) to service_role;
grant execute on function public.radar_collect() to service_role;
grant execute on function public.corp_match_price(bigint, bigint) to service_role;

-- portal: alertas e regras
create or replace function public.market_radar(p_market smallint, p_days int default 14)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_market_member(p_market) or is_master()) then raise exception 'Sem permissão para este supermercado.'; end if;
  return jsonb_build_object(
    'settings', coalesce((select to_jsonb(s) from market_radar_settings s where s.supermarket_id = p_market), jsonb_build_object('min_diff', 0.10, 'min_lists', 0)),
    'alerts', coalesce((select jsonb_agg(x order by x.matched_at is not null, x.created_at desc) from (
      select a.*, c.name competitor_name, pr.name product_name, pr.brand, pr.unit, pr.emoji, pr.image_url,
             (select (e->>'price')::numeric from v_products v, jsonb_array_elements(v.prices) e where v.id = a.product_id and (e->>'market_id')::smallint = p_market) my_now,
             (select (e->>'price')::numeric from v_products v, jsonb_array_elements(v.prices) e where v.id = a.product_id and (e->>'market_id')::smallint = a.competitor) comp_now
        from radar_alerts a join supermarkets c on c.id = a.competitor join products pr on pr.id = a.product_id
       where a.supermarket_id = p_market and a.created_at > now() - make_interval(days => greatest(1, least(p_days, 60)))
       order by a.created_at desc limit 100) x), '[]'));
end $$;
create or replace function public.market_radar_set(p_market smallint, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_market_member(p_market) then raise exception 'Sem permissão para este supermercado.'; end if;
  if p ? 'matched' then
    update radar_alerts set matched_at = now(), matched_by = auth.uid() where id = (p->>'matched')::bigint and supermarket_id = p_market;
    return;
  end if;
  insert into market_radar_settings (supermarket_id, min_diff, min_lists, updated_at)
  values (p_market, greatest(0, coalesce((p->>'min_diff')::numeric, 0.10)), greatest(0, coalesce((p->>'min_lists')::int, 0)), now())
  on conflict (supermarket_id) do update set min_diff = excluded.min_diff, min_lists = excluded.min_lists, updated_at = now();
end $$;
revoke all on function public.market_radar(smallint, int) from public, anon;
revoke all on function public.market_radar_set(smallint, jsonb) from public, anon;
grant execute on function public.market_radar(smallint, int) to authenticated;
grant execute on function public.market_radar_set(smallint, jsonb) to authenticated;

-- robô: avisos de falta ainda não mandados, agrupados por loja e produto
create or replace function public.missing_collect()
returns jsonb language plpgsql security definer set search_path = public as $$
declare out jsonb;
begin
  with g as (
    select r.supermarket_id, r.store_id, r.product_id, count(*) n, array_agg(r.id) ids
      from missing_reports r where r.notified_at is null and r.resolved_at is null and r.created_at > now() - interval '1 day'
     group by r.supermarket_id, r.store_id, r.product_id),
  upd as (update missing_reports set notified_at = now() where id in (select unnest(ids) from g) returning id)
  select coalesce(jsonb_agg(jsonb_build_object('supermarket_id', g.supermarket_id, 'store', st.name, 'neighborhood', st.neighborhood,
           'store_id', g.store_id, 'product_id', g.product_id, 'product', concat_ws(' ', p.name, p.brand, p.unit), 'n', g.n,
           'total24', (select count(*) from missing_reports x where x.store_id = g.store_id and x.product_id = g.product_id and x.resolved_at is null and x.created_at > now() - interval '1 day'),
           'chats', (select coalesce(jsonb_agg(chat_id), '[]') from corp_chats(g.supermarket_id, 'missing')))), '[]')
    into out from g join stores st on st.id = g.store_id join products p on p.id = g.product_id;
  return out;
end $$;
create or replace function public.corp_resolve_missing(p_chat bigint, p_store int, p_product int)
returns int language plpgsql security definer set search_path = public as $$
declare v_m smallint; v int;
begin
  select supermarket_id into v_m from stores where id = p_store;
  if not exists (select 1 from corp_chats(v_m, null) x where x.chat_id = p_chat) then raise exception 'Sem permissão.'; end if;
  update missing_reports set resolved_at = now() where store_id = p_store and product_id = p_product and resolved_at is null;
  get diagnostics v = row_count; return v;
end $$;
revoke all on function public.missing_collect() from public, anon, authenticated;
revoke all on function public.corp_resolve_missing(bigint, int, int) from public, anon, authenticated;
grant execute on function public.missing_collect() to service_role;
grant execute on function public.corp_resolve_missing(bigint, int, int) to service_role;

-- ---------------------------------------------------------------------
-- 5. COMPARAR AS LOJAS DA REDE
-- ---------------------------------------------------------------------
create or replace function public.market_stores_compare(p_market smallint, p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_from timestamptz := now() - make_interval(days => greatest(1, least(p_days, 180)));
begin
  if not (is_market_member(p_market) or is_master()) then raise exception 'Sem permissão para este supermercado.'; end if;
  return coalesce((select jsonb_agg(x order by x.visits + x.receipts desc) from (
    select st.id, st.name, st.neighborhood,
      (select count(distinct coalesce(e.user_id::text, e.device_id, e.session_id)) from events e where e.kind = 'store_visit' and e.store_id = st.id and e.created_at >= v_from) visits,
      (select count(*) from receipts r where r.store_id = st.id and r.market_confirmed and r.issued_at >= v_from) receipts,
      (select coalesce(sum(total), 0) from receipts r where r.store_id = st.id and r.market_confirmed and r.issued_at >= v_from) revenue,
      (select count(*) from missing_reports m where m.store_id = st.id and m.resolved_at is null and m.created_at >= v_from) missing,
      (select count(*) from promotions pm where pm.store_id = st.id and pm.active and now() between pm.starts_at and pm.ends_at) promos,
      -- ranchos de quem mora mais perto desta loja (entre as lojas da rede): ganhos e para quem perdeu
      rk.won, rk.lost, rk.lost_to,
      (select coalesce(jsonb_agg(jsonb_build_object('name', b.nb, 'n', b.n) order by b.n desc), '[]') from (
         select e.neighborhood nb, count(distinct coalesce(e.user_id::text, e.device_id, e.session_id)) n from events e
          where e.kind = 'store_visit' and e.store_id = st.id and e.created_at >= v_from and coalesce(e.neighborhood, '') <> ''
          group by e.neighborhood order by n desc limit 5) b) bairros
    from stores st
    cross join lateral (
      with mine as (
        select l.best_market from shopping_lists l join profiles pf on pf.id = l.user_id
         where l.status = 'concluida' and l.completed_at >= v_from and l.best_market is not null and pf.home_lat is not null
           and st.id = (select s2.id from stores s2 where s2.supermarket_id = p_market order by _km(pf.home_lat, pf.home_lng, s2.lat, s2.lng) limit 1)
           and _km(pf.home_lat, pf.home_lng, st.lat, st.lng) <= 8)
      select count(*) filter (where best_market = p_market) won, count(*) filter (where best_market <> p_market) lost,
             coalesce((select jsonb_agg(jsonb_build_object('market', s.name, 'n', z.n) order by z.n desc)
                        from (select best_market, count(*) n from mine where best_market <> p_market group by best_market) z join supermarkets s on s.id = z.best_market), '[]') lost_to
        from mine) rk
    where st.supermarket_id = p_market) x), '[]');
end $$;
revoke all on function public.market_stores_compare(smallint, int) from public, anon;
grant execute on function public.market_stores_compare(smallint, int) to authenticated;

-- o resumo semanal (chave de serviço) também usa o relatório de vendas comprovadas
create or replace function public.market_sales_proof(p_market smallint, p_days int default 30, p_window int default 7)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_from timestamptz := now() - make_interval(days => greatest(1, least(p_days, 365)));
  v_win interval := make_interval(days => greatest(1, least(p_window, 30)));
  out jsonb;
begin
  if not (is_market_member(p_market) or is_master() or _is_service()) then raise exception 'Sem permissão para este supermercado.'; end if;

  create temp table if not exists _tb_ex (user_id uuid, person text, t timestamptz, src text, ref bigint) on commit drop;
  create temp table if not exists _tb_att (receipt_id bigint, user_id uuid, issued_at timestamptz, total numeric, src text, ref bigint, t timestamptz) on commit drop;
  truncate _tb_ex; truncate _tb_att;

  -- contatos com o mercado (com conta ou não: os sem conta só contam como "viram")
  insert into _tb_ex
  select e.user_id, coalesce(e.user_id::text, e.device_id, e.session_id), e.created_at,
         case when e.kind like 'camp_%' then 'campanha'
              when e.kind = 'promo_view' then 'promocao'
              when e.kind = 'route' then 'rota'
              when e.kind like 'ad_%' then 'publicidade'
              when e.kind like 'cover_%' then 'cubra'
              when e.kind like 'clear_%' then 'queima' end,
         case when e.kind like 'camp_%' or e.kind like 'cover_%' or e.kind like 'clear_%' then e.campaign_id
              when e.kind like 'ad_%' then e.ad_id
              when e.kind = 'promo_view' then e.product_id end
    from events e
   where e.created_at >= v_from - v_win
     and e.kind in ('camp_view','camp_click','promo_view','route','ad_view','ad_click','cover_view','cover_accept','clear_view','clear_claim')
     and (e.supermarket_id = p_market
          or (e.kind like 'camp_%' and e.campaign_id in (select id from market_campaigns where supermarket_id = p_market))
          or (e.kind like 'ad_%' and e.ad_id in (select id from ad_campaigns where supermarket_id = p_market)));

  -- cada nota confirmada pelo CNPJ vai para o último contato da mesma pessoa nos N dias antes dela
  insert into _tb_att
  select distinct on (r.id) r.id, r.user_id, r.issued_at, r.total, x.src, x.ref, x.t
    from receipts r join _tb_ex x on x.user_id = r.user_id and x.t <= r.issued_at and x.t >= r.issued_at - v_win
   where r.supermarket_id = p_market and r.market_confirmed and r.issued_at >= v_from and r.total > 0
   order by r.id, x.t desc;

  with ex as (select * from _tb_ex where t >= v_from),
  logged as (select distinct user_id from ex where user_id is not null),
  -- controle: quem usou o site no período com a conta aberta e NÃO teve contato com o mercado
  active as (select distinct e.user_id from events e where e.created_at >= v_from and e.user_id is not null
               and not exists (select 1 from logged l where l.user_id = e.user_id)),
  ctrl_buy as (select count(distinct r.user_id) n from receipts r join active a on a.user_id = r.user_id
                where r.supermarket_id = p_market and r.market_confirmed and r.issued_at >= v_from),
  hide as (select (select count(distinct user_id) from _tb_att) < 3 h),
  by_src as (
    select s.src,
           (select count(distinct person) from ex where ex.src = s.src) people,
           (select count(distinct user_id) from ex where ex.src = s.src and user_id is not null) logged,
           count(distinct a.user_id) buyers, count(a.receipt_id) receipts, coalesce(sum(a.total), 0) revenue
      from (values ('campanha'), ('promocao'), ('rota'), ('publicidade'), ('cubra'), ('queima')) s(src)
      left join _tb_att a on a.src = s.src
     group by s.src),
  camps as (
    select c.id, c.title, c.kind, c.starts_at, c.ends_at,
           (select count(distinct person) from ex where ex.src = 'campanha' and ex.ref = c.id) people,
           (select count(distinct user_id) from ex where ex.src = 'campanha' and ex.ref = c.id and user_id is not null) logged,
           count(distinct a.user_id) buyers, count(a.receipt_id) receipts, coalesce(sum(a.total), 0) revenue
      from market_campaigns c left join _tb_att a on a.src = 'campanha' and a.ref = c.id
     where c.supermarket_id = p_market and c.ends_at >= v_from
     group by c.id order by c.starts_at desc limit 20),
  -- prova direta: a nota tem o produto da promoção pelo preço da promoção
  promo_hits as (
    select pm.id promo_id, pm.kind, pm.code, p.name product, count(distinct r.id) receipts, count(distinct r.user_id) buyers,
           coalesce(sum(ri.qty), 0) units, coalesce(sum(ri.total), 0) value
      from promotions pm join products p on p.id = pm.product_id
      join receipt_items ri on ri.product_id = pm.product_id and ri.unit_price <= pm.promo_price + 0.01
      join receipts r on r.id = ri.receipt_id and r.supermarket_id = p_market and r.market_confirmed
                     and r.issued_at between pm.starts_at and pm.ends_at + interval '1 day'
     where pm.supermarket_id = p_market and pm.ends_at >= v_from
     group by pm.id, p.name order by count(distinct r.id) desc limit 15),
  daily as (
    select (issued_at at time zone 'America/Manaus')::date d, count(*) receipts, sum(total) revenue
      from _tb_att group by 1 order by 1)
  select jsonb_build_object(
    'days', p_days, 'window', p_window, 'hidden', (select h from hide),
    'totals', jsonb_build_object(
      'people', (select count(distinct person) from ex),
      'logged', (select count(*) from logged),
      'buyers', (select count(distinct user_id) from _tb_att),
      'receipts', (select count(*) from _tb_att),
      'revenue', case when (select h from hide) then null else (select coalesce(sum(total), 0) from _tb_att) end,
      'ticket', case when (select h from hide) then null else (select round(avg(total), 2) from _tb_att) end,
      'conv', (select round(100.0 * count(distinct user_id) / nullif((select count(*) from logged), 0), 1) from _tb_att),
      'ctrl_conv', (select round(100.0 * n / nullif((select count(*) from active), 0), 1) from ctrl_buy),
      'all_receipts', (select count(*) from receipts where supermarket_id = p_market and market_confirmed and issued_at >= v_from),
      'all_revenue', (select coalesce(sum(total), 0) from receipts where supermarket_id = p_market and market_confirmed and issued_at >= v_from)),
    'by_source', (select jsonb_agg(jsonb_build_object('src', src, 'people', people, 'logged', logged, 'buyers', buyers, 'receipts', receipts,
                    'revenue', case when buyers < 3 then null else revenue end,
                    'ticket', case when buyers < 3 or receipts = 0 then null else round(revenue / receipts, 2) end) order by revenue desc) from by_src),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'kind', kind, 'starts_at', starts_at, 'ends_at', ends_at,
                    'people', people, 'logged', logged, 'buyers', buyers, 'receipts', receipts,
                    'revenue', case when buyers < 3 then null else revenue end,
                    'ticket', case when buyers < 3 or receipts = 0 then null else round(revenue / receipts, 2) end)) from camps), '[]'),
    'promos', coalesce((select jsonb_agg(jsonb_build_object('promo_id', promo_id, 'kind', kind, 'code', code, 'product', product,
                    'receipts', receipts, 'buyers', buyers, 'units', units, 'value', case when buyers < 3 then null else value end)) from promo_hits), '[]'),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'receipts', receipts,
                    'revenue', case when (select h from hide) then null else revenue end)) from daily), '[]')
  ) into out;
  return out;
end $$;

-- ---------------------------------------------------------------------
-- 1. RESUMO DA SEMANA (robô, e-mail e portal usam o mesmo)
-- ---------------------------------------------------------------------
create or replace function public._brl(v numeric)
returns text language sql immutable as $$
  select 'R$ ' || translate(to_char(round(coalesce(v, 0), 2), 'FM999,999,990.00'), ',.', '.,')
$$;

create or replace function public.market_weekly_digest(p_market smallint, p_days int default 7)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_days int := greatest(1, least(p_days, 31));
  v_from timestamptz := now() - make_interval(days => v_days);
  m supermarkets; p14 jsonb; p7 jsonb; v_clients int; v_visits int; v_ads numeric; v_cover numeric; v_spend numeric;
  v_rev numeric; v_prev numeric; v_lost jsonb; v_won int; v_ranchos int; v_miss jsonb; v_radar jsonb; v_pos jsonb; out jsonb; t text;
  x jsonb;
begin
  if not (is_market_member(p_market) or is_master() or _is_service()) then raise exception 'Sem permissão para este supermercado.'; end if;
  select * into m from supermarkets where id = p_market;
  p14 := market_sales_proof(p_market, v_days * 2, 7);
  p7 := market_sales_proof(p_market, v_days, 7);   -- deixa as notas atribuídas em _tb_att
  v_rev := nullif(p7->'totals'->>'revenue', '')::numeric;
  v_prev := case when v_rev is null or (p14->'totals'->>'revenue') is null then null else (p14->'totals'->>'revenue')::numeric - v_rev end;

  -- clientes que vieram pelo site: chegaram numa loja com o site aberto ou mandaram nota depois de ver algo do mercado
  select count(distinct coalesce(e.user_id::text, e.device_id, e.session_id)) into v_visits
    from events e where e.kind = 'store_visit' and e.supermarket_id = p_market and e.created_at >= v_from;
  select count(*) into v_clients from (
    select coalesce(e.user_id::text, e.device_id, e.session_id) who from events e where e.kind = 'store_visit' and e.supermarket_id = p_market and e.created_at >= v_from
    union select user_id::text from _tb_att) z where who is not null;

  -- quanto o mercado gastou: anúncios (proporcional ao tempo no ar na semana) e cupons usados
  select coalesce(sum(price * extract(epoch from (least(ends_at, now()) - greatest(starts_at, v_from))) / nullif(extract(epoch from (ends_at - starts_at)), 0)), 0)
    into v_ads from ad_campaigns where supermarket_id = p_market and paid and status = 'aprovada' and starts_at < now() and ends_at > v_from;
  select coalesce(sum(value), 0) into v_cover from cover_coupons where supermarket_id = p_market and status = 'usado' and used_at >= v_from;
  v_spend := round(v_ads + v_cover, 2);

  -- ranchos: ganhos e perdidos (e por quais produtos), com os preços de hoje
  select count(*) filter (where e.supermarket_id = p_market), count(*) into v_won, v_ranchos
    from events e where e.kind = 'rancho_done' and e.created_at >= v_from;
  with lost as (
    select l.id, l.best_market from shopping_lists l
     where l.status = 'concluida' and l.completed_at >= v_from and l.best_market is not null and l.best_market <> p_market),
  it as (
    select lo.id, lo.best_market, i.product_id, i.qty,
           (select (e->>'price')::numeric from v_products v, jsonb_array_elements(v.prices) e where v.id = i.product_id and (e->>'market_id')::smallint = p_market) mine,
           (select (e->>'price')::numeric from v_products v, jsonb_array_elements(v.prices) e where v.id = i.product_id and (e->>'market_id')::smallint = lo.best_market) theirs
      from lost lo join shopping_list_items i on i.list_id = lo.id),
  per_list as (select id, best_market, sum(mine * qty) filter (where mine is not null and theirs is not null) my_t,
                      sum(theirs * qty) filter (where mine is not null and theirs is not null) their_t from it group by id, best_market),
  close as (select * from per_list where my_t is not null and my_t > their_t and my_t <= their_t * 1.10),   -- perdeu por pouco (até 10% mais caro)
  why as (select it.best_market, p.name, count(*) n, sum((it.mine - it.theirs) * it.qty) d
            from it join close c on c.id = it.id join products p on p.id = it.product_id
           where it.mine > it.theirs group by it.best_market, p.name)
  select coalesce(jsonb_agg(jsonb_build_object('market_id', g.best_market, 'market', s.name, 'n', g.n, 'diff', round(g.d, 2),
           'products', (select coalesce(jsonb_agg(w.name order by w.n desc, w.d desc), '[]') from (select * from why where why.best_market = g.best_market order by n desc, d desc limit 2) w))
           order by g.n desc), '[]')
    into v_lost
    from (select best_market, count(*) n, sum(my_t - their_t) d from close group by best_market) g join supermarkets s on s.id = g.best_market;

  -- não acharam na loja e radar
  select jsonb_build_object('n', count(*), 'open', count(*) filter (where resolved_at is null),
           'top', coalesce((select jsonb_agg(z.name) from (select p.name, count(*) c from missing_reports r join products p on p.id = r.product_id
                    where r.supermarket_id = p_market and r.created_at >= v_from group by p.name order by c desc limit 3) z), '[]'))
    into v_miss from missing_reports where supermarket_id = p_market and created_at >= v_from;
  select jsonb_build_object('n', count(*), 'matched', count(*) filter (where matched_at is not null))
    into v_radar from radar_alerts where supermarket_id = p_market and created_at >= v_from;
  -- posição de preço: em quantos dos seus produtos você é o mais barato hoje
  select jsonb_build_object('cheapest', count(*) filter (where (v.prices->0->>'market_id')::smallint = p_market), 'total', count(*))
    into v_pos from v_products v where v.prices @> jsonb_build_array(jsonb_build_object('market_id', p_market));

  out := jsonb_build_object('market', m.name, 'from', v_from, 'to', now(), 'days', v_days,
    'clients', v_clients, 'visits', v_visits, 'buyers', (p7->'totals'->>'buyers')::int, 'receipts', (p7->'totals'->>'receipts')::int,
    'revenue', v_rev, 'prev_revenue', v_prev, 'ticket', nullif(p7->'totals'->>'ticket', '')::numeric,
    'spend', v_spend, 'spend_ads', round(v_ads, 2), 'spend_cover', round(v_cover, 2),
    'roi', case when v_spend > 0 and v_rev is not null then round(v_rev / v_spend, 1) end,
    'ranchos_won', v_won, 'ranchos_total', v_ranchos, 'lost', v_lost, 'missing', v_miss, 'radar', v_radar, 'position', v_pos,
    'hidden', (p7->>'hidden')::boolean);

  -- texto pronto (Telegram/HTML simples)
  t := '📊 <b>' || m.name || ': sua semana no Tá Barato Mesmo?</b>' || E'\n'
    || to_char(v_from at time zone 'America/Manaus', 'DD/MM') || ' a ' || to_char(now() at time zone 'America/Manaus', 'DD/MM') || E'\n\n'
    || '👥 <b>' || v_clients || '</b> clientes vieram pelo site' || case when v_visits > 0 then ' (' || v_visits || ' chegaram na loja com o site aberto)' else '' end || E'\n'
    || case when v_rev is not null then '🧾 <b>' || _brl(v_rev) || '</b> em notas comprovadas (' || coalesce(p7->'totals'->>'receipts', '0') || ' notas'
              || case when v_prev is not null and v_prev > 0 then ', ' || case when v_rev >= v_prev then '+' else '' end || round(100 * (v_rev - v_prev) / v_prev) || '% na semana' else '' end || ')' || E'\n'
            else '🧾 ' || coalesce(p7->'totals'->>'receipts', '0') || ' notas comprovadas (valores aparecem com 3 compradores ou mais)' || E'\n' end
    || case when v_spend > 0 then '💸 Você gastou <b>' || _brl(v_spend) || '</b> em anúncios e cupons'
              || case when v_rev is not null then ': retorno de <b>' || round(v_rev / v_spend) || ' vezes</b>' else '' end || E'\n' else '' end
    || '🛒 ' || v_won || ' ranchos saíram mais baratos no ' || m.name || E'\n';
  for x in select * from jsonb_array_elements(v_lost) loop
    t := t || '⚠️ Você perdeu <b>' || (x->>'n') || ' ' || case when (x->>'n')::int = 1 then 'rancho' else 'ranchos' end || '</b> por pouco para o ' || (x->>'market')
         || case when jsonb_array_length(x->'products') > 0 then ' por causa ' || (select string_agg(case when i = 1 then 'do ' else 'e do ' end || lower(v), ' ')
                                                                     from jsonb_array_elements_text(x->'products') with ordinality a(v, i)) else '' end || E'\n';
  end loop;
  if (v_miss->>'n')::int > 0 then
    t := t || '🔎 ' || (v_miss->>'n') || ' avisos de “não achei na loja”'
         || case when jsonb_array_length(v_miss->'top') > 0 then ': ' || (select string_agg(v, ', ') from jsonb_array_elements_text(v_miss->'top') v) else '' end || E'\n';
  end if;
  if (v_radar->>'n')::int > 0 then t := t || '📡 ' || (v_radar->>'n') || ' alertas de preço da concorrência (' || (v_radar->>'matched') || ' igualados)' || E'\n'; end if;
  t := t || '🏷️ Você é o mais barato em ' || (v_pos->>'cheapest') || ' de ' || (v_pos->>'total') || ' produtos hoje.';
  return out || jsonb_build_object('text', t);
end $$;
revoke all on function public.market_weekly_digest(smallint, int) from public, anon;
grant execute on function public.market_weekly_digest(smallint, int) to authenticated, service_role;

-- quem deve receber o resumo agora (segunda a partir das 8h, ou pedido "enviar agora" do portal)
create or replace function public.corp_digest_due(p_now timestamptz default now())
returns table (supermarket_id smallint, week date, now_request boolean)
language plpgsql security definer set search_path = public as $$
declare v_local timestamp := p_now at time zone 'America/Manaus'; v_week date := (date_trunc('week', p_now at time zone 'America/Manaus'))::date;
begin
  -- pedidos "enviar agora"
  return query select l.supermarket_id, l.week, true from corp_digest_log l where l.week = '1970-01-01' and l.sent_at is null;
  if extract(isodow from v_local) = 1 and extract(hour from v_local) >= 8 then
    return query select s.id, v_week, false from supermarkets s
      where s.active and s.portal_enabled
        and (exists (select 1 from corp_chats(s.id, 'weekly')) or exists (select 1 from corp_emails e where e.supermarket_id = s.id))
        and not exists (select 1 from corp_digest_log l where l.supermarket_id = s.id and l.week = v_week and l.sent_at is not null);
  end if;
end $$;
create or replace function public.corp_digest_done(p_market smallint, p_week date)
returns void language sql security definer set search_path = public as $$
  insert into corp_digest_log (supermarket_id, week, sent_at) values (p_market, p_week, now())
  on conflict (supermarket_id, week) do update set sent_at = now();
$$;
revoke all on function public.corp_digest_due(timestamptz) from public, anon, authenticated;
revoke all on function public.corp_digest_done(smallint, date) from public, anon, authenticated;
grant execute on function public.corp_digest_due(timestamptz) to service_role;
grant execute on function public.corp_digest_done(smallint, date) to service_role;

-- saúde do banco confere esta atualização
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
    ('Promoção por unidade e mapa no portal', 'func', 'public.market_save_store(jsonb)'),
    ('Parceiros: vendas comprovadas, cubra a diferença, demanda e queima', 'col', 'supermarkets.brand_primary'),
    ('Parceiros: vendas comprovadas, cubra a diferença, demanda e queima', 'func', 'public.market_sales_proof(smallint,integer,integer)'),
    ('Parceiros: vendas comprovadas, cubra a diferença, demanda e queima', 'table', 'public.cover_coupons'),
    ('Parceiros: vendas comprovadas, cubra a diferença, demanda e queima', 'func', 'public.market_demand(smallint,integer)'),
    ('Parceiros: vendas comprovadas, cubra a diferença, demanda e queima', 'table', 'public.market_clearance'),
    ('Parceiros: vendas comprovadas, cubra a diferença, demanda e queima', 'func', 'public.tg_clearance_collect(timestamptz)'),
    ('Publicidade inteligente (busca, troca, hora de repor)', 'col', 'ad_campaigns.keywords'),
    ('Publicidade inteligente (busca, troca, hora de repor)', 'col', 'ad_slots.smart'),
    ('Dono do mercado: resumo, radar, diferenciais, faltas, lojas', 'func', 'public.market_weekly_digest(smallint,integer)'),
    ('Dono do mercado: resumo, radar, diferenciais, faltas, lojas', 'table', 'public.radar_alerts'),
    ('Dono do mercado: resumo, radar, diferenciais, faltas, lojas', 'table', 'public.missing_reports'),
    ('Dono do mercado: resumo, radar, diferenciais, faltas, lojas', 'col', 'supermarkets.services'),
    ('Dono do mercado: resumo, radar, diferenciais, faltas, lojas', 'func', 'public.market_stores_compare(smallint,integer)')
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
