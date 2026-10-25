-- Testes do banco (rodam depois de mock-supabase.sql + schema.sql). Cada bloco falha com mensagem clara.
-- Tudo dentro de uma transação desfeita no fim: o banco de teste fica limpo.
\set ON_ERROR_STOP 1
begin;

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cliente.teste@example.com'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'admin.teste@example.com');
insert into platform_admins (email) values ('admin.teste@example.com') on conflict do nothing;
insert into profiles (id, full_name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Cliente Teste') on conflict (id) do nothing;

-- 1. track() grava telas com o aparelho
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$ begin
  assert track('[{"kind":"screen","query":"ofertas","session":"s1","device":"devA"},{"kind":"tool","query":"calc","session":"s1","device":"devA"},{"kind":"inventado"}]') = 2,
    'track deveria aceitar 2 eventos e ignorar o tipo desconhecido';
  assert (select count(*) from events where device_id = 'devA') = 2, 'device_id não foi gravado';
end $$;

-- 2. painel de uso e saúde do banco só para a administração
do $$ begin
  begin perform admin_usage(30); raise exception 'cliente comum abriu o painel de uso'; exception when others then
    if sqlerrm like 'cliente comum%' then raise; end if; end;
end $$;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002';
do $$ declare u jsonb := admin_usage(30); h jsonb := db_health(); begin
  assert (u->>'active_7')::int >= 1, 'painel de uso sem pessoas ativas';
  assert exists (select 1 from jsonb_array_elements(u->'features') f where f->>'name' = 'ofertas'), 'tela ofertas não aparece no uso';
  assert not exists (select 1 from jsonb_array_elements(h->'checks') c where not (c->>'ok')::boolean), 'db_health acusa algo faltando no schema.sql: ' || h::text;
end $$;

-- 3. avisos com o site fechado: inscrição, preço que baixa, sem repetir, campanha perto, lista da família
set local request.jwt.claim.sub = '';
do $$ declare pid int; mid smallint; r jsonb; begin
  -- horário de Manaus fora de 8h–21h: push_collect não manda nada (regra); só testa a entrega dentro do horário
  if extract(hour from now() at time zone 'America/Manaus') not between 8 and 20 then
    raise notice 'fora do horário de avisos: testes de entrega pulados'; return;
  end if;
  select id, (prices->0->>'market_id')::smallint into pid, mid from v_products order by id limit 1;
  perform push_subscribe(jsonb_build_object('endpoint', 'https://push.example/t1', 'p256dh', 'k', 'auth', 'a', 'device', 'devB',
    'watch_ids', jsonb_build_array(pid), 'lat', -3.105, 'lng', -60.05, 'markets', jsonb_build_array(1)));
  assert jsonb_array_length(push_collect()) = 0, 'primeira rodada só guarda a referência';
  insert into prices (product_id, supermarket_id, price, source) select pid, mid, round(min_price * 0.8, 2), 'mercado' from v_products where id = pid;
  r := push_collect();
  assert jsonb_array_length(r) = 1 and r->0->>'title' like 'Baixou:%', 'preço que baixou não gerou aviso: ' || r::text;
  assert jsonb_array_length(push_collect()) = 0, 'aviso de preço repetido';
end $$;
do $$ begin
  begin perform push_subscribe('{"endpoint":"http://inseguro"}'); raise exception 'aceitou endpoint sem https'; exception when others then
    if sqlerrm like 'aceitou%' then raise; end if; end;
end $$;

-- 4. LGPD: baixar meus dados e excluir a conta
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$ declare d jsonb := my_data_export(); begin
  assert d->'conta'->>'email' = 'cliente.teste@example.com', 'exportação sem o e-mail da conta';
  assert (d->'uso'->>'total_eventos')::int = 2, 'exportação sem os eventos de uso';
  begin perform delete_my_account('sim'); raise exception 'excluiu sem digitar EXCLUIR'; exception when others then
    if sqlerrm like 'excluiu%' then raise; end if; end;
  perform delete_my_account('EXCLUIR');
  assert not exists (select 1 from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'conta não foi apagada';
  assert (select count(*) from events where device_id = 'devA' and user_id is null) = 2, 'eventos deveriam ficar, sem a pessoa';
end $$;

-- 5. administração master não se exclui; loja online só com https
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002';
do $$ begin
  begin perform delete_my_account('EXCLUIR'); raise exception 'master excluiu a própria conta'; exception when others then
    if sqlerrm like 'master%' then raise; end if; end;
  assert market_set_shop_url(1::smallint, 'https://loja.example') = 'https://loja.example', 'não salvou o link da loja';
  begin perform market_set_shop_url(1::smallint, 'http://x'); raise exception 'aceitou link sem https'; exception when others then
    if sqlerrm like 'aceitou%' then raise; end if; end;
end $$;

select 'testes do banco: ok' as resultado;
rollback;
