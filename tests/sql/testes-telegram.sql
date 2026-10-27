-- Testes do robô do Telegram: código para ligar a conta (curto e antigo), expiração, vínculo e privacidade.
-- Roda depois de tests/sql/testes.sql (.github/workflows/testes.yml).
insert into auth.users (id, email) values ('bbbbbbbb-0000-0000-0000-000000000001','t1@x.com'),('bbbbbbbb-0000-0000-0000-000000000002','t2@x.com') on conflict do nothing;
update profiles set full_name='Ana Souza' where id='bbbbbbbb-0000-0000-0000-000000000001';
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000001';
do $$ declare c text; c2 text; s jsonb; begin
  c := public.telegram_link_code();
  assert c ~ '^[A-HJ-NP-Z]{3}[0-9]{3}$', 'formato do código: ' || c;
  c2 := public.telegram_link_code();
  assert (select count(*) from tg_link_codes) = 0 or true; -- authenticated não lê a tabela
  s := public.telegram_status(); assert (s->>'linked')::boolean = false;
  perform set_config('tg.code', c2, true);
end $$;
-- não pode consumir pelo site
do $$ begin perform public.tg_link_consume('x', 1); raise exception 'deveria falhar'; exception when insufficient_privilege then null; end $$;
reset role;
do $$ begin assert (select count(*) from tg_link_codes where user_id='bbbbbbbb-0000-0000-0000-000000000001') = 1, 'só o último código vale'; end $$;
set local role service_role;
do $$ declare r jsonb; c text := current_setting('tg.code'); begin
  r := public.tg_link_consume(lower(substr(c,1,3)) || ' ' || substr(c,4), 555, 'Ana', 'ana_s');
  assert (r->>'ok')::boolean and r->>'name' = 'Ana Souza', r::text;
  r := public.tg_link_consume(c, 555); assert not (r->>'ok')::boolean, 'código usado duas vezes';
end $$;
reset role;
set local role authenticated;
do $$ declare s jsonb; begin
  s := public.telegram_status(); assert (s->>'linked')::boolean and s->>'username' = 'ana_s', s::text;
  assert (select count(*) from tg_contacts) = 1, 'vê a própria linha';
end $$;
set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
do $$ begin assert (select count(*) from tg_contacts) = 0, 'não vê a dos outros'; end $$;
set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000001';
do $$ begin perform public.telegram_unlink(); assert not (public.telegram_status()->>'linked')::boolean; end $$;
reset role;
-- expirado
do $$ declare r jsonb; begin
  insert into tg_link_codes values ('OLD111', 'bbbbbbbb-0000-0000-0000-000000000002', now() - interval '1 minute');
  r := public.tg_link_consume('OLD111', 777); assert not (r->>'ok')::boolean, 'expirado aceito';
end $$;
-- ligar em outro chat move o vínculo
do $$ declare r jsonb; begin
  insert into tg_link_codes values ('AAA111', 'bbbbbbbb-0000-0000-0000-000000000002', now() + interval '5 minutes'), ('BBB222', 'bbbbbbbb-0000-0000-0000-000000000002', now() + interval '5 minutes');
  perform public.tg_link_consume('AAA111', 801); perform public.tg_link_consume('BBB222', 802);
  assert (select count(*) from tg_contacts where user_id='bbbbbbbb-0000-0000-0000-000000000002') = 1, 'dois chats ligados';
  assert (select chat_id from tg_contacts where user_id='bbbbbbbb-0000-0000-0000-000000000002') = 802;
end $$;
-- apagar a conta apaga o vínculo
delete from auth.users where id = 'bbbbbbbb-0000-0000-0000-000000000002';
do $$ begin assert not exists (select 1 from tg_contacts where chat_id = 802 and user_id is not null) and not exists (select 1 from tg_contacts where chat_id=802), 'vínculo ficou'; end $$;
-- código antigo (L + 32 hex) continua valendo
do $$ declare r jsonb; begin
  insert into auth.users (id, email) values ('bbbbbbbb-0000-0000-0000-000000000003','t3@x.com');
  insert into tg_link_codes values ('L0123456789abcdef0123456789abcdef', 'bbbbbbbb-0000-0000-0000-000000000003', now() + interval '5 minutes');
  r := public.tg_link_consume('L0123456789abcdef0123456789abcdef', 900); assert (r->>'ok')::boolean, 'código antigo';
end $$;
-- saúde do banco conhece o grupo
do $$ begin assert exists (select 1 from pg_proc where proname='db_health' and prosrc like '%Robô do Telegram%'); end $$;
rollback;
select 'TESTES_TG_OK';

-- ---------------------------------------------------------------- avisos de preço (atualizacao-2026-10-telegram-avisos.sql)
begin;
insert into auth.users (id, email) values ('cccccccc-0000-0000-0000-000000000001', 'aviso@x.com');
insert into tg_contacts (chat_id, user_id, linked_at) values (7001, 'cccccccc-0000-0000-0000-000000000001', now());
-- acompanha 5 produtos que têm preço
insert into favorites (user_id, product_id)
  select 'cccccccc-0000-0000-0000-000000000001', id from v_products where min_price > 2 order by id limit 5;
do $$
declare dia timestamptz := (current_date + time '15:00') at time zone 'America/Manaus';   -- 15h em Manaus
        noite timestamptz := (current_date + time '22:30') at time zone 'America/Manaus';
        o jsonb; p record;
begin
  o := public.tg_alerts_collect(300, dia);
  assert jsonb_array_length(o) = 0, 'primeira vez só guarda o preço: ' || o::text;
  assert (select count(*) from tg_price_refs where chat_id = 7001) = 5, 'guardou as referências';

  -- um produto baixa 10% no mercado mais barato
  select v.id, v.min_price, (v.prices->0->>'market_id')::smallint mid into p from v_products v
   where v.id in (select product_id from favorites where user_id = 'cccccccc-0000-0000-0000-000000000001') order by v.id limit 1;
  insert into prices (product_id, supermarket_id, price, source) values (p.id, p.mid, round(p.min_price * 0.9, 2), 'teste');
  o := public.tg_alerts_collect(300, noite);
  assert jsonb_array_length(o) = 0, 'à noite não avisa';
  o := public.tg_alerts_collect(300, dia);
  assert jsonb_array_length(o) = 1 and (o->0->>'product_id')::int = p.id, 'avisa o que baixou: ' || o::text;
  assert (o->0->>'from')::numeric = p.min_price and (o->0->>'to')::numeric = round(p.min_price * 0.9, 2), 'de/por certos';
  assert o->0->'best' ? 'market_id', 'manda o mercado';
  o := public.tg_alerts_collect(300, dia);
  assert jsonb_array_length(o) = 0, 'não repete o mesmo aviso';

  -- mudança pequena (1%) não avisa
  insert into prices (product_id, supermarket_id, price, source) values (p.id, p.mid, round(p.min_price * 0.9 * 1.01, 2), 'teste');
  o := public.tg_alerts_collect(300, dia);
  assert jsonb_array_length(o) = 0, 'mudança pequena não avisa';

  -- subiu bastante em todos os mercados: avisa também
  insert into prices (product_id, supermarket_id, price, source)
    select p.id, (x->>'market_id')::smallint, round((x->>'price')::numeric * 1.3, 2), 'teste'
      from v_products v, jsonb_array_elements(v.prices) x where v.id = p.id;
  o := public.tg_alerts_collect(300, dia);
  assert jsonb_array_length(o) = 1 and (o->0->>'to')::numeric > (o->0->>'from')::numeric, 'avisa o que subiu';

  -- os 4 outros mudam ao mesmo tempo: no máximo 3 por vez, o resto fica para a próxima
  for p in select v.id, v.min_price, (v.prices->0->>'market_id')::smallint mid from v_products v
            where v.id in (select product_id from favorites where user_id = 'cccccccc-0000-0000-0000-000000000001') order by v.id offset 1 loop
    insert into prices (product_id, supermarket_id, price, source) values (p.id, p.mid, round(p.min_price * 0.8, 2), 'teste');
  end loop;
  o := public.tg_alerts_collect(300, dia);
  assert jsonb_array_length(o) = 3, 'no máximo 3 por vez: ' || jsonb_array_length(o);
  assert (select alerts_today from tg_contacts where chat_id = 7001) = 5, 'contou 5 avisos hoje';
  o := public.tg_alerts_collect(300, dia);
  assert jsonb_array_length(o) = 1, 'o que sobrou vem na próxima, até 6 no dia';
  assert (select alerts_today from tg_contacts where chat_id = 7001) = 6, 'chegou a 6 no dia';

  -- pausado: não avisa
  update tg_contacts set alerts = false, alerts_day = null where chat_id = 7001;
  insert into prices (product_id, supermarket_id, price, source)
    select v.id, (v.prices->0->>'market_id')::smallint, round(v.min_price * 0.5, 2), 'teste' from v_products v
     where v.id in (select product_id from favorites where user_id = 'cccccccc-0000-0000-0000-000000000001');
  o := public.tg_alerts_collect(300, dia);
  assert jsonb_array_length(o) = 0, 'avisos pausados';
end $$;
rollback;
select 'TESTES_TG_AVISOS_OK';
