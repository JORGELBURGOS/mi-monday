-- =============================================================================
-- Pruebas de seguridad (RLS) para Vetta.
-- Se ejecutan dentro de una transacción que se revierte: no dejan datos.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql
-- Cada verificación que falla corta la ejecución con un error descriptivo.
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

create or replace function pg_temp.act_as(uid uuid, mail text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'email', mail, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

do $t$
declare
  a uuid := gen_random_uuid();   -- propietaria
  b uuid := gen_random_uuid();   -- invitada
  c uuid := gen_random_uuid();   -- ajena
  ws uuid; bd uuid; pbd uuid; grp uuid; st uuid; tk uuid; inv uuid; cm uuid;
  n int;
  blocked boolean;
begin
  -- Registro público cerrado: un alta sin la marca de la función de administración se rechaza.
  blocked := false;
  begin
    insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'intruso@example.test', null, '{"vetta_provision_token":"inventado"}', '{"provider":"email"}', now(), now());
  exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'el registro público está bloqueado');

  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', a, 'authenticated', 'authenticated', 'rls-a@example.test', now(),
          jsonb_build_object('full_name', 'Persona A', 'vetta_provision_token', public.admin_issue_provision_token()), '{"provider":"email"}', now(), now()),
         ('00000000-0000-0000-0000-000000000000', b, 'authenticated', 'authenticated', 'rls-b@example.test', now(),
          jsonb_build_object('vetta_provision_token', public.admin_issue_provision_token()), '{"provider":"email"}', now(), now()),
         ('00000000-0000-0000-0000-000000000000', c, 'authenticated', 'authenticated', 'rls-c@example.test', now(),
          jsonb_build_object('vetta_provision_token', public.admin_issue_provision_token()), '{"provider":"email"}', now(), now());
  perform pg_temp.check(not exists (select 1 from auth.users where id = a and raw_user_meta_data ? 'vetta_provision_token'),
    'el token de alta no queda guardado en el usuario');
  blocked := false;
  begin
    insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
    select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'reuso@example.test',
           jsonb_build_object('vetta_provision_token', t.token), now(), now()
    from private.provision_tokens t where t.used_at is not null limit 1;
    if not found then blocked := true; end if;
  exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'un token de alta no se puede reutilizar');

  select count(*) into n from public.profiles where id in (a, b, c);
  perform pg_temp.check(n = 3, 'se crea un perfil por usuario');

  -- ---------------------------------------------------------------- A crea todo
  perform pg_temp.act_as(a, 'rls-a@example.test');
  insert into public.workspaces (name) values ('Espacio de prueba') returning id into ws;
  perform pg_temp.check(exists (select 1 from public.workspace_members where workspace_id = ws and user_id = a and role = 'owner'),
    'el creador queda como propietario');

  insert into public.boards (workspace_id, name) values (ws, 'Tablero compartido') returning id into bd;
  select count(*) into n from public.board_statuses where board_id = bd;
  perform pg_temp.check(n = 4, 'un tablero nuevo trae 4 estados');
  select id into grp from public.board_groups where board_id = bd limit 1;
  perform pg_temp.check(grp is not null, 'un tablero nuevo trae un grupo');
  select id into st from public.board_statuses where board_id = bd and position = 1;

  insert into public.tasks (board_id, group_id, status_id, title) values (bd, grp, st, '  Tarea 1  ') returning id into tk;
  perform pg_temp.check((select title from public.tasks where id = tk) = 'Tarea 1', 'el título se normaliza');

  insert into public.boards (workspace_id, name, visibility) values (ws, 'Tablero privado', 'private') returning id into pbd;
  insert into public.workspace_invitations (workspace_id, email) values (ws, 'RLS-B@example.test') returning id into inv;
  perform pg_temp.check((select email from public.workspace_invitations where id = inv) = 'rls-b@example.test',
    'el email de la invitación se normaliza');

  blocked := false;
  begin update public.tasks set assignee_id = b where id = tk; exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'no se puede asignar a alguien que no es miembro');

  blocked := false;
  begin delete from public.workspace_members where workspace_id = ws and user_id = a; exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'no se puede quitar al último propietario');

  delete from public.boards where id = bd; get diagnostics n = row_count;
  perform pg_temp.check(n = 0, 'no se puede eliminar un tablero sin archivar');
  execute 'reset role';

  -- ---------------------------------------------------------------- C (ajena)
  perform pg_temp.act_as(c, 'rls-c@example.test');
  perform pg_temp.check(not exists (select 1 from public.workspaces where id = ws), 'C no ve el espacio');
  perform pg_temp.check(not exists (select 1 from public.boards where id = bd), 'C no ve el tablero');
  perform pg_temp.check(not exists (select 1 from public.tasks where id = tk), 'C no ve tareas');
  perform pg_temp.check(not exists (select 1 from public.workspace_invitations where id = inv), 'C no ve invitaciones ajenas');
  perform pg_temp.check(not exists (select 1 from public.profiles where id = a), 'C no ve perfiles ajenos');
  update public.tasks set title = 'hack' where id = tk; get diagnostics n = row_count;
  perform pg_temp.check(n = 0, 'C no puede editar tareas');
  update public.profiles set full_name = 'Nombre propio' where id = c; get diagnostics n = row_count;
  perform pg_temp.check(n = 1, 'cada usuario puede cambiar su nombre');
  blocked := false;
  begin update public.profiles set is_platform_admin = true where id = c; exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'nadie puede hacerse administrador de la plataforma');
  blocked := false;
  begin update public.profiles set must_change_password = false where id = c; exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'nadie puede saltear el cambio obligatorio de contraseña');
  blocked := false;
  begin perform public.admin_issue_provision_token(); exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'un usuario no puede emitir tokens de alta');
  blocked := false;
  begin insert into public.tasks (board_id, group_id, title) values (bd, grp, 'intrusa'); exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'C no puede crear tareas');
  blocked := false;
  begin insert into public.workspace_members (workspace_id, user_id, role) values (ws, c, 'owner'); exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'C no puede sumarse sola al espacio');
  blocked := false;
  begin perform public.respond_to_invitation(inv, true); exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'C no puede aceptar la invitación de otra persona');
  execute 'reset role';

  -- ---------------------------------------------------------------- B (invitada)
  perform pg_temp.act_as(b, 'rls-b@example.test');
  perform pg_temp.check(not exists (select 1 from public.workspaces where id = ws), 'B no ve el espacio antes de aceptar');
  perform pg_temp.check(exists (select 1 from public.workspace_invitations where id = inv), 'B ve su invitación pendiente');
  update public.workspace_invitations set role = 'admin' where id = inv; get diagnostics n = row_count;
  perform pg_temp.check(n = 0, 'B no puede cambiar el rol de su invitación');

  perform public.respond_to_invitation(inv, true);
  perform pg_temp.check(exists (select 1 from public.workspace_members where workspace_id = ws and user_id = b and role = 'member'),
    'B es miembro tras aceptar');
  perform pg_temp.check(exists (select 1 from public.tasks where id = tk), 'B ve tareas del tablero compartido');
  perform pg_temp.check(not exists (select 1 from public.boards where id = pbd), 'B no ve el tablero privado de A');
  perform pg_temp.check(exists (select 1 from public.profiles where id = a), 'B ve el perfil de A (comparten espacio)');

  update public.boards set name = 'renombrado' where id = bd; get diagnostics n = row_count;
  perform pg_temp.check(n = 0, 'un miembro no puede renombrar un tablero ajeno');
  update public.tasks set title = 'Editada por B' where id = tk; get diagnostics n = row_count;
  perform pg_temp.check(n = 1, 'un miembro puede editar tareas');
  update public.workspace_members set role = 'owner' where workspace_id = ws and user_id = b; get diagnostics n = row_count;
  perform pg_temp.check(n = 0, 'un miembro no puede ascenderse');
  blocked := false;
  begin insert into public.workspace_invitations (workspace_id, email) values (ws, 'otra@example.test'); exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'un miembro no puede invitar');
  blocked := false;
  begin insert into public.board_statuses (board_id, label) values (bd, 'Nuevo'); exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'un miembro no puede editar estados de un tablero ajeno');

  insert into public.task_comments (task_id, body) values (tk, 'Comentario de B') returning id into cm;
  perform pg_temp.check((select author_id from public.task_comments where id = cm) = b, 'el autor del comentario es quien lo escribe');
  execute 'reset role';

  -- ---------------------------------------------------------------- contraseña pendiente
  -- Simula un reseteo hecho por un administrador: la cuenta queda sin acceso a datos.
  execute 'reset role';
  update public.profiles set must_change_password = true where id = b;
  perform pg_temp.act_as(b, 'rls-b@example.test');
  perform pg_temp.check(not exists (select 1 from public.tasks where id = tk), 'con contraseña pendiente no se ven tareas');
  perform pg_temp.check(not exists (select 1 from public.workspaces where id = ws), 'con contraseña pendiente no se ven espacios');
  update public.tasks set title = 'intento' where id = tk; get diagnostics n = row_count;
  perform pg_temp.check(n = 0, 'con contraseña pendiente no se puede editar');
  execute 'reset role';
  update public.profiles set must_change_password = false where id = b;
  perform pg_temp.act_as(b, 'rls-b@example.test');
  perform pg_temp.check(exists (select 1 from public.tasks where id = tk), 'tras cambiar la contraseña vuelve el acceso');
  execute 'reset role';

  -- ---------------------------------------------------------------- A de nuevo
  perform pg_temp.act_as(a, 'rls-a@example.test');
  update public.tasks set assignee_id = b where id = tk; get diagnostics n = row_count;
  perform pg_temp.check(n = 1, 'se puede asignar a un miembro');
  update public.task_comments set body = 'editado por A' where id = cm; get diagnostics n = row_count;
  perform pg_temp.check(n = 0, 'nadie edita comentarios ajenos');
  perform pg_temp.check((select task_count from public.board_overview where id = bd) = 1, 'la vista de resumen respeta RLS');

  update public.workspace_members set role = 'admin' where workspace_id = ws and user_id = b; get diagnostics n = row_count;
  perform pg_temp.check(n = 1, 'la propietaria puede ascender a administradora');
  delete from public.workspace_members where workspace_id = ws and user_id = b;
  perform pg_temp.check((select assignee_id from public.tasks where id = tk) is null, 'al quitar a un miembro se desasignan sus tareas');

  update public.boards set is_archived = true where id = bd;
  perform pg_temp.check((select archived_at from public.boards where id = bd) is not null, 'archivar registra la fecha');
  delete from public.boards where id = bd; get diagnostics n = row_count;
  perform pg_temp.check(n = 1, 'un tablero archivado se puede eliminar');
  execute 'reset role';

  raise notice 'TODAS LAS PRUEBAS PASARON';
end
$t$;

rollback;
