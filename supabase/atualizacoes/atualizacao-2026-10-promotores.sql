-- =====================================================================
--  Tá Barato Mesmo? — Área do promotor (promotor.html), outubro/2026
--  • Promotor e supervisor da marca entram com um CÓDIGO DE 6 NÚMEROS (sem e-mail).
--    Quem gera o código é o supermercado (portal › Promotores) ou a administração.
--  • O promotor cadastra os espaços da marca na loja (gôndola, ponta, ilha, geladeira…)
--    e, a cada visita, diz por produto quantos SOBRARAM e quantos COLOCOU.
--  • O sistema calcula o que já saiu da prateleira: vendas do caixa enviadas pelo mercado
--    (planilha diária) e, onde o caixa ainda não chegou, as notas dos clientes do app
--    (mínimo garantido, ajustado pelas contagens anteriores do próprio promotor).
--  • O supervisor da marca vê todos os promotores da marca nas lojas onde tem acesso.
--  Rode uma vez no Supabase › SQL Editor (pode rodar de novo sem problema).
-- =====================================================================

create table if not exists public.promo_brands (
  id         serial primary key,
  name       text not null check (char_length(name) between 2 and 60),
  color      text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now()
);
create unique index if not exists promo_brands_name on public.promo_brands (lower(name));

create table if not exists public.promo_people (
  id             bigserial primary key,
  name           text not null check (char_length(name) between 2 and 80),
  phone          text check (phone is null or char_length(phone) <= 30),
  brand_id       int not null references public.promo_brands(id),
  role           text not null default 'promotor' check (role in ('promotor', 'supervisor')),
  code           text not null unique check (code ~ '^[0-9]{6}$'),
  active         boolean not null default true,
  created_by     uuid default auth.uid(),
  created_market smallint references public.supermarkets(id) on delete set null,
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz
);

-- em quais mercados/lojas a pessoa pode trabalhar (store_id vazio = todas as lojas da rede)
create table if not exists public.promo_access (
  person_id      bigint not null references public.promo_people(id) on delete cascade,
  supermarket_id smallint not null references public.supermarkets(id) on delete cascade,
  store_id       int references public.stores(id) on delete cascade,
  granted_by     uuid default auth.uid(),
  created_at     timestamptz not null default now()
);
create unique index if not exists promo_access_uni on public.promo_access (person_id, supermarket_id, coalesce(store_id, 0));

create table if not exists public.promo_sessions (
  token_hash   text primary key,
  person_id    bigint not null references public.promo_people(id) on delete cascade,
  device       text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '30 days'
);
create table if not exists public.promo_login_fails (
  id     bigserial primary key,
  device text,
  at     timestamptz not null default now()
);
create index if not exists promo_login_fails_at on public.promo_login_fails (at);

create table if not exists public.promo_spaces (
  id         bigserial primary key,
  store_id   int not null references public.stores(id) on delete cascade,
  brand_id   int not null references public.promo_brands(id) on delete cascade,
  name       text not null check (char_length(name) between 2 and 60),
  kind       text not null default 'gondola' check (kind in ('gondola', 'ponta', 'ilha', 'geladeira', 'checkout', 'outro')),
  aisle      int check (aisle between 0 and 99),          -- corredor (0 = frente da loja)
  side       text check (side in ('esquerda', 'direita', 'fundo', 'frente')),
  capacity   int check (capacity between 1 and 5000),    -- unidades que cabem no espaço
  active     boolean not null default true,
  created_by bigint references public.promo_people(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists promo_spaces_store on public.promo_spaces (store_id, brand_id) where active;

-- cada visita, por produto: quantos ficaram na prateleira depois da visita (qty) e quantos foram colocados
create table if not exists public.promo_restocks (
  id           bigserial primary key,
  space_id     bigint not null references public.promo_spaces(id) on delete cascade,
  person_id    bigint references public.promo_people(id) on delete set null,
  product_id   int not null references public.products(id) on delete cascade,
  qty          int not null check (qty between 0 and 5000),   -- total na prateleira ao sair
  added        int not null default 0 check (added between 0 and 5000),
  placed_at    timestamptz not null default now(),
  counted_left int check (counted_left between 0 and 5000),   -- na visita seguinte: quantos sobraram
  counted_at   timestamptz
);
create index if not exists promo_restocks_space on public.promo_restocks (space_id, product_id, placed_at desc);

-- vendas do caixa por produto, loja e dia (planilha enviada pelo supermercado)
create table if not exists public.store_sales (
  supermarket_id smallint not null references public.supermarkets(id) on delete cascade,
  store_id       int references public.stores(id) on delete cascade,
  product_id     int not null references public.products(id) on delete cascade,
  day            date not null,
  qty            numeric(12,3) not null check (qty >= 0),
  source         text not null default 'planilha',
  imported_at    timestamptz not null default now()
);
create unique index if not exists store_sales_uni on public.store_sales (supermarket_id, coalesce(store_id, 0), product_id, day);
create index if not exists store_sales_lookup on public.store_sales (product_id, store_id, day);

alter table public.promo_brands enable row level security;
alter table public.promo_people enable row level security;
alter table public.promo_access enable row level security;
alter table public.promo_sessions enable row level security;
alter table public.promo_login_fails enable row level security;
alter table public.promo_spaces enable row level security;
alter table public.promo_restocks enable row level security;
alter table public.store_sales enable row level security;
-- sem políticas: tudo passa pelas funções abaixo

insert into public.app_settings (key, value, label) values ('promoters_enabled', 'true', 'Área do promotor')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- código e sessão
create or replace function public._promo_new_code()
returns text language plpgsql volatile set search_path = public as $$
declare c text;
begin
  loop
    c := lpad((floor(random() * 1000000))::int::text, 6, '0');
    -- nada de código fácil de adivinhar (000000, 111111, 123456, 654321…)
    continue when c ~ '^(\d)\1{5}$' or c in ('123456', '654321', '012345', '543210', '123123', '112233');
    exit when not exists (select 1 from promo_people where code = c);
  end loop;
  return c;
end $$;

create or replace function public._promo_hash(p_token text)
returns text language sql immutable as $$ select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') $$;

/** pessoa da sessão (ou erro). Renova a validade a cada uso. */
create or replace function public._promo_me(p_token text)
returns promo_people language plpgsql security definer set search_path = public as $$
declare s promo_sessions; p promo_people;
begin
  if not setting_on('promoters_enabled') then raise exception 'A área do promotor está fechada no momento.'; end if;
  select * into s from promo_sessions where token_hash = _promo_hash(p_token) and expires_at > now();
  if not found then raise exception 'sessao_expirada' using hint = 'Entre de novo com o seu código.'; end if;
  select * into p from promo_people where id = s.person_id and active;
  if not found then delete from promo_sessions where person_id = s.person_id; raise exception 'sessao_expirada' using hint = 'Seu acesso foi desativado.'; end if;
  update promo_sessions set last_used_at = now(), expires_at = now() + interval '30 days' where token_hash = s.token_hash;
  update promo_people set last_seen_at = now() where id = p.id and (last_seen_at is null or last_seen_at < now() - interval '5 minutes');
  return p;
end $$;

/** lojas em que a pessoa pode trabalhar */
create or replace function public._promo_stores(p_person bigint)
returns table (store_id int) language sql stable security definer set search_path = public as $$
  select distinct st.id from promo_access a join stores st on st.supermarket_id = a.supermarket_id and (a.store_id is null or st.id = a.store_id)
    join supermarkets s on s.id = a.supermarket_id and s.active
   where a.person_id = p_person
$$;

-- entrar com o código. Limites contra quem tenta adivinhar: 8 erros por aparelho em 15 min
-- e, se muita gente errar ao mesmo tempo (ataque), a entrada pausa por alguns minutos.
create or replace function public.promoter_login(p_code text, p_device text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p promo_people; v_token text; v_dev text := left(coalesce(p_device, ''), 40); b promo_brands;
begin
  if not setting_on('promoters_enabled') then raise exception 'A área do promotor está fechada no momento.'; end if;
  delete from promo_login_fails where at < now() - interval '1 day';
  if (select count(*) from promo_login_fails where at > now() - interval '10 minutes') >= 300 then
    raise exception 'Muitas tentativas agora. Espere alguns minutos e tente de novo.';
  end if;
  if v_dev <> '' and (select count(*) from promo_login_fails where device = v_dev and at > now() - interval '15 minutes') >= 8 then
    raise exception 'Muitas tentativas neste aparelho. Espere 15 minutos ou confira o código com o responsável.';
  end if;
  select * into p from promo_people where code = regexp_replace(coalesce(p_code, ''), '\D', '', 'g') and active;
  if not found or not exists (select 1 from promo_access where person_id = p.id) then
    insert into promo_login_fails (device) values (nullif(v_dev, ''));
    perform pg_sleep(0.4);
    raise exception 'Código não encontrado ou desativado. Confira com o responsável pelo supermercado.';
  end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into promo_sessions (token_hash, person_id, device) values (_promo_hash(v_token), p.id, nullif(v_dev, ''));
  delete from promo_sessions where person_id = p.id and token_hash not in
    (select token_hash from promo_sessions where person_id = p.id order by last_used_at desc limit 5); -- até 5 aparelhos
  update promo_people set last_seen_at = now() where id = p.id;
  select * into b from promo_brands where id = p.brand_id;
  return jsonb_build_object('token', v_token, 'name', p.name, 'role', p.role, 'brand', b.name, 'brand_color', b.color);
end $$;

create or replace function public.promoter_logout(p_token text)
returns void language sql security definer set search_path = public as $$
  delete from promo_sessions where token_hash = _promo_hash(p_token);
$$;

-- ---------------------------------------------------------------- o que saiu da prateleira
-- Vendas do caixa de um produto numa loja depois de um momento (o dia do momento conta pela parte que sobrava do dia).
create or replace function public._promo_sold_caixa(p_store int, p_market smallint, p_product int, p_since timestamptz)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(case
           when ss.day > (p_since at time zone 'America/Manaus')::date then ss.qty
           when ss.day = (p_since at time zone 'America/Manaus')::date then
             ss.qty * greatest(0, least(1, (21 - extract(hour from p_since at time zone 'America/Manaus')) / 14.0))
           else 0 end), 0)
    from store_sales ss
   where ss.product_id = p_product and ss.supermarket_id = p_market
     and (ss.store_id = p_store or (ss.store_id is null and (select count(*) from stores where supermarket_id = p_market) = 1))
     and ss.day >= (p_since at time zone 'America/Manaus')::date
$$;

-- até quando o caixa desta rede já mandou vendas (fim desse dia)
create or replace function public._promo_caixa_until(p_market smallint)
returns timestamptz language sql stable security definer set search_path = public as $$
  select ((max(day) + 1)::timestamp) at time zone 'America/Manaus' from store_sales where supermarket_id = p_market
$$;

-- unidades nas notas dos clientes do app (mínimo garantido), num intervalo
create or replace function public._promo_sold_app(p_store int, p_market smallint, p_product int, p_from timestamptz, p_to timestamptz default now())
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(coalesce(ri.qty, 1)), 0)
    from receipt_items ri join receipts r on r.id = ri.receipt_id
   where ri.product_id = p_product and r.supermarket_id = p_market and r.market_confirmed
     and (r.store_id = p_store or r.store_id is null)
     and r.issued_at > p_from and r.issued_at <= p_to
$$;

/**
 * Situação de cada produto num espaço: o que foi deixado na última visita, o que já saiu,
 * quanto sobra (estimado), o ritmo de venda, quando acaba e quanto levar na próxima visita.
 */
create or replace function public._promo_space_status(p_space bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  sp promo_spaces; st stores; out jsonb := '[]'; r record; v_until timestamptz;
  v_caixa numeric; v_app numeric; v_k numeric; v_sold numeric; v_left numeric; v_vel numeric; v_src text;
  v_status text; v_sugg int; v_hours numeric; v_eta numeric;
begin
  select * into sp from promo_spaces where id = p_space;
  select * into st from stores where id = sp.store_id;
  v_until := _promo_caixa_until(st.supermarket_id);
  for r in
    select distinct on (pr.product_id) pr.*, p.name, p.brand, p.unit, p.emoji, p.image_url
      from promo_restocks pr join products p on p.id = pr.product_id
     where pr.space_id = p_space order by pr.product_id, pr.placed_at desc
  loop
    v_hours := extract(epoch from now() - r.placed_at) / 3600;
    -- caixa até onde já chegou; o resto (hoje) pelas notas do app
    if v_until is not null and v_until > r.placed_at then
      v_caixa := _promo_sold_caixa(st.id, st.supermarket_id, r.product_id, r.placed_at);
      v_app := _promo_sold_app(st.id, st.supermarket_id, r.product_id, greatest(r.placed_at, v_until));
      v_src := case when v_app > 0 then 'caixa+app' else 'caixa' end;
    else
      v_caixa := 0; v_app := _promo_sold_app(st.id, st.supermarket_id, r.product_id, r.placed_at); v_src := 'app';
    end if;
    -- quanto o app "enxerga" das vendas reais desta loja: aprendido nas contagens anteriores do promotor
    select percentile_cont(0.5) within group (order by (x.qty - x.counted_left)::numeric / x.appsold)
      into v_k
      from (select h.qty, h.counted_left, _promo_sold_app(st.id, st.supermarket_id, h.product_id, h.placed_at, h.counted_at) appsold
              from promo_restocks h join promo_spaces hs on hs.id = h.space_id
             where hs.store_id = st.id and h.product_id = r.product_id and h.counted_left is not null and h.counted_at > h.placed_at
             order by h.placed_at desc limit 6) x
     where x.appsold >= 2 and x.qty >= x.counted_left;
    v_k := case when v_k is null then null else greatest(1, least(v_k, 40)) end;
    if v_src = 'app' and v_k is not null then v_src := 'app_ajustado'; end if;
    v_sold := v_caixa + v_app * coalesce(v_k, 1);
    v_left := greatest(0, r.qty - v_sold);

    -- ritmo (unidades por dia): caixa dos últimos 14 dias; senão as contagens do promotor; senão o app ajustado
    select sum(ss.qty) / nullif(count(distinct ss.day), 0) into v_vel from store_sales ss
     where ss.product_id = r.product_id and ss.supermarket_id = st.supermarket_id and ss.store_id = st.id and ss.day >= current_date - 14;
    if v_vel is null then
      select sum(h.qty - h.counted_left)::numeric / nullif(sum(extract(epoch from h.counted_at - h.placed_at) / 86400), 0) into v_vel
        from (select h.* from promo_restocks h join promo_spaces hs on hs.id = h.space_id
               where hs.store_id = st.id and h.product_id = r.product_id and h.counted_left is not null and h.counted_at > h.placed_at + interval '2 hours'
               order by h.placed_at desc limit 5) h where h.qty >= h.counted_left;
    end if;
    if v_vel is null and v_hours >= 12 then v_vel := v_sold / (v_hours / 24); end if;

    v_status := case
      when r.qty = 0 or v_left <= 0 then 'acabou'
      when v_left <= greatest(1, r.qty * 0.2) then 'repor'
      when v_left <= r.qty * 0.5 then 'baixo'
      when v_hours >= 72 and v_sold = 0 then 'parado'
      else 'ok' end;
    v_eta := case when coalesce(v_vel, 0) > 0 then round(v_left / v_vel * 24, 1) end;
    -- levar para 2 dias de venda com folga (sem passar do que cabe no espaço)
    v_sugg := case when coalesce(v_vel, 0) > 0 then ceil(v_vel * 2 * 1.2)::int end;
    if v_sugg is not null and sp.capacity is not null then v_sugg := least(v_sugg, sp.capacity); end if;
    if v_sugg is not null then v_sugg := greatest(0, v_sugg - floor(v_left)::int); end if;

    out := out || jsonb_build_object(
      'product_id', r.product_id, 'name', r.name, 'brand', r.brand, 'unit', r.unit, 'emoji', r.emoji, 'image_url', r.image_url,
      'placed', r.qty, 'added', r.added, 'placed_at', r.placed_at, 'restock_id', r.id,
      'sold', round(v_sold, 1), 'sold_caixa', round(v_caixa, 1), 'sold_app', round(v_app, 1), 'k', v_k,
      'left', floor(v_left)::int, 'source', v_src, 'velocity', round(v_vel, 2), 'eta_hours', v_eta,
      'status', v_status, 'suggest', v_sugg);
  end loop;
  return out;
end $$;

-- espaços (com situação) de uma marca nas lojas da pessoa
create or replace function public._promo_spaces_json(p_brand int, p_stores int[])
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', sp.id, 'store_id', sp.store_id, 'name', sp.name, 'kind', sp.kind, 'aisle', sp.aisle, 'side', sp.side, 'capacity', sp.capacity,
      'last_visit', (select max(placed_at) from promo_restocks where space_id = sp.id),
      'last_by', (select pp.name from promo_restocks x join promo_people pp on pp.id = x.person_id where x.space_id = sp.id order by x.placed_at desc limit 1),
      'items', _promo_space_status(sp.id)) order by sp.store_id, sp.aisle nulls last, sp.name), '[]')
    from promo_spaces sp where sp.active and sp.brand_id = p_brand and sp.store_id = any(p_stores)
$$;

-- ---------------------------------------------------------------- telas do promotor
create or replace function public.promoter_home(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p promo_people; b promo_brands; v_stores int[];
begin
  p := _promo_me(p_token);
  select * into b from promo_brands where id = p.brand_id;
  select coalesce(array_agg(store_id), '{}') into v_stores from _promo_stores(p.id);
  return jsonb_build_object(
    'me', jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role, 'brand', b.name, 'brand_id', b.id, 'brand_color', b.color),
    'stores', coalesce((select jsonb_agg(jsonb_build_object('id', st.id, 'name', st.name, 'neighborhood', st.neighborhood, 'lat', st.lat, 'lng', st.lng,
                          'supermarket_id', s.id, 'market', s.name, 'logo_url', s.logo_url, 'color', s.color,
                          'caixa_until', _promo_caixa_until(s.id)) order by s.name, st.name)
                        from stores st join supermarkets s on s.id = st.supermarket_id where st.id = any(v_stores)), '[]'),
    'spaces', _promo_spaces_json(p.brand_id, v_stores),
    'team', case when p.role = 'supervisor' then coalesce((
        select jsonb_agg(jsonb_build_object('id', pp.id, 'name', pp.name, 'role', pp.role, 'last_seen_at', pp.last_seen_at,
                 'visits_7d', (select count(distinct (x.space_id, date_trunc('day', x.placed_at))) from promo_restocks x join promo_spaces xs on xs.id = x.space_id
                                where x.person_id = pp.id and x.placed_at > now() - interval '7 days' and xs.store_id = any(v_stores)),
                 'last_visit', (select max(x.placed_at) from promo_restocks x join promo_spaces xs on xs.id = x.space_id where x.person_id = pp.id and xs.store_id = any(v_stores)),
                 'stores', (select count(*) from _promo_stores(pp.id) z where z.store_id = any(v_stores))) order by pp.name)
          from promo_people pp
         where pp.brand_id = p.brand_id and pp.active and pp.id <> p.id
           and exists (select 1 from _promo_stores(pp.id) z where z.store_id = any(v_stores))), '[]') end
  );
end $$;

create or replace function public.promoter_space_save(p_token text, p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare me promo_people; v_id bigint := nullif(p->>'id', '')::bigint; v_store int := (p->>'store_id')::int;
begin
  me := _promo_me(p_token);
  if not exists (select 1 from _promo_stores(me.id) where store_id = v_store) then raise exception 'Você não tem acesso a esta loja.'; end if;
  if v_id is null then
    insert into promo_spaces (store_id, brand_id, name, kind, aisle, side, capacity, created_by)
    values (v_store, me.brand_id, trim(p->>'name'), coalesce(nullif(p->>'kind', ''), 'gondola'), nullif(p->>'aisle', '')::int,
            nullif(p->>'side', ''), nullif(p->>'capacity', '')::int, me.id)
    returning id into v_id;
  else
    update promo_spaces set name = trim(p->>'name'), kind = coalesce(nullif(p->>'kind', ''), kind), aisle = nullif(p->>'aisle', '')::int,
           side = nullif(p->>'side', ''), capacity = nullif(p->>'capacity', '')::int, store_id = v_store,
           active = coalesce((p->>'active')::boolean, active)
     where id = v_id and brand_id = me.brand_id and store_id in (select store_id from _promo_stores(me.id));
    if not found then raise exception 'Espaço não encontrado.'; end if;
  end if;
  return v_id;
end $$;

/**
 * Registrar a visita num espaço. items: [{ product_id, left (quantos sobraram; vazio = não contou), added (quantos colocou) }]
 * Conta o que sobrou da visita anterior (aprende o ritmo real) e grava o que ficou na prateleira agora.
 */
create or replace function public.promoter_visit(p_token text, p_space bigint, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me promo_people; sp promo_spaces; it jsonb; v_pid int; v_left int; v_add int; prev promo_restocks; n int := 0; v_total int;
begin
  me := _promo_me(p_token);
  select * into sp from promo_spaces where id = p_space and active and brand_id = me.brand_id;
  if not found or not exists (select 1 from _promo_stores(me.id) where store_id = sp.store_id) then raise exception 'Espaço não encontrado.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Informe pelo menos um produto.'; end if;
  for it in select * from jsonb_array_elements(p_items) limit 60 loop
    v_pid := nullif(it->>'product_id', '')::int;
    continue when v_pid is null or not exists (select 1 from products where id = v_pid);
    v_left := nullif(it->>'left', '')::int; v_add := greatest(0, coalesce(nullif(it->>'added', '')::int, 0));
    if v_left is not null and (v_left < 0 or v_left > 5000) then raise exception 'Quantidade inválida.'; end if;
    select * into prev from promo_restocks where space_id = p_space and product_id = v_pid order by placed_at desc limit 1;
    if found and v_left is not null then
      if v_left > prev.qty then v_left := prev.qty; end if; -- não pode sobrar mais do que havia
      update promo_restocks set counted_left = v_left, counted_at = now() where id = prev.id;
    end if;
    -- o que fica na prateleira: o que sobrou (contado, ou a estimativa se não contou) + o que colocou
    v_total := coalesce(v_left, case when prev.id is null then 0 else
                 coalesce((select (e->>'left')::int from jsonb_array_elements(_promo_space_status(p_space)) e where (e->>'product_id')::int = v_pid), 0) end) + v_add;
    if sp.capacity is not null and v_total > sp.capacity * 3 then raise exception 'Quantidade muito acima do que cabe no espaço (%).', sp.capacity; end if;
    insert into promo_restocks (space_id, person_id, product_id, qty, added) values (p_space, me.id, v_pid, least(v_total, 5000), v_add);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Nenhum produto válido.'; end if;
  return jsonb_build_object('saved', n, 'items', _promo_space_status(p_space));
end $$;

-- tirar um produto do espaço (deixa de aparecer)
create or replace function public.promoter_space_remove_product(p_token text, p_space bigint, p_product int)
returns void language plpgsql security definer set search_path = public as $$
declare me promo_people;
begin
  me := _promo_me(p_token);
  if not exists (select 1 from promo_spaces s where s.id = p_space and s.brand_id = me.brand_id and s.store_id in (select store_id from _promo_stores(me.id))) then
    raise exception 'Espaço não encontrado.'; end if;
  delete from promo_restocks where space_id = p_space and product_id = p_product;
end $$;

-- ---------------------------------------------------------------- gestão (supermercado ou administração)
create or replace function public._promo_can(p_market smallint)
returns boolean language sql stable security definer set search_path = public as $$
  select is_master() or is_market_member(p_market)
$$;

create or replace function public.market_promoters(p_market smallint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not _promo_can(p_market) then raise exception 'Sem permissão para este supermercado.'; end if;
  return jsonb_build_object(
    'people', coalesce((select jsonb_agg(x order by x.active desc, x.name) from (
      select pp.id, pp.name, pp.phone, pp.role, pp.code, pp.active, pp.last_seen_at, pp.created_at, b.name brand, b.id brand_id,
             (pp.created_market = p_market or is_master()) as mine,
             coalesce((select jsonb_agg(a.store_id) from promo_access a where a.person_id = pp.id and a.supermarket_id = p_market and a.store_id is not null), '[]') store_ids,
             exists (select 1 from promo_access a where a.person_id = pp.id and a.supermarket_id = p_market and a.store_id is null) all_stores,
             (select max(x.placed_at) from promo_restocks x join promo_spaces xs on xs.id = x.space_id join stores st on st.id = xs.store_id
               where x.person_id = pp.id and st.supermarket_id = p_market) last_visit,
             (select count(*) from promo_restocks x join promo_spaces xs on xs.id = x.space_id join stores st on st.id = xs.store_id
               where x.person_id = pp.id and st.supermarket_id = p_market and x.placed_at > now() - interval '7 days') items_7d
        from promo_people pp join promo_brands b on b.id = pp.brand_id
       where exists (select 1 from promo_access a where a.person_id = pp.id and a.supermarket_id = p_market)) x), '[]'),
    'brands', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name) from promo_brands), '[]'),
    'stores', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name) from stores where supermarket_id = p_market), '[]'),
    'sales', jsonb_build_object('until', (select max(day) from store_sales where supermarket_id = p_market),
                                'rows_7d', (select count(*) from store_sales where supermarket_id = p_market and day > current_date - 7)));
end $$;

-- criar/editar promotor ou supervisor (p: { id?, name, phone, brand, role, store_ids: [] (vazio = todas as lojas) })
create or replace function public.market_promoter_save(p_market smallint, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id bigint := nullif(p->>'id', '')::bigint; v_brand int; pp promo_people; v_store int;
begin
  if not _promo_can(p_market) then raise exception 'Sem permissão para este supermercado.'; end if;
  if char_length(trim(coalesce(p->>'name', ''))) < 2 then raise exception 'Informe o nome.'; end if;
  if char_length(trim(coalesce(p->>'brand', ''))) < 2 then raise exception 'Informe a marca (ex.: Nestlé).'; end if;
  select id into v_brand from promo_brands where lower(name) = lower(trim(p->>'brand'));
  if v_brand is null then insert into promo_brands (name) values (trim(p->>'brand')) returning id into v_brand; end if;
  if v_id is null then
    insert into promo_people (name, phone, brand_id, role, code, created_market)
    values (trim(p->>'name'), nullif(trim(p->>'phone'), ''), v_brand, coalesce(nullif(p->>'role', ''), 'promotor'), _promo_new_code(), p_market)
    returning * into pp;
  else
    select * into pp from promo_people where id = v_id;
    if not found or not exists (select 1 from promo_access where person_id = v_id and supermarket_id = p_market) and not is_master() then
      raise exception 'Promotor não encontrado neste supermercado.'; end if;
    if pp.created_market = p_market or is_master() then
      update promo_people set name = trim(p->>'name'), phone = nullif(trim(p->>'phone'), ''), brand_id = v_brand,
             role = coalesce(nullif(p->>'role', ''), role) where id = v_id returning * into pp;
    end if;
  end if;
  -- lojas deste supermercado (as de outros mercados não mudam)
  delete from promo_access where person_id = pp.id and supermarket_id = p_market;
  if jsonb_typeof(p->'store_ids') = 'array' and jsonb_array_length(p->'store_ids') > 0 then
    for v_store in select (x)::int from jsonb_array_elements_text(p->'store_ids') x loop
      if exists (select 1 from stores where id = v_store and supermarket_id = p_market) then
        insert into promo_access (person_id, supermarket_id, store_id) values (pp.id, p_market, v_store) on conflict do nothing;
      end if;
    end loop;
  end if;
  if not exists (select 1 from promo_access where person_id = pp.id and supermarket_id = p_market) then
    insert into promo_access (person_id, supermarket_id, store_id) values (pp.id, p_market, null);
  end if;
  return jsonb_build_object('id', pp.id, 'code', pp.code, 'name', pp.name);
end $$;

-- dar acesso, neste supermercado, a quem já tem código (ex.: supervisor da marca que já trabalha em outra rede)
create or replace function public.market_promoter_attach(p_market smallint, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pp promo_people;
begin
  if not _promo_can(p_market) then raise exception 'Sem permissão para este supermercado.'; end if;
  select * into pp from promo_people where code = regexp_replace(coalesce(p_code, ''), '\D', '', 'g') and active;
  if not found then raise exception 'Código não encontrado.'; end if;
  insert into promo_access (person_id, supermarket_id, store_id) values (pp.id, p_market, null) on conflict do nothing;
  return jsonb_build_object('id', pp.id, 'name', pp.name);
end $$;

create or replace function public.market_promoter_new_code(p_market smallint, p_id bigint)
returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not _promo_can(p_market) then raise exception 'Sem permissão para este supermercado.'; end if;
  if not exists (select 1 from promo_people where id = p_id and (created_market = p_market or is_master())) then
    raise exception 'Só quem criou o acesso pode trocar o código.'; end if;
  c := _promo_new_code();
  update promo_people set code = c where id = p_id;
  delete from promo_sessions where person_id = p_id; -- quem estava com o código antigo sai
  return c;
end $$;

-- desativar/reativar (quem criou) ou tirar deste supermercado (os outros)
create or replace function public.market_promoter_status(p_market smallint, p_id bigint, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not _promo_can(p_market) then raise exception 'Sem permissão para este supermercado.'; end if;
  if exists (select 1 from promo_people where id = p_id and (created_market = p_market or is_master())) then
    update promo_people set active = p_active where id = p_id;
    if not p_active then delete from promo_sessions where person_id = p_id; end if;
  elsif not p_active then
    delete from promo_access where person_id = p_id and supermarket_id = p_market;
    if not exists (select 1 from promo_access where person_id = p_id) then delete from promo_sessions where person_id = p_id; end if;
  else raise exception 'Só quem criou o acesso pode reativar.';
  end if;
end $$;

/**
 * Vendas do caixa (planilha). rows: [{ day: '2026-10-28', store?: id ou nome, ean?: código de barras, product_id?, name?, qty }]
 * Linhas com o mesmo produto, loja e dia substituem as anteriores (pode mandar de novo sem duplicar).
 */
create or replace function public.market_sales_import(p_market smallint, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; v_pid int; v_store int; v_day date; v_qty numeric; n int := 0; unk_p jsonb := '[]'; unk_s jsonb := '[]'; v_ean text;
begin
  if not _promo_can(p_market) then raise exception 'Sem permissão para este supermercado.'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Planilha inválida.'; end if;
  if jsonb_array_length(p_rows) > 20000 then raise exception 'Máximo de 20 mil linhas por envio.'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    begin v_day := (r->>'day')::date; exception when others then v_day := null; end;
    v_qty := nullif(replace(r->>'qty', ',', '.'), '')::numeric;
    continue when v_day is null or v_qty is null or v_qty < 0 or v_day > current_date + 1 or v_day < current_date - 400;
    v_ean := regexp_replace(coalesce(r->>'ean', ''), '\D', '', 'g');
    v_pid := coalesce(nullif(r->>'product_id', '')::int,
                      (select id from products where v_ean <> '' and ean in (v_ean, lpad(v_ean, 13, '0'), ltrim(v_ean, '0')) limit 1));
    if v_pid is null then
      if jsonb_array_length(unk_p) < 30 then unk_p := unk_p || to_jsonb(coalesce(nullif(r->>'name', ''), v_ean)); end if;
      continue;
    end if;
    v_store := case when (r->>'store') ~ '^\d+$' then (select id from stores where id = (r->>'store')::int and supermarket_id = p_market)
                    when nullif(trim(r->>'store'), '') is not null then
                      (select id from stores where supermarket_id = p_market and (lower(name) = lower(trim(r->>'store')) or lower(name) like '%' || lower(trim(r->>'store')) || '%') order by length(name) limit 1)
               end;
    if nullif(trim(r->>'store'), '') is not null and v_store is null then
      if jsonb_array_length(unk_s) < 20 and not unk_s ? (r->>'store') then unk_s := unk_s || to_jsonb(r->>'store'); end if;
      continue;
    end if;
    insert into store_sales as s (supermarket_id, store_id, product_id, day, qty) values (p_market, v_store, v_pid, v_day, v_qty)
    on conflict (supermarket_id, (coalesce(store_id, 0)), product_id, day) do update set qty = excluded.qty, imported_at = now();
    n := n + 1;
  end loop;
  return jsonb_build_object('imported', n, 'unknown_products', unk_p, 'unknown_stores', unk_s);
end $$;

-- grants: o promotor não tem conta (entra pelo código), então as funções dele ficam abertas e conferem o token
do $$
declare f text;
begin
  foreach f in array array['promoter_login(text,text)', 'promoter_logout(text)', 'promoter_home(text)', 'promoter_space_save(text,jsonb)',
                           'promoter_visit(text,bigint,jsonb)', 'promoter_space_remove_product(text,bigint,integer)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
  foreach f in array array['market_promoters(smallint)', 'market_promoter_save(smallint,jsonb)', 'market_promoter_attach(smallint,text)',
                           'market_promoter_new_code(smallint,bigint)', 'market_promoter_status(smallint,bigint,boolean)', 'market_sales_import(smallint,jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['_promo_me(text)', '_promo_stores(bigint)', '_promo_space_status(bigint)', '_promo_spaces_json(integer,integer[])',
                           '_promo_sold_caixa(integer,smallint,integer,timestamptz)', '_promo_sold_app(integer,smallint,integer,timestamptz,timestamptz)',
                           '_promo_caixa_until(smallint)', '_promo_new_code()', '_promo_can(smallint)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
