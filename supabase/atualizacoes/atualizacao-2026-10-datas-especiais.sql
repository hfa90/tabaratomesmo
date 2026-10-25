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
