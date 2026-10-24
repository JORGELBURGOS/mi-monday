-- =============================================================================
-- Pruebas de la acción de regla "Agregar pasos al checklist" (circuito por carpetas).
-- Transacción que se revierte: no deja datos.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rule_add_checklist_test.sql
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
  ws uuid; b uuid; g1 uuid; g2 uuid; g3 uuid; col uuid; tk uuid; tp1 uuid; tp2 uuid;
  lst jsonb; n int; secs text[]; v_err text;
begin
  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', ow, 'authenticated', 'authenticated', 'acl-ow@example.test', now(),
          jsonb_build_object('vetta_provision_token', public.admin_issue_provision_token()), '{}', now(), now());
  execute 'reset role';
  insert into public.workspaces (name) values ('Circuito SA') returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, ow, 'owner');

  perform pg_temp.act_as(ow);
  insert into public.boards (workspace_id, name) values (ws, 'Operaciones') returning id into b;
  insert into public.board_groups (board_id, name, position) values (b, 'Comercial', 10) returning id into g1;
  insert into public.board_groups (board_id, name, position) values (b, 'Logística', 20) returning id into g2;
  insert into public.board_groups (board_id, name, position) values (b, 'Cobranzas', 30) returning id into g3;
  insert into public.board_columns (board_id, name, kind) values (b, 'Checklist', 'checklist') returning id into col;
  insert into public.checklist_templates (workspace_id, name, items)
  values (ws, 'Comercial', '[{"text":"Cotizar"},{"text":"Firmar orden"}]') returning id into tp1;
  insert into public.checklist_templates (workspace_id, name, items)
  values (ws, 'Logística', '[{"text":"Reservar camión"},{"text":"Despachar","note":"Con remito"}]') returning id into tp2;

  -- Al llegar a Comercial: pasos de Comercial (sección = carpeta).
  insert into public.board_automations (workspace_id, board_id, name, trigger_type, trigger_group_id, action_type, action_config, target_board_id)
  values (ws, b, 'Pasos Comercial', 'item_arrived', g1, 'add_checklist',
          jsonb_build_object('column_id', col, 'template_id', tp1, 'section', '{carpeta}'), b);
  -- Al entrar a Logística: pasos de Logística, asignados al responsable del ítem.
  insert into public.board_automations (workspace_id, board_id, name, trigger_type, trigger_group_id, action_type, action_config, target_board_id, position)
  values (ws, b, 'Pasos Logística', 'group_changed', g2, 'add_checklist',
          jsonb_build_object('column_id', col, 'template_id', tp2, 'section', '{carpeta}', 'assign', 'assignee'), b, 2);
  -- Al completar el checklist en Comercial → pasar a Logística.
  insert into public.board_automations (workspace_id, board_id, name, trigger_type, trigger_config, conditions, action_type, action_config, target_board_id, position)
  values (ws, b, 'Avanzar', 'checklist_changed', jsonb_build_object('column_id', col, 'event', 'completed'),
          jsonb_build_array(jsonb_build_object('field', 'group', 'op', 'is', 'value', g1)),
          'set_group', jsonb_build_object('group_id', g2), b, 3);

  insert into public.tasks (board_id, group_id, title, assignee_id) values (b, g1, 'Operación 1', ow) returning id into tk;
  select custom_values -> col::text into lst from public.tasks where id = tk;
  perform pg_temp.check(jsonb_array_length(lst) = 3, 'al llegar a Comercial: sección + 2 pasos');
  perform pg_temp.check(lst -> 0 ->> 'text' = 'Comercial' and (lst -> 0 ->> 'header')::boolean, 'la sección lleva el nombre de la carpeta');
  perform pg_temp.check(lst -> 1 ->> 'assignee' is null, 'sin responsable si la regla no lo pide');

  -- El equipo comercial completa su parte → la regla lo pasa a Logística → se suman sus pasos.
  update public.tasks set custom_values = jsonb_set(custom_values, array[col::text],
    (select jsonb_agg(case when coalesce((e ->> 'header')::boolean, false) then e else e || '{"done":true}' end order by o)
       from jsonb_array_elements(lst) with ordinality x(e, o)))
   where id = tk;
  perform pg_temp.check((select group_id from public.tasks where id = tk) = g2, 'checklist completo en Comercial → pasa a Logística');
  select custom_values -> col::text into lst from public.tasks where id = tk;
  perform pg_temp.check(jsonb_array_length(lst) = 6, 'en Logística se suman sección + 2 pasos (quedan los 3 anteriores)');
  perform pg_temp.check((lst -> 1 ->> 'done')::boolean and (lst -> 2 ->> 'done')::boolean, 'lo que hizo Comercial sigue tildado');
  perform pg_temp.check(lst -> 3 ->> 'text' = 'Logística' and lst -> 4 ->> 'assignee' = ow::text, 'pasos de Logística asignados al responsable');
  perform pg_temp.check(lst -> 5 ->> 'note' = 'Con remito' and not (lst -> 5 ->> 'done')::boolean, 'conserva la nota y arranca sin tildar');

  -- Vuelve a Comercial y otra vez a Logística: no se duplica.
  update public.tasks set group_id = g1 where id = tk;
  update public.tasks set group_id = g2 where id = tk;
  select custom_values -> col::text into lst from public.tasks where id = tk;
  perform pg_temp.check(jsonb_array_length(lst) = 6, 'volver a pasar por Logística no repite los pasos');

  -- Historial: la regla quedó registrada como ejecutada.
  select count(*) into n from public.automation_runs ar join public.board_automations a on a.id = ar.automation_id
   where a.board_id = b and a.action_type = 'add_checklist' and ar.ok;
  perform pg_temp.check(n >= 2, 'las ejecuciones quedan registradas');

  -- Sin sección: no duplica si ya están todos los pasos.
  update public.board_automations set action_config = jsonb_build_object('column_id', col, 'template_id', tp1) where name = 'Pasos Comercial';
  insert into public.tasks (board_id, group_id, title) values (b, g1, 'Operación 2') returning id into tk;
  select custom_values -> col::text into lst from public.tasks where id = tk;
  perform pg_temp.check(jsonb_array_length(lst) = 2, 'sin sección: solo los pasos');

  -- Plantilla borrada → la ejecución falla con un error claro (y no rompe el alta).
  execute 'reset role';
  delete from public.checklist_templates where id = tp1;
  perform pg_temp.act_as(ow);
  insert into public.tasks (board_id, group_id, title) values (b, g1, 'Operación 3') returning id into tk;
  perform pg_temp.check(exists (select 1 from public.tasks where id = tk), 'el alta sigue funcionando aunque falte la plantilla');
  select ar.error into v_err from public.automation_runs ar where ar.task_id = tk and not ar.ok limit 1;
  perform pg_temp.check(v_err like '%plantilla%', 'el error de la regla explica qué falta');

  -- Acción no válida en el constraint sigue rechazada.
  begin
    insert into public.board_automations (workspace_id, board_id, name, trigger_type, action_type, target_board_id)
    values (ws, b, 'X', 'item_arrived', 'borrar_todo', b);
    perform pg_temp.check(false, 'acción desconocida rechazada');
  exception when check_violation then
    perform pg_temp.check(true, 'acción desconocida rechazada');
  end;
end
$t$;

rollback;
