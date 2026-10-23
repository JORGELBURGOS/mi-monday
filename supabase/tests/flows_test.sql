-- =============================================================================
-- Pruebas de columnas, reglas entre tableros y trazabilidad.
-- Se ejecutan dentro de una transacción que se revierte: no dejan datos.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/flows_test.sql
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
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

do $t$
declare
  a uuid := gen_random_uuid();   -- propietaria
  m uuid := gen_random_uuid();   -- miembro
  ws uuid; ws2 uuid;
  ventas uuid; prod uuid; priv uuid; l1 uuid; l2 uuid; otro uuid;
  v_grp uuid; v_cerr uuid; p_grp uuid; p_grp2 uuid; x_grp uuid;
  v_done uuid; v_prog uuid; p_done uuid;
  c_cli uuid; c_monto uuid; c_tipo uuid; p_cli uuid; p_tipo uuid; p_planta uuid;
  r_copy uuid; r_back uuid; r_move uuid;
  tk uuid; cp uuid;
  n int;
  blocked boolean;
begin
  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', a, 'authenticated', 'authenticated', 'flow-a@example.test', now(),
          jsonb_build_object('full_name', 'Ana', 'vetta_provision_token', public.admin_issue_provision_token()), '{}', now(), now()),
         ('00000000-0000-0000-0000-000000000000', m, 'authenticated', 'authenticated', 'flow-m@example.test', now(),
          jsonb_build_object('full_name', 'Mario', 'vetta_provision_token', public.admin_issue_provision_token()), '{}', now(), now());

  -- ---------------------------------------------------------------- estructura
  perform pg_temp.act_as(a);
  insert into public.workspaces (name) values ('Empresa') returning id into ws;
  insert into public.workspaces (name) values ('Otra empresa') returning id into ws2;
  insert into public.boards (workspace_id, name) values (ws, 'Ventas') returning id into ventas;
  insert into public.boards (workspace_id, name) values (ws, 'Producción') returning id into prod;
  insert into public.boards (workspace_id, name, visibility) values (ws, 'Facturación', 'private') returning id into priv;
  insert into public.boards (workspace_id, name) values (ws2, 'Ajeno') returning id into otro;

  select id into v_grp from public.board_groups where board_id = ventas;
  insert into public.board_groups (board_id, name, position) values (ventas, 'Cerrados', 5000) returning id into v_cerr;
  select id into p_grp from public.board_groups where board_id = prod;
  insert into public.board_groups (board_id, name, position) values (prod, 'Planta norte', 5000) returning id into p_grp2;
  select id into x_grp from public.board_groups where board_id = priv;
  select id into v_done from public.board_statuses where board_id = ventas and label = 'Hecho';
  select id into v_prog from public.board_statuses where board_id = ventas and label = 'En progreso';
  select id into p_done from public.board_statuses where board_id = prod and label = 'Hecho';

  insert into public.board_columns (board_id, name, kind) values (ventas, 'Cliente', 'text') returning id into c_cli;
  insert into public.board_columns (board_id, name, kind) values (ventas, 'Monto', 'number') returning id into c_monto;
  insert into public.board_columns (board_id, name, kind, options)
    values (ventas, 'Canal', 'list', '[{"id":"v1","label":"Mayorista"},{"id":"v2","label":"Retail"}]') returning id into c_tipo;
  insert into public.board_columns (board_id, name, kind) values (prod, 'Cliente', 'text') returning id into p_cli;
  insert into public.board_columns (board_id, name, kind, options)
    values (prod, 'Canal', 'list', '[{"id":"p1","label":"retail"}]') returning id into p_tipo;
  insert into public.board_columns (board_id, name, kind) values (prod, 'Planta', 'text') returning id into p_planta;

  update public.board_columns set kind = 'number' where id = c_cli;
  perform pg_temp.check((select kind from public.board_columns where id = c_cli) = 'text', 'el tipo de una columna no cambia');

  -- Reglas inválidas
  blocked := false;
  begin
    insert into public.board_automations (board_id, name, trigger_type, action_type, target_board_id)
    values (ventas, 'a otro espacio', 'item_arrived', 'copy', otro);
  exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'una regla no puede apuntar a otro espacio');

  blocked := false;
  begin
    insert into public.board_automations (board_id, name, trigger_type, action_type, target_board_id, column_map)
    values (ventas, 'tipos distintos', 'item_arrived', 'copy', prod,
            jsonb_build_array(jsonb_build_object('from', c_monto, 'to', p_cli)));
  exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'el mapeo exige columnas del mismo tipo');

  blocked := false;
  begin
    insert into public.board_automations (board_id, name, trigger_type, action_type, target_board_id, target_group_id)
    values (ventas, 'carpeta ajena', 'item_arrived', 'copy', prod, v_cerr);
  exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'la carpeta de destino tiene que ser del tablero de destino');

  -- R1: en Ventas, al pasar a Hecho → copiar a Producción / Planta norte
  insert into public.board_automations (board_id, name, trigger_type, trigger_status_id, action_type,
                                        target_board_id, target_group_id, column_map, extra_values)
  values (ventas, 'Pedido ganado a producción', 'status_changed', v_done, 'copy', prod, p_grp2,
          jsonb_build_array(jsonb_build_object('from', c_cli, 'to', p_cli), jsonb_build_object('from', c_tipo, 'to', p_tipo)),
          jsonb_build_object(p_planta, 'Norte'))
  returning id into r_copy;
  perform pg_temp.check((select workspace_id from public.board_automations where id = r_copy) = ws, 'la regla toma el espacio del tablero');

  -- R2: en Producción, al pasar a Hecho → mover el original (en Ventas) a Cerrados
  insert into public.board_automations (board_id, name, trigger_type, trigger_status_id, action_type,
                                        target_board_id, target_group_id, link_direction)
  values (prod, 'Avisar a ventas', 'status_changed', p_done, 'update_linked', ventas, v_cerr, 'origin')
  returning id into r_back;

  -- R3: en Ventas, al entrar a Cerrados → mover completo a Facturación (privado)
  insert into public.board_automations (board_id, name, trigger_type, trigger_group_id, action_type, target_board_id)
  values (ventas, 'Cerrados a facturar', 'group_changed', v_cerr, 'move', priv)
  returning id into r_move;

  execute 'reset role';
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, m, 'member');

  -- ---------------------------------------------------------------- miembro
  perform pg_temp.act_as(m);
  perform pg_temp.check(exists (select 1 from public.board_columns where id = c_cli), 'el miembro ve las columnas');
  perform pg_temp.check(exists (select 1 from public.board_automations where id = r_copy), 'el miembro ve las reglas');
  blocked := false;
  begin insert into public.board_columns (board_id, name, kind) values (ventas, 'X', 'text'); exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'un miembro no puede crear columnas');
  blocked := false;
  begin
    insert into public.board_automations (board_id, name, trigger_type, action_type, target_board_id)
    values (ventas, 'mía', 'item_arrived', 'copy', prod);
  exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'un miembro no puede crear reglas');
  update public.board_automations set is_active = false where id = r_copy; get diagnostics n = row_count;
  perform pg_temp.check(n = 0, 'un miembro no puede pausar reglas');

  insert into public.tasks (board_id, group_id, status_id, title, priority, assignee_id, due_date, custom_values)
  values (ventas, v_grp, v_prog, 'Pedido ACME', 'high', m, date '2026-11-01',
          jsonb_build_object(c_cli, 'ACME', c_monto, 1500, c_tipo, 'v2'))
  returning id into tk;

  blocked := false;
  begin insert into public.task_events (workspace_id, board_id, task_id, kind) values (ws, ventas, tk, 'falso'); exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'nadie puede escribir el historial a mano');
  blocked := false;
  begin insert into public.task_links (source_task_id, target_task_id) values (tk, tk); exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'nadie puede crear vínculos a mano');
  blocked := false;
  begin update public.task_events set kind = 'otro' where task_id = tk; exception when others then blocked := true; end;
  perform pg_temp.check(blocked, 'el historial no se puede modificar');

  update public.tasks set board_id = prod where id = tk;
  perform pg_temp.check((select board_id from public.tasks where id = tk) = ventas, 'un ítem no cambia de tablero por la API');

  -- Dispara R1
  update public.tasks set status_id = v_done where id = tk;
  select l.target_task_id into cp from public.task_links l where l.source_task_id = tk;
  perform pg_temp.check(cp is not null, 'al pasar a Hecho se crea la copia vinculada');
  perform pg_temp.check((select board_id = prod and group_id = p_grp2 from public.tasks where id = cp), 'la copia queda en el tablero y carpeta de destino');
  perform pg_temp.check((select custom_values ->> p_cli::text = 'ACME' from public.tasks where id = cp), 'las columnas mapeadas viajan');
  perform pg_temp.check((select custom_values ->> p_tipo::text = 'p1' from public.tasks where id = cp), 'las listas se traducen por nombre de opción');
  perform pg_temp.check((select custom_values ->> p_planta::text = 'Norte' from public.tasks where id = cp), 'se agregan los valores fijos');
  perform pg_temp.check((select not (custom_values ? c_monto::text) from public.tasks where id = cp), 'las columnas no mapeadas no viajan');
  perform pg_temp.check((select priority = 'high' and assignee_id = m and due_date = date '2026-11-01' from public.tasks where id = cp),
    'los campos elegidos se copian');
  perform pg_temp.check((select s.position = 0 from public.tasks t join public.board_statuses s on s.id = t.status_id where t.id = cp),
    'sin copiar el estado, la copia arranca en el primero');
  perform pg_temp.check(exists (select 1 from public.task_events where task_id = tk and kind = 'copied_to' and automation_name = 'Pedido ganado a producción'),
    'el original registra la copia');
  perform pg_temp.check(exists (select 1 from public.task_events where task_id = cp and kind = 'created' and detail ->> 'from_board' = 'Ventas'),
    'la copia registra de dónde vino');
  perform pg_temp.check(exists (select 1 from public.task_events where task_id = tk and kind = 'status_changed' and detail ->> 'to' = 'Hecho'),
    'el historial registra el cambio de estado');

  update public.tasks set status_id = v_prog where id = tk;
  update public.tasks set status_id = v_done where id = tk;
  select count(*) into n from public.task_links where source_task_id = tk;
  perform pg_temp.check(n = 1, 'una regla copia un mismo ítem una sola vez');

  select count(*) into n from public.task_trace(cp) where depth = -1 and task_id = tk;
  perform pg_temp.check(n = 1, 'la trazabilidad de la copia muestra el original');

  -- Dispara R2 → mueve el original a Cerrados → dispara R3 → viaja a Facturación (privado)
  update public.tasks set status_id = p_done where id = cp;
  perform pg_temp.check(not exists (select 1 from public.tasks where id = tk), 'el original viajó a un tablero que el miembro no ve');
  perform pg_temp.check(exists (select 1 from public.task_events where task_id = tk and kind = 'group_changed' and automation_name = 'Avisar a ventas'),
    'el miembro ve el historial de lo que pasó en Ventas');
  perform pg_temp.check(not exists (select 1 from public.task_events where task_id = tk and board_id = priv),
    'el miembro no ve el historial del tablero privado');
  select count(*) into n from public.task_trace(cp) where depth = -1 and task_id = tk and title is null;
  perform pg_temp.check(n = 1, 'en la cadena, el ítem sin acceso aparece sin datos');

  -- ---------------------------------------------------------------- propietaria
  perform pg_temp.act_as(a);
  perform pg_temp.check((select board_id = priv and group_id = x_grp from public.tasks where id = tk), 'el ítem completo llegó a Facturación');
  perform pg_temp.check((select s.label = 'Hecho' from public.tasks t join public.board_statuses s on s.id = t.status_id where t.id = tk),
    'al moverse conserva el estado por nombre');
  perform pg_temp.check((select custom_values = '{}'::jsonb from public.tasks where id = tk), 'sin columnas equivalentes, no lleva valores');
  perform pg_temp.check(exists (select 1 from public.task_events where task_id = tk and kind = 'moved' and detail ->> 'to_board' = 'Facturación'),
    'el historial registra el viaje entre tableros');
  perform pg_temp.check(exists (select 1 from public.task_trace(tk) where depth = 1 and task_id = cp and title = 'Pedido ACME'),
    'la trazabilidad del original muestra la copia');

  -- Borrar una columna usada y la carpeta de destino no rompe la regla
  delete from public.board_columns where id = p_planta;
  delete from public.board_groups where id = p_grp2;
  perform pg_temp.check((select target_group_id is null from public.board_automations where id = r_copy), 'si se borra la carpeta destino se usa la primera');
  delete from public.board_statuses where id = v_done;
  perform pg_temp.check(not exists (select 1 from public.board_automations where id = r_copy), 'si se borra el estado que dispara, la regla se elimina');

  -- Cadenas circulares
  insert into public.boards (workspace_id, name) values (ws, 'Loop 1') returning id into l1;
  insert into public.boards (workspace_id, name) values (ws, 'Loop 2') returning id into l2;
  insert into public.board_automations (board_id, name, trigger_type, action_type, target_board_id) values (l1, 'ida', 'item_arrived', 'move', l2);
  insert into public.board_automations (board_id, name, trigger_type, action_type, target_board_id) values (l2, 'vuelta', 'item_arrived', 'move', l1);
  insert into public.tasks (board_id, group_id, title)
  values (l1, (select id from public.board_groups where board_id = l1), 'Ping') returning id into tk;
  perform pg_temp.check(exists (select 1 from public.task_events where task_id = tk and kind = 'automation_limit'), 'una cadena circular se corta sola');

  -- El historial se conserva aunque se elimine el ítem
  delete from public.tasks where id = cp;
  perform pg_temp.check(exists (select 1 from public.task_events where task_id = cp and kind = 'deleted'), 'el historial registra la eliminación');

  set constraints all immediate;
  perform pg_temp.check(true, 'los vínculos son consistentes al confirmar');

  delete from public.workspaces where id = ws; get diagnostics n = row_count;
  perform pg_temp.check(n = 1, 'se puede eliminar el espacio completo');
  execute 'reset role';

  raise notice 'TODAS LAS PRUEBAS PASARON';
end
$t$;

rollback;
