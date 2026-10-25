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
    user_id = coalesce(auth.uid(), s.user_id), device = excluded.device, prefs = excluded.prefs,
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
