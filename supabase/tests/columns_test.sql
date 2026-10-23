-- =============================================================================
-- Pruebas de columnas v2: tipos nuevos, cambios de tipo, paleta ampliada y
-- ajustes del tablero. Transacción que se revierte: no deja datos.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/columns_test.sql
-- =============================================================================
begin;

create or replace function pg_temp.check(cond boolean, label text) returns void
language plpgsql as $$
begin
  if not coalesce(cond, false) then
    raise exception 'FALLÓ: %', label;
  end if;
  raise notice 'ok  %', label;
end $$;

create or replace function pg_temp.act_as(uid uuid) returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

do $t$
declare
  ad uuid := gen_random_uuid();
  mb uuid := gen_random_uuid();
  ws uuid; b uuid; c_text uuid; c_formula uuid; c_tags uuid; st uuid; g uuid;
  k text; blocked boolean; n int;
begin
  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.mail, now(),
         jsonb_build_object('vetta_provision_token', public.admin_issue_provision_token()), '{}', now(), now()
  from (values (ad, 'col-ad@example.test'), (mb, 'col-mb@example.test')) u(id, mail);
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);
  insert into public.workspaces (name) values ('Columnas SA') returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, ad, 'owner'), (ws, mb, 'member');

  perform pg_temp.act_as(ad);
  insert into public.boards (workspace_id, name) values (ws, 'Ventas') returning id into b;

  insert into public.board_columns (board_id, name, kind) values (b, 'Notas', 'text') returning id into c_text;
  insert into public.board_columns (board_id, name, kind, settings) values (b, 'Total', 'formula', '{"formula":"{A} * 2"}') returning id into c_formula;
  insert into public.board_columns (board_id, name, kind, options) values (b, 'Tipo', 'tags', '[{"id":"a","label":"A","color":"lime"}]') returning id into c_tags;
  select count(*) into n from public.board_columns where board_id = b and kind in ('formula', 'tags');
  perform pg_temp.check(n = 2, 'se crean columnas de tipos nuevos (fórmula, desplegable)');
  select legacy_kind into k from public.board_columns where id = c_formula;
  perform pg_temp.check(k = 'text', 'el tipo heredado queda con un valor válido');

  blocked := false;
  begin insert into public.board_columns (board_id, name, kind) values (b, 'Mal', 'inventado'); exception when check_violation then blocked := true; end;
  perform pg_temp.check(blocked, 'un tipo de columna inexistente se rechaza');

  update public.board_columns set kind = 'long_text' where id = c_text;
  select kind into k from public.board_columns where id = c_text;
  perform pg_temp.check(k = 'long_text', 'texto puede pasar a texto largo');
  update public.board_columns set kind = 'number' where id = c_text;
  select kind into k from public.board_columns where id = c_text;
  perform pg_temp.check(k = 'long_text', 'texto no puede pasar a número (se ignora el cambio)');
  update public.board_columns set kind = 'list' where id = c_tags;
  select kind into k from public.board_columns where id = c_tags;
  perform pg_temp.check(k = 'list', 'desplegable puede pasar a estado');

  insert into public.board_statuses (board_id, label, color, position) values (b, 'Bloqueado', 'navy', 9) returning id into st;
  perform pg_temp.check(st is not null, 'un estado acepta colores nuevos (navy)');
  select id into g from public.board_groups where board_id = b limit 1;
  update public.board_groups set color = 'olive' where id = g;
  perform pg_temp.check((select color from public.board_groups where id = g) = 'olive', 'una carpeta acepta colores nuevos');
  blocked := false;
  begin update public.board_statuses set color = 'fucsia' where id = st; exception when check_violation then blocked := true; end;
  perform pg_temp.check(blocked, 'un color inexistente se rechaza');

  update public.boards set settings = '{"columns":{"priority":{"hidden":true}}}' where id = b;
  perform pg_temp.check((select settings #>> '{columns,priority,hidden}' from public.boards where id = b) = 'true', 'el administrador guarda ajustes del tablero');

  insert into public.tasks (board_id, group_id, title, custom_values) values (b, g, 'Ítem', jsonb_build_object(c_tags::text, jsonb_build_array('a')));
  perform pg_temp.check((select jsonb_typeof(custom_values -> c_tags::text) from public.tasks where board_id = b) = 'array', 'un ítem guarda varias opciones (lista)');

  perform pg_temp.act_as(mb);
  update public.boards set settings = '{}' where id = b;
  perform pg_temp.check((select settings <> '{}'::jsonb from public.boards where id = b), 'un usuario común no cambia los ajustes de un tablero ajeno');
  blocked := false;
  begin
    insert into public.board_columns (board_id, name, kind) values (b, 'Intrusa', 'text');
  exception when others then blocked := true;
  end;
  perform pg_temp.check(blocked, 'un usuario común no agrega columnas a un tablero ajeno');

  raise notice 'TODAS LAS PRUEBAS PASARON';
end $t$;

rollback;
