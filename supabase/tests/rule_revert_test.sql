-- =============================================================================
-- Pruebas de reglas reversibles, detalle de ejecuciones e historial.
-- Transacción que se revierte: no deja datos.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rule_revert_test.sql
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
  ws uuid; b uuid; g uuid; col uuid; txt uuid; tk uuid; t2 uuid; s_first uuid; s_ini uuid; s_rev uuid; st uuid; n int;
  steps jsonb := '[{"id":"a","text":"Paso uno","done":false},{"id":"b","text":"Paso dos","done":false}]';
begin
  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', ow, 'authenticated', 'authenticated', 'rev-ow@example.test', now(),
          jsonb_build_object('vetta_provision_token', public.admin_issue_provision_token()), '{}', now(), now());
  execute 'reset role';
  insert into public.workspaces (name) values ('Reversa SA') returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, ow, 'owner');

  perform pg_temp.act_as(ow);
  insert into public.boards (workspace_id, name) values (ws, 'Tablero') returning id into b;
  select id into g from public.board_groups where board_id = b limit 1;
  select id into s_first from public.board_statuses where board_id = b order by position limit 1;
  select id into s_ini from public.board_statuses where board_id = b order by position offset 1 limit 1;
  select id into s_rev from public.board_statuses where board_id = b order by position offset 2 limit 1;
  insert into public.board_columns (board_id, name, kind) values (b, 'Checklist', 'checklist') returning id into col;
  insert into public.board_columns (board_id, name, kind) values (b, 'Nota', 'text') returning id into txt;

  insert into public.board_automations (workspace_id, board_id, name, trigger_type, trigger_config, conditions, action_type, action_config, target_board_id, revert_on_undo)
  values (ws, b, 'Arranca', 'checklist_changed', '{"event":"any_checked"}',
          jsonb_build_array(jsonb_build_object('field', 'status', 'op', 'is_not', 'value', s_ini)),
          'set_status', jsonb_build_object('status_id', s_ini), b, true);

  insert into public.tasks (board_id, group_id, title, status_id, custom_values)
  values (b, g, 'Uno', s_first, jsonb_build_object(col::text, steps)) returning id into tk;

  update public.tasks set custom_values = jsonb_set(custom_values, array[col::text, '0', 'done'], 'true') where id = tk;
  perform pg_temp.check((select status_id from public.tasks where id = tk) = s_ini, 'tildar un paso dispara la regla');
  perform pg_temp.check((select change ->> 'field' from public.automation_runs where task_id = tk and kind = 'run') = 'status_id', 'la ejecución guarda qué cambió');
  perform pg_temp.check((select actor_id from public.automation_runs where task_id = tk and kind = 'run') = ow, 'la ejecución guarda quién la disparó');

  update public.tasks set custom_values = jsonb_set(custom_values, array[col::text, '1', 'done'], 'true') where id = tk;
  update public.tasks set custom_values = jsonb_set(custom_values, array[col::text, '1', 'done'], 'false') where id = tk;
  perform pg_temp.check((select status_id from public.tasks where id = tk) = s_ini, 'destildar uno con otro tildado no revierte');

  update public.tasks set custom_values = jsonb_set(custom_values, array[col::text, '0', 'done'], 'false') where id = tk;
  perform pg_temp.check((select status_id from public.tasks where id = tk) = s_first, 'destildar todo vuelve al estado anterior');
  perform pg_temp.check((select count(*) from public.automation_runs where task_id = tk and kind = 'revert' and ok and change is not null) = 1, 'la reversión queda registrada');
  perform pg_temp.check(exists (select 1 from public.task_events where task_id = tk and kind = 'status_changed' and automation_name = 'Arranca (reversión)'), 'el historial marca la reversión');

  -- Si alguien cambió el estado a mano, la reversión no lo pisa.
  update public.tasks set custom_values = jsonb_set(custom_values, array[col::text, '0', 'done'], 'true') where id = tk;
  update public.tasks set status_id = s_rev where id = tk;
  update public.tasks set custom_values = jsonb_set(custom_values, array[col::text, '0', 'done'], 'false') where id = tk;
  perform pg_temp.check((select status_id from public.tasks where id = tk) = s_rev, 'no pisa un cambio manual');
  perform pg_temp.check(exists (select 1 from public.automation_runs where task_id = tk and kind = 'revert' and note is not null), 'deja nota de por qué no revirtió');

  -- Regla por estado con reversión: al salir del estado, se deshace la prioridad.
  insert into public.board_automations (workspace_id, board_id, name, trigger_type, trigger_status_id, action_type, action_config, target_board_id, revert_on_undo, position)
  values (ws, b, 'Urgente en revisión', 'status_changed', s_rev, 'set_priority', '{"priority":"urgent"}', b, true, 2);
  insert into public.tasks (board_id, group_id, title, status_id, priority) values (b, g, 'Dos', s_first, 'low') returning id into t2;
  update public.tasks set status_id = s_rev where id = t2;
  perform pg_temp.check((select priority from public.tasks where id = t2) = 'urgent', 'la regla por estado actúa');
  update public.tasks set status_id = s_ini where id = t2;
  perform pg_temp.check((select priority from public.tasks where id = t2) = 'low', 'al salir del estado vuelve la prioridad anterior');

  -- Historial completo: descripción y columnas.
  update public.tasks set description = 'Hola', custom_values = custom_values || jsonb_build_object(txt::text, 'abc') where id = t2;
  perform pg_temp.check(exists (select 1 from public.task_events where task_id = t2 and kind = 'description_changed'), 'registra la descripción');
  perform pg_temp.check(exists (select 1 from public.task_events where task_id = t2 and kind = 'value_changed' and detail ->> 'to' = 'abc' and detail ->> 'column' = 'Nota'), 'registra el valor de una columna');
  perform pg_temp.check(exists (select 1 from public.task_events where task_id = t2 and kind = 'priority_changed' and detail ->> 'from' = 'low'), 'registra el valor anterior');

  execute 'reset role';
  raise notice 'TODAS LAS PRUEBAS PASARON';
end $t$;

rollback;
