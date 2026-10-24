-- =============================================================================
-- Pruebas de equipos, responsables múltiples y permisos finos.
-- Transacción que se revierte: no deja datos.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/teams_permissions_test.sql
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

-- ¿La sentencia falla? (devuelve el mensaje o null)
create or replace function pg_temp.fails(sql text) returns text
language plpgsql as $$
begin
  execute sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $t$
declare
  ow uuid := gen_random_uuid();   -- dueño
  ed uuid := gen_random_uuid();   -- editor
  lo uuid := gen_random_uuid();   -- equipo Logística
  vi uuid := gen_random_uuid();   -- solo lectura / comentarista
  ot uuid := gen_random_uuid();   -- de otra empresa
  ws uuid; ws2 uuid; b uuid; bp uuid; g1 uuid; g2 uuid; col uuid; ck uuid; tlog uuid; tother uuid;
  t1 uuid; t2 uuid; t3 uuid; msg text; n int; v text; lst jsonb;
begin
  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.mail, now(),
         jsonb_build_object('vetta_provision_token', public.admin_issue_provision_token()), '{}', now(), now()
  from (values (ow, 'tp-ow@example.test'), (ed, 'tp-ed@example.test'), (lo, 'tp-lo@example.test'),
               (vi, 'tp-vi@example.test'), (ot, 'tp-ot@example.test')) u(id, mail);
  update public.profiles set full_name = 'Lola Logística' where id = lo;
  update public.profiles set full_name = 'Edu Editor' where id = ed;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);
  insert into public.workspaces (name) values ('Circuito SA') returning id into ws;
  insert into public.workspaces (name) values ('Otra SA') returning id into ws2;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws, ow, 'owner'), (ws, ed, 'member'), (ws, lo, 'member'), (ws, vi, 'member'), (ws2, ot, 'owner');

  -- ------------------------------------------------------------ equipos
  perform pg_temp.act_as(ed);
  msg := pg_temp.fails(format('insert into public.workspace_teams (workspace_id, name) values (%L, %L)', ws, 'Pirata'));
  perform pg_temp.check(msg is not null, 'un miembro común no arma equipos');

  perform pg_temp.act_as(ow);
  insert into public.workspace_teams (workspace_id, name, color) values (ws, 'Logística', 'green') returning id into tlog;
  insert into public.team_members (team_id, user_id) values (tlog, lo);
  msg := pg_temp.fails(format('insert into public.team_members (team_id, user_id) values (%L, %L)', tlog, ot));
  perform pg_temp.check(msg like '%empresa%', 'solo gente de la empresa en un equipo');
  msg := pg_temp.fails(format('insert into public.workspace_teams (workspace_id, name) values (%L, %L)', ws, ' logística '));
  perform pg_temp.check(msg is not null, 'no hay dos equipos con el mismo nombre');
  perform pg_temp.act_as(ot);
  insert into public.workspace_teams (workspace_id, name) values (ws2, 'Ajeno') returning id into tother;
  select count(*) into n from public.workspace_teams where workspace_id = ws;
  perform pg_temp.check(n = 0, 'otra empresa no ve los equipos');

  -- ------------------------------------------------------------ responsables múltiples
  perform pg_temp.act_as(ow);
  insert into public.boards (workspace_id, name, visibility) values (ws, 'Operaciones', 'workspace') returning id into b;
  insert into public.board_groups (board_id, name, position) values (b, 'Comercial', 10) returning id into g1;
  insert into public.board_groups (board_id, name, position) values (b, 'Logística', 20) returning id into g2;
  insert into public.board_columns (board_id, name, kind) values (b, 'Monto', 'number') returning id into col;
  insert into public.board_columns (board_id, name, kind) values (b, 'Checklist', 'checklist') returning id into ck;

  insert into public.tasks (board_id, group_id, title, assignee_id) values (b, g1, 'Uno', ed) returning id into t1;
  perform pg_temp.check((select assignee_ids from public.tasks where id = t1) = array[ed], 'el responsable de siempre queda en la lista');
  update public.tasks set assignee_ids = array[lo, ed, lo] where id = t1;
  perform pg_temp.check((select assignee_id = lo and assignee_ids = array[lo, ed] from public.tasks where id = t1), 'varias personas: sin repetidos y la primera es la principal');
  update public.tasks set assignee_id = vi where id = t1;
  perform pg_temp.check((select assignee_ids = array[vi] from public.tasks where id = t1), 'asignar de a uno reemplaza la lista');
  msg := pg_temp.fails(format('update public.tasks set assignee_ids = array[%L::uuid] where id = %L', ot, t1));
  perform pg_temp.check(msg like '%empresa%', 'no se asigna gente de otra empresa');
  msg := pg_temp.fails(format('update public.tasks set team_ids = array[%L::uuid] where id = %L', tother, t1));
  perform pg_temp.check(msg like '%equipo%', 'no se asigna un equipo de otra empresa');

  execute 'reset role';
  delete from public.notifications where workspace_id = ws;
  perform pg_temp.act_as(ow);
  update public.tasks set assignee_ids = array[ed], team_ids = array[tlog] where id = t1;
  execute 'reset role';
  select count(*) into n from public.notifications where user_id = ed and title = 'Te asignaron un elemento';
  perform pg_temp.check(n = 1, 'aviso a la persona que se suma');
  select count(*) into n from public.notifications where user_id = lo and title like 'Asignaron un elemento a tu equipo%';
  perform pg_temp.check(n = 1, 'aviso a quienes integran el equipo que se suma');
  select count(*) into n from public.notifications where user_id = ow;
  perform pg_temp.check(n = 0, 'quien asigna no se avisa a sí mismo');

  perform pg_temp.check(private.render_text('{responsable}', t1) = 'Edu Editor, equipo Logística', '{responsable} nombra personas y equipos');
  perform pg_temp.check(private.condition_met(jsonb_build_object('field', 'assignee', 'op', 'is', 'value', tlog), (select x from public.tasks x where x.id = t1)),
                        'condición "responsable es" con un equipo');
  select count(*) into n from public.task_events where task_id = t1 and kind = 'assignee_changed' and detail ->> 'to' = 'Edu Editor, equipo Logística';
  perform pg_temp.check(n = 1, 'el historial muestra personas y equipos');
  perform pg_temp.act_as(ow);

  -- ------------------------------------------------------------ roles por tablero
  -- Tablero para todos con rol por defecto "solo lectura".
  update public.boards set default_role = 'viewer' where id = b;
  perform pg_temp.act_as(vi);
  perform pg_temp.check(public.my_board_role(b) = 'viewer', 'el rol por defecto aplica a la empresa');
  msg := pg_temp.fails(format('update public.tasks set title = %L where id = %L', 'Hack', t1));
  perform pg_temp.check(msg like '%solo lectura%', 'solo lectura no edita');
  msg := pg_temp.fails(format('insert into public.tasks (board_id, group_id, title) values (%L, %L, %L)', b, g1, 'Nuevo'));
  perform pg_temp.check(msg like '%solo lectura%', 'solo lectura no crea elementos');
  msg := pg_temp.fails(format('insert into public.task_comments (task_id, body) values (%L, %L)', t1, 'hola'));
  perform pg_temp.check(msg is not null, 'solo lectura no comenta');
  msg := pg_temp.fails(format('insert into public.board_groups (board_id, name) values (%L, %L)', b, 'Mía'));
  perform pg_temp.check(msg is not null, 'solo lectura no crea carpetas');

  perform pg_temp.act_as(ow);
  insert into public.board_members (board_id, user_id, role) values (b, vi, 'commenter');
  perform pg_temp.act_as(vi);
  perform pg_temp.check(public.my_board_role(b) = 'commenter', 'el permiso explícito gana sobre el de la empresa');
  insert into public.task_comments (task_id, body) values (t1, 'Comento');
  msg := pg_temp.fails(format('update public.tasks set title = %L where id = %L', 'Hack', t1));
  perform pg_temp.check(msg like '%actualizaciones%', 'comentarista comenta pero no edita');

  -- Solo lo suyo (por equipo).
  perform pg_temp.act_as(ow);
  insert into public.board_teams (board_id, team_id, role) values (b, tlog, 'own');
  insert into public.tasks (board_id, group_id, title) values (b, g1, 'Ajeno') returning id into t2;
  perform pg_temp.act_as(lo);
  perform pg_temp.check(public.my_board_role(b) = 'own', 'el permiso del equipo llega a sus integrantes');
  update public.tasks set title = 'Uno (logística)' where id = t1;
  perform pg_temp.check((select title from public.tasks where id = t1) = 'Uno (logística)', 'edita lo de su equipo');
  msg := pg_temp.fails(format('update public.tasks set title = %L where id = %L', 'Hack', t2));
  perform pg_temp.check(msg like '%responsable%', 'no edita lo que no es suyo');
  insert into public.tasks (board_id, group_id, title) values (b, g1, 'Lo creé yo') returning id into t3;
  update public.tasks set priority = 'high' where id = t3;
  perform pg_temp.check((select priority from public.tasks where id = t3) = 'high', 'edita lo que creó');
  msg := pg_temp.fails(format('delete from public.tasks where id = %L', t2));
  perform pg_temp.check(msg like '%responsable%', 'no borra lo que no es suyo');

  -- Tablero privado: el permiso a un equipo da acceso.
  perform pg_temp.act_as(ow);
  insert into public.boards (workspace_id, name, visibility) values (ws, 'Privado', 'private') returning id into bp;
  perform pg_temp.act_as(lo);
  perform pg_temp.check(not exists (select 1 from public.boards where id = bp), 'sin permiso no ve el tablero privado');
  perform pg_temp.act_as(ow);
  insert into public.board_teams (board_id, team_id, role) values (bp, tlog, 'viewer');
  perform pg_temp.act_as(lo);
  perform pg_temp.check(exists (select 1 from public.boards where id = bp), 'con permiso de su equipo ve el tablero privado');

  -- Administrador por permiso: configura el tablero.
  perform pg_temp.act_as(ow);
  update public.board_members set role = 'admin' where board_id = b and user_id = vi;
  perform pg_temp.act_as(vi);
  update public.boards set description = 'Ahora administro' where id = b;
  perform pg_temp.check((select description from public.boards where id = b) = 'Ahora administro', 'administrador del tablero por permiso');
  perform pg_temp.act_as(ow);
  update public.board_members set role = 'editor' where board_id = b and user_id = vi;
  delete from public.board_teams where board_id = b;
  update public.boards set default_role = 'editor' where id = b;

  -- ------------------------------------------------------------ carpeta restringida
  perform pg_temp.act_as(ed);
  msg := pg_temp.fails(format('update public.board_groups set editors = %L where id = %L', jsonb_build_object('teams', jsonb_build_array(tlog)), g2));
  perform pg_temp.check(msg like '%administra%', 'solo quien administra restringe carpetas');
  perform pg_temp.act_as(ow);
  update public.board_groups set editors = jsonb_build_object('teams', jsonb_build_array(tlog)) where id = g2;

  perform pg_temp.act_as(ed);
  -- Pasar de Comercial a Logística (entregar) se puede…
  update public.tasks set group_id = g2 where id = t2;
  -- …pero después ya no lo edita.
  msg := pg_temp.fails(format('update public.tasks set title = %L where id = %L', 'Sigo', t2));
  perform pg_temp.check(msg like '%Logística%', 'en la carpeta restringida no edita quien no está asignado');
  msg := pg_temp.fails(format('insert into public.tasks (board_id, group_id, title) values (%L, %L, %L)', b, g2, 'Nuevo'));
  perform pg_temp.check(msg like '%Logística%', 'tampoco crea elementos ahí');
  msg := pg_temp.fails(format('delete from public.board_groups where id = %L', g2));
  perform pg_temp.check(msg like '%Logística%', 'ni borra la carpeta');
  perform pg_temp.act_as(lo);
  update public.board_groups set name = 'Logística' where id = g2; -- su equipo sí puede
  perform pg_temp.act_as(ow);
  update public.board_teams set role = 'editor' where board_id = b;
  insert into public.board_teams (board_id, team_id, role) values (b, tlog, 'editor') on conflict do nothing;
  perform pg_temp.act_as(lo);
  update public.tasks set title = 'Ajeno en logística' where id = t2;
  perform pg_temp.check((select title from public.tasks where id = t2) = 'Ajeno en logística', 'el equipo de la carpeta la edita');

  -- ------------------------------------------------------------ columna restringida
  perform pg_temp.act_as(ow);
  update public.board_columns set settings = settings || jsonb_build_object('editors', jsonb_build_object('users', jsonb_build_array(ow))) where id = col;
  update public.boards set settings = jsonb_set(settings, '{columns}', coalesce(settings -> 'columns', '{}') ||
    jsonb_build_object('status', jsonb_build_object('editors', jsonb_build_object('users', jsonb_build_array(ow))))) where id = b;
  perform pg_temp.act_as(ed);
  msg := pg_temp.fails(format('update public.tasks set custom_values = custom_values || jsonb_build_object(%L, 10) where id = %L', col, t3));
  perform pg_temp.check(msg like '%Monto%', 'columna propia restringida');
  msg := pg_temp.fails(format('update public.tasks set status_id = (select id from public.board_statuses where board_id = %L order by position desc limit 1) where id = %L', b, t3));
  perform pg_temp.check(msg like '%Estado%', 'columna fija restringida');
  update public.tasks set priority = 'urgent' where id = t3;
  perform pg_temp.check((select priority from public.tasks where id = t3) = 'urgent', 'las demás columnas siguen libres');

  -- ------------------------------------------------------------ checklist por sección
  perform pg_temp.act_as(ow);
  update public.tasks set group_id = g1, custom_values = jsonb_build_object(ck, jsonb_build_array(
    jsonb_build_object('id', 'h1', 'text', 'Comercial', 'done', false, 'header', true),
    jsonb_build_object('id', 's1', 'text', 'Cotizar', 'done', false),
    jsonb_build_object('id', 'h2', 'text', 'Logística', 'done', false, 'header', true),
    jsonb_build_object('id', 's2', 'text', 'Despachar', 'done', false))) where id = t3;
  perform pg_temp.act_as(ed);
  select custom_values -> ck::text into lst from public.tasks where id = t3;
  update public.tasks set custom_values = jsonb_set(custom_values, array[ck::text, '1', 'done'], 'true') where id = t3;
  perform pg_temp.check((select (custom_values -> ck::text -> 1 ->> 'done')::boolean from public.tasks where id = t3), 'tilda los pasos de su sección');
  msg := pg_temp.fails(format('update public.tasks set custom_values = jsonb_set(custom_values, array[%L, %L, %L], %L) where id = %L', ck, '3', 'done', 'true', t3));
  perform pg_temp.check(msg like '%Logística%', 'no tilda los pasos de la sección de otro equipo');
  msg := pg_temp.fails(format('update public.tasks set custom_values = jsonb_set(custom_values, array[%L], (custom_values -> %L) - 3) where id = %L', ck, ck, t3));
  perform pg_temp.check(msg like '%Logística%', 'ni los borra');
  perform pg_temp.act_as(lo);
  update public.tasks set custom_values = jsonb_set(custom_values, array[ck::text, '3', 'done'], 'true') where id = t3;
  perform pg_temp.check((select (custom_values -> ck::text -> 3 ->> 'done')::boolean from public.tasks where id = t3), 'el equipo de Logística tilda su sección');

  -- ------------------------------------------------------------ reglas y sistema no se bloquean
  perform pg_temp.act_as(ow);
  insert into public.board_automations (workspace_id, board_id, name, trigger_type, trigger_group_id, action_type, action_config, target_board_id)
  values (ws, b, 'A Logística', 'group_changed', g2, 'set_assignee', jsonb_build_object('mode', 'team', 'team_id', tlog), b);
  update public.board_groups set editors = '{}' where id = g2;
  perform pg_temp.act_as(ed);
  update public.tasks set group_id = g2 where id = t3;
  perform pg_temp.check((select team_ids = array[tlog] and cardinality(assignee_ids) = 0 from public.tasks where id = t3),
                        'la regla pasa el elemento al equipo de la carpeta');

  -- ------------------------------------------------------------ borrar un equipo
  perform pg_temp.act_as(ow);
  update public.board_groups set editors = jsonb_build_object('teams', jsonb_build_array(tlog)) where id = g2;
  update public.board_columns set settings = jsonb_set(settings, '{editors}', jsonb_build_object('teams', jsonb_build_array(tlog))) where id = col;
  delete from public.workspace_teams where id = tlog;
  perform pg_temp.check((select cardinality(team_ids) = 0 from public.tasks where id = t3), 'el equipo borrado deja de ser responsable');
  perform pg_temp.check((select not private.restricted(editors) from public.board_groups where id = g2), 'la carpeta deja de estar restringida a un equipo que ya no existe');
  perform pg_temp.check((select not private.restricted(settings -> 'editors') from public.board_columns where id = col), 'la columna también');
end
$t$;

rollback;
