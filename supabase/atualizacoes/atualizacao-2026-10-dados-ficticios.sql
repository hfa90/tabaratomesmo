-- =====================================================================
--  Tá Barato Mesmo? — Dados fictícios para apresentação e "Zerar uso" (outubro/2026)
--   • admin_seed_fictitious(passo): cria clientes, visitas, buscas, listas, notas, cupons, alertas e
--     faltas FICTÍCIOS nas 5 redes, para o portal ter números na hora de apresentar.
--     Produtos e preços NÃO são inventados: tudo usa o catálogo e os preços reais.
--     Nada fictício aparece para o consumidor: campanhas e queimas inventadas já nascem encerradas,
--     os clientes fictícios não entram no ranking e não conseguem entrar no site.
--   • admin_clear_fictitious(): apaga só o que é fictício.
--   • admin_reset_usage('ZERAR'): apaga TODO o uso (fictício e real) e deixa só produtos, preços,
--     mercados, lojas, contas e acessos.
--   • admin_usage_counts(): quanto há de cada coisa (fictício x real), para a tela do admin.
--  Rode uma vez no Supabase › SQL Editor (pode rodar de novo sem problema).
-- =====================================================================

-- marca do que é fictício nas tabelas que não dependem de um cliente fictício
alter table public.market_campaigns add column if not exists ficticio boolean not null default false;
alter table public.market_clearance add column if not exists ficticio boolean not null default false;
alter table public.radar_alerts     add column if not exists ficticio boolean not null default false;
alter table public.missing_reports  add column if not exists ficticio boolean not null default false;
alter table public.cover_coupons    add column if not exists ficticio boolean not null default false;
alter table public.ad_campaigns     add column if not exists ficticio boolean not null default false;

-- clientes fictícios: e-mail neste domínio (que não existe), sem senha e bloqueados para entrar
create or replace function public._fic_domain() returns text language sql immutable as $$ select '@ficticio.tabaratomesmo.invalid'::text $$;

-- quem pode gerar/apagar: o master no admin, a chave de serviço ou o SQL Editor
create or replace function public._fic_guard() returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_master() or _is_service() or session_user = 'postgres') then
    raise exception 'Acesso restrito ao administrador master.';
  end if;
end $$;

-- apaga só o que é fictício
create or replace function public._fic_clear() returns jsonb
language plpgsql volatile security definer set search_path = public, auth as $$
declare n_ev int; n_us int;
begin
  delete from events where session_id like 'fic-%';
  get diagnostics n_ev = row_count;
  delete from radar_alerts where ficticio;
  delete from missing_reports where ficticio;
  delete from cover_coupons where ficticio;
  delete from market_clearance where ficticio;
  delete from market_campaigns where ficticio;
  delete from ad_campaigns where ficticio;
  -- os clientes fictícios levam junto (cascata) perfis, listas, notas, cupons e o resto
  delete from auth.users where email like '%' || _fic_domain();
  get diagnostics n_us = row_count;
  return jsonb_build_object('events', n_ev, 'users', n_us);
end $$;
revoke all on function public._fic_clear() from public, anon, authenticated;

-- tabelas de apoio de cada passo (temporárias: somem no fim da transação)
create or replace function public._fic_prepare() returns void
language plpgsql volatile security definer set search_path = public, auth as $$
begin
  -- peso de cada rede na escolha do cliente (as 5 redes de Manaus; outra rede nova entra com peso médio)
  create temp table if not exists _fm (mid smallint, lo float8, hi float8) on commit drop; truncate _fm;
  insert into _fm
  select id, (cw - w) / tot, cw / tot from (
    select id, w, sum(w) over (order by id) cw, sum(w) over () tot from (
      select id, (case id when 1 then 25 when 2 then 25 when 3 then 12 when 4 then 16 when 5 then 22 else 15 end)::float8 w
        from supermarkets where active) a) b;
  update _fm set hi = 1.0000001 where hi = (select max(hi) from _fm);

  -- preço de hoje de cada produto em cada rede (os preços reais)
  create temp table if not exists _fpr (pid int, mid smallint, price numeric) on commit drop; truncate _fpr;
  insert into _fpr
  select distinct on (pr.product_id, pr.supermarket_id) pr.product_id, pr.supermarket_id, pr.price
    from prices pr join products p on p.id = pr.product_id and p.active
    join supermarkets s on s.id = pr.supermarket_id and s.active
    left join market_products mp on mp.product_id = pr.product_id and mp.supermarket_id = pr.supermarket_id
   where coalesce(mp.active, true)
   order by pr.product_id, pr.supermarket_id, pr.collected_at desc;

  -- produtos com preço, numa ordem fixa de "popularidade" (os primeiros saem mais)
  create temp table if not exists _fp (rk int, pid int, q text) on commit drop; truncate _fp;
  insert into _fp
  select row_number() over (order by md5('tb' || p.id)), p.id,
         lower(array_to_string((regexp_split_to_array(trim(p.name), '\s+'))[1:2], ' '))
    from products p where p.active and exists (select 1 from _fpr x where x.pid = p.id);
  -- produtos de cada rede
  create temp table if not exists _fpm (mid smallint, rk int, pid int, price numeric) on commit drop; truncate _fpm;
  insert into _fpm select mid, row_number() over (partition by mid order by md5('tb' || pid)), pid, price from _fpr;

  -- clientes fictícios já criados
  create temp table if not exists _fu (i int, id uuid, bairro text, zone text, gender text, age text, pref smallint) on commit drop; truncate _fu;
  insert into _fu
  select row_number() over (order by u.email), u.id, pf.neighborhood, zone_of(pf.neighborhood), nullif(pf.gender, 'nao_informar'),
         case when pf.birth_date is null then null
              when age(pf.birth_date) < interval '25 years' then '18-24'
              when age(pf.birth_date) < interval '35 years' then '25-34'
              when age(pf.birth_date) < interval '45 years' then '35-44'
              when age(pf.birth_date) < interval '60 years' then '45-59' else '60+' end,
         pf.preferred_markets[1]
    from auth.users u join profiles pf on pf.id = u.id
   where u.email like '%' || _fic_domain();

  create temp table if not exists _fb (i int, name text, zone text) on commit drop; truncate _fb;
  insert into _fb select row_number() over (order by name), name, zone from bairros;

  -- loja mais perto de cada bairro, em cada rede
  create temp table if not exists _fnear (bairro text, mid smallint, store_id int) on commit drop; truncate _fnear;
  insert into _fnear
  select b.name, s.id, (select st.id from stores st where st.supermarket_id = s.id
                         order by case when st.lat is null or b.lat is null then 999 else _km(b.lat, b.lng, st.lat, st.lng) end, st.id limit 1)
    from bairros b cross join supermarkets s where s.active;
end $$;
revoke all on function public._fic_prepare() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- GERAR (em passos curtos, para caber no tempo de uma chamada do site)
--   passo 0: apaga o fictício anterior e cria clientes, campanhas, queimas, alertas, faltas e cupons
--   passos 1..N: visitas, buscas, rotas, notas… de 15 em 15 dias
--   último passo: listas do mês
-- ---------------------------------------------------------------------
create or replace function public.admin_seed_fictitious(p_step int default 0, p_days int default 90)
returns jsonb language plpgsql volatile security definer set search_path = public, auth as $$
declare
  v_days int := greatest(14, least(coalesce(p_days, 90), 180));
  v_chunk constant int := 15;
  v_last int := ceil(v_days::numeric / v_chunk)::int + 1;   -- passo das listas
  d0 int; d1 int; n_u int; n_p int; n_b int; v_n int := 0;
begin
  perform _fic_guard();
  perform set_config('client_min_messages', 'warning', true);
  if p_step < 0 or p_step > v_last then raise exception 'Passo inválido.'; end if;

  -- ================================================================ passo 0
  if p_step = 0 then
    perform _fic_clear();

    -- 320 clientes fictícios: bairro, sexo, idade e rede preferida
    perform _fic_prepare();
    drop table if exists _nu; create temp table _nu on commit drop as
    select g.i, gen_random_uuid() id, b.name bairro, b.lat, b.lng,
           case when g.r1 < 0.55 then 'feminino' when g.r1 < 0.93 then 'masculino' else 'nao_informar' end gender,
           (current_date - ((18 + floor(power(g.r2, 1.25) * 52))::int * 365 + floor(g.r3 * 360)::int)) birth,
           (select mid from _fm where g.r4 >= lo and g.r4 < hi) pref
      from (select i, random() r1, random() r2, random() r3, random() r4, random() rb from generate_series(1, 320) i) g
      cross join lateral (select name, lat, lng from bairros order by md5(g.i::text || g.rb::text || name) limit 1) b;

    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data,
                            created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, banned_until)
    select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', 'cliente' || i || _fic_domain(), '',
           jsonb_build_object('provider', 'ficticio', 'providers', '[]'::jsonb, 'ficticio', true),
           jsonb_build_object('full_name', 'Cliente fictício ' || i),
           now() - make_interval(days => floor(random() * v_days)::int), now(), '', '', '', '', 'infinity'
      from _nu;
    update profiles pf set neighborhood = u.bairro, home_lat = u.lat + (random() - 0.5) * 0.01, home_lng = u.lng + (random() - 0.5) * 0.01,
           home_label = u.bairro, gender = u.gender, birth_date = u.birth,
           preferred_markets = case when u.pref is null then '{}' else array[u.pref] end, show_in_ranking = false
      from _nu u where pf.id = u.id;
    perform _fic_prepare();
    select count(*) into n_u from _fu;

    -- campanhas que JÁ ACABARAM (não aparecem para ninguém no site; servem para "Vendas comprovadas")
    insert into market_campaigns (supermarket_id, kind, title, body, product_ids, cta, audience, radius_km, starts_at, ends_at, status, created_at, ficticio)
    select s.id, c.kind, c.title, c.body, '{}', 'ofertas', 'todos', 2,
           now() - make_interval(days => c.a), now() - make_interval(days => c.b), 'encerrada', now() - make_interval(days => c.a + 1), true
      from supermarkets s cross join (values
        ('janela', 'Terça do Hortifrúti', 'Frutas, verduras e legumes com preço especial toda terça.', 38, 31),
        ('vitrine', 'Semana da Carne', 'Cortes bovinos, frango e linguiça com preço de atacado.', 17, 10)) c(kind, title, body, a, b)
     where s.active;

    -- um anúncio pago que JÁ ACABOU (entra no gasto do "Resumo da semana"; não aparece mais no site)
    insert into ad_campaigns (supermarket_id, slot, title, teaser, body, image_url, cta, target_type, starts_at, ends_at, price, status, paid, created_at, reviewed_at, ficticio)
    select s.id, 'home', 'Seu rancho mais barato aqui', 'Adivinha onde?', 'Ofertas da semana para quem vem pelo Tá Barato Mesmo?.',
           coalesce(nullif(s.logo_url, ''), 'assets/icon-512.png'), 'Ver ofertas', 'store',
           now() - interval '9 days', now() - interval '1 day', round((280 + random() * 260)::numeric, 2), 'aprovada', true,
           now() - interval '10 days', now() - interval '10 days', true
      from supermarkets s where s.active;

    -- queimas de perecíveis que JÁ ACABARAM
    insert into market_clearance (supermarket_id, store_id, product_id, title, note, regular_price, price, qty, expires_on, ends_at,
                                  radius_km, status, claims, notified, created_at, ficticio)
    select x.mid, (select id from stores where supermarket_id = x.mid order by id limit 1), x.pid, left(p.name, 60), 'Gôndola de refrigerados',
           x.price, round(x.price * (0.5 + random()::numeric * 0.12), 2), 40 + floor(random() * 50)::int,
           (now() - make_interval(days => x.k))::date, now() - make_interval(days => x.k), 2,
           case when x.k < 10 then 'esgotada' else 'encerrada' end, 40 + floor(random() * 70)::int, 400 + floor(random() * 600)::int,
           now() - make_interval(days => x.k + 3), true
      from (select f.mid, f.pid, f.price, case f.rn when 1 then 6 else 20 end k
              from (select mid, pid, price, row_number() over (partition by mid order by md5('q' || pid)) rn from _fpm where price >= 3) f
             where f.rn <= 2) x join products p on p.id = x.pid
     where exists (select 1 from stores where supermarket_id = x.mid);

    -- radar: produtos em que outra rede está de fato mais barata hoje
    insert into radar_alerts (supermarket_id, product_id, competitor, comp_price, comp_prev, my_price, lists, near, created_at, notified_at, matched_at, ficticio)
    select x.mid, x.pid, x.comp, x.comp_price, round(x.comp_price + 0.4 + random()::numeric * 1.6, 2), x.my_price, 40 + floor(random() * 380)::int,
           coalesce((select array_agg(nb) from (select st.neighborhood nb from stores st where st.supermarket_id = x.mid and st.neighborhood is not null
                       order by md5(x.pid::text || st.id) limit 2) z), '{}'),
           x.ts, x.ts, case when x.rn = 6 then x.ts + interval '2 hours' end, true
      from (select a.mid, a.pid, b.mid comp, b.price comp_price, a.price my_price,
                   now() - make_interval(hours => 2 + floor(random() * 230)::int) ts,
                   row_number() over (partition by a.mid order by md5(a.pid::text || b.mid::text)) rn
              from _fpr a join _fpr b on b.pid = a.pid and b.mid <> a.mid and b.price < a.price - 0.10 and b.price > a.price * 0.6) x
     where x.rn <= 6
    on conflict do nothing;

    -- "Não achei na loja"
    insert into missing_reports (product_id, store_id, supermarket_id, device, created_at, notified_at, resolved_at, ficticio)
    select f.pid, st.id, f.mid, 'fic-d' || g.k, g.ts, g.ts, case when g.ts < now() - interval '3 days' and random() < 0.45 then g.ts + interval '5 hours' end, true
      from (select s.id mid, k, random() rp, random() rs, now() - make_interval(hours => floor(random() * 330)::int) ts
              from supermarkets s, generate_series(1, 18) k where s.active) g
      join lateral (select pid, mid from _fpm where mid = g.mid order by rk limit 1 offset floor(g.rp * 14)::int) f on true
      join lateral (select id from stores where supermarket_id = g.mid order by md5(g.rs::text || id) limit 1) st on true;

    -- "Cubra a diferença": cupons deste mês
    insert into cover_coupons (code, supermarket_id, user_id, best_market, best_total, my_total, diff, value, min_spend, items, status,
                               created_at, accepted_at, expires_at, used_at, used_via, receipt_total, ficticio)
    select 'TB' || upper(substr(md5(random()::text || c.k || c.mid), 1, 7)), c.mid, u.id,
           (select mid from _fm where mid <> c.mid order by md5(c.k::text || mid) limit 1),
           c.my_total - c.diff, c.my_total, c.diff, ceil(c.diff) + 1, round(c.my_total * 0.8, 2), 12 + floor(random() * 14)::int,
           c.st, c.ts, case when c.st in ('aceito', 'usado') then c.ts + interval '10 minutes' end, c.ts + interval '4 days',
           case when c.st = 'usado' then least(now(), c.ts + make_interval(hours => 3 + floor(random() * 50)::int)) end,
           case when c.st = 'usado' then (case when random() < 0.5 then 'caixa' else 'nota' end) end,
           case when c.st = 'usado' then round(c.my_total * (0.95 + random()::numeric * 0.15), 2) end, true
      from (select s.id mid, k, round((200 + random() * 230)::numeric, 2) my_total, round((3 + random() * 16)::numeric, 2) diff,
                   case when r < 0.36 then 'usado' when r < 0.56 then 'aceito' when r < 0.66 then 'recusado' else 'oferta' end st,
                   greatest(date_trunc('month', now()) + interval '2 hours', now() - make_interval(hours => floor(random() * 640)::int)) ts, ru
              from supermarkets s, generate_series(1, 16) k, lateral (select random() + 0 * k r, random() + 0 * k ru) rr where s.active) c
      join _fu u on u.i = 1 + floor(c.ru * n_u)::int;

    return jsonb_build_object('step', 0, 'next', 1, 'steps', v_last + 1, 'label', 'Clientes, campanhas, alertas e cupons');
  end if;

  perform _fic_prepare();
  select count(*) into n_u from _fu;
  select count(*) into n_p from _fp;
  select count(*) into n_b from _fb;
  if n_u = 0 then raise exception 'Rode o passo 0 antes.'; end if;
  if n_p = 0 then raise exception 'Não há produtos com preço para usar.'; end if;

  -- ================================================================ passos de visitas
  if p_step < v_last then
    d0 := (p_step - 1) * v_chunk; d1 := least(v_days, p_step * v_chunk);

    drop table if exists _fs; create temp table _fs on commit drop as
    with days as (select g, current_date - g dia from generate_series(d0, d1 - 1) g),
    cnt as (
      select g, dia, greatest(6, round(46 * (1 + 0.35 * (v_days - g)::numeric / v_days)
               * (case extract(dow from dia)::int when 6 then 1.35 when 0 then 1.12 when 5 then 1.1 when 2 then 0.86 else 1 end)
               * (case when extract(day from dia) between 5 and 10 then 1.28 else 1 end)
               * (0.85 + random() * 0.3)))::int n
        from days),
    s as materialized (
      select p_step * 1000000 + row_number() over () sid, c.dia,
             (array[6,7,8,9,10,11,11,12,12,13,14,15,16,17,17,18,18,19,19,19,20,20,21,22])[1 + floor(random() * 24)::int] h,
             floor(random() * 60)::int mi, random() rl, random() ru, random() rm, random() rp, random() rb, random() rb2
        from cnt c, generate_series(1, c.n) k)
    select s.sid, ((s.dia + make_time(s.h, s.mi, 0)) at time zone 'America/Manaus') t,
           case when s.rl < 0.62 then u.id end uid, 'fic-' || s.sid sess,
           case when s.rl < 0.62 then u.bairro when s.rb < 0.75 then b.name end bairro,
           case when s.rl < 0.62 then u.zone when s.rb < 0.75 then b.zone end zone,
           case when s.rl < 0.62 then u.gender end gender,
           case when s.rl < 0.62 then u.age end age,
           coalesce(case when s.rl < 0.62 and s.rp < 0.45 then u.pref end, m.mid) mid,
           null::int store,
           random() < 0.32 x_route, random() x_r, random() < 0.14 x_rancho, random() < 0.09 x_bought, random() < 0.12 x_promo,
           random() < 0.07 x_ad, random() < 0.03 x_cover, random() x_rc
      from s
      left join _fu u on u.i = 1 + floor(s.ru * n_u)::int
      left join _fb b on b.i = 1 + floor(s.rb2 * n_b)::int
      join _fm m on s.rm >= m.lo and s.rm < m.hi;
    delete from _fs where t > now() - interval '5 minutes';
    update _fs set store = coalesce((select n.store_id from _fnear n where n.bairro = _fs.bairro and n.mid = _fs.mid),
                                    (select st.id from stores st where st.supermarket_id = _fs.mid order by md5(_fs.sid::text || st.id) limit 1));

    -- buscas (algumas sem resultado: o que o público procura e não acha)
    insert into events (created_at, kind, session_id, user_id, query, results, neighborhood, zone, gender, age_band)
    select x.t + make_interval(secs => x.k * 25), 'search', x.sess, x.uid,
           case when x.rq < 0.07 then (array['leite moça','tapioca','sabão de coco','fralda pampers','queijo coalho','pão integral','ração de gato','carvão'])[1 + floor(x.rq2 * 8)::int] else p.q end,
           case when x.rq < 0.07 then 0 else 3 + floor(x.rq2 * 10)::int end,
           x.bairro, x.zone, x.gender, x.age
      from (select s.*, k, 1 + floor(power(random(), 1.8) * n_p)::int rk, random() rq, random() rq2
              from _fs s, generate_series(1, 1 + floor(random() * 3 + 0 * s.sid)::int) k) x
      join _fp p on p.rk = x.rk;
    get diagnostics v_n = row_count;

    -- produtos vistos e adicionados ao rancho
    insert into events (created_at, kind, session_id, user_id, product_id, neighborhood, zone, gender, age_band)
    select x.t + make_interval(secs => 60 + x.k * 40), 'view', x.sess, x.uid, p.pid, x.bairro, x.zone, x.gender, x.age
      from (select s.*, k, 1 + floor(power(random(), 1.6) * n_p)::int rk from _fs s, generate_series(1, 2 + floor(random() * 5 + 0 * s.sid)::int) k) x
      join _fp p on p.rk = x.rk;
    insert into events (created_at, kind, session_id, user_id, product_id, neighborhood, zone, gender, age_band)
    select x.t + make_interval(secs => 300 + x.k * 30), 'add', x.sess, x.uid, p.pid, x.bairro, x.zone, x.gender, x.age
      from (select s.*, k, 1 + floor(power(random(), 1.6) * n_p)::int rk from _fs s, generate_series(1, 1 + floor(random() * 4 + 0 * s.sid)::int) k
             where s.x_r < 0.42) x
      join _fp p on p.rk = x.rk;

    -- rota até a loja e chegada na loja
    insert into events (created_at, kind, session_id, user_id, supermarket_id, store_id, neighborhood, zone, gender, age_band)
    select t + interval '6 minutes', 'route', sess, uid, mid, store, bairro, zone, gender, age from _fs where x_route;
    insert into events (created_at, kind, session_id, user_id, supermarket_id, store_id, neighborhood, zone, gender, age_band)
    select least(now(), t + make_interval(mins => 30 + floor(random() * 90)::int)), 'store_visit', sess, uid, mid, store, bairro, zone, gender, age
      from _fs where (x_route and x_r < 0.8) or (not x_route and x_r < 0.05);

    -- rancho concluído (o mercado mais barato da lista) e compra confirmada
    insert into events (created_at, kind, session_id, user_id, supermarket_id, neighborhood, zone, gender, age_band, value)
    select t + interval '12 minutes', 'rancho_done', sess, uid,
           case when random() < 0.7 then mid else (select m.mid from _fm m order by md5(sid::text || m.mid) limit 1) end,
           bairro, zone, gender, age, round((180 + random() * 380)::numeric, 2)
      from _fs where x_rancho;
    insert into events (created_at, kind, session_id, user_id, supermarket_id, store_id, neighborhood, zone, gender, age_band, value)
    select least(now(), t + interval '55 minutes'), 'bought', sess, uid, mid, store, bairro, zone, gender, age, round((120 + random() * 530)::numeric, 2)
      from _fs where x_bought;

    -- promoção vista, publicidade, "cubra a diferença"
    insert into events (created_at, kind, session_id, user_id, supermarket_id, product_id, neighborhood, zone, gender, age_band)
    select s.t + interval '2 minutes', 'promo_view', s.sess, s.uid, s.mid, f.pid, s.bairro, s.zone, s.gender, s.age
      from _fs s join lateral (select pid from _fpm where mid = s.mid order by rk limit 1 offset floor(s.x_rc * 12)::int) f on true
     where s.x_promo;
    insert into events (created_at, kind, session_id, user_id, supermarket_id, ad_id, neighborhood, zone, gender, age_band)
    select s.t + interval '90 seconds', k, s.sess, s.uid, s.mid,
           (select a.id from ad_campaigns a where a.ficticio and a.supermarket_id = s.mid and s.t between a.starts_at and a.ends_at limit 1),
           s.bairro, s.zone, s.gender, s.age
      from _fs s, unnest(case when s.x_rc < 0.3 then array['ad_view', 'ad_reveal'] else array['ad_view'] end) k
     where s.x_ad or (s.x_r < 0.12 and exists (select 1 from ad_campaigns a where a.ficticio and a.supermarket_id = s.mid and s.t between a.starts_at and a.ends_at));
    insert into events (created_at, kind, session_id, user_id, supermarket_id, neighborhood, zone, gender, age_band)
    select t + interval '15 minutes', k, sess, uid, mid, bairro, zone, gender, age
      from _fs, unnest(case when x_rc < 0.4 then array['cover_view', 'cover_accept'] else array['cover_view'] end) k where x_cover;

    -- campanhas e queimas (só no período em que estavam no ar)
    insert into events (created_at, kind, session_id, user_id, supermarket_id, campaign_id, neighborhood, zone, gender, age_band)
    select s.t + interval '30 seconds', k, s.sess, s.uid, s.mid, c.id, s.bairro, s.zone, s.gender, s.age
      from _fs s join market_campaigns c on c.ficticio and c.supermarket_id = s.mid and s.t between c.starts_at and c.ends_at,
           unnest(case when s.x_rc < 0.35 then array['camp_view', 'camp_click'] else array['camp_view'] end) k
     where s.x_r < 0.3;
    insert into events (created_at, kind, session_id, user_id, supermarket_id, campaign_id, neighborhood, zone, gender, age_band)
    select s.t + interval '40 seconds', k, s.sess, s.uid, s.mid, c.id, s.bairro, s.zone, s.gender, s.age
      from _fs s join market_clearance c on c.ficticio and c.supermarket_id = s.mid and s.t between c.created_at and c.ends_at,
           unnest(case when s.x_rc < 0.18 then array['clear_view', 'clear_claim'] else array['clear_view'] end) k
     where s.x_r > 0.75;

    -- notas fiscais: quem teve contato com o mercado e comprou lá em até 4 dias (e um grupo de controle sem contato)
    drop table if exists _frc; create temp table _frc on commit drop as
    select s.uid, s.mid, s.store, least(now() - interval '2 minutes', s.t + make_interval(hours => 1 + floor(random() * 90)::int)) issued
      from _fs s
     where s.uid is not null
       and ((( s.x_route or s.x_promo or s.x_ad or s.x_cover
               or exists (select 1 from market_campaigns c where c.ficticio and c.supermarket_id = s.mid and s.t between c.starts_at and c.ends_at)
               or exists (select 1 from market_clearance c where c.ficticio and c.supermarket_id = s.mid and s.t between c.created_at and c.ends_at))
             and random() < 0.28)
         or random() < 0.05);
    with ins as (
      insert into receipts (created_at, user_id, chave, source, supermarket_id, store_id, market_confirmed, store_name, issued_at, total,
                            items_count, matched_count, points, status)
      select r.issued + interval '20 minutes', r.uid,
             lpad((floor(random() * 9e14))::bigint::text, 15, '0') || lpad((floor(random() * 9e14))::bigint::text, 15, '0')
               || lpad((p_step * 100000 + row_number() over ())::text, 14, '0'),
             'qr', r.mid, r.store, true, (select name from stores where id = r.store), r.issued,
             round((90 + power(random(), 1.4) * 560)::numeric, 2), 8 + floor(random() * 22)::int, 4, 0, 'verificada'
        from _frc r
      returning id, supermarket_id)
    insert into receipt_items (receipt_id, name, qty, unit, unit_price, total, product_id)
    select ins.id, p.name, q.qty, 'UN', f.price, round(f.price * q.qty, 2), f.pid
      from ins
      cross join lateral (select pid, price from _fpm where mid = ins.supermarket_id and ins.id is not null order by md5(ins.id::text || pid) limit 4) f
      join products p on p.id = f.pid
      cross join lateral (select (1 + floor(random() * 3 + 0 * ins.id))::numeric qty) q;

    return jsonb_build_object('step', p_step, 'next', p_step + 1, 'steps', v_last + 1, 'label', format('Visitas de %s a %s dias atrás', d0, d1), 'searches', v_n);
  end if;

  -- ================================================================ último passo: listas do mês
  drop table if exists _fl; create temp table _fl on commit drop as
  select u.id uid, u.pref, k.m, k.st, random() r
    from _fu u
    cross join lateral (
      select date_trunc('month', now())::date m, case when rr < 0.55 then 'aberta' when rr < 0.78 then 'concluida' end st from (select random() + 0 * u.i rr) z
      union all
      select (date_trunc('month', now()) - interval '1 month')::date, case when random() + 0 * u.i < 0.5 then 'concluida' end) k
   where k.st is not null;
  with ins as (
    insert into shopping_lists (user_id, name, month, status, created_at, updated_at, completed_at, gen)
    select l.uid, 'Rancho de ' || (array['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'])[extract(month from l.m)::int], l.m, l.st,
           l.m + interval '1 day',
           case when l.st = 'aberta' then now() - make_interval(hours => floor(l.r * 280)::int)
                when l.m = date_trunc('month', now())::date then greatest(l.m + interval '2 days', now() - make_interval(hours => floor(l.r * 600)::int))
                else l.m + make_interval(days => 3 + floor(l.r * 24)::int) end,
           case when l.st = 'concluida' then
                case when l.m = date_trunc('month', now())::date then greatest(l.m + interval '2 days', now() - make_interval(hours => floor(l.r * 600)::int))
                     else l.m + make_interval(days => 3 + floor(l.r * 24)::int) end end,
           coalesce((select history_gen from profiles where id = l.uid), 0)
      from _fl l
    on conflict do nothing
    returning id)
  insert into shopping_list_items (list_id, product_id, qty, checked)
  select ins.id, p.pid, 1 + floor(random() * 2 + 0 * p.rk), false
    from ins cross join lateral (select rk, pid from _fp where ins.id is not null order by md5(ins.id::text || pid) limit 7 + (abs(hashtext(ins.id::text)) % 12)) p
  on conflict do nothing;

  -- totais de cada lista: mercado mais barato (com o peso de cada rede), quanto custa e quanto economiza
  update shopping_lists l set
         best_market = z.best, best_total = z.tot, base_total = round(z.tot * (1.05 + random()::numeric * 0.12), 2),
         savings = round(z.tot * (0.05 + random()::numeric * 0.12), 2), items_count = z.n,
         bought_market = case when l.status = 'concluida' then (case when random() < 0.82 then z.best else z.other end) end,
         spent = case when l.status = 'concluida' then round(z.tot * (0.97 + random()::numeric * 0.1), 2) end
    from (select l2.id, count(i.*) n,
                 coalesce(pf.preferred_markets[1], (select mid from _fm order by md5(l2.id::text || mid) limit 1)) best0,
                 null::smallint best, 0::numeric tot, null::smallint other
            from shopping_lists l2 join shopping_list_items i on i.list_id = l2.id left join profiles pf on pf.id = l2.user_id
           where l2.user_id in (select id from _fu) group by l2.id, pf.preferred_markets) z0
    cross join lateral (
      select z0.best0 best, z0.n n,
             coalesce((select round(sum(i.qty * coalesce((select price from _fpr where pid = i.product_id and mid = z0.best0),
                                                         (select min(price) from _fpr where pid = i.product_id))), 2)
                         from shopping_list_items i where i.list_id = z0.id), 0) tot,
             (select mid from _fm where mid <> z0.best0 order by md5(z0.id::text || mid) limit 1) other) z
   where l.id = z0.id;

  analyze events;
  perform admin_note('gerar dados fictícios', jsonb_build_object('dias', v_days,
    'clientes', (select count(*) from _fu), 'eventos', (select count(*) from events where session_id like 'fic-%'),
    'notas', (select count(*) from receipts where user_id in (select id from _fu))));
  return jsonb_build_object('step', p_step, 'next', null, 'steps', v_last + 1, 'label', 'Listas do mês', 'done', true);
end $$;
revoke all on function public.admin_seed_fictitious(int, int) from public, anon;
grant execute on function public.admin_seed_fictitious(int, int) to authenticated;

-- apagar só o fictício (botão do admin)
create or replace function public.admin_clear_fictitious()
returns jsonb language plpgsql volatile security definer set search_path = public, auth as $$
declare r jsonb;
begin
  perform _fic_guard();
  r := _fic_clear();
  perform admin_note('apagar dados fictícios', r);
  return r;
end $$;
revoke all on function public.admin_clear_fictitious() from public, anon;
grant execute on function public.admin_clear_fictitious() to authenticated;

-- ZERAR: apaga todo o uso do site (fictício e real). Ficam produtos, preços, mercados, lojas, contas, acessos e configurações.
create or replace function public.admin_reset_usage(p_confirm text)
returns jsonb language plpgsql volatile security definer set search_path = public, auth as $$
declare r jsonb := '{}'; n int; t text;
begin
  perform _fic_guard();
  if p_confirm is distinct from 'ZERAR' then raise exception 'Digite ZERAR para confirmar.'; end if;
  r := jsonb_build_object('ficticios', _fic_clear());
  foreach t in array array['events', 'shopping_lists', 'shared_lists', 'user_state', 'favorites', 'receipts', 'price_reports', 'ia_readings',
                           'shelf_photos', 'ean_suggestions', 'encarte_imports', 'missing_reports', 'radar_alerts', 'cover_coupons',
                           'market_clearance', 'market_campaigns', 'promotions', 'market_deals', 'ad_campaigns', 'push_log',
                           'tg_updates', 'tg_price_refs', 'tg_link_codes', 'corp_link_codes', 'corp_digest_log'] loop
    if to_regclass('public.' || t) is not null then
      execute format('delete from public.%I where true', t);
      get diagnostics n = row_count;
      r := r || jsonb_build_object(t, n);
    end if;
  end loop;
  -- os aparelhos de quem tem conta também se limpam na próxima abertura (mesmo mecanismo do "Zerar meu histórico")
  perform set_config('app.trusted', 'on', true);
  update profiles set history_gen = history_gen + 1, history_reset_at = now(), comparisons_used = 0 where true;
  perform admin_note('zerar uso do site', r);
  return r;
end $$;
revoke all on function public.admin_reset_usage(text) from public, anon;
grant execute on function public.admin_reset_usage(text) to authenticated;

-- quanto há de cada coisa (para a tela do admin)
create or replace function public.admin_usage_counts()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare fu uuid[];
begin
  perform _fic_guard();
  select coalesce(array_agg(id), '{}') into fu from auth.users where email like '%' || _fic_domain();
  return jsonb_build_object(
    'ficticio', jsonb_build_object(
      'clientes', cardinality(fu),
      'eventos', (select count(*) from events where session_id like 'fic-%'),
      'notas', (select count(*) from receipts where user_id = any(fu)),
      'listas', (select count(*) from shopping_lists where user_id = any(fu)),
      'cupons', (select count(*) from cover_coupons where ficticio),
      'alertas', (select count(*) from radar_alerts where ficticio),
      'faltas', (select count(*) from missing_reports where ficticio),
      'campanhas', (select count(*) from market_campaigns where ficticio) + (select count(*) from market_clearance where ficticio) + (select count(*) from ad_campaigns where ficticio),
      'ultimo', (select max(created_at) from admin_log where action = 'gerar dados fictícios')),
    'real', jsonb_build_object(
      'contas', (select count(*) from auth.users where not (id = any(fu))),
      'eventos', (select count(*) from events where session_id is null or session_id not like 'fic-%'),
      'notas', (select count(*) from receipts where not (user_id = any(fu))),
      'listas', (select count(*) from shopping_lists where not (user_id = any(fu))),
      'precos_informados', (select count(*) from price_reports),
      'promocoes', (select count(*) from promotions),
      'campanhas', (select count(*) from market_campaigns where not ficticio)),
    'fica', jsonb_build_object(
      'produtos', (select count(*) from products), 'precos', (select count(*) from prices),
      'mercados', (select count(*) from supermarkets), 'lojas', (select count(*) from stores)));
end $$;
revoke all on function public.admin_usage_counts() from public, anon;
grant execute on function public.admin_usage_counts() to authenticated;
