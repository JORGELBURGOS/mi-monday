-- =============================================================================
-- Vetta · nuevo disparador de reglas: "cambia un checklist"
-- -----------------------------------------------------------------------------
-- trigger_type = 'checklist_changed', trigger_config:
--   column_id   columna checklist (vacío = cualquier checklist del tablero)
--   event       'started'      se tilda el primer paso (el checklist arranca)
--               'step_checked' se tilda un paso puntual (step = texto, o step_index = n° de paso)
--               'any_checked'  se tilda cualquier paso
--               'completed'    se completan todos los pasos
--               'percent'      el avance llega o pasa percent %
-- Los encabezados (secciones) y los pasos "No aplica" no cuentan.
-- No elimina datos: solo amplía la lista de disparadores permitidos.
-- =============================================================================

alter table public.board_automations drop constraint if exists board_automations_trigger_kind;
alter table public.board_automations add constraint board_automations_trigger_kind check (trigger_type in (
  'item_arrived', 'status_changed', 'group_changed', 'assignee_changed', 'priority_changed',
  'column_changed', 'checklist_changed', 'date_arrives', 'stale', 'schedule'));

-- Pasos que cuentan (sin secciones ni "No aplica"), en orden.
create or replace function private.checklist_steps(p_list jsonb)
returns table (ord int, step_id text, step_text text, done boolean)
language sql
immutable
set search_path = ''
as $$
  select (row_number() over (order by t.ord))::int, t.i ->> 'id', t.i ->> 'text', coalesce((t.i ->> 'done')::boolean, false)
  from jsonb_array_elements(case when jsonb_typeof(p_list) = 'array' then p_list else '[]'::jsonb end) with ordinality as t(i, ord)
  where not coalesce((t.i ->> 'header')::boolean, false) and coalesce(t.i ->> 'status', '') <> 'na';
$$;

-- ¿El cambio de un checklist (old → new) cumple el evento configurado?
create or replace function private.checklist_event(p_cfg jsonb, p_old jsonb, p_new jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_event  text := coalesce(p_cfg ->> 'event', 'any_checked');
  v_total  int;
  v_done   int;
  v_prev   int;
  v_pct    int;
  v_step   text := lower(btrim(coalesce(p_cfg ->> 'step', '')));
  v_index  int := case when p_cfg ->> 'step_index' ~ '^[0-9]+$' then (p_cfg ->> 'step_index')::int end;
begin
  if p_new is not distinct from p_old then
    return false;
  end if;
  select count(*), count(*) filter (where s.done) into v_total, v_done from private.checklist_steps(p_new) s;
  select count(*) filter (where s.done) into v_prev from private.checklist_steps(p_old) s;

  if v_event = 'started' then
    return v_prev = 0 and v_done > 0;
  elsif v_event = 'completed' then
    return v_total > 0 and v_done = v_total
      and v_prev < (select count(*) from private.checklist_steps(p_old));
  elsif v_event = 'percent' then
    v_pct := least(100, greatest(1, coalesce(case when p_cfg ->> 'percent' ~ '^[0-9]+$' then (p_cfg ->> 'percent')::int end, 50)));
    return v_total > 0 and v_done * 100 >= v_pct * v_total
      and v_prev * 100 < v_pct * greatest(1, (select count(*) from private.checklist_steps(p_old)));
  else
    -- Pasos que pasaron de sin tildar a tildados.
    return exists (
      select 1
      from private.checklist_steps(p_new) n
      left join private.checklist_steps(p_old) o on o.step_id = n.step_id
      where n.done and not coalesce(o.done, false)
        and (v_event <> 'step_checked'
             or (v_step <> '' and lower(btrim(n.step_text)) = v_step)
             or (v_step = '' and v_index is not null and n.ord = v_index))
    );
  end if;
end;
$$;

create or replace function private.checklist_fired(p_cfg jsonb, p_board uuid, p_old jsonb, p_new jsonb)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.board_columns c
    where c.board_id = p_board and c.kind = 'checklist'
      and (p_cfg ->> 'column_id' is null or c.id::text = p_cfg ->> 'column_id')
      and private.checklist_event(p_cfg, p_old -> c.id::text, p_new -> c.id::text)
  );
$$;

revoke all on function private.checklist_steps(jsonb) from public, anon, authenticated;
revoke all on function private.checklist_event(jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.checklist_fired(jsonb, uuid, jsonb, jsonb) from public, anon, authenticated;

-- Motor por eventos: suma el disparador de checklist.
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
