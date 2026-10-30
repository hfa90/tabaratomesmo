-- Testes: dados fictícios para apresentação e "Zerar uso do site" (admin).
-- Roda depois de tests/sql/testes.sql (.github/workflows/testes.yml). Tudo desfeito no fim (rollback).
begin;
insert into auth.users (id, email) values
  ('dddddddd-0000-0000-0000-0000000000a1', 'cliente-real@x.test'),
  ('dddddddd-0000-0000-0000-0000000000a2', 'curioso@x.test');
insert into profiles (id, full_name) values
  ('dddddddd-0000-0000-0000-0000000000a1', 'Cliente real'), ('dddddddd-0000-0000-0000-0000000000a2', 'Curioso')
on conflict (id) do nothing;
-- um pouco de uso real antes de tudo
insert into events (kind, session_id, user_id, query) values ('search', 'real-1', 'dddddddd-0000-0000-0000-0000000000a1', 'arroz');
insert into market_members (user_id, supermarket_id, role)
  select 'dddddddd-0000-0000-0000-0000000000a1', min(id), 'admin' from supermarkets where active;

create temp table _antes as
  select (select count(*) from products) produtos, (select count(*) from prices) precos, (select count(*) from stores) lojas,
         (select count(*) from supermarkets) mercados, (select count(*) from market_members) acessos,
         (select count(*) from events where session_id is null or session_id not like 'fic-%') eventos_reais;

-- quem não é master não gera nem zera (fora do SQL Editor, session_user é o do site)
do $$
begin
  perform set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-0000000000a2', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local session authorization authenticated;
  begin
    perform admin_seed_fictitious(0);
    raise exception 'FALHOU: quem não é master gerou dados';
  exception when others then
    if sqlerrm like 'FALHOU%' then raise; end if;
  end;
  begin
    perform admin_reset_usage('ZERAR');
    raise exception 'FALHOU: quem não é master zerou o uso';
  exception when others then
    if sqlerrm like 'FALHOU%' then raise; end if;
  end;
  reset session authorization;
end $$;
reset session authorization;
select set_config('request.jwt.claim.sub', '', false);

-- gerar: todos os passos
do $$
declare r jsonb; s int := 0; c jsonb;
begin
  loop
    r := admin_seed_fictitious(s);
    exit when r->>'next' is null;
    s := (r->>'next')::int;
    if s > 20 then raise exception 'FALHOU: passos sem fim'; end if;
  end loop;
  c := admin_usage_counts();
  assert (c->'ficticio'->>'clientes')::int = 320, 'FALHOU: clientes fictícios ' || (c->'ficticio'->>'clientes');
  assert (c->'ficticio'->>'eventos')::int > 5000, 'FALHOU: poucos eventos ' || (c->'ficticio'->>'eventos');
  assert (c->'ficticio'->>'notas')::int > 50, 'FALHOU: poucas notas';
  assert (c->'ficticio'->>'listas')::int > 100, 'FALHOU: poucas listas';
  assert (c->'ficticio'->>'alertas')::int > 0 and (c->'ficticio'->>'faltas')::int > 0 and (c->'ficticio'->>'cupons')::int > 0, 'FALHOU: alertas/faltas/cupons';
  assert (c->'real'->>'eventos')::int = (select eventos_reais from _antes), 'FALHOU: mexeu no uso real';
  -- nada fictício fica no ar para o consumidor
  assert not exists (select 1 from market_campaigns where ficticio and ends_at > now()), 'FALHOU: campanha fictícia no ar';
  assert not exists (select 1 from market_clearance where ficticio and ends_at > now()), 'FALHOU: queima fictícia no ar';
  assert not exists (select 1 from ad_campaigns where ficticio and ends_at > now()), 'FALHOU: anúncio fictício no ar';
  assert not exists (select 1 from profiles pf join auth.users u on u.id = pf.id where u.email like '%' || _fic_domain() and pf.show_in_ranking), 'FALHOU: fictício no ranking';
  assert not exists (select 1 from radar_alerts where ficticio and notified_at is null), 'FALHOU: alerta fictício iria para o Telegram';
  assert not exists (select 1 from missing_reports where ficticio and notified_at is null), 'FALHOU: falta fictícia iria para o Telegram';
  assert not exists (select 1 from events where session_id like 'fic-%' and created_at > now()), 'FALHOU: evento no futuro';
  -- produtos e preços intactos
  assert (select produtos from _antes) = (select count(*) from products) and (select precos from _antes) = (select count(*) from prices), 'FALHOU: mexeu em produtos/preços';
end $$;

-- o portal tem números (dono de um mercado)
do $$
declare m smallint; d jsonb;
begin
  select min(id) into m from supermarkets where active;
  perform set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-0000000000a1', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  d := market_dashboard(m, 30);
  assert (d->'kpis'->>'searches')::int > 100 and (d->'kpis'->>'people')::int > 50, 'FALHOU: painel vazio';
  assert jsonb_array_length(market_customers(m, 90)->'bairros') > 3, 'FALHOU: clientes sem bairros';
  assert (market_sales_proof(m, 30, 7)->'totals'->>'receipts')::int > 0, 'FALHOU: vendas comprovadas vazio';
  assert (market_demand(m, 40)->>'lists')::int > 20, 'FALHOU: demanda vazia';
  assert position('clientes vieram' in market_weekly_digest(m, 7)->>'text') > 0, 'FALHOU: resumo da semana';
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- gerar de novo substitui (não duplica)
do $$
declare s int := 0; r jsonb;
begin
  loop r := admin_seed_fictitious(s); exit when r->>'next' is null; s := (r->>'next')::int; end loop;
  assert (admin_usage_counts()->'ficticio'->>'clientes')::int = 320, 'FALHOU: duplicou clientes';
end $$;

-- apagar só o fictício
do $$
declare c jsonb;
begin
  perform admin_clear_fictitious();
  c := admin_usage_counts();
  assert (c->'ficticio'->>'clientes')::int = 0 and (c->'ficticio'->>'eventos')::int = 0 and (c->'ficticio'->>'notas')::int = 0, 'FALHOU: sobrou fictício';
  assert (c->'ficticio'->>'campanhas')::int = 0 and (c->'ficticio'->>'alertas')::int = 0, 'FALHOU: sobrou campanha/alerta fictício';
  assert (c->'real'->>'eventos')::int = (select eventos_reais from _antes), 'FALHOU: apagou uso real junto';
end $$;

-- zerar tudo: fica só produtos, preços, mercados, lojas, contas e acessos
do $$
declare s int := 0; r jsonb; g int;
begin
  loop r := admin_seed_fictitious(s); exit when r->>'next' is null; s := (r->>'next')::int; end loop;
  begin
    perform admin_reset_usage('zerar');
    raise exception 'FALHOU: zerou sem a confirmação certa';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  select history_gen into g from profiles where id = 'dddddddd-0000-0000-0000-0000000000a1';
  perform admin_reset_usage('ZERAR');
  assert (select count(*) from events) = 0, 'FALHOU: sobrou evento';
  assert (select count(*) from receipts) = 0 and (select count(*) from shopping_lists) = 0, 'FALHOU: sobrou nota/lista';
  assert not exists (select 1 from auth.users where email like '%' || _fic_domain()), 'FALHOU: sobrou cliente fictício';
  assert exists (select 1 from auth.users where id = 'dddddddd-0000-0000-0000-0000000000a1'), 'FALHOU: apagou conta real';
  assert (select produtos from _antes) = (select count(*) from products), 'FALHOU: apagou produto';
  assert (select precos from _antes) = (select count(*) from prices), 'FALHOU: apagou preço';
  assert (select lojas from _antes) = (select count(*) from stores) and (select mercados from _antes) = (select count(*) from supermarkets), 'FALHOU: apagou loja/mercado';
  assert (select acessos from _antes) = (select count(*) from market_members), 'FALHOU: apagou acesso';
  assert (select history_gen from profiles where id = 'dddddddd-0000-0000-0000-0000000000a1') = g + 1, 'FALHOU: aparelhos não vão se limpar';
end $$;

select 'testes-ficticios: tudo certo' as resultado;
rollback;
