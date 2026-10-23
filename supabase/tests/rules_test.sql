-- =============================================================================
-- Pruebas del motor de reglas v2: disparadores por cambios, fechas, ítems
-- quietos y programados; condiciones; acciones; avisos y registro.
-- Se ejecutan dentro de una transacción que se revierte: no dejan datos.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rules_test.sql
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
  a uuid := gen_random_uuid();   -- propietaria
  m uuid := gen_random_uuid();   -- miembro
  x uuid := gen_random_uuid();   -- otra persona del espacio
  ws uuid; bd uuid; bd2 uuid; grp uuid; grp_done uuid; grp2 uuid;
  st_todo uuid; st_prog uuid; st_done uuid;
  c_monto uuid; c_entrega uuid; c_tipo uuid;
  tk uuid; tk2 uuid; tk3 uuid;
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid; r7 uuid;
  today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  monday timestamptz;
  n int;
  blocked boolean;
begin
  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', a, 'authenticated', 'authenticated', 'rules-a@example.test', now(),
          jsonb_build_object('full_name', 'Ana', 'vetta_provision_token', public.admin_issue_provision_token()), '{}', now(), now()),
         ('00000000-0000-0000-0000-000000000000', m, 'authenticated', 'authenticated', 'rules-m@example.test', now(),
          jsonb_build_object('full_name', 'Mario', 'vetta_provision_token', public.admin_issue_provision_token()), '{}', now(), now()),
         ('00000000-0000-0000-0000-000000000000', x, 'authenticated', 'authenticated', 'rules-x@example.test', now(),
          jsonb_build_object('full_name', 'Xime', 'vetta_provision_token', public.admin_issue_provision_token()), '{}', now(), now());

  -- Solo el superadministrador da de alta empresas.
  update public.profiles set is_platform_admin = true where id = a;
  perform pg_temp.act_as(a);
  insert into public.workspaces (name) values ('Empresa reglas') returning id into ws;
  insert into public.boards (workspace_id, name) values (ws, 'Pedidos') returning id into bd;
  insert into public.boards (workspace_id, name) values (ws, 'Calidad') returning id into bd2;
  select id into grp from public.board_groups where board_id = bd;
  insert into public.board_groups (board_id, name, position) values (bd, 'Terminados', 9000) returning id into grp_done;
  select id into grp2 from public.board_groups where board_id = bd2;
  select id into st_todo from public.board_statuses where board_id = bd and position = 0;
  select id into st_prog from public.board_statuses where board_id = bd and position = 1;
  select id into st_done from public.board_statuses where board_id = bd and is_done;
  insert into public.board_columns (board_id, name, kind) values (bd, 'Monto', 'number') returning id into c_monto;
  insert into public.board_columns (board_id, name, kind) values (bd, 'Entrega', 'date') returning id into c_entrega;
  insert into public.board_columns (board_id, name, kind, options)
    values (bd, 'Tipo', 'list', '[{"id":"t1","label":"Normal"},{"id":"t2","label":"Especial"}]') returning id into c_tipo;
  execute 'reset role';
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, m, 'member'), (ws, x, 'member');

  -- ------------------------------------------------------------ validaciones
  perform pg_temp.act_as(a);
  blocked := false;
  begin
    insert into public.board_automations (board_id, target_board_id, name, trigger_type, action_type, action_config)
    values (bd, bd2, 'mal', 'status_changed', 'set_status', jsonb_build_object('status_id', st_done));
  exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'las acciones sobre el ítem apuntan a su propio tablero');
  blocked := false;
  begin
    insert into public.board_automations (board_id, target_board_id, name, trigger_type, action_type, action_config)
    values (bd, bd, 'mal', 'status_changed', 'set_status',
            jsonb_build_object('status_id', (select id from public.board_statuses where board_id = bd2 limit 1)));
  exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'no se puede usar un estado de otro tablero');
  blocked := false;
  begin
    insert into public.board_automations (board_id, target_board_id, name, trigger_type, action_type, action_config)
    values (bd, bd, 'mal', 'status_changed', 'notify', jsonb_build_object('to', 'user', 'user_id', gen_random_uuid()));
  exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'no se puede avisar a alguien de afuera del espacio');

  -- ------------------------------------------------------------ reglas por eventos
  -- R1: al pasar a Hecho, mover a la carpeta Terminados (solo si la prioridad es alta)
  insert into public.board_automations (board_id, target_board_id, name, trigger_type, trigger_status_id, action_type, action_config, conditions)
  values (bd, bd, 'Hechos a Terminados', 'status_changed', st_done, 'set_group', jsonb_build_object('group_id', grp_done),
          '[{"field":"priority","op":"is","value":"high"}]')
  returning id into r1;
  -- R2: al asignar a alguien, avisarle
  insert into public.board_automations (board_id, target_board_id, name, trigger_type, action_type, action_config)
  values (bd, bd, 'Avisar asignación', 'assignee_changed', 'notify',
          jsonb_build_object('to', 'assignee', 'message', 'Te asignaron {titulo}'))
  returning id into r2;
  -- R3: si Tipo pasa a Especial, prioridad urgente y comentario
  insert into public.board_automations (board_id, target_board_id, name, trigger_type, trigger_config, action_type, action_config)
  values (bd, bd, 'Especial urgente', 'column_changed', jsonb_build_object('column_id', c_tipo, 'value', 't2'),
          'set_priority', '{"priority":"urgent"}')
  returning id into r3;
  insert into public.board_automations (board_id, target_board_id, name, trigger_type, trigger_config, action_type, action_config)
  values (bd, bd, 'Comentar especial', 'column_changed', jsonb_build_object('column_id', c_tipo, 'value', 't2'),
          'add_comment', '{"text":"Pedido especial: revisar con {responsable}"}');
  -- R4: si el monto supera 1000, crear tarea vinculada en Calidad
  insert into public.board_automations (board_id, target_board_id, name, trigger_type, trigger_config, action_type, action_config, conditions)
  values (bd, bd2, 'Control de calidad', 'column_changed', jsonb_build_object('column_id', c_monto),
          'create_item', jsonb_build_object('title', 'Revisar {titulo}', 'group_id', grp2, 'due_days', 2),
          jsonb_build_array(jsonb_build_object('field', 'column', 'column_id', c_monto, 'op', 'gt', 'value', '1000')))
  returning id into r4;

  perform pg_temp.check((select legacy_action_type = 'copy' and action_type = 'set_group' from public.board_automations where id = r1),
    'la columna heredada se completa sola');

  execute 'reset role';
  perform pg_temp.act_as(m);
  insert into public.tasks (board_id, group_id, status_id, title, priority) values (bd, grp, st_prog, 'Pedido 1', 'high') returning id into tk;
  insert into public.tasks (board_id, group_id, status_id, title, priority) values (bd, grp, st_prog, 'Pedido 2', 'low') returning id into tk2;

  update public.tasks set status_id = st_done where id = tk;
  perform pg_temp.check((select group_id = grp_done from public.tasks where id = tk), 'cambio de estado → mover a carpeta');
  update public.tasks set status_id = st_done where id = tk2;
  perform pg_temp.check((select group_id = grp from public.tasks where id = tk2), 'las condiciones filtran (prioridad baja no se mueve)');

  update public.tasks set assignee_id = x where id = tk;
  perform pg_temp.check(not exists (select 1 from public.notifications where task_id = tk), 'el miembro no ve avisos de otra persona');

  update public.tasks set custom_values = jsonb_build_object(c_tipo, 't2') where id = tk2;
  perform pg_temp.check((select priority = 'urgent' from public.tasks where id = tk2), 'cambio de columna → prioridad');
  perform pg_temp.check(exists (select 1 from public.task_comments where task_id = tk2 and author_id is null and body like 'Pedido especial%'),
    'la regla comenta como Vetta, sin autor');

  update public.tasks set custom_values = custom_values || jsonb_build_object(c_monto, 500) where id = tk2;
  perform pg_temp.check(not exists (select 1 from public.task_links where source_task_id = tk2), 'condición numérica: 500 no crea control');
  update public.tasks set custom_values = custom_values || jsonb_build_object(c_monto, 1500) where id = tk2;
  select l.target_task_id into tk3 from public.task_links l where l.source_task_id = tk2;
  execute 'reset role';
  perform pg_temp.check((select board_id = bd2 and title = 'Revisar Pedido 2' and due_date = today + 2 from public.tasks where id = tk3),
    'crear ítem vinculado en otro tablero con título y vencimiento');

  perform pg_temp.act_as(x);
  perform pg_temp.check(exists (select 1 from public.notifications where task_id = tk and title = 'Te asignaron Pedido 1'),
    'la persona asignada recibe el aviso');
  update public.notifications set read_at = now() where task_id = tk; get diagnostics n = row_count;
  perform pg_temp.check(n = 1, 'puede marcar su aviso como leído');
  blocked := false;
  begin update public.notifications set title = 'otro' where task_id = tk; exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'no puede cambiar el texto del aviso');
  blocked := false;
  begin
    insert into public.notifications (user_id, workspace_id, title) values (x, ws, 'falso');
  exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'nadie crea avisos a mano');
  perform pg_temp.check(exists (select 1 from public.automation_runs where automation_id = r1 and ok),
    'el registro de ejecuciones es visible para quien ve el tablero');

  -- Una acción que falla no frena el cambio de la persona
  execute 'reset role';
  perform pg_temp.act_as(a);
  insert into public.board_automations (board_id, target_board_id, name, trigger_type, action_type, action_config)
  values (bd, bd, 'Asignar a Xime', 'priority_changed', 'set_assignee', jsonb_build_object('user_id', x))
  returning id into r5;
  execute 'reset role';
  delete from public.workspace_members where workspace_id = ws and user_id = x;
  perform pg_temp.act_as(m);
  update public.tasks set priority = 'medium' where id = tk2; get diagnostics n = row_count;
  perform pg_temp.check(n = 1 and (select priority = 'medium' from public.tasks where id = tk2),
    'si la acción de una regla falla, el cambio igual se guarda');
  execute 'reset role';
  perform pg_temp.check(exists (select 1 from public.automation_runs where automation_id = r5 and not ok and error is not null),
    'el error de la regla queda registrado');
  update public.board_automations set is_active = false where id = r5;

  -- ------------------------------------------------------------ reglas por tiempo
  perform pg_temp.act_as(a);
  -- R6: 2 días antes del vencimiento, avisar al responsable (si no está hecho)
  insert into public.board_automations (board_id, target_board_id, name, trigger_type, trigger_config, action_type, action_config, conditions)
  values (bd, bd, 'Vence pronto', 'date_arrives', '{"date_field":"due_date","offset_days":-2,"hour":0}', 'notify',
          '{"to":"assignee","message":"{titulo} vence el {vencimiento}"}', '[{"field":"done","op":"is","value":"false"}]')
  returning id into r6;
  -- R7: un día después de la fecha de Entrega, marcar prioridad urgente
  insert into public.board_automations (board_id, target_board_id, name, trigger_type, trigger_config, action_type, action_config)
  values (bd, bd, 'Entrega atrasada', 'date_arrives', jsonb_build_object('date_field', c_entrega, 'offset_days', 1, 'hour', 0),
          'set_priority', '{"priority":"urgent"}')
  returning id into r7;
  insert into public.board_automations (board_id, target_board_id, name, trigger_type, trigger_config, action_type, action_config)
  values (bd, bd, 'Quieto 5 días', 'stale', jsonb_build_object('days', 5, 'status_id', st_prog, 'hour', 0),
          'notify', '{"to":"admins","message":"{titulo} lleva 5 días en {estado}"}');
  insert into public.board_automations (board_id, target_board_id, name, trigger_type, trigger_config, action_type, action_config)
  values (bd, bd, 'Revisión semanal', 'schedule', '{"freq":"weekly","weekday":1,"hour":9}',
          'create_item', jsonb_build_object('title', 'Revisión semanal {hoy}', 'group_id', grp));

  execute 'reset role';
  update public.tasks set assignee_id = m, due_date = today + 2, status_id = st_prog, priority = 'low' where id = tk2;
  update public.tasks set custom_values = jsonb_build_object(c_entrega, (today - 1)::text) where id = tk;
  insert into public.tasks (board_id, group_id, status_id, title) values (bd, grp, st_prog, 'Pedido quieto') returning id into tk3;

  n := private.run_scheduled_automations(now());
  perform pg_temp.check(exists (select 1 from public.notifications where user_id = m and task_id = tk2 and title like 'Pedido 2 vence el%'),
    '2 días antes del vencimiento se avisa al responsable');
  perform pg_temp.check((select priority = 'urgent' from public.tasks where id = tk), 'un día después de la fecha de una columna');
  perform private.run_scheduled_automations(now());
  select count(*) into n from public.notifications where user_id = m and task_id = tk2 and title like 'Pedido 2 vence%';
  perform pg_temp.check(n = 1, 'una regla por fecha no se repite');

  update public.tasks set due_date = today + 3 where id = tk2;
  perform private.run_scheduled_automations(now() + interval '1 day');
  select count(*) into n from public.notifications where user_id = m and task_id = tk2 and title like 'Pedido 2 vence%';
  perform pg_temp.check(n = 2, 'si cambia la fecha, la regla vuelve a avisar');

  update public.tasks set due_date = today + 2, status_id = st_done, assignee_id = m where id = tk;
  perform private.run_scheduled_automations(now());
  perform pg_temp.check(not exists (select 1 from public.notifications where task_id = tk and title like '%vence%'),
    'la condición "no hecho" excluye ítems terminados');

  perform private.run_scheduled_automations(now() + interval '6 days');
  perform pg_temp.check(exists (select 1 from public.notifications where user_id = a and task_id = tk3 and title like '%lleva 5 días en En progreso'),
    'un ítem quieto 5 días avisa a los administradores');
  perform pg_temp.check(not exists (select 1 from public.notifications where user_id = m and title like '%lleva 5 días%'),
    'los avisos a administradores no llegan a miembros');

  monday := ((date_trunc('week', (now() at time zone 'America/Argentina/Buenos_Aires')) + interval '7 days 10 hours')
             at time zone 'America/Argentina/Buenos_Aires');
  perform private.run_scheduled_automations(monday - interval '2 hours');
  perform pg_temp.check(not exists (select 1 from public.tasks where board_id = bd and title like 'Revisión semanal%'),
    'una regla programada espera su hora');
  perform private.run_scheduled_automations(monday);
  perform private.run_scheduled_automations(monday + interval '30 minutes');
  select count(*) into n from public.tasks where board_id = bd and title like 'Revisión semanal%';
  perform pg_temp.check(n = 1, 'la regla semanal crea un ítem por semana');
  perform private.run_scheduled_automations(monday + interval '1 day');
  select count(*) into n from public.tasks where board_id = bd and title like 'Revisión semanal%';
  perform pg_temp.check(n = 1, 'el martes no se repite');

  set constraints all immediate;
  perform pg_temp.check(true, 'los vínculos son consistentes al confirmar');
  raise notice 'TODAS LAS PRUEBAS PASARON';
end
$t$;

rollback;
