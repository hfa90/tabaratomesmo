-- Testes: promoção numa unidade só e o supermercado cadastrando as próprias unidades.
-- Roda depois de tests/sql/testes.sql (.github/workflows/testes.yml).
begin;
insert into auth.users (id, email) values ('ffffffff-0000-0000-0000-0000000000b1', 'gerente-mapa@x.com');
do $$
declare ma smallint; mb smallint;
begin
  select id into ma from supermarkets where active order by id limit 1;
  select id into mb from supermarkets where active and id <> ma order by id limit 1;
  insert into market_members (user_id, supermarket_id, role) values ('ffffffff-0000-0000-0000-0000000000b1', ma, 'admin');
  update supermarkets set portal_enabled = true where id in (ma, mb);
  perform set_config('t.ma', ma::text, true); perform set_config('t.mb', mb::text, true);
  insert into stores (supermarket_id, name, lat, lng) values (mb, 'Loja de outra rede', -3.10, -60.02);
end $$;

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000000b1';
do $$
declare ma smallint := current_setting('t.ma')::smallint; mb smallint := current_setting('t.mb')::smallint; v int; o int;
begin
  -- cadastra a própria unidade
  v := public.market_save_store(jsonb_build_object('supermarket_id', ma, 'name', 'Unidade Teste Flores', 'lat', -3.07, 'lng', -60.015, 'osm_ref', 'node/777'));
  assert v is not null, 'cadastrou a própria unidade';
  -- não cadastra para outra rede
  begin perform public.market_save_store(jsonb_build_object('supermarket_id', mb, 'name', 'X', 'lat', -3.07, 'lng', -60.01));
    raise exception 'cadastrou para outra rede'; exception when others then if sqlerrm not like '%não tem acesso%' then raise; end if; end;
  -- não mexe na loja de outra rede, nem trocando o supermarket_id
  select id into o from stores where name = 'Loja de outra rede';
  begin perform public.market_save_store(jsonb_build_object('id', o, 'supermarket_id', ma, 'name', 'Roubada', 'lat', -3.1, 'lng', -60.0));
    raise exception 'editou loja de outra rede'; exception when others then if sqlerrm not like '%não é do seu supermercado%' then raise; end if; end;
  -- promoção numa unidade da própria rede
  perform set_config('t.store', v::text, true); perform set_config('t.other', o::text, true);
end $$;

-- a promoção da unidade não muda o preço da rede, aparece em v_store_promos
do $$
declare ma smallint := current_setting('t.ma')::smallint; s int := current_setting('t.store')::int; p record; antes numeric; depois numeric; n int;
begin
  select v.id, (select (x->>'price')::numeric from jsonb_array_elements(v.prices) x where (x->>'market_id')::smallint = ma) as preco into p
    from v_products v where v.prices @> jsonb_build_array(jsonb_build_object('market_id', ma)) order by v.id limit 1;
  antes := p.preco;
  insert into promotions (supermarket_id, product_id, kind, promo_price, store_id, title, ends_at)
  values (ma, p.id, 'geral', round(antes * 0.7, 2), s, 'Só na Flores', now() + interval '3 days');
  select (x->>'price')::numeric into depois from v_products v, jsonb_array_elements(v.prices) x where v.id = p.id and (x->>'market_id')::smallint = ma;
  assert depois = antes, format('o preço da rede mudou: %s → %s', antes, depois);
  select count(*) into n from v_store_promos where product_id = p.id and store_id = s and price = round(antes * 0.7, 2) and store = 'Unidade Teste Flores';
  assert n = 1, 'a promoção aparece como da unidade';
  -- unidade de outra rede: o banco recusa
  begin
    insert into promotions (supermarket_id, product_id, kind, promo_price, store_id) values (ma, p.id, 'geral', 1, current_setting('t.other')::int);
    raise exception 'aceitou unidade de outra rede';
  exception when others then if sqlerrm not like '%não é do supermercado%' then raise; end if; end;
end $$;
reset role;

-- quem não é do supermercado vê a promoção (é pública) mas não cadastra lojas
set local role anon;
set local request.jwt.claim.sub = '';
do $$ begin assert (select count(*) from v_store_promos where store = 'Unidade Teste Flores') = 1, 'visitante vê a promoção da unidade'; end $$;
reset role;
rollback;
select 'TESTES_PROMO_UNIDADE_OK';
