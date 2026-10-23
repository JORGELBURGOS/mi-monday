-- =============================================================================
-- Pruebas de acceso por tablero, empresas y cuentas desactivadas.
-- Se ejecutan dentro de una transacción que se revierte: no dejan datos.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/access_test.sql
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
  ad uuid := gen_random_uuid();  -- administrador de la empresa
  m1 uuid := gen_random_uuid();  -- miembro
  m2 uuid := gen_random_uuid();  -- miembro
  ws uuid; ws2 uuid; pub uuid; priv uuid; mine uuid; grp uuid;
  n int;
  blocked boolean;
begin
  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.mail, now(),
         jsonb_build_object('vetta_provision_token', public.admin_issue_provision_token()), '{}', now(), now()
  from (values (sa, 'acc-sa@example.test'), (ad, 'acc-ad@example.test'), (m1, 'acc-m1@example.test'), (m2, 'acc-m2@example.test')) u(id, mail);
  update public.profiles set is_platform_admin = true where id = sa;

  -- ------------------------------------------------------------ empresas
  perform pg_temp.act_as(ad);
  blocked := false;
  begin insert into public.workspaces (name) values ('Por mi cuenta'); exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'un usuario común no puede dar de alta empresas');

  perform pg_temp.act_as(sa);
  insert into public.workspaces (name) values ('Empresa SA') returning id into ws;
  perform pg_temp.check(ws is not null, 'el superadministrador puede dar de alta empresas');
  execute 'reset role';
  -- Alta hecha por la función de administración (privilegios de servicio): sin usuario en sesión.
  perform set_config('request.jwt.claims', '{}', true);
  insert into public.workspaces (name) values ('Empresa nueva') returning id into ws2;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws2, ad, 'owner'), (ws2, m1, 'member'), (ws2, m2, 'member');

  -- ------------------------------------------------------------ tableros
  perform pg_temp.act_as(ad);
  insert into public.boards (workspace_id, name, visibility) values (ws2, 'Para todos', 'workspace') returning id into pub;
  insert into public.boards (workspace_id, name, visibility) values (ws2, 'Compras', 'private') returning id into priv;
  select id into grp from public.board_groups where board_id = priv;
  insert into public.tasks (board_id, group_id, title) values (priv, grp, 'Orden de compra 1');

  perform pg_temp.act_as(m1);
  perform pg_temp.check(exists (select 1 from public.boards where id = pub), 'un miembro ve los tableros para todo el equipo');
  perform pg_temp.check(not exists (select 1 from public.boards where id = priv), 'un miembro no ve un tablero privado sin acceso');
  perform pg_temp.check(not exists (select 1 from public.tasks where board_id = priv), 'ni sus ítems');
  blocked := false;
  begin insert into public.board_members (board_id, user_id) values (priv, m1); exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'un miembro no puede darse acceso solo');
  insert into public.boards (workspace_id, name, visibility) values (ws2, 'Mis cosas', 'private') returning id into mine;
  perform pg_temp.check(exists (select 1 from public.boards where id = mine), 'quien crea un tablero privado lo ve');

  perform pg_temp.act_as(ad);
  perform pg_temp.check(exists (select 1 from public.boards where id = mine), 'el administrador ve todos los tableros de la empresa');
  insert into public.board_members (board_id, user_id) values (priv, m1);
  perform pg_temp.check((select granted_by = ad from public.board_members where board_id = priv and user_id = m1), 'se registra quién dio el acceso');
  blocked := false;
  begin insert into public.board_members (board_id, user_id) values (priv, sa); exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'no se da acceso a alguien de otra empresa');

  perform pg_temp.act_as(m1);
  perform pg_temp.check(exists (select 1 from public.tasks where board_id = priv), 'con acceso, el miembro ve el tablero y sus ítems');
  update public.tasks set title = 'Orden de compra 1 (revisada)' where board_id = priv; get diagnostics n = row_count;
  perform pg_temp.check(n = 1, 'y puede trabajar en él');
  update public.boards set name = 'hack' where id = priv; get diagnostics n = row_count;
  perform pg_temp.check(n = 0, 'pero no administrarlo');

  perform pg_temp.act_as(m2);
  perform pg_temp.check(not exists (select 1 from public.boards where id = priv), 'otro miembro sigue sin verlo');
  perform pg_temp.check(not exists (select 1 from public.board_members where board_id = priv), 'ni ve quién tiene acceso');

  perform pg_temp.act_as(ad);
  delete from public.board_members where board_id = priv and user_id = m1;
  perform pg_temp.act_as(m1);
  perform pg_temp.check(not exists (select 1 from public.boards where id = priv), 'al quitar el acceso deja de verlo');

  -- ------------------------------------------------------------ cuentas desactivadas
  execute 'reset role';
  update public.profiles set deactivated_at = now() where id = m1;
  perform pg_temp.act_as(m1);
  perform pg_temp.check(not exists (select 1 from public.boards where id = pub), 'una cuenta desactivada no ve nada');
  perform pg_temp.check(not exists (select 1 from public.workspaces where id = ws2), 'ni la empresa');
  execute 'reset role';
  update public.profiles set deactivated_at = null where id = m1;
  perform pg_temp.act_as(m1);
  perform pg_temp.check(exists (select 1 from public.boards where id = pub), 'al reactivarla vuelve el acceso');

  -- ------------------------------------------------------------ superadministrador
  execute 'reset role';
  perform pg_temp.check(not private.user_can_access_board(sa, priv), 'el superadministrador no entra a una empresa ajena sin ser miembro');
  perform pg_temp.act_as(m1);
  blocked := false;
  begin update public.profiles set is_platform_admin = true where id = m1; exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'nadie se hace superadministrador solo');
  blocked := false;
  begin update public.profiles set deactivated_at = null where id = m1; exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'nadie se reactiva solo');

  execute 'reset role';
  raise notice 'TODAS LAS PRUEBAS PASARON';
end
$t$;

rollback;
