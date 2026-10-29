-- Testes: vendas comprovadas, "cubra a diferença", previsão de demanda, queima de perecíveis e pontos em dobro.
-- Roda depois de tests/sql/testes.sql (.github/workflows/testes.yml). Tudo dentro de uma transação desfeita no fim.
begin;
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-0000000000c1', 'gerente-parceiro@x.com'),
  ('aaaaaaaa-0000-0000-0000-0000000000c2', 'cliente1@x.com'),
  ('aaaaaaaa-0000-0000-0000-0000000000c3', 'cliente2@x.com'),
  ('aaaaaaaa-0000-0000-0000-0000000000c4', 'cliente3@x.com'),
  ('aaaaaaaa-0000-0000-0000-0000000000c5', 'cliente4@x.com'),
  ('aaaaaaaa-0000-0000-0000-0000000000c6', 'cliente5@x.com');
insert into profiles (id, full_name) select id, email from auth.users where email like 'cliente%@x.com' or email = 'gerente-parceiro@x.com' on conflict do nothing;

do $$
declare ma smallint; mb smallint; cat smallint; pids int[] := '{}'; pid int; i int;
begin
  -- dois mercados novos, só para o teste (A = parceiro que perde por pouco, B = o mais barato)
  insert into supermarkets (slug, name, color, active, portal_enabled, cnpj_raiz) values ('teste-a', 'Mercado Teste A', '#123456', true, true, '{11111111}') returning id into ma;
  insert into supermarkets (slug, name, color, active, portal_enabled) values ('teste-b', 'Mercado Teste B', '#654321', true, true) returning id into mb;
  update supermarkets set active = false where id not in (ma, mb); -- só os dois contam no rancho
  insert into stores (supermarket_id, name, lat, lng) values (ma, 'A Centro', -3.10, -60.02), (mb, 'B Centro', -3.11, -60.03);
  insert into market_members (user_id, supermarket_id, role) values ('aaaaaaaa-0000-0000-0000-0000000000c1', ma, 'admin');
  select id into cat from categories order by id limit 1;
  for i in 1..6 loop
    insert into products (name, brand, unit, category_id, active) values ('Produto teste ' || i, 'Marca', '1 un', cat, true) returning id into pid;
    pids := pids || pid;
    insert into prices (product_id, supermarket_id, price, source) values (pid, ma, 12.00, 'mercado'), (pid, mb, 10.00, 'mercado');
  end loop;
  perform set_config('t.ma', ma::text, false); perform set_config('t.mb', mb::text, false);
  perform set_config('t.pids', array_to_string(pids, ','), false);
end $$;

-- ------------------------------------------------------------ marca
do $$
declare ma smallint := current_setting('t.ma')::smallint;
begin
  begin update supermarkets set brand_primary = 'vermelho' where id = ma; raise exception 'aceitou cor inválida';
  exception when check_violation then null; end;
  update supermarkets set brand_primary = '#C21A19', brand_accent = '#F29100' where id = ma;
  assert (select brand_primary from supermarkets where id = ma) = '#C21A19', 'cor da marca gravada';
  assert ma = any(partner_markets()), 'mercado com gerente ativo é parceiro';
  assert not (current_setting('t.mb')::smallint = any(partner_markets())), 'mercado sem gerente não é parceiro';
end $$;

-- ------------------------------------------------------------ cubra a diferença: regras (só quem é do mercado)
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c2';
do $$
begin
  begin perform market_cover_save(current_setting('t.ma')::smallint, '{"active": true}'); raise exception 'cliente salvou regra';
  exception when others then if sqlerrm not like '%Sem permissão%' then raise; end if; end;
end $$;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c1';
do $$
declare ma smallint := current_setting('t.ma')::smallint; r jsonb;
begin
  r := market_cover_save(ma, '{"active": true, "max_diff": 15, "min_total": 50, "budget_month": 30, "extra": 1, "valid_days": 3, "min_spend_pct": 80}');
  assert (r->>'active')::boolean and (r->>'max_diff')::numeric = 15, 'regra salva';
  r := market_cover_get(ma);
  assert (r->'rules'->>'budget_month')::numeric = 30 and (r->>'partner')::boolean, 'portal lê a regra';
end $$;

-- cliente conclui o rancho: B ganha por R$ 12 (6 x R$ 2) → A oferece cupom de R$ 13
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c2';
do $$
declare ma smallint := current_setting('t.ma')::smallint; items jsonb; o jsonb; a jsonb; o2 jsonb;
begin
  select jsonb_agg(jsonb_build_object('product_id', x::int, 'qty', 1)) into items from unnest(string_to_array(current_setting('t.pids'), ',')) x;
  o := cover_offer(items);
  assert o is not null, 'gerou contraoferta';
  assert (o->>'supermarket_id')::smallint = ma, 'oferta do mercado que perdeu';
  assert (o->>'diff')::numeric = 12 and (o->>'value')::numeric = 13, format('diferença 12, cupom 13 (veio %s / %s)', o->>'diff', o->>'value');
  assert o->>'code' is null, 'código só aparece depois de aceitar';
  o2 := cover_offer(items);
  assert (o2->>'id') = (o->>'id'), 'não gera outro cupom a cada clique';
  a := cover_accept((o->>'id')::bigint);
  assert a->>'status' = 'aceito' and a->>'code' like 'TB%', 'aceitou e recebeu o código';
  perform set_config('t.code', a->>'code', false);
  assert jsonb_array_length(my_cover_coupons()) = 1, 'aparece em meus cupons';
end $$;

-- outra pessoa: orçamento do mês (R$ 30) ainda cabe mais um de R$ 13; o terceiro não
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c3';
do $$
declare items jsonb; o jsonb;
begin
  select jsonb_agg(jsonb_build_object('product_id', x::int, 'qty', 1)) into items from unnest(string_to_array(current_setting('t.pids'), ',')) x;
  o := cover_offer(items); perform cover_accept((o->>'id')::bigint);
  perform set_config('t.c3', o->>'id', false);
end $$;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c4';
do $$
declare items jsonb;
begin
  select jsonb_agg(jsonb_build_object('product_id', x::int, 'qty', 1)) into items from unnest(string_to_array(current_setting('t.pids'), ',')) x;
  assert cover_offer(items) is null, 'orçamento do mês esgotado: sem oferta';
  -- lista pequena (menos de 5 itens) não gera oferta
  assert cover_offer(jsonb_build_array(jsonb_build_object('product_id', split_part(current_setting('t.pids'), ',', 1)::int, 'qty', 1))) is null, 'lista pequena sem oferta';
end $$;

-- caixa valida o código
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c1';
do $$
declare ma smallint := current_setting('t.ma')::smallint; r jsonb;
begin
  begin perform market_cover_redeem(ma, current_setting('t.code'), 10); raise exception 'aceitou compra abaixo do mínimo';
  exception when others then if sqlerrm not like '%compra mínima%' then raise; end if; end;
  r := market_cover_redeem(ma, lower(current_setting('t.code')), 80);
  assert (r->>'value')::numeric = 13, 'cupom validado no caixa';
  begin perform market_cover_redeem(ma, current_setting('t.code'), 80); raise exception 'usou o cupom duas vezes';
  exception when others then if sqlerrm not like '%já foi usado%' then raise; end if; end;
  r := market_cover_get(ma);
  assert (r->'month'->>'used')::int = 1 and (r->'month'->>'used_value')::numeric = 13, 'portal mostra o cupom usado';
end $$;
reset role;

-- ------------------------------------------------------------ nota: pontos em dobro e cupom comprovado pela nota
do $$
declare ma smallint := current_setting('t.ma')::smallint; r jsonb; p1 int := split_part(current_setting('t.pids'), ',', 1)::int; base int;
begin
  -- cliente 2 (c3) tem cupom aceito de A: a nota de A acima da compra mínima comprova o uso
  r := receipt_ingest('aaaaaaaa-0000-0000-0000-0000000000c3', jsonb_build_object(
        'chave', '1' || repeat('2', 43), 'store', jsonb_build_object('cnpj', '11.111.111/0001-00', 'name', 'A'),
        'date', to_char(now() at time zone 'America/Manaus', 'DD/MM/YYYY HH24:MI'), 'total', '70.00',
        'items', jsonb_build_array(jsonb_build_object('name', 'Produto teste 1', 'product_id', p1, 'qty', 2, 'unit_price', 11.50, 'total', 23))));
  assert (r->>'market_confirmed')::boolean, 'mercado reconhecido pelo CNPJ';
  assert (r->>'partner_bonus')::boolean, 'nota de parceiro marcada';
  base := least(150, 20 + 2 * 1);
  assert (r->>'points')::int >= base * 2, format('pontos em dobro (veio %s)', r->>'points');
  assert r->'coupon_used' is not null, 'cupom comprovado pela nota';
  assert (select status from cover_coupons where id = current_setting('t.c3')::bigint) = 'usado', 'cupom marcado como usado';
  assert (select used_via from cover_coupons where id = current_setting('t.c3')::bigint) = 'nota', 'usado via nota';
end $$;

-- ------------------------------------------------------------ vendas comprovadas
do $$
declare ma smallint := current_setting('t.ma')::smallint; camp bigint; u uuid; i int := 0; r jsonb;
begin
  insert into market_campaigns (supermarket_id, kind, title, starts_at, ends_at) values (ma, 'janela', 'Campanha de terça', now() - interval '5 days', now() + interval '2 days') returning id into camp;
  -- 3 pessoas veem a campanha e mandam nota de A 2 dias depois; 1 pessoa sem conta só vê
  for u in select id from auth.users where email in ('cliente1@x.com', 'cliente3@x.com', 'cliente4@x.com') loop
    i := i + 1;
    insert into events (kind, user_id, supermarket_id, campaign_id, created_at) values ('camp_view', u, ma, camp, now() - interval '4 days');
    insert into receipts (user_id, chave, supermarket_id, market_confirmed, issued_at, total)
    values (u, lpad((900 + i)::text, 44, '9'), ma, true, now() - interval '2 days', 100 * i);
  end loop;
  insert into events (kind, session_id, supermarket_id, campaign_id, created_at) values ('camp_view', 'sem-conta', ma, camp, now() - interval '4 days');
  -- nota fora da janela de 7 dias não conta
  insert into events (kind, user_id, supermarket_id, created_at) values ('route', 'aaaaaaaa-0000-0000-0000-0000000000c6', ma, now() - interval '20 days');
  insert into receipts (user_id, chave, supermarket_id, market_confirmed, issued_at, total)
  values ('aaaaaaaa-0000-0000-0000-0000000000c6', lpad('999', 44, '8'), ma, true, now() - interval '1 day', 500);
  perform set_config('t.camp', camp::text, false);
end $$;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c2';
do $$
begin
  begin perform market_sales_proof(current_setting('t.ma')::smallint, 30, 7); raise exception 'cliente viu o relatório do mercado';
  exception when others then if sqlerrm not like '%Sem permissão%' then raise; end if; end;
end $$;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c1';
do $$
declare r jsonb; c jsonb;
begin
  r := market_sales_proof(current_setting('t.ma')::smallint, 30, 7);
  assert (r->'totals'->>'buyers')::int = 3, format('3 compradores atribuídos (veio %s)', r->'totals'->>'buyers');
  assert (r->'totals'->>'revenue')::numeric = 600, format('R$ 600 em notas (veio %s)', r->'totals'->>'revenue');
  assert (r->'totals'->>'ticket')::numeric = 200, 'ticket médio R$ 200';
  select x into c from jsonb_array_elements(r->'campaigns') x where (x->>'id')::bigint = current_setting('t.camp')::bigint;
  assert (c->>'people')::int = 4 and (c->>'buyers')::int = 3, format('campanha: 4 viram, 3 compraram (veio %s)', c);
  assert (r->'totals'->>'all_receipts')::int >= 5, 'total de notas do mercado no período';
end $$;

-- ------------------------------------------------------------ previsão de demanda
reset role;
do $$
declare ma smallint := current_setting('t.ma')::smallint; mb smallint := current_setting('t.mb')::smallint; p1 int := split_part(current_setting('t.pids'), ',', 1)::int;
begin
  -- 3 listas abertas com o produto 1; uma delas só compara o mercado A (aí A vence)
  insert into user_state (user_id, key, value, updated_at) values
    ('aaaaaaaa-0000-0000-0000-0000000000c2', 'tb.list', jsonb_build_array(jsonb_build_array(p1, 2)), now()),
    ('aaaaaaaa-0000-0000-0000-0000000000c3', 'tb.list', jsonb_build_array(jsonb_build_array(p1, 1)), now()),
    ('aaaaaaaa-0000-0000-0000-0000000000c4', 'tb.list', jsonb_build_array(jsonb_build_array(p1, 1)), now()),
    ('aaaaaaaa-0000-0000-0000-0000000000c4', 'tb.enabled', jsonb_build_array(ma), now())
  on conflict (user_id, key) do update set value = excluded.value, updated_at = excluded.updated_at;
end $$;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c1';
do $$
declare r jsonb; p jsonb; p1 int := split_part(current_setting('t.pids'), ',', 1)::int;
begin
  r := market_demand(current_setting('t.ma')::smallint, 40);
  select x into p from jsonb_array_elements(r->'products') x where (x->>'product_id')::int = p1;
  assert p is not null, 'produto em 3 listas aparece';
  assert (p->>'n_lists')::int = 3 and (p->>'units')::numeric = 4, format('3 listas, 4 unidades (veio %s)', p);
  assert (p->>'wins')::int = 1 and (p->>'free')::int = 1, 'vence só onde é o único comparado';
  assert p->'beats' = '[[10.00, 2]]'::jsonb or (p->'beats'->0->>1)::int = 2, format('preço a bater: R$ 10 em 2 listas (veio %s)', p->'beats');
end $$;

-- ------------------------------------------------------------ queima de perecíveis
do $$
declare ma smallint := current_setting('t.ma')::smallint; mb smallint := current_setting('t.mb')::smallint; id bigint; l jsonb; p1 int := split_part(current_setting('t.pids'), ',', 1)::int;
begin
  begin perform market_clearance_save(jsonb_build_object('supermarket_id', mb, 'title', 'Iogurte', 'regular_price', 5, 'price', 3, 'expires_on', current_date + 2));
    raise exception 'cadastrou queima para outra rede'; exception when others then if sqlerrm not like '%Sem permissão%' then raise; end if; end;
  begin perform market_clearance_save(jsonb_build_object('supermarket_id', ma, 'title', 'Iogurte', 'regular_price', 5, 'price', 6, 'expires_on', current_date + 2));
    raise exception 'aceitou preço maior que o normal'; exception when others then if sqlerrm not like '%menor que o normal%' then raise; end if; end;
  id := market_clearance_save(jsonb_build_object('supermarket_id', ma, 'product_id', p1, 'title', 'Iogurte vence sexta', 'regular_price', 5, 'price', 3,
                                                 'qty', 60, 'expires_on', current_date + 2, 'radius_km', 2));
  assert id is not null, 'queima cadastrada';
  perform set_config('t.clear', id::text, false);
  l := market_clearance_list(ma);
  assert (l->0->>'pct')::int = 40, 'desconto calculado (40%)';
end $$;
reset role;
set local role anon;
do $$
declare l jsonb;
begin
  l := clearance_live(-3.10, -60.02);
  assert exists (select 1 from jsonb_array_elements(l) x where (x->>'id')::bigint = current_setting('t.clear')::bigint), 'aparece para quem está perto';
  l := clearance_live(-2.50, -60.02);
  assert not exists (select 1 from jsonb_array_elements(l) x where (x->>'id')::bigint = current_setting('t.clear')::bigint), 'não aparece para quem está longe';
  assert clearance_claim(current_setting('t.clear')::bigint, 'dev1') = 1, '"vou buscar" contado';
end $$;
reset role;
-- aviso no celular: perto da loja e acompanha o produto
do $$
declare out jsonb; m jsonb;
begin
  insert into push_subscriptions (endpoint, p256dh, auth, user_id, lat, lng, watch_ids, prefs)
  values ('https://push.example/queima', 'k', 'a', null, -3.10, -60.02, array[split_part(current_setting('t.pids'), ',', 1)::int], '{"precos": false, "campanhas": true, "familia": false}');
  insert into push_subscriptions (endpoint, p256dh, auth, user_id, lat, lng, watch_ids, prefs)
  values ('https://push.example/longe', 'k', 'a', null, -2.50, -60.02, array[split_part(current_setting('t.pids'), ',', 1)::int], '{"precos": false, "campanhas": true, "familia": false}');
  out := push_collect(500);
  select x into m from jsonb_array_elements(out) x where x->>'endpoint' = 'https://push.example/queima';
  -- fora do horário (8h–21h em Manaus) o push_collect não manda nada: só confere quando está no horário
  if extract(hour from now() at time zone 'America/Manaus') between 8 and 20 then
    assert m is not null and m->>'title' like 'Queima no Mercado Teste A%', format('aviso da queima enviado (veio %s)', out);
    assert not exists (select 1 from jsonb_array_elements(out) x where x->>'endpoint' = 'https://push.example/longe'), 'quem está longe não recebe';
  end if;
end $$;

rollback;
select 'testes-parceiros: ok' as resultado;
