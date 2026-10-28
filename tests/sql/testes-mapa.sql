-- Testes do Mapa de unidades: a referência do OpenStreetMap não pode ser cadastrada duas vezes.
-- Roda depois de tests/sql/testes.sql (.github/workflows/testes.yml).
begin;
insert into auth.users (id, email) values ('eeeeeeee-0000-0000-0000-0000000000a1', 'adm-mapa-teste@x.com');
insert into platform_admins (email) values ('adm-mapa-teste@x.com') on conflict do nothing;
set local role authenticated;
set local request.jwt.claim.sub = 'eeeeeeee-0000-0000-0000-0000000000a1';
set local request.jwt.claims = '{"email": "adm-mapa-teste@x.com"}';
do $$
declare m smallint := (select id from supermarkets order by id limit 1); n int;
begin
  perform public.admin_save_store(jsonb_build_object('supermarket_id', m, 'name', 'Teste Mapa A', 'lat', -3.05, 'lng', -60.01,
    'neighborhood', 'Flores', 'opening_hours', 'Seg-Sáb 07:00-22:00', 'osm_ref', 'node/123456'));
  assert (select count(*) from stores where osm_ref = 'node/123456') = 1, 'cadastrou com a referência do mapa';
  begin
    perform public.admin_save_store(jsonb_build_object('supermarket_id', m, 'name', 'Teste Mapa B', 'lat', -3.05, 'lng', -60.01, 'osm_ref', 'node/123456'));
    raise exception 'deveria recusar a mesma unidade duas vezes';
  exception when others then
    if sqlerrm not like '%já está cadastrada%' then raise; end if;
  end;
  begin
    perform public.admin_save_store(jsonb_build_object('supermarket_id', m, 'name', 'X', 'lat', -3.05, 'lng', -60.01, 'osm_ref', 'qualquer coisa'));
    raise exception 'deveria recusar referência inválida';
  exception when others then
    if sqlerrm not like '%inválida%' then raise; end if;
  end;
  -- editar sem mandar horário nem referência mantém os dois
  select id into n from stores where osm_ref = 'node/123456';
  perform public.admin_save_store(jsonb_build_object('id', n, 'supermarket_id', m, 'name', 'Teste Mapa A2', 'lat', -3.051, 'lng', -60.011));
  assert (select opening_hours = 'Seg-Sáb 07:00-22:00' and osm_ref = 'node/123456' and name = 'Teste Mapa A2' from stores where id = n), 'editar não apaga horário nem referência';
  -- ligar uma loja antiga à unidade do mapa
  perform public.admin_save_store(jsonb_build_object('supermarket_id', m, 'name', 'Loja antiga', 'lat', -3.1, 'lng', -60.0));
  select id into n from stores where name = 'Loja antiga';
  perform public.admin_save_store(jsonb_build_object('id', n, 'supermarket_id', m, 'name', 'Loja antiga', 'lat', -3.1, 'lng', -60.0, 'osm_ref', 'way/99'));
  assert (select osm_ref from stores where id = n) = 'way/99', 'ligou a loja antiga ao mapa';
end $$;
reset role;
-- quem não é administrador não cadastra
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002';
set local request.jwt.claims = '{"email": "outro@x.com"}';
do $$ begin
  perform public.admin_save_store(jsonb_build_object('supermarket_id', 1, 'name', 'Invasor', 'lat', -3.05, 'lng', -60.01));
  raise exception 'não-administrador cadastrou loja';
exception when others then if sqlerrm like '%não-administrador%' then raise; end if; end $$;
reset role;
rollback;
select 'TESTES_MAPA_OK';
