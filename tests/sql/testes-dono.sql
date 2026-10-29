-- Testes: o que o dono do mercado vê — resumo da semana, radar da concorrência, diferenciais,
-- "não achei na loja", robô dos supermercados e comparação entre lojas.
-- Roda depois de tests/sql/testes.sql (.github/workflows/testes.yml). Tudo desfeito no fim.
begin;
insert into auth.users (id, email) values
  ('cccccccc-0000-0000-0000-0000000000e1', 'dono@novaera.test'),
  ('cccccccc-0000-0000-0000-0000000000e2', 'cliente-a@x.test'),
  ('cccccccc-0000-0000-0000-0000000000e3', 'intruso@x.test');
insert into profiles (id, full_name, home_lat, home_lng) values
  ('cccccccc-0000-0000-0000-0000000000e1', 'Dono', null, null),
  ('cccccccc-0000-0000-0000-0000000000e2', 'Cliente', -3.101, -60.021),
  ('cccccccc-0000-0000-0000-0000000000e3', 'Intruso', null, null)
on conflict (id) do update set home_lat = excluded.home_lat, home_lng = excluded.home_lng;

do $$
declare ma smallint; mb smallint; cat smallint; pids int[] := '{}'; pid int; i int; sa int; sb int; l uuid;
begin
  insert into supermarkets (slug, name, color, active, portal_enabled) values ('dono-a', 'Mercado do Dono', '#C21A19', true, true) returning id into ma;
  insert into supermarkets (slug, name, color, active, portal_enabled) values ('dono-b', 'Concorrente B', '#00529B', true, true) returning id into mb;
  update supermarkets set active = false where id not in (ma, mb);
  insert into stores (supermarket_id, name, neighborhood, lat, lng) values (ma, 'Loja Centro', 'Centro', -3.10, -60.02) returning id into sa;
  insert into stores (supermarket_id, name, neighborhood, lat, lng) values (ma, 'Loja Longe', 'Tarumã', -2.95, -60.10);
  insert into stores (supermarket_id, name, neighborhood, lat, lng) values (mb, 'B Centro', 'Centro', -3.105, -60.025) returning id into sb;
  insert into market_members (user_id, supermarket_id, role) values ('cccccccc-0000-0000-0000-0000000000e1', ma, 'admin');
  select id into cat from categories order by id limit 1;
  for i in 1..4 loop
    insert into products (name, brand, unit, category_id, active) values ('Produto dono ' || i, 'Marca', '1 un', cat, true) returning id into pid;
    pids := pids || pid;
    insert into prices (product_id, supermarket_id, price, source, collected_at) values (pid, ma, 10.00, 'mercado', now() - interval '2 days'), (pid, mb, 10.50, 'mercado', now() - interval '2 days');
  end loop;
  -- rancho concluído que o Mercado do Dono perdeu por pouco para o B (o B baixou o produto 1)
  insert into shopping_lists (user_id, status, completed_at, best_market, best_total) values ('cccccccc-0000-0000-0000-0000000000e2', 'concluida', now() - interval '1 day', mb, 40) returning id into l;
  insert into shopping_list_items (list_id, product_id, qty) select l, unnest(pids), 1;
  perform set_config('t.ma', ma::text, false); perform set_config('t.mb', mb::text, false);
  perform set_config('t.sa', sa::text, false); perform set_config('t.sb', sb::text, false);
  perform set_config('t.p1', pids[1]::text, false); perform set_config('t.p2', pids[2]::text, false);
end $$;

-- ------------------------------------------------------------ diferenciais da rede
set local role authenticated;
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-0000000000e3';
do $$ begin
  begin perform market_set_profile(current_setting('t.ma')::smallint, '{"services": ["acougue"]}'); raise exception 'intruso editou a página';
  exception when others then if sqlerrm not like '%Sem permissão%' then raise; end if; end;
end $$;
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-0000000000e1';
do $$
declare r jsonb; ma smallint := current_setting('t.ma')::smallint;
begin
  r := market_set_profile(ma, jsonb_build_object('services', jsonb_build_array('acougue', 'entrega', 'inventado', 'acougue'), 'about', 'Rede manauara desde 1990.',
         'whatsapp', '(92) 99999-1234', 'hours', jsonb_build_array(jsonb_build_object('store_id', current_setting('t.sa')::int, 'opening_hours', 'Todos os dias 7h–22h'),
                                                                   jsonb_build_object('store_id', current_setting('t.sb')::int, 'opening_hours', 'invadido'))));
  assert r->'services' @> '["acougue","entrega"]' and jsonb_array_length(r->'services') = 2, format('só serviços válidos, sem repetir (veio %s)', r->'services');
  assert r->>'whatsapp' = '92999991234', 'WhatsApp só com números';
  begin perform market_set_profile(ma, '{"whatsapp": "123"}'); raise exception 'aceitou WhatsApp curto';
  exception when others then if sqlerrm not like '%WhatsApp inválido%' then raise; end if; end;
end $$;
reset role;
do $$ begin
  assert (select opening_hours from stores where id = current_setting('t.sa')::int) = 'Todos os dias 7h–22h', 'horário da própria loja gravado';
  assert (select opening_hours from stores where id = current_setting('t.sb')::int) is distinct from 'invadido', 'não mexe na loja do concorrente';
end $$;

-- ------------------------------------------------------------ "não achei na loja"
set local role anon;
set local request.jwt.claim.sub = '';
do $$
declare n int; sa int := current_setting('t.sa')::int; p1 int := current_setting('t.p1')::int; i int;
begin
  n := report_missing(p1, sa, 'aparelho-1');
  assert n = 1, 'primeiro aviso';
  n := report_missing(p1, sa, 'aparelho-1');
  assert n = 1, 'o mesmo aparelho não conta duas vezes em 12 h';
  n := report_missing(p1, sa, 'aparelho-2');
  assert n = 2, 'outra pessoa soma';
  begin perform report_missing(p1, sa, null); raise exception 'aceitou sem aparelho nem conta';
  exception when others then if sqlerrm not like '%Não deu%' then raise; end if; end;
end $$;
reset role;

-- ------------------------------------------------------------ robô: ligar o Telegram
set local role authenticated;
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-0000000000e3';
do $$ begin
  begin perform market_corp_link_code(current_setting('t.ma')::smallint); raise exception 'intruso gerou código';
  exception when others then if sqlerrm not like '%Sem permissão%' then raise; end if; end;
end $$;
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-0000000000e1';
do $$
declare c text;
begin
  c := market_corp_link_code(current_setting('t.ma')::smallint);
  assert c ~ '^[A-Z]{3}[0-9]{3}$', 'código de 3 letras e 3 números';
  perform set_config('t.code', c, false);
  perform market_corp_set(current_setting('t.ma')::smallint, '{"email": "Dono@NovaEra.test"}');
  perform market_corp_set(current_setting('t.ma')::smallint, '{"send_now": true}');
end $$;
reset role;
do $$
declare r jsonb; ma smallint := current_setting('t.ma')::smallint;
begin
  assert corp_link_consume('xxx999', 777001, 'Ana') is null, 'código errado não liga';
  r := corp_link_consume(lower(substr(current_setting('t.code'), 1, 3)) || ' ' || substr(current_setting('t.code'), 4), 777001, 'Ana');
  assert (r->>'supermarket_id')::smallint = ma, 'ligou com o código (aceita minúsculas e espaço)';
  assert corp_link_consume(current_setting('t.code'), 777002, 'Outro') is null, 'código vale uma vez só';
  assert exists (select 1 from corp_chats(ma, 'radar') where chat_id = 777001), 'contato recebe alertas';
  assert (select email from corp_emails where supermarket_id = ma) = 'dono@novaera.test', 'e-mail em minúsculas';
  assert exists (select 1 from corp_digest_due() where supermarket_id = ma and now_request), '"enviar agora" aparece para o robô';
  -- acesso suspenso: para de receber
  update market_members set suspended = true where supermarket_id = ma;
  assert not exists (select 1 from corp_chats(ma, 'radar')), 'suspenso não recebe';
  update market_members set suspended = false where supermarket_id = ma;
end $$;

-- avisos de falta vão para o robô uma vez
do $$
declare j jsonb; x jsonb;
begin
  j := missing_collect();
  select e into x from jsonb_array_elements(j) e where (e->>'store_id')::int = current_setting('t.sa')::int;
  assert x is not null and (x->>'total24')::int = 2 and x->'chats' @> '[777001]', format('falta com os contatos (veio %s)', j);
  assert jsonb_array_length(missing_collect()) = 0, 'não manda de novo';
  assert corp_resolve_missing(777001, current_setting('t.sa')::int, current_setting('t.p1')::int) = 2, 'resolvido pelo robô';
  begin perform corp_resolve_missing(999, current_setting('t.sa')::int, current_setting('t.p1')::int); raise exception 'estranho resolveu';
  exception when others then if sqlerrm not like '%Sem permissão%' then raise; end if; end;
end $$;

-- ------------------------------------------------------------ radar: o B baixou o produto 1 para R$ 9,50
do $$
declare n int; j jsonb; a jsonb; r jsonb;
begin
  insert into user_state (user_id, key, value, updated_at) values ('cccccccc-0000-0000-0000-0000000000e2', 'tb.list', jsonb_build_array(jsonb_build_array(current_setting('t.p1')::int, 1)), now())
  on conflict (user_id, key) do update set value = excluded.value, updated_at = now();
  insert into prices (product_id, supermarket_id, price, source) values (current_setting('t.p1')::int, current_setting('t.mb')::smallint, 9.50, 'encarte');
  -- o B subiu outro produto: não é alerta
  insert into prices (product_id, supermarket_id, price, source) values (current_setting('t.p2')::int, current_setting('t.mb')::smallint, 11.90, 'encarte');
  n := radar_scan();
  assert n = 1, format('um alerta (veio %s)', n);
  assert radar_scan() = 0, 'não repete o mesmo alerta';
  j := radar_collect();
  a := j->0;
  assert (a->>'comp_price')::numeric = 9.50 and (a->>'my_price')::numeric = 10.00 and (a->>'lists')::int = 1, format('alerta completo (veio %s)', a);
  assert a->'near' @> '["Centro"]' and not (a->'near' @> '["Tarumã"]'), 'só as lojas perto do concorrente';
  assert a->'chats' @> '[777001]', 'vai para o Telegram ligado';
  assert jsonb_array_length(radar_collect()) = 0, 'avisado uma vez';
  begin perform corp_match_price(123, (a->>'id')::bigint); raise exception 'estranho igualou preço';
  exception when others then if sqlerrm not like '%não está ligado%' then raise; end if; end;
  r := corp_match_price(777001, (a->>'id')::bigint);
  assert (r->>'price')::numeric = 9.50, 'igualou';
  assert (select (e->>'price')::numeric from v_products v, jsonb_array_elements(v.prices) e
           where v.id = current_setting('t.p1')::int and (e->>'market_id')::smallint = current_setting('t.ma')::smallint) = 9.50, 'preço novo no site';
  assert (corp_match_price(777001, (a->>'id')::bigint)->>'already')::boolean, 'tocar de novo não grava outra vez';
end $$;

-- ------------------------------------------------------------ resumo da semana
-- volta o produto 1 para o rancho perdido ficar mais caro no Mercado do Dono
do $$
declare p3 int;
begin
  select product_id into p3 from shopping_list_items i join shopping_lists l on l.id = i.list_id
   where l.user_id = 'cccccccc-0000-0000-0000-0000000000e2' and i.product_id not in (current_setting('t.p1')::int, current_setting('t.p2')::int) limit 1;
  insert into prices (product_id, supermarket_id, price, source, collected_at) values
    (current_setting('t.p1')::int, current_setting('t.ma')::smallint, 11.00, 'mercado', now() + interval '1 second'),
    (p3, current_setting('t.ma')::smallint, 12.00, 'mercado', now() + interval '1 second');
end $$;
insert into events (kind, user_id, supermarket_id, store_id, neighborhood, created_at)
values ('store_visit', 'cccccccc-0000-0000-0000-0000000000e2', current_setting('t.ma')::smallint, current_setting('t.sa')::int, 'Centro', now() - interval '2 days'),
       ('rancho_done', null, current_setting('t.ma')::smallint, null, null, now() - interval '1 day');
set local role authenticated;
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-0000000000e3';
do $$ begin
  begin perform market_weekly_digest(current_setting('t.ma')::smallint, 7); raise exception 'intruso viu o resumo';
  exception when others then if sqlerrm not like '%Sem permissão%' then raise; end if; end;
end $$;
-- o robô (chave de serviço) consegue
set local request.jwt.claim.role = 'service_role';
do $$
declare d jsonb;
begin
  d := market_weekly_digest(current_setting('t.ma')::smallint, 7);
  assert (d->>'clients')::int >= 1 and (d->>'visits')::int = 1, format('clientes que vieram pelo site (veio %s)', d->>'clients');
  assert (d->>'ranchos_won')::int = 1, 'rancho ganho';
  assert d->'lost'->0->>'market' = 'Concorrente B' and d->'lost'->0->'products' @> '["Produto dono 1"]', format('perdeu para o B por causa do produto 1 (veio %s)', d->'lost');
  assert (d->'radar'->>'n')::int = 1 and (d->'radar'->>'matched')::int = 1, 'radar no resumo';
  assert (d->'missing'->>'n')::int = 2, 'faltas no resumo';
  assert d->>'text' like '%clientes vieram pelo site%' and d->>'text' like '%por pouco para o Concorrente B por causa do produto dono 1%', format('texto pronto (veio %s)', d->>'text');
end $$;
reset role;

-- ------------------------------------------------------------ comparar as lojas
set local role authenticated;
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-0000000000e1';
do $$
declare j jsonb; c jsonb;
begin
  j := market_stores_compare(current_setting('t.ma')::smallint, 30);
  assert jsonb_array_length(j) = 2, 'as duas lojas da rede';
  select e into c from jsonb_array_elements(j) e where (e->>'id')::int = current_setting('t.sa')::int;
  assert (c->>'visits')::int = 1 and (c->>'lost')::int = 1 and c->'lost_to'->0->>'market' = 'Concorrente B', format('loja Centro perdeu 1 rancho para o B (veio %s)', c);
  assert c->'bairros'->0->>'name' = 'Centro', 'bairro de quem visita';
end $$;
rollback;
select 'testes-dono: ok' as resultado;
