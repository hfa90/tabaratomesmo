-- Simula um banco que já está em uso (listas de antes e depois de zerar, eventos novos),
-- para garantir que rodar o schema.sql de novo não quebra com dados de verdade.
insert into auth.users (id, email) values ('dddddddd-0000-0000-0000-000000000001', 'antigo@example.com') on conflict do nothing;
insert into shopping_lists (user_id, month, gen) values
  ('dddddddd-0000-0000-0000-000000000001', '2026-10-01', 0),
  ('dddddddd-0000-0000-0000-000000000001', '2026-10-01', 1);
insert into events (kind, query) values ('screen', 'ofertas'), ('camp_view', null), ('push_open', 'tb-preco');
