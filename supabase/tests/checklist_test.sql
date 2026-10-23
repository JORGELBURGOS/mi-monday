-- =============================================================================
-- Pruebas de checklists: plantillas, automatismos, historial y avisos.
-- Transacción que se revierte: no deja datos.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/checklist_test.sql
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
  mb uuid := gen_random_uuid();
  ot uuid := gen_random_uuid();
  ws uuid; ws2 uuid; b uuid; g uuid; col uuid; tpl uuid; tk uuid; s_done uuid; s_todo uuid;
  v jsonb; n int; blocked boolean;
begin
  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.mail, now(),
         jsonb_build_object('vetta_provision_token', public.admin_issue_provision_token()), '{}', now(), now()
  from (values (ow, 'chk-ow@example.test'), (mb, 'chk-mb@example.test'), (ot, 'chk-ot@example.test')) u(id, mail);
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);
  insert into public.workspaces (name) values ('Check SA') returning id into ws;
  insert into public.workspaces (name) values ('Otra SA') returning id into ws2;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, ow, 'owner'), (ws, mb, 'member'), (ws2, ot, 'owner');

  perform pg_temp.act_as(ow);
  insert into public.boards (workspace_id, name) values (ws, 'Tablero') returning id into b;
  select id into g from public.board_groups where board_id = b limit 1;
  select id into s_done from public.board_statuses where board_id = b and is_done limit 1;
  select id into s_todo from public.board_statuses where board_id = b and not is_done order by position limit 1;

  insert into public.checklist_templates (workspace_id, name, items)
  values (ws, 'Alta de cliente', '[{"text":"Documentación","header":true},{"text":"DNI"},{"text":"Contrato","note":"firmado"}]')
  returning id into tpl;
  insert into public.board_columns (board_id, name, kind, settings)
  values (b, 'Checklist', 'checklist', jsonb_build_object('templateId', tpl, 'completeOnDone', true)) returning id into col;

  -- Plantilla automática al crear
  insert into public.tasks (board_id, group_id, title, status_id) values (b, g, 'Cliente nuevo', s_todo) returning id into tk;
  select custom_values -> col::text into v from public.tasks where id = tk;
  perform pg_temp.check(jsonb_array_length(v) = 3, 'un elemento nuevo arranca con la plantilla del checklist');
  perform pg_temp.check((v -> 0 ->> 'header')::boolean and not (v -> 1 ->> 'done')::boolean, 'la plantilla conserva secciones y arranca sin tildar');

  -- Asignar un paso a otra persona: aviso
  update public.tasks set custom_values = jsonb_set(custom_values, array[col::text, '1', 'assignee'], to_jsonb(mb::text)) where id = tk;
  execute 'reset role';
  select count(*) into n from public.notifications where user_id = mb and task_id = tk;
  perform pg_temp.check(n = 1, 'quien recibe un paso asignado tiene un aviso');

  -- Tildar un paso: historial
  perform pg_temp.act_as(ow);
  update public.tasks set custom_values = jsonb_set(custom_values, array[col::text, '1', 'done'], 'true') where id = tk;
  execute 'reset role';
  select count(*) into n from public.task_events where task_id = tk and kind = 'checklist_item';
  perform pg_temp.check(n = 1, 'tildar un paso queda en el historial');

  -- Completar todo: evento de checklist completo
  perform pg_temp.act_as(ow);
  update public.tasks set custom_values = jsonb_set(custom_values, array[col::text, '2', 'done'], 'true') where id = tk;
  execute 'reset role';
  select count(*) into n from public.task_events where task_id = tk and kind = 'checklist_completed';
  perform pg_temp.check(n = 1, 'completar el checklist queda en el historial');

  -- Tildar todo al pasar a un estado terminado
  perform pg_temp.act_as(ow);
  insert into public.tasks (board_id, group_id, title, status_id) values (b, g, 'Otro cliente', s_todo) returning id into tk;
  update public.tasks set status_id = s_done where id = tk;
  select custom_values -> col::text into v from public.tasks where id = tk;
  select count(*) into n from jsonb_array_elements(v) x where not coalesce((x ->> 'header')::boolean, false) and not (x ->> 'done')::boolean;
  perform pg_temp.check(n = 0, 'al pasar a terminado se tildan todos los pasos');

  -- Permisos de plantillas
  perform pg_temp.act_as(mb);
  update public.checklist_templates set name = 'hackeada' where id = tpl;
  perform pg_temp.check((select name from public.checklist_templates where id = tpl) = 'Alta de cliente', 'un usuario no edita plantillas ajenas');
  insert into public.checklist_templates (workspace_id, name) values (ws, 'Mía');
  perform pg_temp.check(exists (select 1 from public.checklist_templates where name = 'Mía'), 'un usuario crea sus propias plantillas');
  perform pg_temp.act_as(ot);
  select count(*) into n from public.checklist_templates where workspace_id = ws;
  perform pg_temp.check(n = 0, 'otra empresa no ve las plantillas');
  blocked := false;
  begin insert into public.checklist_templates (workspace_id, name) values (ws, 'Intrusa'); exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'otra empresa no crea plantillas acá');

  raise notice 'TODAS LAS PRUEBAS PASARON';
end $t$;

rollback;
