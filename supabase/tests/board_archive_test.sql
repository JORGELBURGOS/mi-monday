-- =============================================================================
-- Pruebas: archivar y eliminar tableros solo administradores.
-- Transacción que se revierte: no deja datos.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/board_archive_test.sql
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
  us uuid := gen_random_uuid();
  ws uuid; b uuid; n int; failed boolean;
begin
  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', ow, 'authenticated', 'authenticated', 'arc-ow@example.test', now(),
          jsonb_build_object('vetta_provision_token', public.admin_issue_provision_token()), '{}', now(), now()),
         ('00000000-0000-0000-0000-000000000000', us, 'authenticated', 'authenticated', 'arc-us@example.test', now(),
          jsonb_build_object('vetta_provision_token', public.admin_issue_provision_token()), '{}', now(), now());
  execute 'reset role';
  insert into public.workspaces (name) values ('Archivo SA') returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, ow, 'owner'), (ws, us, 'member');

  -- Un usuario común crea su tablero…
  perform pg_temp.act_as(us);
  insert into public.boards (workspace_id, name) values (ws, 'Del usuario') returning id into b;
  -- …pero no lo puede archivar.
  failed := false;
  begin
    update public.boards set is_archived = true where id = b;
  exception when insufficient_privilege then failed := true;
  end;
  perform pg_temp.check(failed, 'un usuario común no puede archivar (aunque haya creado el tablero)');
  perform pg_temp.check(not (select is_archived from public.boards where id = b), 'sigue sin archivar');
  -- Puede seguir renombrándolo.
  update public.boards set name = 'Del usuario 2' where id = b;
  perform pg_temp.check((select name from public.boards where id = b) = 'Del usuario 2', 'el creador sigue pudiendo editarlo');

  -- El administrador lo archiva.
  perform pg_temp.act_as(ow);
  update public.boards set is_archived = true where id = b;
  perform pg_temp.check((select is_archived from public.boards where id = b), 'el administrador archiva');

  -- El usuario común no lo puede restaurar ni eliminar.
  perform pg_temp.act_as(us);
  failed := false;
  begin
    update public.boards set is_archived = false where id = b;
  exception when insufficient_privilege then failed := true;
  end;
  perform pg_temp.check(failed, 'un usuario común no puede restaurar');
  delete from public.boards where id = b;
  get diagnostics n = row_count;
  perform pg_temp.check(n = 0, 'un usuario común no puede eliminar');

  -- El administrador lo elimina.
  perform pg_temp.act_as(ow);
  delete from public.boards where id = b;
  get diagnostics n = row_count;
  perform pg_temp.check(n = 1, 'el administrador elimina un tablero archivado');

  execute 'reset role';
  raise notice 'TODAS LAS PRUEBAS PASARON';
end $t$;

rollback;
