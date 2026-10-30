-- =====================================================================
--  Tá Barato Mesmo? — Cofrinho: o que o cliente ganha a cada nota (outubro/2026)
--   Tudo GARANTIDO, sem sorteio (sorteio/vale-brinde exigem autorização da Lei 5.768/71):
--   • Economia da compra: quanto a nota saiu mais barata que a média dos outros mercados hoje.
--   • Pontos da nota (como já era) + bônus: primeira nota do dia, semanas seguidas, desafios da semana.
--   • Níveis (Bronze, Prata, Ouro, Diamante) pelos pontos ganhos.
--   • Troca de pontos: cada supermercado cadastra no portal as recompensas que oferece e paga
--     (ex.: R$ 5 de desconto em compras acima de R$ 100 = 600 pontos). O código vale no caixa e é
--     dado como usado sozinho quando a próxima nota daquele mercado chega.
--  Rode uma vez no Supabase › SQL Editor (pode rodar de novo sem problema).
-- =====================================================================

-- ---------------------------------------------------------------- tabelas
create table if not exists public.point_ledger (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  delta       int not null,
  kind        text not null check (kind in ('dia', 'sequencia', 'desafio', 'troca', 'estorno', 'ajuste')),
  ref         text not null,                         -- dia, semana, semana:desafio ou id do resgate (evita bônus em dobro)
  note        text,
  receipt_id  bigint references public.receipts(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (user_id, kind, ref)
);
create index if not exists point_ledger_user on public.point_ledger (user_id, created_at desc);
alter table public.point_ledger enable row level security;   -- só pelas funções

create table if not exists public.market_rewards (
  id             bigserial primary key,
  supermarket_id smallint not null references public.supermarkets(id) on delete cascade,
  title          text not null check (char_length(title) between 3 and 60),
  value          numeric(10,2) not null check (value > 0 and value <= 200),      -- desconto em R$
  min_spend      numeric(10,2) not null default 0 check (min_spend >= 0),        -- compra mínima
  cost_points    int not null check (cost_points between 50 and 20000),
  valid_days     int not null default 7 check (valid_days between 1 and 60),
  monthly_stock  int check (monthly_stock between 1 and 100000),                -- quantos códigos por mês (vazio = sem limite)
  active         boolean not null default true,
  ficticio       boolean not null default false,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists market_rewards_market on public.market_rewards (supermarket_id, active);
alter table public.market_rewards enable row level security;

create table if not exists public.reward_redemptions (
  id             bigserial primary key,
  reward_id      bigint not null references public.market_rewards(id) on delete cascade,
  supermarket_id smallint not null references public.supermarkets(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  code           text not null unique,
  title          text not null,
  value          numeric(10,2) not null,
  min_spend      numeric(10,2) not null default 0,
  cost_points    int not null,
  status         text not null default 'ativo' check (status in ('ativo', 'usado', 'cancelado')),
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  used_at        timestamptz,
  used_via       text check (used_via in ('caixa', 'nota')),
  receipt_id     bigint references public.receipts(id) on delete set null,
  receipt_total  numeric(10,2)
);
create index if not exists reward_redemptions_user on public.reward_redemptions (user_id, created_at desc);
create index if not exists reward_redemptions_reward on public.reward_redemptions (reward_id, created_at);
alter table public.reward_redemptions enable row level security;

-- ---------------------------------------------------------------- contas de pontos
-- nota que vale para bônus: não recusada e enviada em até 3 dias da compra
create or replace function public._fresh_receipt(r receipts) returns boolean language sql immutable as $$
  select r.status <> 'recusada' and r.issued_at >= r.created_at - interval '3 days'
$$;

-- pontos ganhos (notas + preços informados + bônus) desde o último "zerar histórico"
create or replace function public._points_earned(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select (coalesce((select sum(points) from receipts where user_id = p_user and status <> 'recusada' and created_at >= _reset_at(p_user)), 0)
        + coalesce((select sum(points) from price_reports where user_id = p_user and created_at >= _reset_at(p_user)), 0)
        + coalesce((select sum(delta) from point_ledger where user_id = p_user and delta > 0 and created_at >= _reset_at(p_user)), 0))::int
$$;
-- pontos para trocar = ganhos - trocados (+ estornos já entram como ganho positivo)
create or replace function public._points_balance(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select _points_earned(p_user) + coalesce((select sum(delta) from point_ledger where user_id = p_user and delta < 0 and created_at >= _reset_at(p_user)), 0)::int
$$;

create or replace function public._level(p_earned int) returns jsonb language sql immutable as $$
  select case
    when p_earned >= 4000 then jsonb_build_object('name', 'Diamante', 'min', 4000, 'next', null, 'next_name', null)
    when p_earned >= 1500 then jsonb_build_object('name', 'Ouro', 'min', 1500, 'next', 4000, 'next_name', 'Diamante')
    when p_earned >= 500  then jsonb_build_object('name', 'Prata', 'min', 500, 'next', 1500, 'next_name', 'Ouro')
    else jsonb_build_object('name', 'Bronze', 'min', 0, 'next', 500, 'next_name', 'Prata') end
$$;

-- semanas seguidas com nota (a semana atual sem nota ainda não quebra a sequência)
create or replace function public._streak_weeks(p_user uuid) returns int
language plpgsql stable security definer set search_path = public as $$
declare w date := date_trunc('week', now() at time zone 'America/Manaus')::date; n int := 0; v_since timestamptz := _reset_at(p_user);
begin
  if not exists (select 1 from receipts r where r.user_id = p_user and _fresh_receipt(r) and r.created_at >= v_since
                   and date_trunc('week', r.issued_at at time zone 'America/Manaus')::date = w) then w := w - 7; end if;
  loop
    exit when n >= 104 or not exists (
      select 1 from receipts r where r.user_id = p_user and _fresh_receipt(r) and r.created_at >= v_since
         and date_trunc('week', r.issued_at at time zone 'America/Manaus')::date = w);
    n := n + 1; w := w - 7;
  end loop;
  return n;
end $$;

-- desafios desta semana (segunda a domingo, horário de Manaus)
create or replace function public._missions(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with w as (select date_trunc('week', now() at time zone 'America/Manaus')::date w0),
  r as (select r.* from receipts r, w where r.user_id = p_user and _fresh_receipt(r) and r.created_at >= _reset_at(p_user)
          and (r.issued_at at time zone 'America/Manaus')::date >= w.w0),
  m as (select * from (values
      ('duas_notas', 'Mande 2 notas nesta semana', 2, 30, (select count(*) from r)::int),
      ('parceiro', 'Compre num mercado parceiro', 1, 20, (select count(*) from r where market_confirmed and is_partner_market(supermarket_id))::int),
      ('rancho', 'Uma nota com 15 itens ou mais', 1, 20, (select count(*) from r where items_count >= 15)::int)) v(code, title, goal, points, prog))
  select jsonb_agg(jsonb_build_object('code', m.code, 'title', m.title, 'goal', m.goal, 'points', m.points,
                     'progress', least(m.prog, m.goal), 'done', m.prog >= m.goal,
                     'paid', exists (select 1 from point_ledger l where l.user_id = p_user and l.kind = 'desafio' and l.ref = w.w0 || ':' || m.code))
                   order by m.points desc, m.code)
    from m, w
$$;

-- quanto a nota saiu mais barata que a média dos OUTROS mercados (preços de hoje); nunca negativo
create or replace function public._receipt_savings(p_receipt bigint) returns numeric
language sql stable security definer set search_path = public as $$
  with r as (select id, supermarket_id from receipts where id = p_receipt),
  latest as (
    select distinct on (pr.product_id, pr.supermarket_id) pr.product_id, pr.supermarket_id, pr.price
      from prices pr join supermarkets s on s.id = pr.supermarket_id and s.active
     where pr.product_id in (select product_id from receipt_items where receipt_id = p_receipt and product_id is not null)
     order by pr.product_id, pr.supermarket_id, pr.collected_at desc)
  select greatest(0, coalesce(round(sum((o.avg_other - ri.unit_price) * coalesce(nullif(ri.qty, 0), 1)), 2), 0))
    from receipt_items ri join r on r.id = ri.receipt_id
    cross join lateral (select avg(l.price) avg_other from latest l
                         where l.product_id = ri.product_id and l.supermarket_id is distinct from r.supermarket_id) o
   where ri.product_id is not null and ri.unit_price > 0 and o.avg_other is not null and ri.unit_price < o.avg_other * 3
$$;

-- ---------------------------------------------------------------- depois de cada nota (chamada pelo receipt_ingest)
create or replace function public.rewards_after_receipt(p_user uuid, p_receipt bigint) returns void
language plpgsql volatile security definer set search_path = public as $$
declare r receipts; w date := date_trunc('week', now() at time zone 'America/Manaus')::date; s int; m jsonb;
begin
  select * into r from receipts where id = p_receipt and user_id = p_user;
  if not found then return; end if;

  -- o código trocado vira "usado" quando chega a nota do mesmo mercado (dentro da validade e da compra mínima)
  if r.market_confirmed and r.status <> 'recusada' then
    update reward_redemptions set status = 'usado', used_at = now(), used_via = 'nota', receipt_id = r.id, receipt_total = r.total
     where id = (select id from reward_redemptions
                  where user_id = p_user and supermarket_id = r.supermarket_id and status = 'ativo'
                    and r.issued_at between created_at - interval '1 hour' and expires_at
                    and coalesce(r.total, 0) >= min_spend
                  order by value desc limit 1);
  end if;

  if not setting_on('rewards_enabled') or not _fresh_receipt(r) then return; end if;
  -- primeira nota do dia
  insert into point_ledger (user_id, delta, kind, ref, note, receipt_id)
  values (p_user, 10, 'dia', (r.created_at at time zone 'America/Manaus')::date::text, 'Primeira nota do dia', p_receipt)
  on conflict do nothing;
  -- semanas seguidas (a partir da 2ª semana: +10 por semana, até +50)
  s := _streak_weeks(p_user);
  if s >= 2 then
    insert into point_ledger (user_id, delta, kind, ref, note, receipt_id)
    values (p_user, least(50, 10 * (s - 1)), 'sequencia', w::text, s || ' semanas seguidas', p_receipt)
    on conflict do nothing;
  end if;
  -- desafios da semana
  for m in select * from jsonb_array_elements(coalesce(_missions(p_user), '[]')) loop
    if (m->>'done')::boolean then
      insert into point_ledger (user_id, delta, kind, ref, note, receipt_id)
      values (p_user, (m->>'points')::int, 'desafio', w || ':' || (m->>'code'), 'Desafio: ' || (m->>'title'), p_receipt)
      on conflict do nothing;
    end if;
  end loop;
end $$;
revoke all on function public.rewards_after_receipt(uuid, bigint) from public, anon, authenticated;

-- o receipt_ingest passa a chamar rewards_after_receipt no fim (sem reescrever a função inteira)
do $$
declare d text; alvo constant text := '  select prices_added, stale_updated, points, market_confirmed into v_added, v_stale, v_points, v_confirmed from receipts where id = v_id;';
begin
  if to_regprocedure('public.receipt_ingest(uuid,jsonb)') is null then return; end if;
  d := pg_get_functiondef('public.receipt_ingest(uuid,jsonb)'::regprocedure);
  if position('rewards_after_receipt' in d) = 0 and position(alvo in d) > 0 then
    execute replace(d, alvo, '  perform rewards_after_receipt(p_user, v_id);' || chr(10) || alvo);
  end if;
end $$;

-- ---------------------------------------------------------------- para o cliente
-- recompensas no catálogo (dos mercados de verdade; as fictícias nunca aparecem aqui)
create or replace function public._rewards_catalog(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.cost_points, x.value desc), '[]') from (
    select w.id, w.supermarket_id, s.name market, s.slug, s.logo_url, s.color, w.title, w.value, w.min_spend, w.cost_points, w.valid_days,
           case when w.monthly_stock is null then null
                else greatest(0, w.monthly_stock - (select count(*) from reward_redemptions d where d.reward_id = w.id
                                                      and d.created_at >= date_trunc('month', now()) and d.status <> 'cancelado')) end stock_left,
           exists (select 1 from reward_redemptions d where d.reward_id = w.id and d.user_id = p_user and d.status = 'ativo' and d.expires_at > now()) have
      from market_rewards w join supermarkets s on s.id = w.supermarket_id and s.active
     where w.active and not w.ficticio and setting_on('rewards_enabled')) x
$$;

create or replace function public._my_codes(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'code', d.code, 'title', d.title, 'value', d.value, 'min_spend', d.min_spend,
           'market', s.name, 'supermarket_id', d.supermarket_id, 'cost_points', d.cost_points, 'created_at', d.created_at, 'expires_at', d.expires_at,
           'status', case when d.status = 'ativo' and d.expires_at < now() then 'vencido' else d.status end, 'used_at', d.used_at, 'used_via', d.used_via)
         order by (d.status = 'ativo' and d.expires_at >= now()) desc, d.created_at desc), '[]')
    from (select * from reward_redemptions where user_id = p_user and created_at >= _reset_at(p_user) order by created_at desc limit 20) d
    join supermarkets s on s.id = d.supermarket_id
$$;

create or replace function public.my_cofrinho()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid(); e int; ms timestamptz := date_trunc('month', now()); ys timestamptz := date_trunc('year', now());
begin
  if u is null then return null; end if;
  e := _points_earned(u);
  return jsonb_build_object(
    'enabled', setting_on('rewards_enabled'),
    'balance', _points_balance(u), 'earned', e, 'level', _level(e),
    'month_points', (coalesce((select sum(points) from receipts where user_id = u and status <> 'recusada' and created_at >= greatest(ms, _reset_at(u))), 0)
                   + coalesce((select sum(delta) from point_ledger where user_id = u and delta > 0 and created_at >= greatest(ms, _reset_at(u))), 0)),
    'streak', _streak_weeks(u),
    'missions', _missions(u),
    'savings', jsonb_build_object(
       'month', coalesce((select sum(_receipt_savings(r.id)) from receipts r where r.user_id = u and r.status <> 'recusada'
                            and r.issued_at >= greatest(ms, _reset_at(u))), 0),
       'year', coalesce((select sum(_receipt_savings(r.id)) from receipts r where r.user_id = u and r.status <> 'recusada'
                           and r.issued_at >= greatest(ys, _reset_at(u))), 0),
       'receipts_month', (select count(*) from receipts r where r.user_id = u and r.status <> 'recusada' and r.issued_at >= greatest(ms, _reset_at(u)))),
    'ledger', coalesce((select jsonb_agg(jsonb_build_object('delta', delta, 'kind', kind, 'note', note, 'at', created_at) order by created_at desc)
                          from (select * from point_ledger where user_id = u and created_at >= _reset_at(u) order by created_at desc limit 15) l), '[]'),
    'codes', _my_codes(u),
    'rewards', _rewards_catalog(u));
end $$;
revoke all on function public.my_cofrinho() from public, anon;
grant execute on function public.my_cofrinho() to authenticated;

-- a comemoração logo depois de mandar a nota
create or replace function public.receipt_rewards(p_receipt bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid(); r receipts; e int; b int; nxt jsonb;
begin
  select * into r from receipts where id = p_receipt and user_id = u;
  if not found then return null; end if;
  e := _points_earned(u); b := _points_balance(u);
  -- a próxima troca: a mais barata que ainda não dá, ou a melhor que já dá
  select x.v into nxt from jsonb_array_elements(_rewards_catalog(u)) as x(v)
   where not (x.v->>'have')::boolean and coalesce((x.v->>'stock_left')::int, 1) > 0
   order by ((x.v->>'cost_points')::int <= b) desc,
            case when (x.v->>'cost_points')::int <= b then -(x.v->>'value')::numeric else (x.v->>'cost_points')::numeric end
   limit 1;
  return jsonb_build_object(
    'enabled', setting_on('rewards_enabled'),
    'points', r.points, 'fresh', _fresh_receipt(r), 'savings', _receipt_savings(r.id),
    'bonuses', coalesce((select jsonb_agg(jsonb_build_object('delta', delta, 'kind', kind, 'note', note) order by id) from point_ledger where receipt_id = r.id and delta > 0), '[]'),
    'balance', b, 'earned', e, 'level', _level(e), 'streak', _streak_weeks(u), 'missions', _missions(u),
    'next_reward', case when nxt is null then null else nxt || jsonb_build_object('missing', greatest(0, (nxt->>'cost_points')::int - b)) end,
    'reward_used', (select jsonb_build_object('code', code, 'title', title, 'value', value) from reward_redemptions where receipt_id = r.id limit 1));
end $$;
revoke all on function public.receipt_rewards(bigint) from public, anon;
grant execute on function public.receipt_rewards(bigint) to authenticated;

-- trocar pontos por uma recompensa
create or replace function public.reward_redeem(p_reward bigint)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare u uuid := auth.uid(); v market_rewards; bal int; v_code text; d reward_redemptions;
begin
  if u is null then raise exception 'Entre na sua conta para trocar pontos.'; end if;
  if not setting_on('rewards_enabled') then raise exception 'A troca de pontos está pausada no momento.'; end if;
  if coalesce((select blocked from profiles where id = u), false) then raise exception 'Sua conta não pode trocar pontos.'; end if;
  select * into v from market_rewards where id = p_reward and active and not ficticio for update;
  if not found or not exists (select 1 from supermarkets where id = v.supermarket_id and active) then
    raise exception 'Esta recompensa não está mais disponível.';
  end if;
  if exists (select 1 from reward_redemptions where user_id = u and reward_id = v.id and status = 'ativo' and expires_at > now()) then
    raise exception 'Você já tem um código desta recompensa. Use-o antes de trocar de novo.';
  end if;
  if (select count(*) from reward_redemptions where user_id = u and created_at > now() - interval '1 day') >= 5 then
    raise exception 'Você já trocou 5 vezes hoje. Amanhã tem mais!';
  end if;
  if v.monthly_stock is not null and (select count(*) from reward_redemptions where reward_id = v.id
        and created_at >= date_trunc('month', now()) and status <> 'cancelado') >= v.monthly_stock then
    raise exception 'As recompensas deste mês acabaram. Volte no mês que vem!';
  end if;
  bal := _points_balance(u);
  if bal < v.cost_points then raise exception 'Faltam % pontos para esta troca.', v.cost_points - bal; end if;
  loop
    v_code := 'TB' || upper(substr(translate(md5(gen_random_uuid()::text), '01', ''), 1, 6));
    exit when length(v_code) = 8 and not exists (select 1 from reward_redemptions where code = v_code);
  end loop;
  insert into reward_redemptions (reward_id, supermarket_id, user_id, code, title, value, min_spend, cost_points, expires_at)
  values (v.id, v.supermarket_id, u, v_code, v.title, v.value, v.min_spend, v.cost_points,
          date_trunc('day', now() at time zone 'America/Manaus') at time zone 'America/Manaus' + make_interval(days => v.valid_days + 1) - interval '1 second')
  returning * into d;
  insert into point_ledger (user_id, delta, kind, ref, note) values (u, -v.cost_points, 'troca', d.id::text, v.title);
  return jsonb_build_object('id', d.id, 'code', d.code, 'title', d.title, 'value', d.value, 'min_spend', d.min_spend, 'expires_at', d.expires_at,
                            'cost_points', d.cost_points, 'supermarket_id', d.supermarket_id,
                            'market', (select name from supermarkets where id = d.supermarket_id), 'balance', _points_balance(u));
end $$;
revoke all on function public.reward_redeem(bigint) from public, anon;
grant execute on function public.reward_redeem(bigint) to authenticated;

-- desistir de um código ainda não usado: os pontos voltam
create or replace function public.reward_cancel(p_id bigint)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare u uuid := auth.uid(); d reward_redemptions;
begin
  select * into d from reward_redemptions where id = p_id and user_id = u for update;
  if not found then raise exception 'Código não encontrado.'; end if;
  if d.status <> 'ativo' or d.expires_at < now() then raise exception 'Este código não pode mais ser cancelado.'; end if;
  update reward_redemptions set status = 'cancelado' where id = d.id;
  insert into point_ledger (user_id, delta, kind, ref, note) values (u, d.cost_points, 'estorno', d.id::text, 'Troca cancelada: ' || d.title)
  on conflict do nothing;
  return jsonb_build_object('balance', _points_balance(u));
end $$;
revoke all on function public.reward_cancel(bigint) from public, anon;
grant execute on function public.reward_cancel(bigint) to authenticated;

-- ---------------------------------------------------------------- para o supermercado (portal)
create or replace function public.market_rewards_list(p_market smallint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ms timestamptz := date_trunc('month', now());
begin
  if not (is_market_member(p_market) or is_master()) then raise exception 'Sem permissão para este supermercado.'; end if;
  return jsonb_build_object(
    'enabled', setting_on('rewards_enabled'),
    'partner', is_partner_market(p_market),
    'rewards', coalesce((select jsonb_agg(x order by x.active desc, x.cost_points) from (
        select w.*, (select count(*) from reward_redemptions d where d.reward_id = w.id and d.created_at >= ms and d.status <> 'cancelado') month_redeemed,
               (select count(*) from reward_redemptions d where d.reward_id = w.id and d.status <> 'cancelado') redeemed,
               (select count(*) from reward_redemptions d where d.reward_id = w.id and d.status = 'usado') used
          from market_rewards w where w.supermarket_id = p_market) x), '[]'),
    'month', (select jsonb_build_object(
        'redeemed', count(*) filter (where status <> 'cancelado'),
        'used', count(*) filter (where status = 'usado'),
        'active', count(*) filter (where status = 'ativo' and expires_at >= now()),
        'cost', coalesce(sum(value) filter (where status = 'usado'), 0),
        'receipts_value', coalesce(sum(receipt_total) filter (where status = 'usado'), 0),
        'people', count(distinct user_id) filter (where status <> 'cancelado'))
      from reward_redemptions where supermarket_id = p_market and created_at >= ms),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'value', value, 'created_at', created_at, 'expires_at', expires_at,
                  'status', case when status = 'ativo' and expires_at < now() then 'vencido' else status end, 'used_at', used_at, 'used_via', used_via,
                  'receipt_total', receipt_total) order by created_at desc)
                from (select * from reward_redemptions where supermarket_id = p_market order by created_at desc limit 30) z), '[]'));
end $$;

create or replace function public.market_reward_save(p_market smallint, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v market_rewards; v_id bigint := nullif(p->>'id', '')::bigint;
begin
  if not is_market_member(p_market) then raise exception 'Sem permissão para este supermercado.'; end if;
  if char_length(trim(coalesce(p->>'title', ''))) < 3 then raise exception 'Dê um nome para a recompensa.'; end if;
  if v_id is null then
    if (select count(*) from market_rewards where supermarket_id = p_market and active) >= 6 then raise exception 'No máximo 6 recompensas ativas por rede.'; end if;
    insert into market_rewards (supermarket_id, title, value, min_spend, cost_points, valid_days, monthly_stock, active)
    values (p_market, left(trim(p->>'title'), 60), (p->>'value')::numeric, coalesce(nullif(p->>'min_spend', '')::numeric, 0),
            (p->>'cost_points')::int, coalesce(nullif(p->>'valid_days', '')::int, 7), nullif(p->>'monthly_stock', '')::int,
            coalesce((p->>'active')::boolean, true))
    returning * into v;
  else
    update market_rewards set title = left(trim(p->>'title'), 60), value = (p->>'value')::numeric,
           min_spend = coalesce(nullif(p->>'min_spend', '')::numeric, 0), cost_points = (p->>'cost_points')::int,
           valid_days = coalesce(nullif(p->>'valid_days', '')::int, 7), monthly_stock = nullif(p->>'monthly_stock', '')::int,
           active = coalesce((p->>'active')::boolean, active), updated_at = now()
     where id = v_id and supermarket_id = p_market returning * into v;
    if not found then raise exception 'Recompensa não encontrada.'; end if;
  end if;
  return to_jsonb(v);
end $$;

-- o caixa confere o código que o cliente mostra
create or replace function public.market_reward_check(p_market smallint, p_code text, p_total numeric default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare d reward_redemptions;
begin
  if not is_market_member(p_market) then raise exception 'Sem permissão para este supermercado.'; end if;
  select * into d from reward_redemptions where code = upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')) and supermarket_id = p_market for update;
  if not found then raise exception 'Código não encontrado para esta rede.'; end if;
  if d.status = 'usado' then raise exception 'Este código já foi usado em %.', to_char(d.used_at at time zone 'America/Manaus', 'DD/MM às HH24:MI'); end if;
  if d.status = 'cancelado' then raise exception 'O cliente cancelou este código.'; end if;
  if d.expires_at < now() then raise exception 'Este código venceu em %.', to_char(d.expires_at at time zone 'America/Manaus', 'DD/MM'); end if;
  if p_total is not null and p_total < d.min_spend then raise exception 'A compra mínima para este código é de R$ %.', replace(to_char(d.min_spend, 'FM999990.00'), '.', ','); end if;
  update reward_redemptions set status = 'usado', used_at = now(), used_via = 'caixa', receipt_total = p_total where id = d.id;
  return jsonb_build_object('title', d.title, 'value', d.value, 'min_spend', d.min_spend);
end $$;
revoke all on function public.market_rewards_list(smallint) from public, anon;
revoke all on function public.market_reward_save(smallint, jsonb) from public, anon;
revoke all on function public.market_reward_check(smallint, text, numeric) from public, anon;
grant execute on function public.market_rewards_list(smallint) to authenticated;
grant execute on function public.market_reward_save(smallint, jsonb) to authenticated;
grant execute on function public.market_reward_check(smallint, text, numeric) to authenticated;

-- ---------------------------------------------------------------- dados fictícios e "zerar uso"
-- apagar o fictício também tira as recompensas fictícias (os resgates e bônus dos clientes fictícios saem em cascata)
do $$
declare d text;
begin
  if to_regprocedure('public._fic_clear()') is null then return; end if;
  d := pg_get_functiondef('public._fic_clear()'::regprocedure);
  if position('market_rewards' in d) = 0 then
    execute replace(d, '  delete from ad_campaigns where ficticio;', '  delete from ad_campaigns where ficticio;' || chr(10) || '  delete from market_rewards where ficticio;');
  end if;
  -- zerar uso: também os pontos trocados, os bônus e as recompensas
  if to_regprocedure('public.admin_reset_usage(text)') is not null then
    d := pg_get_functiondef('public.admin_reset_usage(text)'::regprocedure);
    if position('point_ledger' in d) = 0 then
      execute replace(d, '''tg_updates'', ''tg_price_refs'',', '''tg_updates'', ''tg_price_refs'', ''point_ledger'', ''reward_redemptions'', ''market_rewards'',');
    end if;
  end if;
end $$;

-- recompensas fictícias para o portal (nunca aparecem no catálogo do cliente)
create or replace function public._fic_rewards() returns void
language plpgsql volatile security definer set search_path = public, auth as $$
declare n_u int;
begin
  delete from market_rewards where ficticio;
  insert into market_rewards (supermarket_id, title, value, min_spend, cost_points, valid_days, monthly_stock, active, ficticio, created_at)
  select s.id, x.title, x.value, x.min_spend, x.cost, 7, x.stock, true, true, now() - interval '40 days'
    from supermarkets s cross join (values ('R$ 5 de desconto no rancho', 5.00, 100.00, 600, 200), ('R$ 15 de desconto no rancho', 15.00, 250.00, 1500, 80)) x(title, value, min_spend, cost, stock)
   where s.active;
  select count(*) into n_u from auth.users where email like '%' || _fic_domain();
  if n_u = 0 then return; end if;
  insert into reward_redemptions (reward_id, supermarket_id, user_id, code, title, value, min_spend, cost_points, status, created_at, expires_at,
                                  used_at, used_via, receipt_total)
  select w.id, w.supermarket_id, u.id, 'TF' || upper(substr(md5(random()::text || w.id || g.k), 1, 7)), w.title, w.value, w.min_spend, w.cost_points,
         case when g.r < 0.62 then 'usado' when g.r < 0.92 then 'ativo' else 'cancelado' end, g.ts, g.ts + interval '8 days',
         case when g.r < 0.62 then least(now(), g.ts + make_interval(hours => 6 + floor(random() * 120)::int)) end,
         case when g.r < 0.62 then (case when random() < 0.55 then 'nota' else 'caixa' end) end,
         case when g.r < 0.62 then round((w.min_spend * (1.05 + random()::numeric * 1.4)), 2) end
    from market_rewards w
    cross join lateral (select k, random() + 0 * w.id r, random() + 0 * w.id ru,
                               now() - make_interval(hours => floor(random() * 700 + 0 * w.id)::int) ts
                          from generate_series(1, case when w.value < 10 then 14 else 6 end) k) g
    cross join lateral (select id from auth.users where email like '%' || _fic_domain() order by md5(g.ru::text || id) limit 1) u
   where w.ficticio;
end $$;
revoke all on function public._fic_rewards() from public, anon, authenticated;

-- o passo 0 de "Gerar dados fictícios" passa a criar as recompensas fictícias
do $$
declare d text; alvo constant text := '    return jsonb_build_object(''step'', 0, ''next'', 1,';
begin
  if to_regprocedure('public.admin_seed_fictitious(integer,integer)') is null then return; end if;
  d := pg_get_functiondef('public.admin_seed_fictitious(integer,integer)'::regprocedure);
  if position('_fic_rewards' in d) = 0 and position(alvo in d) > 0 then
    execute replace(d, alvo, '    perform _fic_rewards();' || chr(10) || alvo);
  end if;
end $$;
