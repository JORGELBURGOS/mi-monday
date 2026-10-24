-- =============================================================================
-- Vetta · reglas reversibles, detalle de ejecuciones e historial completo
-- -----------------------------------------------------------------------------
--   * board_automations.revert_on_undo: si se deshace lo que disparó la regla
--     (se destilda el checklist, el ítem sale del estado, etc.) el ítem vuelve
--     al valor que tenía antes de que la regla actuara.
--   * automation_runs guarda quién la disparó, qué cambió (antes → después) y si
--     se revirtió. Las reversiones quedan como una ejecución más (kind = 'revert').
--   * El historial del ítem suma: descripción, valores de columnas y el valor
--     anterior de responsable, vencimiento y prioridad.
-- Solo agrega columnas y reemplaza funciones: no elimina ni modifica datos.
-- =============================================================================

alter table public.board_automations add column if not exists revert_on_undo boolean not null default false;

alter table public.automation_runs add column if not exists kind text not null default 'run';
alter table public.automation_runs add column if not exists actor_id uuid;
alter table public.automation_runs add column if not exists change jsonb;
alter table public.automation_runs add column if not exists note text;
alter table public.automation_runs add column if not exists reverted_at timestamptz;
do $do$ begin
  if not exists (select 1 from pg_constraint where conname = 'automation_runs_kind') then
    alter table public.automation_runs add constraint automation_runs_kind check (kind in ('run', 'revert'));
  end if;
end $do$;
create index if not exists automation_runs_task_idx on public.automation_runs (automation_id, task_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Campos del ítem que las reglas pueden cambiar (para comparar antes/después).
-- -----------------------------------------------------------------------------
create or replace function private.task_fields(p_task uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('status_id', t.status_id, 'group_id', t.group_id, 'priority', t.priority,
                            'assignee_id', t.assignee_id, 'due_date', t.due_date, 'custom', t.custom_values)
  from public.tasks t where t.id = p_task;
$$;

create or replace function private.field_value(p_field text, p_fields jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select nullif(case when p_field like 'col:%' then p_fields -> 'custom' -> substr(p_field, 5) else p_fields -> p_field end, 'null'::jsonb);
$$;

-- Campo que modifica cada acción "sobre el propio ítem" (null = la acción no se puede revertir).
create or replace function private.rule_field(r public.board_automations)
returns text
language sql
immutable
set search_path = ''
as $$
  select case r.action_type
    when 'set_status'   then 'status_id'
    when 'set_group'    then 'group_id'
    when 'set_priority' then 'priority'
    when 'set_assignee' then 'assignee_id'
    when 'set_due_date' then 'due_date'
    when 'set_column'   then 'col:' || (r.action_config ->> 'column_id')
  end;
$$;

-- ¿Se deshizo lo que disparó la regla? (old → new)
create or replace function private.trigger_undone(r public.board_automations, o public.tasks, n public.tasks)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case r.trigger_type
    when 'status_changed' then r.trigger_status_id is not null and o.status_id = r.trigger_status_id
                               and n.status_id is distinct from o.status_id
    when 'group_changed' then r.trigger_group_id is not null and o.group_id = r.trigger_group_id
                              and n.group_id is distinct from o.group_id
    when 'assignee_changed' then r.trigger_config ->> 'user_id' is not null and o.assignee_id::text = r.trigger_config ->> 'user_id'
                                 and n.assignee_id is distinct from o.assignee_id
    when 'priority_changed' then r.trigger_config ->> 'priority' is not null and o.priority::text = r.trigger_config ->> 'priority'
                                 and n.priority is distinct from o.priority
    when 'column_changed' then r.trigger_config ->> 'value' is not null
                               and o.custom_values ->> (r.trigger_config ->> 'column_id') = r.trigger_config ->> 'value'
                               and (n.custom_values ->> (r.trigger_config ->> 'column_id')) is distinct from (r.trigger_config ->> 'value')
    when 'checklist_changed' then n.custom_values is distinct from o.custom_values and exists (
      select 1
      from public.board_columns c
      where c.board_id = n.board_id and c.kind = 'checklist'
        and (r.trigger_config ->> 'column_id' is null or c.id::text = r.trigger_config ->> 'column_id')
        -- El evento inverso: se evalúa el cambio al revés (new → old).
        -- "Cualquier paso" se deshace cuando no queda ningún paso tildado.
        and private.checklist_event(
              case when coalesce(r.trigger_config ->> 'event', 'any_checked') = 'any_checked'
                   then r.trigger_config || '{"event":"started"}'::jsonb else r.trigger_config end,
              n.custom_values -> c.id::text, o.custom_values -> c.id::text))
    else false
  end;
$$;

-- -----------------------------------------------------------------------------
-- Ejecutar una regla: además registra quién la disparó y qué cambió.
-- -----------------------------------------------------------------------------
create or replace function private.execute_rule(r public.board_automations, p_task uuid, p_fire_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
-- SECURITY DEFINER: automation_runs solo la escribe el motor.
declare
  v_prev   text := current_setting('vetta.automation', true);
  v_field  text := private.rule_field(r);
  v_before jsonb;
  v_from   jsonb;
  v_to     jsonb;
  v_change jsonb;
begin
  perform set_config('vetta.automation', r.id::text, true);
  begin
    if v_field is not null and p_task is not null then
      v_before := private.task_fields(p_task);
    end if;
    perform private.run_rule_action(r, p_task);
    if v_before is not null then
      v_from := private.field_value(v_field, v_before);
      v_to := private.field_value(v_field, private.task_fields(p_task));
      if v_from is distinct from v_to then
        v_change := jsonb_build_object('field', v_field, 'from', v_from, 'to', v_to);
      end if;
    end if;
    insert into public.automation_runs (automation_id, task_id, fire_key, ok, actor_id, change)
    values (r.id, p_task, p_fire_key, true, (select auth.uid()), v_change)
    on conflict do nothing;
  exception when others then
    insert into public.automation_runs (automation_id, task_id, fire_key, ok, error, actor_id)
    values (r.id, p_task, p_fire_key, false, left(sqlerrm, 500), (select auth.uid()))
    on conflict do nothing;
  end;
  perform set_config('vetta.automation', coalesce(v_prev, ''), true);
end;
$$;

-- -----------------------------------------------------------------------------
-- Revertir la última ejecución (no revertida) de una regla sobre un ítem.
-- Solo vuelve atrás si el valor sigue siendo el que puso la regla: si alguien
-- ya lo cambió a mano, se respeta ese cambio.
-- -----------------------------------------------------------------------------
create or replace function private.revert_rule(r public.board_automations, p_task uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
-- SECURITY DEFINER: modifica el ítem en nombre del motor y escribe automation_runs.
declare
  v_run   public.automation_runs%rowtype;
  v_field text;
  v_from  jsonb;
  v_to    jsonb;
  v_col   text;
  v_prev  text := current_setting('vetta.automation', true);
  v_prevr text := current_setting('vetta.revert', true);
begin
  select * into v_run
  from public.automation_runs x
  where x.automation_id = r.id and x.task_id = p_task and x.kind = 'run' and x.ok
    and x.change is not null and x.reverted_at is null
  order by x.created_at desc, x.id desc
  limit 1;
  if v_run.id is null then
    return;
  end if;
  v_field := v_run.change ->> 'field';
  v_from := nullif(v_run.change -> 'from', 'null'::jsonb);
  v_to := nullif(v_run.change -> 'to', 'null'::jsonb);
  update public.automation_runs set reverted_at = now() where id = v_run.id;

  if private.field_value(v_field, private.task_fields(p_task)) is distinct from v_to then
    insert into public.automation_runs (automation_id, task_id, kind, ok, actor_id, note)
    values (r.id, p_task, 'revert', true, (select auth.uid()), 'No se revirtió: el valor ya se había cambiado a mano.');
    return;
  end if;

  perform set_config('vetta.automation', r.id::text, true);
  perform set_config('vetta.revert', '1', true);
  begin
    if v_field = 'status_id' then
      update public.tasks set status_id = (v_from #>> '{}')::uuid where id = p_task;
    elsif v_field = 'group_id' then
      if v_from is null or not exists (select 1 from public.board_groups g where g.id = (v_from #>> '{}')::uuid and g.board_id = r.board_id) then
        raise exception 'La carpeta anterior ya no existe.';
      end if;
      update public.tasks set group_id = (v_from #>> '{}')::uuid, position = private.next_position((v_from #>> '{}')::uuid) where id = p_task;
    elsif v_field = 'priority' then
      update public.tasks set priority = coalesce((v_from #>> '{}')::public.task_priority, 'medium') where id = p_task;
    elsif v_field = 'assignee_id' then
      update public.tasks set assignee_id = (v_from #>> '{}')::uuid where id = p_task;
    elsif v_field = 'due_date' then
      update public.tasks set due_date = (v_from #>> '{}')::date where id = p_task;
    elsif v_field like 'col:%' then
      v_col := substr(v_field, 5);
      update public.tasks
         set custom_values = case when v_from is null then custom_values - v_col else jsonb_set(custom_values, array[v_col], v_from) end
       where id = p_task;
    end if;
    insert into public.automation_runs (automation_id, task_id, kind, ok, actor_id, change)
    values (r.id, p_task, 'revert', true, (select auth.uid()), jsonb_build_object('field', v_field, 'from', v_to, 'to', v_from));
  exception when others then
    insert into public.automation_runs (automation_id, task_id, kind, ok, error, actor_id)
    values (r.id, p_task, 'revert', false, left(sqlerrm, 500), (select auth.uid()));
  end;
  perform set_config('vetta.automation', coalesce(v_prev, ''), true);
  perform set_config('vetta.revert', coalesce(v_prevr, ''), true);
end;
$$;

-- -----------------------------------------------------------------------------
-- Motor por eventos: primero las reversiones, después las reglas que se disparan.
-- -----------------------------------------------------------------------------
create or replace function private.run_automations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
-- SECURITY DEFINER: el motor ejecuta las reglas del tablero en nombre del sistema.
declare
  r         public.board_automations%rowtype;
  t         public.tasks%rowtype;
  v_arrived boolean := tg_op = 'INSERT' or new.board_id is distinct from old.board_id;
begin
  -- Corta cadenas circulares (A → B → A …).
  if pg_trigger_depth() > 16 then
    insert into public.task_events (workspace_id, board_id, task_id, kind, detail, actor_id)
    select b.workspace_id, new.board_id, new.id, 'automation_limit', '{}'::jsonb, (select auth.uid())
    from public.boards b where b.id = new.board_id;
    return null;
  end if;

  if not v_arrived then
    for r in
      select a.*
      from public.board_automations a
      join public.boards b on b.id = a.board_id and not b.is_archived
      where a.board_id = new.board_id
        and a.is_active
        and a.revert_on_undo
        and private.rule_field(a) is not null
        and private.trigger_undone(a, old, new)
      order by a.position desc, a.created_at desc
    loop
      select * into t from public.tasks x where x.id = new.id;
      exit when t.id is null or t.board_id <> r.board_id;
      perform private.revert_rule(r, new.id);
    end loop;
  end if;

  for r in
    select a.*
    from public.board_automations a
    join public.boards b on b.id = a.board_id and not b.is_archived
    where a.board_id = new.board_id
      and a.is_active
      and (
        (a.trigger_type = 'item_arrived' and v_arrived
          and (a.trigger_group_id is null or a.trigger_group_id = new.group_id))
        or (not v_arrived and a.trigger_type = 'status_changed'
          and new.status_id is distinct from old.status_id
          and (a.trigger_status_id is null or a.trigger_status_id = new.status_id)
          and (a.trigger_config ->> 'from_status_id' is null or a.trigger_config ->> 'from_status_id' = old.status_id::text))
        or (not v_arrived and a.trigger_type = 'group_changed'
          and new.group_id is distinct from old.group_id
          and (a.trigger_group_id is null or a.trigger_group_id = new.group_id))
        or (not v_arrived and a.trigger_type = 'assignee_changed'
          and new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null
          and (a.trigger_config ->> 'user_id' is null or a.trigger_config ->> 'user_id' = new.assignee_id::text))
        or (not v_arrived and a.trigger_type = 'priority_changed'
          and new.priority is distinct from old.priority
          and (a.trigger_config ->> 'priority' is null or a.trigger_config ->> 'priority' = new.priority::text))
        or (not v_arrived and a.trigger_type = 'column_changed'
          and (new.custom_values -> (a.trigger_config ->> 'column_id')) is distinct from (old.custom_values -> (a.trigger_config ->> 'column_id'))
          and (a.trigger_config ->> 'value' is null or new.custom_values ->> (a.trigger_config ->> 'column_id') = a.trigger_config ->> 'value'))
        or (not v_arrived and a.trigger_type = 'checklist_changed'
          and new.custom_values is distinct from old.custom_values
          and private.checklist_fired(a.trigger_config, new.board_id, old.custom_values, new.custom_values))
      )
    order by a.position, a.created_at
  loop
    -- Una regla anterior pudo haber movido el ítem a otro tablero.
    select * into t from public.tasks x where x.id = new.id;
    exit when t.id is null or t.board_id <> r.board_id;
    continue when not private.conditions_met(r.conditions, t);
    perform private.execute_rule(r, new.id, null);
  end loop;
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Historial completo del ítem.
-- -----------------------------------------------------------------------------
create or replace function private.log_task_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
-- SECURITY DEFINER: task_events solo la escribe el sistema.
declare
  v_ws    uuid;
  v_auto  uuid := private.current_automation();
  v_aname text;
  v_actor uuid := (select auth.uid());
  v_rows  jsonb := '[]'::jsonb;
  v_row   jsonb;
  c       record;
begin
  if tg_op = 'DELETE' then
    select b.workspace_id into v_ws from public.boards b where b.id = old.board_id;
    -- Si se está eliminando el tablero o el espacio completo no se registra cada ítem.
    if v_ws is null then
      return old;
    end if;
    v_rows := jsonb_build_array(jsonb_build_object('kind', 'deleted', 'detail', jsonb_build_object('title', old.title)));
  else
    select b.workspace_id into v_ws from public.boards b where b.id = new.board_id;
    if tg_op = 'INSERT' then
      v_rows := jsonb_build_array(jsonb_build_object('kind', 'created', 'detail', jsonb_build_object(
        'title', new.title,
        'board', (select b.name from public.boards b where b.id = new.board_id),
        'group', (select g.name from public.board_groups g where g.id = new.group_id),
        'status', (select s.label from public.board_statuses s where s.id = new.status_id),
        'parent', (select p.title from public.tasks p where p.id = new.parent_id),
        'from_task', (select l.source_task_id from public.task_links l where l.target_task_id = new.id limit 1),
        'from_board', (select b.name from public.task_links l join public.tasks t on t.id = l.source_task_id
                       join public.boards b on b.id = t.board_id where l.target_task_id = new.id limit 1)
      )));
    else
      if new.board_id is distinct from old.board_id then
        v_rows := v_rows || jsonb_build_object('kind', 'moved', 'detail', jsonb_build_object(
          'from_board', (select b.name from public.boards b where b.id = old.board_id),
          'to_board', (select b.name from public.boards b where b.id = new.board_id),
          'group', (select g.name from public.board_groups g where g.id = new.group_id)));
      elsif new.group_id is distinct from old.group_id then
        v_rows := v_rows || jsonb_build_object('kind', 'group_changed', 'detail', jsonb_build_object(
          'from', (select g.name from public.board_groups g where g.id = old.group_id),
          'to', (select g.name from public.board_groups g where g.id = new.group_id)));
      end if;
      if new.status_id is distinct from old.status_id then
        v_rows := v_rows || jsonb_build_object('kind', 'status_changed', 'detail', jsonb_build_object(
          'from', (select s.label from public.board_statuses s where s.id = old.status_id),
          'from_color', (select s.color from public.board_statuses s where s.id = old.status_id),
          'to', (select s.label from public.board_statuses s where s.id = new.status_id),
          'to_color', (select s.color from public.board_statuses s where s.id = new.status_id),
          'done', (select s.is_done from public.board_statuses s where s.id = new.status_id)));
      end if;
      if new.assignee_id is distinct from old.assignee_id then
        v_rows := v_rows || jsonb_build_object('kind', 'assignee_changed', 'detail', jsonb_build_object(
          'from', (select coalesce(p.full_name, p.email) from public.profiles p where p.id = old.assignee_id),
          'to', (select coalesce(p.full_name, p.email) from public.profiles p where p.id = new.assignee_id)));
      end if;
      if new.due_date is distinct from old.due_date then
        v_rows := v_rows || jsonb_build_object('kind', 'due_changed', 'detail', jsonb_build_object('from', old.due_date, 'to', new.due_date));
      end if;
      if new.priority is distinct from old.priority then
        v_rows := v_rows || jsonb_build_object('kind', 'priority_changed', 'detail', jsonb_build_object('from', old.priority, 'to', new.priority));
      end if;
      if new.title is distinct from old.title then
        v_rows := v_rows || jsonb_build_object('kind', 'renamed', 'detail', jsonb_build_object('from', old.title, 'to', new.title));
      end if;
      if new.description is distinct from old.description then
        v_rows := v_rows || jsonb_build_object('kind', 'description_changed', 'detail', jsonb_build_object(
          'from', left(old.description, 300), 'to', left(new.description, 300)));
      end if;
      -- Columnas propias (los checklists tienen su propio registro paso a paso).
      if new.custom_values is distinct from old.custom_values then
        for c in
          select bc.id, bc.name, bc.kind
          from public.board_columns bc
          where bc.board_id = new.board_id and bc.kind <> 'checklist'
            and (new.custom_values -> bc.id::text) is distinct from (old.custom_values -> bc.id::text)
          order by bc.position
          limit 20
        loop
          v_rows := v_rows || jsonb_build_object('kind', 'value_changed', 'detail', jsonb_build_object(
            'column_id', c.id, 'column', c.name, 'column_kind', c.kind,
            'from', case when pg_column_size(old.custom_values -> c.id::text) <= 4000 then old.custom_values -> c.id::text end,
            'to', case when pg_column_size(new.custom_values -> c.id::text) <= 4000 then new.custom_values -> c.id::text end));
        end loop;
      end if;
    end if;
  end if;

  if jsonb_array_length(v_rows) = 0 or v_ws is null then
    return null;
  end if;
  if v_auto is not null then
    select a.name || case when current_setting('vetta.revert', true) = '1' then ' (reversión)' else '' end
      into v_aname from public.board_automations a where a.id = v_auto;
  end if;

  for v_row in select * from jsonb_array_elements(v_rows) loop
    insert into public.task_events (workspace_id, board_id, task_id, kind, detail, automation_id, automation_name, actor_id)
    values (v_ws,
            case when tg_op = 'DELETE' then old.board_id else new.board_id end,
            case when tg_op = 'DELETE' then old.id else new.id end,
            v_row ->> 'kind', jsonb_strip_nulls(v_row -> 'detail'), v_auto, v_aname, v_actor);
  end loop;
  return null;
end;
$$;

revoke all on function private.task_fields(uuid) from public, anon, authenticated;
revoke all on function private.field_value(text, jsonb) from public, anon, authenticated;
revoke all on function private.rule_field(public.board_automations) from public, anon, authenticated;
revoke all on function private.trigger_undone(public.board_automations, public.tasks, public.tasks) from public, anon, authenticated;
revoke all on function private.execute_rule(public.board_automations, uuid, text) from public, anon, authenticated;
revoke all on function private.revert_rule(public.board_automations, uuid) from public, anon, authenticated;
revoke all on function private.run_automations() from public, anon, authenticated;
revoke all on function private.log_task_event() from public, anon, authenticated;
