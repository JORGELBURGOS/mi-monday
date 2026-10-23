-- =============================================================================
-- Pruebas del superadministrador: acceso total e invisible para las empresas.
-- Transacción que se revierte: no deja datos.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/superadmin_test.sql
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
  sa uuid := gen_random_uuid();  -- superadministrador
  ow uuid := gen_random_uuid();  -- administrador principal de la empresa
  us uuid := gen_random_uuid();  -- usuario
  ws uuid; ws2 uuid; priv uuid; grp uuid; tk uuid;
  n int; blocked boolean;
begin
  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.mail, now(),
         jsonb_build_object('vetta_provision_token', public.admin_issue_provision_token()), '{}', now(), now()
  from (values (sa, 'sup-sa@example.test'), (ow, 'sup-ow@example.test'), (us, 'sup-us@example.test')) u(id, mail);
  update public.profiles set is_platform_admin = true where id = sa;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);
  insert into public.workspaces (name) values ('Alfa') returning id into ws;
  insert into public.workspaces (name) values ('Beta') returning id into ws2;
  -- El superadministrador figura como miembro de Alfa (como en producción) pero no de Beta.
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, ow, 'owner'), (ws, us, 'member'), (ws, sa, 'owner');

  perform pg_temp.act_as(ow);
  insert into public.boards (workspace_id, name, visibility) values (ws, 'Privado del dueño', 'private') returning id into priv;
  select id into grp from public.board_groups where board_id = priv limit 1;
  insert into public.tasks (board_id, group_id, title) values (priv, grp, 'Secreto') returning id into tk;

  -- --------------------------------------------------- invisible para la empresa
  select count(*) into n from public.workspace_members where workspace_id = ws;
  perform pg_temp.check(n = 2, 'el administrador principal no ve al superadministrador en la lista de usuarios');
  select count(*) into n from public.profiles where id = sa;
  perform pg_temp.check(n = 0, 'el administrador principal no ve el perfil del superadministrador');
  update public.workspace_members set role = 'member' where workspace_id = ws and user_id = sa;
  delete from public.workspace_members where workspace_id = ws and user_id = sa;
  execute 'reset role';
  select count(*) into n from public.workspace_members where workspace_id = ws and user_id = sa and role = 'owner';
  perform pg_temp.check(n = 1, 'el administrador principal no puede degradar ni quitar al superadministrador');

  perform pg_temp.act_as(us);
  select count(*) into n from public.workspace_members where workspace_id = ws;
  perform pg_temp.check(n = 2, 'un usuario tampoco ve al superadministrador');

  -- --------------------------------------------------------- acceso total
  perform pg_temp.act_as(sa);
  select count(*) into n from public.workspaces where id in (ws, ws2);
  perform pg_temp.check(n = 2, 'el superadministrador ve todas las empresas, aunque no sea miembro');
  select count(*) into n from public.workspace_members where workspace_id = ws;
  perform pg_temp.check(n = 3, 'el superadministrador ve a todos los usuarios');
  select count(*) into n from public.tasks where id = tk;
  perform pg_temp.check(n = 1, 'el superadministrador ve tableros privados');
  update public.tasks set title = 'Editado por el superadmin' where id = tk;
  perform pg_temp.check((select title from public.tasks where id = tk) = 'Editado por el superadmin', 'el superadministrador edita cualquier elemento');
  insert into public.boards (workspace_id, name) values (ws2, 'Tablero en Beta');
  select count(*) into n from public.boards where workspace_id = ws2;
  perform pg_temp.check(n = 1, 'el superadministrador crea tableros en una empresa de la que no es miembro');
  update public.workspace_members set role = 'admin' where workspace_id = ws and user_id = ow;
  perform pg_temp.check((select role from public.workspace_members where workspace_id = ws and user_id = ow) = 'admin', 'el superadministrador cambia el rol del administrador principal');
  update public.workspace_members set role = 'owner' where workspace_id = ws and user_id = ow;
  update public.workspaces set name = 'Alfa Service' where id = ws;
  perform pg_temp.check((select name from public.workspaces where id = ws) = 'Alfa Service', 'el superadministrador renombra empresas');

  -- ---------------------------------------------------- eliminar empresas
  perform pg_temp.act_as(ow);
  delete from public.workspaces where id = ws;
  execute 'reset role';
  perform pg_temp.check(exists (select 1 from public.workspaces where id = ws), 'el administrador principal no puede eliminar la empresa');

  raise notice 'TODAS LAS PRUEBAS PASARON';
end $t$;

rollback;
