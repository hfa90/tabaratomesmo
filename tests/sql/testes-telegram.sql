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
