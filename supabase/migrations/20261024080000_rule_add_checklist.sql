-- =============================================================================
-- Vetta · reglas: acción "Agregar pasos al checklist"
-- -----------------------------------------------------------------------------
-- Pensada para tableros tipo circuito, donde cada carpeta es un equipo: al
-- entrar el ítem en una carpeta, la regla suma al checklist los pasos de una
-- plantilla, debajo de una sección (por defecto, el nombre de la carpeta).
-- Lo que ya hizo el equipo anterior queda tal cual.
--
-- action_type = 'add_checklist', action_config:
--   column_id    columna checklist del tablero (obligatoria)
--   template_id  plantilla de checklist de la empresa (obligatoria)
--   section      título de la sección (admite {carpeta}, {estado}, …; vacío = sin sección)
--   assign       'user' (user_id) | 'assignee' (el responsable del ítem) | ausente = sin responsable
--
-- No se duplica: si el checklist ya tiene una sección con ese título (o, sin
-- sección, ya tiene todos los pasos de la plantilla), no agrega nada. Así, si
-- el ítem vuelve a una carpeta por la que ya pasó, no se repiten los pasos.
-- Solo amplía la lista de acciones permitidas: no modifica datos existentes.
-- =============================================================================

alter table public.board_automations drop constraint if exists board_automations_action_kind;
alter table public.board_automations add constraint board_automations_action_kind check (action_type in (
  'move', 'copy', 'update_linked', 'set_status', 'set_group', 'set_priority', 'set_assignee',
  'set_due_date', 'set_column', 'notify', 'add_comment', 'create_item', 'add_checklist'));

create or replace function private.automation_add_checklist(r public.board_automations, p_task uuid)
returns void
language plpgsql
set search_path = ''
as $$
-- Sin SECURITY DEFINER propio: solo la llama private.run_rule_action (que sí lo es).
declare
  cfg       jsonb := r.action_config;
  v_col     text := cfg ->> 'column_id';
  v_tpl     jsonb;
  v_list    jsonb;
  v_new     jsonb;
  v_section text;
  v_user    uuid;
  v_task    public.tasks%rowtype;
begin
  if p_task is null then
    return;
  end if;
  select * into v_task from public.tasks where id = p_task and board_id = r.board_id;
  if v_task.id is null then
    return;
  end if;
  if not exists (select 1 from public.board_columns c where c.id::text = v_col and c.board_id = r.board_id and c.kind = 'checklist') then
    raise exception 'La columna de checklist de la regla ya no existe.';
  end if;
  select t.items into v_tpl from public.checklist_templates t
   where t.id::text = cfg ->> 'template_id' and t.workspace_id = r.workspace_id;
  if v_tpl is null then
    raise exception 'La plantilla de checklist de la regla ya no existe.';
  end if;

  v_list := case when jsonb_typeof(v_task.custom_values -> v_col) = 'array' then v_task.custom_values -> v_col else '[]'::jsonb end;
  v_section := nullif(btrim(left(coalesce(private.render_text(cfg ->> 'section', p_task), ''), 300)), '');

  -- No duplicar.
  if v_section is not null then
    if exists (select 1 from jsonb_array_elements(v_list) i
               where coalesce((i ->> 'header')::boolean, false) and lower(btrim(i ->> 'text')) = lower(v_section)) then
      return;
    end if;
  elsif not exists (
    select 1 from jsonb_array_elements(v_tpl) ti
    where coalesce(ti ->> 'text', '') <> '' and not coalesce((ti ->> 'header')::boolean, false)
      and not exists (select 1 from jsonb_array_elements(v_list) i where lower(btrim(i ->> 'text')) = lower(btrim(ti ->> 'text')))
  ) then
    return;
  end if;

  v_new := private.checklist_from_template(v_tpl);
  if jsonb_array_length(v_new) = 0 then
    return;
  end if;

  v_user := case cfg ->> 'assign'
              when 'assignee' then v_task.assignee_id
              when 'user' then case when cfg ->> 'user_id' ~ '^[0-9a-fA-F-]{36}$' then (cfg ->> 'user_id')::uuid end
            end;
  if v_user is not null then
    select coalesce(jsonb_agg(case when coalesce((e ->> 'header')::boolean, false) then e
                                   else e || jsonb_build_object('assignee', v_user::text) end order by ord), '[]'::jsonb)
      into v_new
      from jsonb_array_elements(v_new) with ordinality x(e, ord);
  end if;

  if v_section is not null then
    v_new := jsonb_build_array(jsonb_build_object(
               'id', substr(md5(random()::text || clock_timestamp()::text), 1, 10),
               'text', v_section, 'done', false, 'header', true)) || v_new;
  end if;

  update public.tasks
     set custom_values = jsonb_set(coalesce(custom_values, '{}'::jsonb), array[v_col], v_list || v_new)
   where id = p_task;
end;
$$;
revoke all on function private.automation_add_checklist(public.board_automations, uuid) from public, anon, authenticated;

-- Motor: suma la nueva acción (el resto queda igual).
create or replace function private.run_rule_action(r public.board_automations, p_task uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg    jsonb := r.action_config;
  t      public.tasks%rowtype;
  v_uuid uuid;
  v_date date;
  v_kind text;
  v_val  jsonb;
begin
  if p_task is not null then
    select * into t from public.tasks where id = p_task;
    if t.id is null then
      return;
    end if;
  end if;

  case r.action_type
    when 'copy' then
      perform private.automation_copy(r, p_task);
    when 'move' then
      perform private.automation_move(r, p_task);
    when 'update_linked' then
      perform private.automation_update_linked(r, p_task);
    when 'create_item' then
      perform private.automation_create_item(r, p_task);
    when 'notify' then
      perform private.automation_notify(r, p_task);
    when 'add_checklist' then
      perform private.automation_add_checklist(r, p_task);
    when 'add_comment' then
      if p_task is not null then
        insert into public.task_comments (task_id, body)
        values (p_task, left(coalesce(nullif(btrim(private.render_text(cfg ->> 'text', p_task)), ''), '(sin texto)'), 5000));
      end if;
    when 'set_status' then
      v_uuid := (cfg ->> 'status_id')::uuid;
      update public.tasks set status_id = v_uuid
       where id = p_task and board_id = r.board_id and status_id is distinct from v_uuid;
    when 'set_group' then
      v_uuid := (cfg ->> 'group_id')::uuid;
      update public.tasks set group_id = v_uuid, position = private.next_position(v_uuid)
       where id = p_task and board_id = r.board_id and group_id is distinct from v_uuid;
    when 'set_priority' then
      update public.tasks set priority = (cfg ->> 'priority')::public.task_priority
       where id = p_task and board_id = r.board_id and priority is distinct from (cfg ->> 'priority')::public.task_priority;
    when 'set_assignee' then
      v_uuid := case cfg ->> 'mode'
                  when 'clear' then null
                  when 'creator' then t.created_by
                  else (cfg ->> 'user_id')::uuid
                end;
      update public.tasks set assignee_id = v_uuid
       where id = p_task and board_id = r.board_id and assignee_id is distinct from v_uuid;
    when 'set_due_date' then
      v_date := case when cfg ->> 'mode' = 'clear' then null
                     else private.local_today() + coalesce(case when cfg ->> 'days' ~ '^-?[0-9]+$' then (cfg ->> 'days')::int end, 0)
                end;
      update public.tasks set due_date = v_date
       where id = p_task and board_id = r.board_id and due_date is distinct from v_date;
    when 'set_column' then
      select c.kind into v_kind from public.board_columns c where c.id::text = cfg ->> 'column_id' and c.board_id = r.board_id;
      if v_kind is null then
        raise exception 'La columna de la regla ya no existe.';
      end if;
      if cfg ->> 'mode' = 'clear' then
        v_val := null;
      elsif v_kind = 'date' and cfg ->> 'days' ~ '^-?[0-9]+$' then
        v_val := to_jsonb((private.local_today() + (cfg ->> 'days')::int)::text);
      else
        v_val := nullif(cfg -> 'value', 'null'::jsonb);
      end if;
      update public.tasks
         set custom_values = case when v_val is null then custom_values - (cfg ->> 'column_id')
                                  else jsonb_set(custom_values, array[cfg ->> 'column_id'], v_val) end
       where id = p_task and board_id = r.board_id
         and (custom_values -> (cfg ->> 'column_id')) is distinct from v_val;
    else
      null;
  end case;
end;
$$;

revoke all on function private.run_rule_action(public.board_automations, uuid) from public, anon, authenticated;
