-- =============================================================================
-- Vetta · motor de reglas v2
-- -----------------------------------------------------------------------------
-- Aditiva: no elimina objetos ni datos.
--   * Nuevos disparadores: cambio de responsable, de prioridad o de una
--     columna; fechas (X días antes / el día / después del vencimiento o de una
--     columna fecha); ítems que llevan N días sin cambiar de estado; reglas
--     programadas (diarias, días hábiles, semanales, mensuales).
--   * Condiciones ("solo si…") sobre estado, carpeta, prioridad, responsable,
--     hecho, vencimiento y columnas.
--   * Nuevas acciones: cambiar estado, carpeta, prioridad, responsable,
--     vencimiento o una columna; comentar; avisar a personas; crear un ítem.
--   * Registro de ejecuciones (automation_runs) y bandeja de avisos
--     (notifications). Ningún aviso sale por email.
--   * Las reglas por fecha y programadas las ejecuta pg_cron cada 15 minutos.
--
-- Las columnas trigger_type / action_type tenían un CHECK con los valores de
-- la versión 1. Para ampliarlos sin eliminar el CHECK, las columnas viejas se
-- renombran a legacy_* (quedan como referencia) y se agregan columnas nuevas
-- con los mismos valores.
-- =============================================================================

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'board_automations' and column_name = 'legacy_trigger_type'
  ) then
    alter table public.board_automations rename column trigger_type to legacy_trigger_type;
    alter table public.board_automations rename column action_type to legacy_action_type;
    alter table public.board_automations alter column legacy_trigger_type set default 'item_arrived';
    alter table public.board_automations alter column legacy_action_type set default 'copy';
    alter table public.board_automations add column trigger_type text;
    alter table public.board_automations add column action_type text;
    -- Completa las columnas nuevas con el mismo valor que ya tenían las reglas.
    update public.board_automations
       set trigger_type = legacy_trigger_type, action_type = legacy_action_type
     where trigger_type is null;
    alter table public.board_automations alter column trigger_type set not null;
    alter table public.board_automations alter column action_type set not null;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'board_automations_trigger_kind') then
    alter table public.board_automations add constraint board_automations_trigger_kind check (trigger_type in (
      'item_arrived', 'status_changed', 'group_changed', 'assignee_changed', 'priority_changed',
      'column_changed', 'date_arrives', 'stale', 'schedule'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'board_automations_action_kind') then
    alter table public.board_automations add constraint board_automations_action_kind check (action_type in (
      'move', 'copy', 'update_linked', 'set_status', 'set_group', 'set_priority', 'set_assignee',
      'set_due_date', 'set_column', 'notify', 'add_comment', 'create_item'));
  end if;
end $$;

alter table public.board_automations add column if not exists trigger_config jsonb not null default '{}'::jsonb;
alter table public.board_automations add column if not exists conditions jsonb not null default '[]'::jsonb;
alter table public.board_automations add column if not exists action_config jsonb not null default '{}'::jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'board_automations_configs_shape') then
    alter table public.board_automations add constraint board_automations_configs_shape check (
      jsonb_typeof(trigger_config) = 'object' and pg_column_size(trigger_config) < 8192
      and jsonb_typeof(conditions) = 'array' and pg_column_size(conditions) < 16384
      and jsonb_typeof(action_config) = 'object' and pg_column_size(action_config) < 16384);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Registro de ejecuciones
-- -----------------------------------------------------------------------------
create table if not exists public.automation_runs (
  id            bigint generated always as identity primary key,
  automation_id uuid not null references public.board_automations (id) on delete cascade,
  task_id       uuid,
  -- Clave de disparo para reglas por fecha / programadas: evita repetir.
  fire_key      text,
  ok            boolean not null default true,
  error         text,
  created_at    timestamptz not null default now()
);
create unique index if not exists automation_runs_once
  on public.automation_runs (automation_id, coalesce(task_id, '00000000-0000-0000-0000-000000000000'::uuid), fire_key)
  where fire_key is not null;
create index if not exists automation_runs_rule_idx on public.automation_runs (automation_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Avisos dentro de Vetta
-- -----------------------------------------------------------------------------
create table if not exists public.notifications (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  board_id        uuid,
  task_id         uuid,
  title           text not null check (char_length(title) <= 2000),
  body            text check (body is null or char_length(body) <= 2000),
  automation_id   uuid,
  automation_name text,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;
create index if not exists notifications_ws_idx on public.notifications (workspace_id);

-- -----------------------------------------------------------------------------
-- Los comentarios creados por una regla no se atribuyen a una persona
-- -----------------------------------------------------------------------------
create or replace function public.prepare_comment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Profundidad > 1: lo inserta el motor de reglas, no una persona.
    new.author_id := case when pg_trigger_depth() > 1 then null else (select auth.uid()) end;
  else
    new.task_id := old.task_id;
    new.author_id := old.author_id;
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Validación de reglas (amplía la versión 1)
-- -----------------------------------------------------------------------------
create or replace function public.prepare_automation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_target_ws uuid;
  v_bad int;
  v_ref text;
begin
  new.name := btrim(new.name);
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    select b.workspace_id into new.workspace_id from public.boards b where b.id = new.board_id;
  else
    new.board_id := old.board_id;
    new.workspace_id := old.workspace_id;
    new.created_by := old.created_by;
  end if;
  -- Columna heredada de la versión 1 (con su propio CHECK).
  new.legacy_trigger_type := case when new.trigger_type in ('item_arrived', 'status_changed', 'group_changed')
                                  then new.trigger_type else 'item_arrived' end;
  new.legacy_action_type := case when new.action_type in ('move', 'copy', 'update_linked')
                                 then new.action_type else 'copy' end;

  if tg_op = 'INSERT' or new.target_board_id is distinct from old.target_board_id then
    select b.workspace_id into v_target_ws from public.boards b where b.id = new.target_board_id;
    if v_target_ws is distinct from new.workspace_id then
      raise exception 'El tablero de destino tiene que ser del mismo espacio.' using errcode = 'P0001';
    end if;
  end if;

  -- Las acciones sobre el propio ítem siempre apuntan a su tablero.
  if new.action_type in ('set_status', 'set_group', 'set_priority', 'set_assignee', 'set_due_date',
                         'set_column', 'notify', 'add_comment')
     and new.target_board_id <> new.board_id then
    raise exception 'Esta acción se aplica sobre el mismo tablero.' using errcode = 'P0001';
  end if;
  if new.action_type = 'update_linked' and new.link_direction is null then
    new.link_direction := 'origin';
  end if;

  if tg_op = 'INSERT' or new.column_map is distinct from old.column_map
     or new.target_board_id is distinct from old.target_board_id then
    select count(*) into v_bad
    from jsonb_array_elements(new.column_map) m
    where jsonb_typeof(m) <> 'object'
       or not exists (
         select 1
         from public.board_columns cf
         join public.board_columns ct on ct.id::text = m ->> 'to'
         where cf.id::text = m ->> 'from'
           and cf.board_id = new.board_id
           and ct.board_id = new.target_board_id
           and ct.kind = cf.kind
       );
    if v_bad > 0 then
      raise exception 'El mapeo de columnas no es válido.' using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'INSERT' or new.extra_values is distinct from old.extra_values
     or new.target_board_id is distinct from old.target_board_id then
    select count(*) into v_bad
    from jsonb_object_keys(new.extra_values) k
    where not exists (
      select 1 from public.board_columns c
      where c.id::text = k and c.board_id = new.target_board_id
    );
    if v_bad > 0 then
      raise exception 'Los valores adicionales no son válidos.' using errcode = 'P0001';
    end if;
  end if;

  -- Referencias del disparador: columnas y estados del tablero de origen.
  if tg_op = 'INSERT' or new.trigger_config is distinct from old.trigger_config then
    v_ref := new.trigger_config ->> 'column_id';
    if v_ref is null and coalesce(new.trigger_config ->> 'date_field', 'due_date') <> 'due_date' then
      v_ref := new.trigger_config ->> 'date_field';
    end if;
    if v_ref is not null and not exists (
      select 1 from public.board_columns c where c.id::text = v_ref and c.board_id = new.board_id
    ) then
      raise exception 'La columna del disparador no es de este tablero.' using errcode = 'P0001';
    end if;
    for v_ref in
      select x from (values (new.trigger_config ->> 'from_status_id'), (new.trigger_config ->> 'status_id')) v(x) where x is not null
    loop
      if not exists (select 1 from public.board_statuses s where s.id::text = v_ref and s.board_id = new.board_id) then
        raise exception 'El estado del disparador no es de este tablero.' using errcode = 'P0001';
      end if;
    end loop;
    v_ref := new.trigger_config ->> 'user_id';
    if v_ref is not null and not exists (
      select 1 from public.workspace_members m where m.user_id::text = v_ref and m.workspace_id = new.workspace_id
    ) then
      raise exception 'La persona del disparador no es miembro del espacio.' using errcode = 'P0001';
    end if;
  end if;

  -- Referencias de las condiciones: del tablero de origen.
  if tg_op = 'INSERT' or new.conditions is distinct from old.conditions then
    select count(*) into v_bad
    from jsonb_array_elements(new.conditions) c
    where jsonb_typeof(c) <> 'object'
       or (c ->> 'field' = 'status' and c ->> 'value' is not null
           and not exists (select 1 from public.board_statuses s where s.id::text = c ->> 'value' and s.board_id = new.board_id))
       or (c ->> 'field' = 'group' and c ->> 'value' is not null
           and not exists (select 1 from public.board_groups g where g.id::text = c ->> 'value' and g.board_id = new.board_id))
       or (c ->> 'field' = 'column'
           and not exists (select 1 from public.board_columns k where k.id::text = c ->> 'column_id' and k.board_id = new.board_id))
       or (c ->> 'field' = 'assignee' and c ->> 'value' is not null
           and not exists (select 1 from public.workspace_members m where m.user_id::text = c ->> 'value' and m.workspace_id = new.workspace_id));
    if v_bad > 0 then
      raise exception 'Alguna condición no es válida.' using errcode = 'P0001';
    end if;
  end if;

  -- Referencias de la acción: del tablero de destino.
  if tg_op = 'INSERT' or new.action_config is distinct from old.action_config
     or new.target_board_id is distinct from old.target_board_id then
    v_ref := new.action_config ->> 'status_id';
    if v_ref is not null and not exists (
      select 1 from public.board_statuses s where s.id::text = v_ref and s.board_id = new.target_board_id
    ) then
      raise exception 'El estado elegido no es del tablero de destino.' using errcode = 'P0001';
    end if;
    v_ref := new.action_config ->> 'group_id';
    if v_ref is not null and not exists (
      select 1 from public.board_groups g where g.id::text = v_ref and g.board_id = new.target_board_id
    ) then
      raise exception 'La carpeta elegida no es del tablero de destino.' using errcode = 'P0001';
    end if;
    v_ref := new.action_config ->> 'column_id';
    if v_ref is not null and not exists (
      select 1 from public.board_columns c where c.id::text = v_ref and c.board_id = new.target_board_id
    ) then
      raise exception 'La columna elegida no es del tablero de destino.' using errcode = 'P0001';
    end if;
    for v_ref in
      select x from (values (new.action_config ->> 'user_id'), (new.action_config ->> 'assignee_id')) v(x) where x is not null
    loop
      if not exists (select 1 from public.workspace_members m where m.user_id::text = v_ref and m.workspace_id = new.workspace_id) then
        raise exception 'La persona elegida no es miembro del espacio.' using errcode = 'P0001';
      end if;
    end loop;
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Funciones auxiliares del motor (esquema private)
-- -----------------------------------------------------------------------------
-- Las fechas se evalúan en la hora de Argentina.
create or replace function private.local_today(p_now timestamptz default now())
returns date
language sql
stable
set search_path = ''
as $$
  select (p_now at time zone 'America/Argentina/Buenos_Aires')::date;
$$;

-- ¿Una persona puede ver un tablero? (misma regla que can_access_board, para otro usuario)
create or replace function private.user_can_access_board(p_user uuid, p_board uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.boards b
    join public.workspace_members m on m.workspace_id = b.workspace_id and m.user_id = p_user
    where b.id = p_board
      and (b.visibility = 'workspace' or b.created_by = p_user or m.role = 'owner')
  );
$$;

-- Reemplaza {titulo}, {tablero}, {carpeta}, {estado}, {vencimiento}, {responsable} y {hoy}.
create or replace function private.render_text(p_tpl text, p_task uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select left(
    replace(replace(replace(replace(replace(replace(replace(coalesce(p_tpl, ''),
      '{titulo}', coalesce(t.title, '')),
      '{tablero}', coalesce(b.name, '')),
      '{carpeta}', coalesce(g.name, '')),
      '{estado}', coalesce(s.label, 'sin estado')),
      '{vencimiento}', coalesce(to_char(t.due_date, 'DD/MM/YYYY'), 'sin fecha')),
      '{responsable}', coalesce(nullif(btrim(p.full_name), ''), p.email, 'sin responsable')),
      '{hoy}', to_char(private.local_today(), 'DD/MM/YYYY')),
    2000)
  from (select 1) one
  left join public.tasks t on t.id = p_task
  left join public.boards b on b.id = t.board_id
  left join public.board_groups g on g.id = t.group_id
  left join public.board_statuses s on s.id = t.status_id
  left join public.profiles p on p.id = t.assignee_id;
$$;

create or replace function private.condition_met(c jsonb, t public.tasks)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f   text := c ->> 'field';
  op  text := coalesce(c ->> 'op', 'is');
  v   text := c ->> 'value';
  cur text;
  num constant text := '^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$';
begin
  if f in ('status', 'group', 'priority', 'assignee') then
    cur := case f
             when 'status' then t.status_id::text
             when 'group' then t.group_id::text
             when 'priority' then t.priority::text
             else t.assignee_id::text
           end;
    return case op
             when 'is' then cur is not distinct from v
             when 'is_not' then cur is distinct from v
             when 'empty' then cur is null
             when 'not_empty' then cur is not null
             else false
           end;
  elsif f = 'done' then
    return coalesce((select s.is_done from public.board_statuses s where s.id = t.status_id), false)
           = (coalesce(v, 'true') = 'true');
  elsif f = 'due_date' then
    return coalesce(case op
             when 'empty' then t.due_date is null
             when 'not_empty' then t.due_date is not null
             when 'overdue' then t.due_date < private.local_today()
             when 'within_days' then t.due_date between private.local_today()
                                     and private.local_today() + coalesce(case when v ~ '^[0-9]+$' then v::int end, 0)
             else false
           end, false);
  elsif f = 'column' then
    cur := t.custom_values ->> (c ->> 'column_id');
    return coalesce(case op
             when 'empty' then cur is null or cur = ''
             when 'not_empty' then cur is not null and cur <> ''
             when 'is' then cur is not distinct from v
             when 'is_not' then cur is distinct from v
             when 'contains' then cur ilike '%' || coalesce(v, '') || '%'
             when 'gt' then case when cur ~ num and v ~ num then cur::numeric > v::numeric else false end
             when 'lt' then case when cur ~ num and v ~ num then cur::numeric < v::numeric else false end
             else false
           end, false);
  end if;
  return false;
end;
$$;

create or replace function private.conditions_met(p_conditions jsonb, t public.tasks)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(bool_and(private.condition_met(c, t)), true)
  from jsonb_array_elements(case when jsonb_typeof(p_conditions) = 'array' then p_conditions else '[]'::jsonb end) c;
$$;

-- Avisos: solo a miembros del espacio que pueden ver el tablero.
create or replace function private.automation_notify(r public.board_automations, p_task uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg     jsonb := r.action_config;
  t       public.tasks%rowtype;
  v_board uuid;
  v_title text;
  v_body  text;
begin
  if p_task is not null then
    select * into t from public.tasks where id = p_task;
  end if;
  v_board := coalesce(t.board_id, r.board_id);
  v_title := nullif(btrim(private.render_text(coalesce(nullif(cfg ->> 'message', ''), '{titulo}'), p_task)), '');
  v_body := case when t.id is not null then private.render_text('{tablero} › {carpeta} · {estado}', p_task) end;

  insert into public.notifications (user_id, workspace_id, board_id, task_id, title, body, automation_id, automation_name)
  select distinct u.id, r.workspace_id, v_board, t.id, coalesce(v_title, r.name), v_body, r.id, r.name
  from (
    select t.assignee_id as id where cfg ->> 'to' = 'assignee'
    union select t.created_by where cfg ->> 'to' = 'creator'
    union select (cfg ->> 'user_id')::uuid where cfg ->> 'to' = 'user'
    union select m.user_id from public.workspace_members m
          where cfg ->> 'to' = 'admins' and m.workspace_id = r.workspace_id and m.role in ('owner', 'admin')
  ) u
  where u.id is not null and private.user_can_access_board(u.id, v_board);
end;
$$;

-- Crea un ítem nuevo (en este u otro tablero). Si nace a partir de otro ítem, queda vinculado.
create or replace function private.automation_create_item(r public.board_automations, p_task uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg     jsonb := r.action_config;
  v_group uuid;
  v_new   uuid := gen_random_uuid();
  v_user  uuid := (cfg ->> 'assignee_id')::uuid;
begin
  if not exists (select 1 from public.boards b where b.id = r.target_board_id and not b.is_archived) then
    return;
  end if;
  v_group := private.resolve_group(r.target_board_id, (cfg ->> 'group_id')::uuid);
  if v_group is null then
    return;
  end if;
  if v_user is not null and not exists (
    select 1 from public.workspace_members m where m.user_id = v_user and m.workspace_id = r.workspace_id
  ) then
    v_user := null;
  end if;
  if p_task is not null then
    insert into public.task_links (source_task_id, target_task_id, automation_id) values (p_task, v_new, r.id);
  end if;
  insert into public.tasks (id, board_id, group_id, status_id, title, priority, assignee_id, due_date, position)
  values (
    v_new, r.target_board_id, v_group,
    private.map_status(null, r.target_board_id, (cfg ->> 'status_id')::uuid, false),
    left(coalesce(nullif(btrim(private.render_text(cfg ->> 'title', p_task)), ''), 'Nuevo ítem'), 500),
    coalesce(nullif(cfg ->> 'priority', '')::public.task_priority, 'medium'),
    v_user,
    case when cfg ->> 'due_days' ~ '^-?[0-9]+$' then private.local_today() + (cfg ->> 'due_days')::int end,
    private.next_position(v_group)
  );
end;
$$;

-- Ejecuta la acción de una regla sobre un ítem (o sin ítem, para reglas programadas).
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

-- Ejecuta una regla aislando sus errores: si la acción falla, se registra el
-- error y el cambio que hizo la persona sigue adelante.
create or replace function private.execute_rule(r public.board_automations, p_task uuid, p_fire_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text := current_setting('vetta.automation', true);
begin
  perform set_config('vetta.automation', r.id::text, true);
  begin
    perform private.run_rule_action(r, p_task);
    insert into public.automation_runs (automation_id, task_id, fire_key, ok)
    values (r.id, p_task, p_fire_key, true)
    on conflict do nothing;
  exception when others then
    insert into public.automation_runs (automation_id, task_id, fire_key, ok, error)
    values (r.id, p_task, p_fire_key, false, left(sqlerrm, 500))
    on conflict do nothing;
  end;
  perform set_config('vetta.automation', coalesce(v_prev, ''), true);
end;
$$;

-- Motor por eventos (reemplaza la versión 1).
create or replace function private.run_automations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

-- Motor por tiempo: fechas, ítems quietos y reglas programadas. Lo llama pg_cron.
create or replace function private.run_scheduled_automations(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r       public.board_automations%rowtype;
  t       public.tasks%rowtype;
  cfg     jsonb;
  v_today date := private.local_today(p_now);
  v_hour  int := extract(hour from (p_now at time zone 'America/Argentina/Buenos_Aires'))::int;
  v_key   text;
  v_date  date;
  v_off   int;
  v_since timestamptz;
  v_due   boolean;
  v_field text;
  v_count int := 0;
begin
  for r in
    select a.*
    from public.board_automations a
    join public.boards b on b.id = a.board_id and not b.is_archived
    where a.is_active and a.trigger_type in ('date_arrives', 'stale', 'schedule')
    order by a.created_at
  loop
    cfg := r.trigger_config;
    -- Cada regla corre a partir de su hora (por defecto, 8 de la mañana).
    continue when v_hour < coalesce(case when cfg ->> 'hour' ~ '^[0-9]+$' then (cfg ->> 'hour')::int end, 8);

    if r.trigger_type = 'schedule' then
      v_due := case coalesce(cfg ->> 'freq', 'daily')
        when 'daily' then true
        when 'weekdays' then extract(isodow from v_today) between 1 and 5
        when 'weekly' then extract(isodow from v_today)::int = coalesce((cfg ->> 'weekday')::int, 1)
        when 'monthly' then extract(day from v_today)::int = least(
          coalesce((cfg ->> 'monthday')::int, 1),
          extract(day from (date_trunc('month', v_today) + interval '1 month - 1 day'))::int)
        else false
      end;
      continue when not v_due;
      v_key := 'schedule|' || v_today::text;
      continue when exists (
        select 1 from public.automation_runs x
        where x.automation_id = r.id and x.task_id is null and x.fire_key = v_key
      );
      insert into public.automation_runs (automation_id, task_id, fire_key, ok) values (r.id, null, v_key, true);
      if r.action_type = 'create_item' then
        perform private.execute_rule(r, null, null);
        v_count := v_count + 1;
      else
        for t in select * from public.tasks x where x.board_id = r.board_id order by x.position limit 1000 loop
          continue when not private.conditions_met(r.conditions, t);
          perform private.execute_rule(r, t.id, v_key);
          v_count := v_count + 1;
        end loop;
      end if;

    elsif r.trigger_type = 'date_arrives' then
      v_field := coalesce(cfg ->> 'date_field', 'due_date');
      v_off := coalesce(case when cfg ->> 'offset_days' ~ '^-?[0-9]+$' then (cfg ->> 'offset_days')::int end, 0);
      for t in
        select * from public.tasks x
        where x.board_id = r.board_id
          and (v_field <> 'due_date' or x.due_date between v_today - 7 - v_off and v_today - v_off)
        limit 2000
      loop
        v_date := case when v_field = 'due_date' then t.due_date
                       when t.custom_values ->> v_field ~ '^\d{4}-\d{2}-\d{2}$' then (t.custom_values ->> v_field)::date
                  end;
        continue when v_date is null;
        -- Se dispara el día que corresponde; si el servidor no corrió, recupera hasta 7 días.
        continue when v_date + v_off > v_today or v_date + v_off < v_today - 7;
        v_key := 'date|' || v_date::text || '|' || v_off;
        continue when exists (
          select 1 from public.automation_runs x
          where x.automation_id = r.id and x.task_id = t.id and x.fire_key = v_key
        );
        continue when not private.conditions_met(r.conditions, t);
        perform private.execute_rule(r, t.id, v_key);
        v_count := v_count + 1;
      end loop;

    elsif r.trigger_type = 'stale' then
      for t in select * from public.tasks x where x.board_id = r.board_id limit 2000 loop
        continue when cfg ->> 'status_id' is not null and t.status_id::text is distinct from cfg ->> 'status_id';
        select max(e.created_at) into v_since
        from public.task_events e
        where e.task_id = t.id and e.kind in ('status_changed', 'created', 'moved');
        v_since := coalesce(v_since, t.created_at);
        continue when v_since > p_now - make_interval(days => greatest(coalesce(
          case when cfg ->> 'days' ~ '^[0-9]+$' then (cfg ->> 'days')::int end, 3), 1));
        v_key := 'stale|' || v_since::text;
        continue when exists (
          select 1 from public.automation_runs x
          where x.automation_id = r.id and x.task_id = t.id and x.fire_key = v_key
        );
        continue when not private.conditions_met(r.conditions, t);
        perform private.execute_rule(r, t.id, v_key);
        v_count := v_count + 1;
      end loop;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function private.local_today(timestamptz) from public, anon;
grant execute on function private.local_today(timestamptz) to authenticated;
revoke all on function private.user_can_access_board(uuid, uuid) from public, anon, authenticated;
revoke all on function private.render_text(text, uuid) from public, anon, authenticated;
revoke all on function private.condition_met(jsonb, public.tasks) from public, anon, authenticated;
revoke all on function private.conditions_met(jsonb, public.tasks) from public, anon, authenticated;
revoke all on function private.automation_notify(public.board_automations, uuid) from public, anon, authenticated;
revoke all on function private.automation_create_item(public.board_automations, uuid) from public, anon, authenticated;
revoke all on function private.run_rule_action(public.board_automations, uuid) from public, anon, authenticated;
revoke all on function private.execute_rule(public.board_automations, uuid, text) from public, anon, authenticated;
revoke all on function private.run_scheduled_automations(timestamptz) from public, anon, authenticated;

-- El motor también escucha cambios de responsable, prioridad y columnas.
create or replace trigger tasks_b_run_automations
  after insert or update of status_id, group_id, board_id, assignee_id, priority, custom_values on public.tasks
  for each row execute function private.run_automations();

-- -----------------------------------------------------------------------------
-- Permisos y RLS
-- -----------------------------------------------------------------------------
revoke all on public.automation_runs, public.notifications from anon, authenticated;
grant select on public.automation_runs to authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

alter table public.automation_runs enable row level security;
alter table public.notifications   enable row level security;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'automation_runs' and policyname = 'runs_select') then
    create policy "runs_select" on public.automation_runs
      for select to authenticated
      using (exists (select 1 from public.board_automations a where a.id = automation_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notifications' and policyname = 'notifications_select') then
    create policy "notifications_select" on public.notifications
      for select to authenticated
      using (user_id = (select auth.uid()) and private.account_active());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notifications' and policyname = 'notifications_update') then
    create policy "notifications_update" on public.notifications
      for update to authenticated
      using (user_id = (select auth.uid()) and private.account_active())
      with check (user_id = (select auth.uid()));
  end if;
end $do$;

-- -----------------------------------------------------------------------------
-- Ejecución programada cada 15 minutos (si pg_cron está disponible)
-- -----------------------------------------------------------------------------
do $do$ begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron no está disponible: las reglas por fecha no se ejecutarán solas.';
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('vetta-reglas-programadas', '*/15 * * * *', 'select private.run_scheduled_automations()');
  end if;
end $do$;
