-- =====================================================================
-- Lista da família (compartilhada ao vivo)
-- Rode uma vez no Supabase › SQL Editor (pode rodar de novo sem problema).
--
-- Cada lista tem um código de 8 letras (ex.: K7QM-2XPA). Quem tem o código
-- vê e mexe na lista; a tabela não pode ser lida direto (sem políticas de RLS):
-- tudo passa pelas funções abaixo, que exigem o código.
-- As mudanças chegam na hora pelo canal "Broadcast" do Realtime (não precisa
-- ligar nada: já vem ativo no Supabase).
-- =====================================================================

create table if not exists public.shared_lists (
  code        text primary key,
  name        text,
  month       text,
  items       jsonb not null default '[]'::jsonb,   -- [{ "product_id": 1, "qty": 2 }]
  checked     jsonb not null default '[]'::jsonb,   -- [1, 5, 9]
  members     int   not null default 1,
  updated_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.shared_lists enable row level security;
-- sem políticas de propósito: ninguém lista ou lê a tabela inteira

-- letra aleatória (sem 0/O, 1/I/L) para o código
create or replace function public._shared_code() returns text
language plpgsql volatile set search_path = public as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  hex text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  c text := '';
  i int;
begin
  for i in 0..7 loop
    c := c || substr(alphabet, 1 + (('x' || substr(hex, i * 2 + 1, 2))::bit(8)::int % length(alphabet)), 1);
  end loop;
  return c;
end $$;

create or replace function public.shared_list_create(p_name text, p_month text, p_items jsonb, p_checked jsonb, p_by text default null)
returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 500 then raise exception 'Lista grande demais'; end if;
  loop
    c := public._shared_code();
    exit when not exists (select 1 from public.shared_lists where code = c);
  end loop;
  insert into public.shared_lists (code, name, month, items, checked, updated_by)
  values (c, left(p_name, 60), left(p_month, 7), coalesce(p_items, '[]'::jsonb), coalesce(p_checked, '[]'::jsonb), left(p_by, 40));
  return c;
end $$;

create or replace function public.shared_list_get(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('code', code, 'name', name, 'month', month, 'items', items, 'checked', checked,
                            'members', members, 'updated_by', updated_by, 'updated_at', updated_at)
  from public.shared_lists where code = upper(replace(p_code, '-', ''));
$$;

create or replace function public.shared_list_join(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  update public.shared_lists set members = least(members + 1, 50) where code = upper(replace(p_code, '-', ''));
  select public.shared_list_get(p_code) into r;
  if r is null then raise exception 'Código não encontrado'; end if;
  return r;
end $$;

create or replace function public.shared_list_put(p_code text, p_name text, p_month text, p_items jsonb, p_checked jsonb, p_by text default null)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare t timestamptz;
begin
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 500 then raise exception 'Lista grande demais'; end if;
  update public.shared_lists
     set name = coalesce(left(p_name, 60), name), month = coalesce(left(p_month, 7), month),
         items = coalesce(p_items, '[]'::jsonb), checked = coalesce(p_checked, '[]'::jsonb),
         updated_by = left(p_by, 40), updated_at = now()
   where code = upper(replace(p_code, '-', ''))
  returning updated_at into t;
  if t is null then raise exception 'Código não encontrado'; end if;
  return t;
end $$;

revoke all on function public._shared_code() from public, anon, authenticated;
grant execute on function public.shared_list_create(text, text, jsonb, jsonb, text) to anon, authenticated;
grant execute on function public.shared_list_get(text)  to anon, authenticated;
grant execute on function public.shared_list_join(text) to anon, authenticated;
grant execute on function public.shared_list_put(text, text, text, jsonb, jsonb, text) to anon, authenticated;
