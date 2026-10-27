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
