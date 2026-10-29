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
