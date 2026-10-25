-- =====================================================================
-- "Zerar meu histórico" (Você › Preferências)
-- Rode uma vez no Supabase › SQL Editor (pode rodar de novo sem problema).
--
-- A pessoa recomeça como se fosse nova: lista do mês, ranchos, economia,
-- notas, pontos, ranking e favoritos somem PARA ELA.
-- Nada que os supermercados e a administração usam é apagado:
--   • listas (shopping_lists), notas (receipts), preços enviados (price_reports)
--     e métricas de uso (events) continuam no banco e nos painéis;
--   • o perfil guarda a data do recomeço (history_reset_at) e uma "geração"
--     (history_gen); o site da pessoa só mostra o que veio depois.
-- Só os favoritos são apagados de verdade (não aparecem em painel nenhum).
-- =====================================================================

alter table public.profiles add column if not exists history_reset_at timestamptz;
alter table public.profiles add column if not exists history_gen int not null default 0;

-- cada recomeço abre uma "geração" nova de listas: a lista antiga do mês fica guardada
-- (para os painéis) e a pessoa pode montar outra no mesmo mês
alter table public.shopping_lists add column if not exists gen int not null default 0;
drop index if exists public.shopping_lists_user_month;
create unique index if not exists shopping_lists_user_month_gen on public.shopping_lists (user_id, month, gen);

-- ---------------------------------------------------------------- recomeçar
create or replace function public.reset_my_history()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_gen int;
begin
  if v_uid is null then raise exception 'Entre na sua conta para zerar o histórico.'; end if;
  update public.profiles
     set history_reset_at = now(), history_gen = history_gen + 1, updated_at = now()
   where id = v_uid
  returning history_gen into v_gen;
  delete from public.favorites where user_id = v_uid;
  return jsonb_build_object('reset_at', now(), 'gen', coalesce(v_gen, 0));
end $$;
revoke all on function public.reset_my_history() from public, anon;
grant execute on function public.reset_my_history() to authenticated;

-- data do último recomeço da pessoa (ou o começo dos tempos)
create or replace function public._reset_at(p_uid uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select coalesce((select history_reset_at from public.profiles where id = p_uid), '-infinity'::timestamptz);
$$;
revoke all on function public._reset_at(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- "Minhas notas" só depois do recomeço
create or replace function public.my_receipts(p_limit int default 50)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.issued_at desc nulls last), '[]') from (
    select r.id, r.chave, r.supermarket_id, r.store_name, r.issued_at, r.total, r.items_count, r.matched_count,
           r.prices_added, r.points, r.status, r.market_confirmed,
           (select jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.qty, 'unit_price', i.unit_price, 'total', i.total, 'product_id', i.product_id) order by i.id)
              from receipt_items i where i.receipt_id = r.id) as items
    from receipts r where r.user_id = auth.uid() and r.created_at >= public._reset_at(auth.uid())
    order by r.issued_at desc nulls last limit greatest(1, least(p_limit, 200))) x
$$;
revoke all on function public.my_receipts(int) from public, anon;
grant execute on function public.my_receipts(int) to authenticated;

-- ---------------------------------------------------------------- pontos e impacto só depois do recomeço
create or replace function public.my_impact()
returns jsonb language sql stable security definer set search_path = public as $$
  with since as (select public._reset_at(auth.uid()) t),
  mine as (
    select * from price_reports where user_id = auth.uid() and created_at >= (select t from since)
  ), myrec as (
    select * from receipts where user_id = auth.uid() and created_at >= (select t from since)
  ), pts as (
    -- pontos de cada pessoa contam a partir do recomeço dela
    select pr.user_id, pr.points, pr.created_at from price_reports pr where pr.created_at >= public._reset_at(pr.user_id)
    union all select r.user_id, r.points, r.created_at from receipts r where r.status <> 'recusada' and r.created_at >= public._reset_at(r.user_id)
  ), month_pts as (
    select user_id, sum(points) pts from pts where created_at >= date_trunc('month', now()) group by user_id
  )
  select jsonb_build_object(
    'reports',  (select count(*) from mine),
    'approved', (select count(*) from mine where status = 'aprovado'),
    'receipts', (select count(*) from myrec),
    'receipt_prices', coalesce((select sum(prices_added) from myrec), 0),
    'points',   coalesce((select sum(points) from pts where user_id = auth.uid()), 0),
    'month_points', coalesce((select pts from month_pts where user_id = auth.uid()), 0),
    'helped',   (select count(distinct l.user_id) from shopping_list_items i
                   join shopping_lists l on l.id = i.list_id
                  where l.user_id <> auth.uid()
                    and i.product_id in (select product_id from mine
                                         union select ri.product_id from receipt_items ri join myrec r on r.id = ri.receipt_id
                                          where ri.price_added)),
    'rank',     (select count(*) + 1 from month_pts
                  where pts > coalesce((select pts from month_pts where user_id = auth.uid()), 0))
  );
$$;
revoke all on function public.my_impact() from public, anon;
grant execute on function public.my_impact() to authenticated;

create or replace function public.leaderboard(p_neighborhood text default null, p_limit int default 10)
returns table (name text, neighborhood text, points bigint, reports bigint, is_me boolean)
language sql stable security definer set search_path = public as $$
  with pts as (
    select pr.user_id, pr.points from price_reports pr
     where pr.created_at >= date_trunc('month', now()) and pr.created_at >= public._reset_at(pr.user_id)
    union all select r.user_id, r.points from receipts r
     where r.created_at >= date_trunc('month', now()) and r.status <> 'recusada' and r.created_at >= public._reset_at(r.user_id)
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
revoke all on function public.leaderboard(text, int) from public;
grant execute on function public.leaderboard(text, int) to anon, authenticated;
