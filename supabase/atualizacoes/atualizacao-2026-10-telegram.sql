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
