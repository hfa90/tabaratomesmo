-- Testes: Cofrinho — bônus da nota (dia, semanas seguidas, desafios), economia, níveis e troca de pontos.
-- Roda depois de tests/sql/testes.sql (.github/workflows/testes.yml). Tudo desfeito no fim (rollback).
begin;
insert into auth.users (id, email) values
  ('eeeeeeee-0000-0000-0000-0000000000f1', 'gerente-cofre@x.test'),
  ('eeeeeeee-0000-0000-0000-0000000000f2', 'cliente-cofre@x.test'),
  ('eeeeeeee-0000-0000-0000-0000000000f3', 'intruso-cofre@x.test');
insert into profiles (id, full_name) select id, email from auth.users where email like '%-cofre@x.test' on conflict do nothing;

do $$
declare ma smallint; mb smallint; cat smallint; pids int[] := '{}'; pid int; i int;
begin
  insert into supermarkets (slug, name, color, active, portal_enabled, cnpj_raiz) values ('cofre-a', 'Mercado Cofre A', '#123456', true, true, '{22222222}') returning id into ma;
  insert into supermarkets (slug, name, color, active, portal_enabled) values ('cofre-b', 'Mercado Cofre B', '#654321', true, true) returning id into mb;
  insert into stores (supermarket_id, name, lat, lng) values (ma, 'A Centro', -3.10, -60.02), (mb, 'B Centro', -3.11, -60.03);
  insert into market_members (user_id, supermarket_id, role) values ('eeeeeeee-0000-0000-0000-0000000000f1', ma, 'admin');
  select id into cat from categories order by id limit 1;
  for i in 1..16 loop
    insert into products (name, brand, unit, category_id, active) values ('Produto cofre ' || i, 'Marca', '1 un', cat, true) returning id into pid;
    pids := pids || pid;
    -- A é mais barato: quem compra em A economiza
    insert into prices (product_id, supermarket_id, price, source) values (pid, ma, 10.00, 'mercado'), (pid, mb, 12.00, 'mercado');
  end loop;
  perform set_config('t.ma', ma::text, false); perform set_config('t.mb', mb::text, false);
  perform set_config('t.pids', array_to_string(pids, ','), false);
end $$;

-- nota de A com n itens
create or replace function pg_temp.nota(p_chave text, p_n int, p_total numeric, p_cnpj text default '22.222.222/0001-00') returns jsonb language plpgsql as $$
declare items jsonb := '[]'; i int; pids int[] := string_to_array(current_setting('t.pids'), ',')::int[];
begin
  for i in 1..p_n loop
    items := items || jsonb_build_array(jsonb_build_object('name', 'Produto cofre ' || i, 'product_id', pids[i], 'qty', 1, 'unit_price', 10.00, 'total', 10.00));
  end loop;
  return receipt_ingest('eeeeeeee-0000-0000-0000-0000000000f2', jsonb_build_object(
    'chave', p_chave, 'store', jsonb_build_object('cnpj', p_cnpj, 'name', 'A'),
    'date', to_char(now() at time zone 'America/Manaus', 'DD/MM/YYYY HH24:MI'), 'total', p_total::text, 'items', items));
end $$;

-- ------------------------------------------------------------ primeira nota do dia, economia, desafios
do $$
declare r jsonb; c jsonb; rid bigint; m jsonb;
begin
  r := pg_temp.nota('2' || repeat('1', 43), 3, 30);
  rid := (r->>'receipt_id')::bigint;
  assert (select delta from point_ledger where user_id = 'eeeeeeee-0000-0000-0000-0000000000f2' and kind = 'dia') = 10, 'FALHOU: +10 da primeira nota do dia';
  perform set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-0000000000f2', true);
  c := receipt_rewards(rid);
  assert (c->>'savings')::numeric = 6.00, 'FALHOU: economia esperada 6,00 (3 itens x R$ 2) veio ' || (c->>'savings');
  assert jsonb_array_length(c->'bonuses') >= 1, 'FALHOU: bônus da nota';
  select x into m from jsonb_array_elements(c->'missions') x where x->>'code' = 'duas_notas';
  assert (m->>'progress')::int = 1 and not (m->>'done')::boolean, 'FALHOU: desafio 2 notas em 1/2';
  select x into m from jsonb_array_elements(c->'missions') x where x->>'code' = 'parceiro';
  assert (m->>'done')::boolean, 'FALHOU: desafio do mercado parceiro';
  assert (c->'level'->>'name') = 'Bronze', 'FALHOU: nível inicial';

  -- segunda nota no mesmo dia, com 15 itens: sem novo +10 do dia; desafios de 2 notas e de 15 itens
  r := pg_temp.nota('2' || repeat('2', 43), 15, 150);
  assert (select count(*) from point_ledger where user_id = 'eeeeeeee-0000-0000-0000-0000000000f2' and kind = 'dia') = 1, 'FALHOU: +10 do dia duas vezes';
  assert exists (select 1 from point_ledger where user_id = 'eeeeeeee-0000-0000-0000-0000000000f2' and kind = 'desafio' and ref like '%:duas_notas'), 'FALHOU: desafio 2 notas pago';
  assert exists (select 1 from point_ledger where user_id = 'eeeeeeee-0000-0000-0000-0000000000f2' and kind = 'desafio' and ref like '%:rancho'), 'FALHOU: desafio 15 itens pago';
  assert (select count(*) from point_ledger where user_id = 'eeeeeeee-0000-0000-0000-0000000000f2' and kind = 'desafio' and ref like '%:parceiro') = 1, 'FALHOU: desafio pago duas vezes';

  c := my_cofrinho();
  assert (c->>'balance')::int = (select sum(points) from receipts where user_id = 'eeeeeeee-0000-0000-0000-0000000000f2')
                                 + (select sum(delta) from point_ledger where user_id = 'eeeeeeee-0000-0000-0000-0000000000f2'), 'FALHOU: saldo = notas + bônus';
  assert (c->'savings'->>'month')::numeric >= 36, 'FALHOU: economia do mês';
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- ------------------------------------------------------------ semanas seguidas
do $$
declare s int;
begin
  insert into receipts (user_id, chave, supermarket_id, market_confirmed, issued_at, created_at, total, points, status)
  select 'eeeeeeee-0000-0000-0000-0000000000f2', '3' || lpad(k::text, 43, '0'), current_setting('t.ma')::smallint, true,
         now() - make_interval(days => 7 * k), now() - make_interval(days => 7 * k), 50, 20, 'verificada'
    from generate_series(1, 3) k;
  s := _streak_weeks('eeeeeeee-0000-0000-0000-0000000000f2');
  assert s = 4, 'FALHOU: 4 semanas seguidas, veio ' || s;
  -- nota velha (enviada muito depois da compra) não conta
  insert into receipts (user_id, chave, supermarket_id, market_confirmed, issued_at, created_at, total, points, status)
  values ('eeeeeeee-0000-0000-0000-0000000000f2', '4' || repeat('0', 43), current_setting('t.ma')::smallint, true, now() - interval '60 days', now() - interval '1 day', 50, 5, 'verificada');
  assert _streak_weeks('eeeeeeee-0000-0000-0000-0000000000f2') = 4, 'FALHOU: nota velha entrou na sequência';
  assert _level(600)->>'name' = 'Prata' and _level(4000)->>'name' = 'Diamante', 'FALHOU: níveis';
end $$;

-- ------------------------------------------------------------ recompensas: cadastrar, trocar, cancelar, usar
do $$
declare ma smallint := current_setting('t.ma')::smallint; w jsonb; d jsonb; d2 jsonb; bal0 int; c jsonb; ok boolean;
begin
  -- quem não é do mercado não vê nem cadastra
  perform set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-0000000000f3', true);
  begin perform market_rewards_list(ma); raise exception 'FALHOU: intruso viu as recompensas'; exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin perform market_reward_save(ma, '{"title":"x","value":5,"cost_points":100}'); raise exception 'FALHOU: intruso cadastrou'; exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;

  perform set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-0000000000f1', true);
  w := market_reward_save(ma, jsonb_build_object('title', 'R$ 5 de desconto', 'value', 5, 'min_spend', 100, 'cost_points', 100, 'valid_days', 7, 'monthly_stock', 2));
  perform set_config('t.rw', w->>'id', false);

  perform set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-0000000000f2', true);
  c := my_cofrinho();
  assert exists (select 1 from jsonb_array_elements(c->'rewards') x where (x->>'id')::bigint = (w->>'id')::bigint), 'FALHOU: recompensa no catálogo';
  bal0 := (c->>'balance')::int;
  d := reward_redeem((w->>'id')::bigint);
  assert length(d->>'code') = 8 and (d->>'code') like 'TB%', 'FALHOU: código ' || (d->>'code');
  assert (d->>'balance')::int = bal0 - 100, 'FALHOU: pontos descontados';
  begin perform reward_redeem((w->>'id')::bigint); raise exception 'FALHOU: dois códigos ativos da mesma recompensa'; exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  perform reward_cancel((d->>'id')::bigint);
  assert _points_balance('eeeeeeee-0000-0000-0000-0000000000f2') = bal0, 'FALHOU: estorno ao cancelar';
  d := reward_redeem((w->>'id')::bigint);
  -- estoque do mês: 2 (o cancelado não conta) -> ainda dá
  perform set_config('t.code1', d->>'code', false);

  -- a próxima nota de A acima da compra mínima usa o código sozinha
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.nota('2' || repeat('3', 43), 12, 120);
  assert (select status from reward_redemptions where code = current_setting('t.code1')) = 'usado', 'FALHOU: código usado pela nota';
  assert (select used_via from reward_redemptions where code = current_setting('t.code1')) = 'nota', 'FALHOU: usado via nota';

  -- outro código, validado no caixa
  perform set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-0000000000f2', true);
  d2 := reward_redeem((w->>'id')::bigint);
  perform set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-0000000000f1', true);
  begin perform market_reward_check(ma, d2->>'code', 50); raise exception 'FALHOU: aceitou abaixo da compra mínima'; exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  perform market_reward_check(ma, lower(d2->>'code'), 130);
  begin perform market_reward_check(ma, d2->>'code', 130); raise exception 'FALHOU: código usado duas vezes'; exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  c := market_rewards_list(ma);
  assert (c->'month'->>'used')::int = 2, 'FALHOU: 2 usados no mês, veio ' || (c->'month'->>'used');
  assert (c->'month'->>'receipts_value')::numeric = 250, 'FALHOU: valor das compras com código';

  -- estoque do mês acabou (2 resgates válidos)
  perform set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-0000000000f2', true);
  begin perform reward_redeem((w->>'id')::bigint); raise exception 'FALHOU: passou do estoque do mês'; exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- ------------------------------------------------------------ desligado pelo admin: sem bônus novos
do $$
declare n int;
begin
  insert into app_settings (key, value) values ('rewards_enabled', 'false') on conflict (key) do update set value = 'false';
  select count(*) into n from point_ledger where user_id = 'eeeeeeee-0000-0000-0000-0000000000f2' and delta > 0;
  delete from point_ledger where user_id = 'eeeeeeee-0000-0000-0000-0000000000f2' and kind = 'dia';
  perform pg_temp.nota('2' || repeat('4', 43), 2, 20);
  assert not exists (select 1 from point_ledger where user_id = 'eeeeeeee-0000-0000-0000-0000000000f2' and kind = 'dia'), 'FALHOU: bônus com o Cofrinho desligado';
  update app_settings set value = 'true' where key = 'rewards_enabled';
end $$;

-- ------------------------------------------------------------ fictícios: recompensas só no portal
do $$
declare s int := 0; r jsonb;
begin
  loop r := admin_seed_fictitious(s); exit when r->>'next' is null; s := (r->>'next')::int; end loop;
  assert exists (select 1 from market_rewards where ficticio), 'FALHOU: recompensas fictícias';
  assert exists (select 1 from reward_redemptions d join market_rewards w on w.id = d.reward_id where w.ficticio), 'FALHOU: resgates fictícios';
  assert not exists (select 1 from jsonb_array_elements(_rewards_catalog('eeeeeeee-0000-0000-0000-0000000000f2')) x
                      join market_rewards w on w.id = (x->>'id')::bigint where w.ficticio), 'FALHOU: fictícia no catálogo do cliente';
  perform admin_clear_fictitious();
  assert not exists (select 1 from market_rewards where ficticio), 'FALHOU: sobrou recompensa fictícia';
  assert exists (select 1 from market_rewards where id = current_setting('t.rw')::bigint), 'FALHOU: apagou recompensa real';
  perform admin_reset_usage('ZERAR');
  assert not exists (select 1 from point_ledger) and not exists (select 1 from market_rewards), 'FALHOU: zerar deixou pontos/recompensas';
end $$;

select 'testes-cofrinho: tudo certo' as resultado;
rollback;
