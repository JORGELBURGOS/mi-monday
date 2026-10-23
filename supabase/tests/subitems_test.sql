-- =============================================================================
-- Pruebas de subelementos. Transacción que se revierte: no deja datos.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/subitems_test.sql
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
  ow uuid := gen_random_uuid();
  ws uuid; b1 uuid; b2 uuid; g1 uuid; g1b uuid; g2 uuid; s_done uuid;
  parent uuid; child uuid; child2 uuid; other uuid;
  n int; blocked boolean;
begin
  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', ow, 'authenticated', 'authenticated', 'sub-ow@example.test', now(),
          jsonb_build_object('vetta_provision_token', public.admin_issue_provision_token()), '{}', now(), now());
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);
  insert into public.workspaces (name) values ('Sub SA') returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, ow, 'owner');

  perform pg_temp.act_as(ow);
  insert into public.boards (workspace_id, name) values (ws, 'Uno') returning id into b1;
  insert into public.boards (workspace_id, name) values (ws, 'Dos') returning id into b2;
  select id into g1 from public.board_groups where board_id = b1 limit 1;
  insert into public.board_groups (board_id, name, position) values (b1, 'Otra', 99) returning id into g1b;
  select id into g2 from public.board_groups where board_id = b2 limit 1;
  select id into s_done from public.board_statuses where board_id = b1 and is_done limit 1;

  insert into public.tasks (board_id, group_id, title) values (b1, g1, 'Elemento') returning id into parent;
  insert into public.tasks (board_id, group_id, parent_id, title, status_id) values (b1, g1b, parent, 'Sub 1', s_done) returning id into child;
  insert into public.tasks (board_id, group_id, parent_id, title) values (b1, g1, parent, 'Sub 2') returning id into child2;
  perform pg_temp.check((select group_id from public.tasks where id = child) = g1, 'el subelemento queda en la carpeta de su elemento');

  blocked := false;
  begin insert into public.tasks (board_id, group_id, parent_id, title) values (b1, g1, child, 'Nieto'); exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'un subelemento no puede tener subelementos');

  insert into public.tasks (board_id, group_id, title) values (b2, g2, 'Ajeno') returning id into other;
  blocked := false;
  begin insert into public.tasks (board_id, group_id, parent_id, title) values (b2, g2, parent, 'Cruzado'); exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'un subelemento tiene que estar en el tablero de su elemento');
  blocked := false;
  begin update public.tasks set parent_id = other where id = parent; exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'un elemento con subelementos no pasa a ser subelemento');

  update public.tasks set group_id = g1b where id = parent;
  select count(*) into n from public.tasks where parent_id = parent and group_id = g1b;
  perform pg_temp.check(n = 2, 'los subelementos acompañan a su elemento al cambiar de carpeta');

  update public.tasks set group_id = g1 where id = child;
  perform pg_temp.check((select group_id from public.tasks where id = child) = g1b, 'un subelemento no se separa de la carpeta de su elemento');

  -- Viaje a otro tablero mediante una regla: los subelementos acompañan.
  insert into public.board_automations (board_id, name, trigger_type, trigger_status_id, action_type, target_board_id)
  values (b1, 'Terminado a Dos', 'status_changed', s_done, 'move', b2);
  update public.tasks set status_id = s_done where id = child2;
  perform pg_temp.check((select board_id from public.tasks where id = child2) = b1, 'las reglas no se disparan en subelementos');
  update public.tasks set status_id = s_done where id = parent;
  perform pg_temp.check((select board_id from public.tasks where id = parent) = b2, 'la regla mueve el elemento a otro tablero');
  select count(*) into n from public.tasks where parent_id = parent and board_id = b2 and group_id = g2;
  perform pg_temp.check(n = 2, 'los subelementos viajan con su elemento a otro tablero');
  select count(*) into n from public.tasks c join public.board_statuses s on s.id = c.status_id where c.parent_id = parent and s.board_id = b2;
  perform pg_temp.check(n = 2, 'el estado de los subelementos se adapta al tablero nuevo');

  perform pg_temp.act_as(ow);
  delete from public.tasks where id = parent;
  select count(*) into n from public.tasks where id in (child, child2);
  perform pg_temp.check(n = 0, 'al eliminar el elemento se eliminan sus subelementos');

  raise notice 'TODAS LAS PRUEBAS PASARON';
end $t$;

rollback;
