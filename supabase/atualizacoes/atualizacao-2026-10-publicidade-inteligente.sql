-- =====================================================================
--  Tá Barato Mesmo? — Publicidade inteligente (outubro/2026)
--  Três formatos novos, sempre de UM produto do supermercado, que só aparecem quando fazem sentido:
--   • busca    — Busca patrocinada: o produto no topo quando alguém procura por ele, pela marca,
--                pela categoria ou pelas palavras que o mercado escolher.
--   • troca    — Sugestão na lista: quem põe na lista um produto parecido (mesma categoria)
--                recebe a sugestão de trocar pelo produto do mercado.
--   • recompra — Hora de repor: quem já comprou esse produto (ou um parecido) vê o anúncio quando
--                costuma estar acabando. A conta é feita NO CELULAR, com as compras guardadas nele:
--                nada sobre a pessoa vai para o mercado.
--  Rode uma vez no Supabase › SQL Editor (pode rodar de novo sem problema).
-- =====================================================================
alter table public.ad_slots add column if not exists smart boolean not null default false;  -- precisa de um produto
alter table public.ad_campaigns add column if not exists keywords text[] not null default '{}';
insert into public.ad_slots (key, name, description, multiplier, max_concurrent, sort, smart) values
  ('busca',    'Busca patrocinada', 'Seu produto no topo quando alguém procura por ele, pela marca, pela categoria ou pelas palavras que você escolher.', 1.40, 3, 6, true),
  ('troca',    'Sugestão na lista', 'Quem põe na lista um produto parecido recebe a sugestão de trocar pelo seu, com o seu preço.', 1.30, 2, 7, true),
  ('recompra', 'Hora de repor',     'Para quem já comprou esse produto ou um parecido, quando costuma estar acabando. A conta é feita no celular da pessoa.', 1.10, 3, 8, true)
on conflict (key) do update set smart = true;

-- Pedido do supermercado (agora com produto e palavras-chave nos formatos inteligentes)
create or replace function public.market_ad_request(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_m smallint := (p->>'supermarket_id')::smallint;
  v_plan ad_plans; v_slot ad_slots; v_start timestamptz := (p->>'starts_at')::timestamptz; v_end timestamptz;
  v_taken int; r ad_campaigns; v_pid int; v_prod products; v_img text; v_title text; v_kw text[] := '{}';
begin
  if not is_market_member(v_m) then raise exception 'Sem permissão para este supermercado.'; end if;
  select * into v_plan from ad_plans where id = (p->>'plan_id')::int and active;
  if not found then raise exception 'Escolha um plano.'; end if;
  select * into v_slot from ad_slots where key = p->>'slot' and active;
  if not found then raise exception 'Escolha um espaço.'; end if;
  if v_start < now() - interval '10 minutes' then raise exception 'Escolha um início no futuro.'; end if;
  v_end := v_start + make_interval(hours => v_plan.hours);
  select count(*) into v_taken from ad_campaigns where slot = v_slot.key and status in ('aprovada','pendente')
     and starts_at < v_end and ends_at > v_start;
  if v_taken >= v_slot.max_concurrent then
    raise exception 'O espaço “%” já está reservado nesse período. Escolha outro horário ou outro espaço.', v_slot.name;
  end if;
  v_img := nullif(p->>'image_url', ''); v_title := nullif(trim(p->>'title'), '');
  if v_slot.smart then
    v_pid := nullif(p->>'target_value', '')::int;
    select * into v_prod from products where id = v_pid and active;
    if not found then raise exception 'Escolha o produto do anúncio.'; end if;
    if not exists (select 1 from prices where product_id = v_pid and supermarket_id = v_m) then
      raise exception 'Este produto ainda não tem preço no seu mercado. Cadastre o preço em Produtos antes.';
    end if;
    if coalesce(trim(p->>'body'), '') = '' then raise exception 'Escreva a mensagem do anúncio.'; end if;
    v_img := coalesce(v_img, v_prod.image_url, '');
    v_title := coalesce(v_title, left(trim(concat_ws(' ', v_prod.name, v_prod.brand)), 40));
    if char_length(v_title) < 6 then v_title := rpad(v_title, 6, ' '); end if;
    select coalesce(array_agg(distinct k), '{}') into v_kw from (
      select lower(left(trim(x), 30)) k from jsonb_array_elements_text(case when jsonb_typeof(p->'keywords') = 'array' then p->'keywords' else '[]' end) x
       where trim(x) <> '' limit 8) z;
  elsif v_img is null then raise exception 'Envie a imagem do anúncio.';
  end if;
  insert into ad_campaigns (supermarket_id, slot, plan_id, title, teaser, body, image_url, cta, target_type, target_value, starts_at, ends_at, price, keywords)
  values (v_m, v_slot.key, v_plan.id, v_title, nullif(trim(p->>'teaser'), ''), nullif(trim(p->>'body'), ''), v_img,
          coalesce(nullif(trim(p->>'cta'), ''), 'Ver oferta'),
          case when v_slot.smart then 'product' else coalesce(nullif(p->>'target_type', ''), 'none') end,
          case when v_slot.smart then v_pid::text else nullif(p->>'target_value', '') end,
          v_start, v_end, round(v_plan.price * v_slot.multiplier), v_kw)
  returning * into r;
  return to_jsonb(r);
end $$;

-- Anúncios no ar (agora com o produto, o preço dele no mercado e as palavras-chave)
drop function if exists public.ads_live();
create or replace function public.ads_live()
returns table (id bigint, slot text, title text, teaser text, body text, image_url text, cta text,
               target_type text, target_value text, supermarket_id smallint, market text, ends_at timestamptz,
               smart boolean, keywords text[], product_id int, category_slug text, price numeric)
language sql stable security definer set search_path = public as $$
  select c.id, c.slot, c.title, c.teaser, c.body, c.image_url, c.cta, c.target_type, c.target_value,
         c.supermarket_id, s.name, c.ends_at, sl.smart, c.keywords,
         case when c.target_type = 'product' then nullif(c.target_value, '')::int end,
         ca.slug,
         (select (e->>'price')::numeric from v_products v, jsonb_array_elements(v.prices) e
           where c.target_type = 'product' and v.id = nullif(c.target_value, '')::int and (e->>'market_id')::smallint = c.supermarket_id limit 1)
  from ad_campaigns c join supermarkets s on s.id = c.supermarket_id join ad_slots sl on sl.key = c.slot
  left join products pr on c.target_type = 'product' and pr.id = nullif(c.target_value, '')::int
  left join categories ca on ca.id = pr.category_id
  where setting_on('ads_enabled') and c.status = 'aprovada' and c.paid and s.active and sl.active
    and now() between c.starts_at and c.ends_at
$$;
grant execute on function public.ads_live() to anon, authenticated;

-- Campanhas do mercado: + quantas vezes o produto foi para a lista a partir do anúncio
create or replace function public.market_ads(p_market smallint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_market_member(p_market) then raise exception 'Sem permissão para este supermercado.'; end if;
  return coalesce((select jsonb_agg(x order by x.starts_at desc) from (
    select c.*, pl.name plan_name, sl.name slot_name, sl.smart,
      (select name from products where c.target_type = 'product' and id = nullif(c.target_value, '')::int) product_name,
      (select count(*) from events e where e.ad_id = c.id and e.kind = 'ad_view') views,
      (select count(*) from events e where e.ad_id = c.id and e.kind = 'ad_reveal') reveals,
      (select count(*) from events e where e.ad_id = c.id and e.kind = 'ad_click') clicks,
      (select count(*) from events e where e.ad_id = c.id and e.kind = 'add') adds
    from ad_campaigns c left join ad_plans pl on pl.id = c.plan_id left join ad_slots sl on sl.key = c.slot
    where c.supermarket_id = p_market) x), '[]');
end $$;
revoke all on function public.market_ad_request(jsonb) from public, anon;
revoke all on function public.market_ads(smallint) from public, anon;
grant execute on function public.market_ad_request(jsonb) to authenticated;
grant execute on function public.market_ads(smallint) to authenticated;

-- saúde do banco confere esta atualização
create or replace function public.db_health()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out jsonb; v_job boolean := null; v_tgjob boolean := null;
begin
  if not is_master() then raise exception 'Só a administração.'; end if;
  if to_regclass('cron.job') is not null then
    execute 'select exists (select 1 from cron.job where jobname = ''tb-notificar'' and active)' into v_job;
    execute 'select exists (select 1 from cron.job where jobname = ''tb-telegram-avisos'' and active)' into v_tgjob;
  end if;
  with req(grp, kind, name) as (values
    ('Base (schema.sql)', 'table', 'public.v_products'),
    ('Base (schema.sql)', 'table', 'public.events'),
    ('Base (schema.sql)', 'func', 'public.track(jsonb)'),
    ('Base (schema.sql)', 'func', 'public.admin_overview(integer)'),
    ('Notas e leitor com IA', 'table', 'public.receipts'),
    ('Notas e leitor com IA', 'table', 'public.ia_readings'),
    ('Zerar histórico', 'col', 'profiles.history_reset_at'),
    ('Zerar histórico', 'func', 'public.reset_my_history()'),
    ('Lista da família', 'table', 'public.shared_lists'),
    ('Sincronizar aparelhos e campanhas', 'table', 'public.user_state'),
    ('Sincronizar aparelhos e campanhas', 'table', 'public.market_campaigns'),
    ('Zerar em todos os aparelhos', 'col', 'user_state.gen'),
    ('Zerar em todos os aparelhos', 'col', 'profiles.history_gen'),
    ('Datas especiais', 'table', 'public.special_events'),
    ('Datas especiais', 'func', 'public.market_event_products_set(text,smallint,jsonb)'),
    ('Uso, avisos e privacidade', 'col', 'events.device_id'),
    ('Uso, avisos e privacidade', 'table', 'public.push_subscriptions'),
    ('Uso, avisos e privacidade', 'func', 'public.push_collect(integer)'),
    ('Uso, avisos e privacidade', 'func', 'public.my_data_export()'),
    ('Uso, avisos e privacidade', 'col', 'supermarkets.shop_url'),
    ('Robô do Telegram', 'table', 'public.tg_contacts'),
    ('Robô do Telegram', 'func', 'public.tg_link_consume(text,bigint,text,text)'),
    ('Avisos de preço no Telegram', 'table', 'public.tg_price_refs'),
    ('Avisos de preço no Telegram', 'func', 'public.tg_alerts_collect(integer,timestamptz)'),
    ('Mapa de unidades (OpenStreetMap)', 'col', 'stores.osm_ref'),
    ('Promoção por unidade e mapa no portal', 'col', 'promotions.store_id'),
    ('Promoção por unidade e mapa no portal', 'table', 'public.v_store_promos'),
    ('Promoção por unidade e mapa no portal', 'func', 'public.market_save_store(jsonb)'),
    ('Parceiros: vendas comprovadas, cubra a diferença, demanda e queima', 'col', 'supermarkets.brand_primary'),
    ('Parceiros: vendas comprovadas, cubra a diferença, demanda e queima', 'func', 'public.market_sales_proof(smallint,integer,integer)'),
    ('Parceiros: vendas comprovadas, cubra a diferença, demanda e queima', 'table', 'public.cover_coupons'),
    ('Parceiros: vendas comprovadas, cubra a diferença, demanda e queima', 'func', 'public.market_demand(smallint,integer)'),
    ('Parceiros: vendas comprovadas, cubra a diferença, demanda e queima', 'table', 'public.market_clearance'),
    ('Parceiros: vendas comprovadas, cubra a diferença, demanda e queima', 'func', 'public.tg_clearance_collect(timestamptz)'),
    ('Publicidade inteligente (busca, troca, hora de repor)', 'col', 'ad_campaigns.keywords'),
    ('Publicidade inteligente (busca, troca, hora de repor)', 'col', 'ad_slots.smart')
  ), chk as (
    select grp, kind, name, case kind
      when 'table' then to_regclass(name) is not null
      when 'func' then to_regprocedure(name) is not null
      when 'col' then exists (select 1 from information_schema.columns c where c.table_schema = 'public'
                                and c.table_name = split_part(name, '.', 1) and c.column_name = split_part(name, '.', 2))
    end ok from req
  )
  select jsonb_build_object(
    'checks', (select jsonb_agg(to_jsonb(chk)) from chk),
    'extensions', jsonb_build_object(
      'pg_cron', exists (select 1 from pg_extension where extname = 'pg_cron'),
      'pg_net', exists (select 1 from pg_extension where extname = 'pg_net')),
    'push_job', v_job,
    'push_subs', (select count(*) from push_subscriptions),
    'events_30d', (select count(*) from events where created_at >= now() - interval '30 days'),
    'telegram_contacts', (select count(*) from tg_contacts),
    'telegram_linked', (select count(*) from tg_contacts where user_id is not null),
    'telegram_job', v_tgjob
  ) into out;
  return out;
end $$;
revoke all on function public.db_health() from public, anon;
grant execute on function public.db_health() to authenticated;
