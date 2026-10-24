-- =============================================================================
-- Pruebas del disparador de reglas "cambia un checklist".
-- Transacción que se revierte: no deja datos.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/checklist_rules_test.sql
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
  ws uuid; b uuid; g uuid; col uuid; tk uuid; t2 uuid; s_ini uuid; s_rev uuid; s_done uuid; s_first uuid;
  steps jsonb := '[{"id":"h","text":"Sección","done":false,"header":true},{"id":"a","text":"Paso uno","done":false},{"id":"b","text":"Paso dos","done":false},{"id":"c","text":"No aplica","done":false,"status":"na"}]';
  st uuid;
begin
  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', ow, 'authenticated', 'authenticated', 'ckr-ow@example.test', now(),
          jsonb_build_object('vetta_provision_token', public.admin_issue_provision_token()), '{}', now(), now());
  execute 'reset role';
  insert into public.workspaces (name) values ('Reglas SA') returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, ow, 'owner');

  perform pg_temp.act_as(ow);
  insert into public.boards (workspace_id, name) values (ws, 'Tablero') returning id into b;
  select id into g from public.board_groups where board_id = b limit 1;
  select id into s_first from public.board_statuses where board_id = b order by position limit 1;
  select id into s_ini from public.board_statuses where board_id = b order by position offset 1 limit 1;
  select id into s_rev from public.board_statuses where board_id = b order by position offset 2 limit 1;
  select id into s_done from public.board_statuses where board_id = b and is_done limit 1;
  insert into public.board_columns (board_id, name, kind) values (b, 'Checklist', 'checklist') returning id into col;

  -- Regla 1: al tildar el primer paso (arranca) → estado "En progreso"
  insert into public.board_automations (workspace_id, board_id, name, trigger_type, trigger_config, action_type, action_config, target_board_id)
  values (ws, b, 'Arranca', 'checklist_changed', jsonb_build_object('event', 'started'), 'set_status', jsonb_build_object('status_id', s_ini), b);
  -- Regla 2: al completar el checklist → "Hecho"
  insert into public.board_automations (workspace_id, board_id, name, trigger_type, trigger_config, action_type, action_config, target_board_id, position)
  values (ws, b, 'Completo', 'checklist_changed', jsonb_build_object('column_id', col, 'event', 'completed'), 'set_status', jsonb_build_object('status_id', s_done), b, 2);

  insert into public.tasks (board_id, group_id, title, status_id, custom_values)
  values (b, g, 'Uno', s_first, jsonb_build_object(col::text, steps)) returning id into tk;
  select status_id into st from public.tasks where id = tk;
  perform pg_temp.check(st = s_first, 'crear el elemento no dispara reglas de checklist');

  update public.tasks set custom_values = jsonb_set(custom_values, array[col::text, '1', 'done'], 'true') where id = tk;
  select status_id into st from public.tasks where id = tk;
  perform pg_temp.check(st = s_ini, 'tildar el primer paso pasa el elemento a "en progreso"');

  update public.tasks set status_id = s_rev where id = tk;
  update public.tasks set custom_values = jsonb_set(custom_values, array[col::text, '1', 'done'], 'false') where id = tk;
  select status_id into st from public.tasks where id = tk;
  perform pg_temp.check(st = s_rev, 'destildar no dispara "arranca"');

  update public.tasks set custom_values = jsonb_set(custom_values, array[col::text, '1', 'done'], 'true') where id = tk;
  update public.tasks set custom_values = jsonb_set(custom_values, array[col::text, '2', 'done'], 'true') where id = tk;
  select status_id into st from public.tasks where id = tk;
  perform pg_temp.check(st = s_done, 'completar los pasos (sin contar secciones ni "no aplica") lo pasa a terminado');

  -- Regla 3: un paso puntual por texto → prioridad urgente
  insert into public.board_automations (workspace_id, board_id, name, trigger_type, trigger_config, action_type, action_config, target_board_id, position)
  values (ws, b, 'Paso dos', 'checklist_changed', jsonb_build_object('event', 'step_checked', 'step', 'paso dos'), 'set_priority', jsonb_build_object('priority', 'urgent'), b, 3);
  insert into public.tasks (board_id, group_id, title, status_id, custom_values)
  values (b, g, 'Dos', s_first, jsonb_build_object(col::text, steps)) returning id into t2;
  update public.tasks set custom_values = jsonb_set(custom_values, array[col::text, '2', 'done'], 'true') where id = t2;
  perform pg_temp.check((select priority from public.tasks where id = t2) = 'urgent', 'tildar un paso puntual (por texto) dispara su regla');

  execute 'reset role';
  raise notice 'TODAS LAS PRUEBAS PASARON';
end $t$;

rollback;
