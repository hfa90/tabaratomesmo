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
