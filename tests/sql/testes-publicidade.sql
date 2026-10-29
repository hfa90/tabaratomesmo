-- Testes: publicidade inteligente (busca patrocinada, sugestão na lista, hora de repor).
-- Roda depois de tests/sql/testes.sql (.github/workflows/testes.yml). Tudo desfeito no fim.
begin;
insert into auth.users (id, email) values ('bbbbbbbb-0000-0000-0000-0000000000d1', 'gerente-ads@x.com');
do $$
declare ma smallint; pid int; sem int; cat smallint;
begin
  select id into ma from supermarkets where active order by id limit 1;
  update supermarkets set portal_enabled = true where id = ma;
  insert into market_members (user_id, supermarket_id, role) values ('bbbbbbbb-0000-0000-0000-0000000000d1', ma, 'admin');
  select id into cat from categories order by id limit 1;
  insert into products (name, brand, unit, category_id, active) values ('Café teste', 'Marca Boa', '500 g', cat, true) returning id into pid;
  insert into prices (product_id, supermarket_id, price, source) values (pid, ma, 15.90, 'mercado');
  insert into products (name, brand, unit, category_id, active) values ('Sem preço aqui', 'X', '1 un', cat, true) returning id into sem;
  perform set_config('t.ma', ma::text, false); perform set_config('t.pid', pid::text, false); perform set_config('t.sem', sem::text, false);
  assert (select count(*) from ad_slots where smart) = 3, 'três espaços inteligentes';
end $$;

set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-0000000000d1';
do $$
declare ma smallint := current_setting('t.ma')::smallint; r jsonb; plan int;
  base jsonb;
begin
  select id into plan from ad_plans where active order by sort limit 1;
  base := jsonb_build_object('supermarket_id', ma, 'slot', 'busca', 'plan_id', plan, 'starts_at', now() + interval '1 hour', 'body', 'Café a R$ 15,90 só esta semana');
  -- sem produto
  begin perform market_ad_request(base); raise exception 'aceitou sem produto';
  exception when others then if sqlerrm not like '%Escolha o produto%' then raise; end if; end;
  -- produto sem preço no mercado
  begin perform market_ad_request(base || jsonb_build_object('target_value', current_setting('t.sem'))); raise exception 'aceitou produto sem preço';
  exception when others then if sqlerrm not like '%não tem preço%' then raise; end if; end;
  -- certo: sem imagem (usa a do produto), título automático, palavras-chave limpas
  r := market_ad_request(base || jsonb_build_object('target_value', current_setting('t.pid'), 'keywords', jsonb_build_array(' Café Forte ', 'cafe', '', 'expresso')));
  assert r->>'target_type' = 'product' and r->>'target_value' = current_setting('t.pid'), 'anúncio ligado ao produto';
  assert r->>'title' like 'Café teste%', 'título vem do produto';
  assert r->'keywords' @> '["café forte", "cafe", "expresso"]'::jsonb and jsonb_array_length(r->'keywords') = 3, format('palavras-chave em minúsculas (veio %s)', r->'keywords');
  perform set_config('t.ad', r->>'id', false);
  -- formato antigo continua exigindo imagem
  begin perform market_ad_request(jsonb_build_object('supermarket_id', ma, 'slot', 'grid', 'plan_id', plan, 'starts_at', now() + interval '1 hour', 'title', 'Qual café baixou?'));
    raise exception 'formato antigo sem imagem'; exception when others then if sqlerrm not like '%imagem%' then raise; end if; end;
end $$;
reset role;

-- aprovado e pago: aparece no ads_live com preço e categoria
do $$
declare a record;
begin
  update ad_campaigns set status = 'aprovada', paid = true, starts_at = now() - interval '1 minute' where id = current_setting('t.ad')::bigint;
  select * into a from ads_live() where id = current_setting('t.ad')::bigint;
  assert a.smart and a.product_id = current_setting('t.pid')::int and a.price = 15.90 and a.category_slug is not null, format('ads_live com produto (veio %s)', to_jsonb(a));
  insert into events (kind, ad_id, product_id) values ('ad_view', a.id, a.product_id), ('add', a.id, a.product_id), ('add', a.id, a.product_id);
end $$;
set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-0000000000d1';
do $$
declare x jsonb;
begin
  select e into x from jsonb_array_elements(market_ads(current_setting('t.ma')::smallint)) e where (e->>'id')::bigint = current_setting('t.ad')::bigint;
  assert (x->>'adds')::int = 2 and (x->>'smart')::boolean and x->>'product_name' = 'Café teste', format('métricas do anúncio (veio %s)', x);
end $$;
rollback;
select 'testes-publicidade: ok' as resultado;
