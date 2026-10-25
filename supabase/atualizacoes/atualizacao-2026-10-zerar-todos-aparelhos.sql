-- =====================================================================
-- "Zerar meu histórico" vale para TODOS os aparelhos da conta.
-- Rode uma vez no Supabase › SQL Editor (pode rodar de novo sem problema).
--
-- Problema: depois de zerar num celular, outro aparelho (ou aba) que ainda tinha a lista
-- antiga a reenviava para a conta. Agora o banco recusa dados de quem está numa "época"
-- anterior ao zerar (profiles.history_gen). O aparelho recusado se limpa sozinho.
-- =====================================================================
alter table public.user_state add column if not exists gen int;

create or replace function public._user_state_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare g int;
begin
  select history_gen into g from profiles where id = new.user_id;
  if coalesce(g, 0) > 0 and coalesce(new.gen, -1) <> g then
    raise exception 'historico_zerado: esta conta foi zerada em outro aparelho';
  end if;
  return new;
end $$;
drop trigger if exists user_state_guard on public.user_state;
create trigger user_state_guard before insert or update on public.user_state
  for each row execute function public._user_state_guard();

-- listas do mês de uma época antiga também não entram mais
create or replace function public._shopping_list_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare g int;
begin
  select history_gen into g from profiles where id = new.user_id;
  if coalesce(new.gen, 0) < coalesce(g, 0) then
    raise exception 'historico_zerado: esta conta foi zerada em outro aparelho';
  end if;
  return new;
end $$;
drop trigger if exists shopping_list_guard on public.shopping_lists;
create trigger shopping_list_guard before insert or update on public.shopping_lists
  for each row execute function public._shopping_list_guard();
