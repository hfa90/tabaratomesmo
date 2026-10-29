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
