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
         product_id, supermarket_id, price, collected_at
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
      'at',        l.collected_at
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
    (abs(hashtext('o' || p.id)) % 1000) / 1000.0                               as shock_on) mk
cross join generate_series(0, 30, 2) as d(n)
where mk.carries < case when m.slug = 'baratao-da-carne' and sd.cat not in ('carnes','mercearia','bebidas')
                        then 0.35 else 0.9 end;

raise notice 'Seed concluído.';
end $seed$;
