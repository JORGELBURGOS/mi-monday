-- =============================================================================
-- Vetta · columnas por tablero, reglas entre tableros y trazabilidad
-- -----------------------------------------------------------------------------
-- Aditiva e idempotente: no elimina objetos ni borra o modifica datos existentes.
--   * board_columns      columnas propias de cada tablero
--   * tasks.custom_values valores de esas columnas por ítem
--   * board_automations  reglas: cuando pasa X en un tablero, mover / copiar a
--                        otro tablero, o actualizar el original / las copias
--   * task_links         vínculo original → copia (la cadena de valor)
--   * task_events        historial inmutable de cada ítem
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Columnas personalizadas
-- -----------------------------------------------------------------------------
create table if not exists public.board_columns (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references public.boards (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  kind       text not null check (kind in ('text', 'number', 'date', 'person', 'list', 'checkbox')),
  -- Para listas: [{ "id": "...", "label": "...", "color": "..." }]
  options    jsonb not null default '[]'::jsonb
             check (jsonb_typeof(options) = 'array' and pg_column_size(options) < 16384),
  position   double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, board_id)
);
create index if not exists board_columns_board_idx on public.board_columns (board_id, position);

-- El tipo y el tablero de una columna no cambian (los valores guardados dependen de ellos).
create or replace function public.prepare_board_column()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  if tg_op = 'UPDATE' then
    new.board_id := old.board_id;
    new.kind := old.kind;
  end if;
  return new;
end;
$$;

create or replace trigger prepare_board_column
  before insert or update on public.board_columns
  for each row execute function public.prepare_board_column();

create or replace trigger set_updated_at
  before update on public.board_columns
  for each row execute function public.set_updated_at();

alter table public.tasks add column if not exists custom_values jsonb not null default '{}'::jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_custom_values_shape') then
    alter table public.tasks add constraint tasks_custom_values_shape
      check (jsonb_typeof(custom_values) = 'object' and pg_column_size(custom_values) < 32768);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Reglas automáticas
-- -----------------------------------------------------------------------------
create table if not exists public.board_automations (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  board_id          uuid not null references public.boards (id) on delete cascade,
  name              text not null check (char_length(btrim(name)) between 1 and 80),
  is_active         boolean not null default true,
  -- Cuándo: llega un ítem al tablero (creado, copiado o movido), cambia de
  -- estado, o entra a una carpeta. Sin estado/carpeta = cualquiera.
  trigger_type      text not null check (trigger_type in ('item_arrived', 'status_changed', 'group_changed')),
  trigger_status_id uuid,
  trigger_group_id  uuid,
  -- Qué: mover, copiar, o actualizar ítems vinculados (original o copias)
  -- que están en target_board_id.
  action_type       text not null check (action_type in ('move', 'copy', 'update_linked')),
  target_board_id   uuid not null references public.boards (id) on delete cascade,
  target_group_id   uuid,
  target_status_id  uuid,
  link_direction    text check (link_direction in ('origin', 'copies')),
  copy_fields       text[] not null default array['description', 'priority', 'assignee', 'due_date']
                    check (copy_fields <@ array['description', 'priority', 'assignee', 'due_date', 'status']),
  -- [{ "from": <columna origen>, "to": <columna destino> }]
  column_map        jsonb not null default '[]'::jsonb
                    check (jsonb_typeof(column_map) = 'array' and pg_column_size(column_map) < 16384),
  -- { <columna destino>: valor fijo }
  extra_values      jsonb not null default '{}'::jsonb
                    check (jsonb_typeof(extra_values) = 'object' and pg_column_size(extra_values) < 16384),
  position          double precision not null default 0,
  created_by        uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Si se elimina el estado o la carpeta que dispara la regla, la regla deja de tener sentido.
  constraint automations_trigger_status_same_board foreign key (trigger_status_id, board_id)
    references public.board_statuses (id, board_id) on delete cascade,
  constraint automations_trigger_group_same_board foreign key (trigger_group_id, board_id)
    references public.board_groups (id, board_id) on delete cascade,
  -- Si se elimina la carpeta o el estado de destino, se usa el predeterminado.
  constraint automations_target_group_same_board foreign key (target_group_id, target_board_id)
    references public.board_groups (id, board_id) on delete set null (target_group_id),
  constraint automations_target_status_same_board foreign key (target_status_id, target_board_id)
    references public.board_statuses (id, board_id) on delete set null (target_status_id)
);
create index if not exists board_automations_board_idx  on public.board_automations (board_id, position);
create index if not exists board_automations_target_idx on public.board_automations (target_board_id);
create index if not exists board_automations_ws_idx     on public.board_automations (workspace_id);
create index if not exists board_automations_tstatus_idx on public.board_automations (trigger_status_id, board_id);
create index if not exists board_automations_tgroup_idx  on public.board_automations (trigger_group_id, board_id);
create index if not exists board_automations_dgroup_idx  on public.board_automations (target_group_id, target_board_id);
create index if not exists board_automations_dstatus_idx on public.board_automations (target_status_id, target_board_id);
create index if not exists board_automations_by_idx      on public.board_automations (created_by);

-- Ambos tableros deben ser del mismo espacio, y las columnas del mapeo deben
-- existir en el tablero que corresponde y ser del mismo tipo.
create or replace function public.prepare_automation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_target_ws uuid;
  v_bad int;
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

  if tg_op = 'INSERT' or new.target_board_id is distinct from old.target_board_id then
    select b.workspace_id into v_target_ws from public.boards b where b.id = new.target_board_id;
    if v_target_ws is distinct from new.workspace_id then
      raise exception 'El tablero de destino tiene que ser del mismo espacio.' using errcode = 'P0001';
    end if;
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
  return new;
end;
$$;

create or replace trigger prepare_automation
  before insert or update on public.board_automations
  for each row execute function public.prepare_automation();

create or replace trigger set_updated_at
  before update on public.board_automations
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Vínculos e historial
-- -----------------------------------------------------------------------------
-- Las claves foráneas se verifican al final de la transacción para que el
-- motor pueda registrar el vínculo antes de crear la copia (así las reglas del
-- tablero de destino ya ven de dónde vino el ítem).
create table if not exists public.task_links (
  id             uuid primary key default gen_random_uuid(),
  source_task_id uuid not null references public.tasks (id) on delete cascade deferrable initially deferred,
  target_task_id uuid not null references public.tasks (id) on delete cascade deferrable initially deferred,
  automation_id  uuid references public.board_automations (id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (source_task_id, target_task_id)
);
create index if not exists task_links_target_idx     on public.task_links (target_task_id);
create index if not exists task_links_automation_idx on public.task_links (automation_id);

-- Sin claves foráneas a propósito: el historial sobrevive aunque se elimine el ítem.
create table if not exists public.task_events (
  id              bigint generated always as identity primary key,
  workspace_id    uuid not null,
  board_id        uuid not null,
  task_id         uuid not null,
  kind            text not null,
  detail          jsonb not null default '{}'::jsonb,
  automation_id   uuid,
  automation_name text,
  actor_id        uuid,
  created_at      timestamptz not null default now()
);
create index if not exists task_events_task_idx  on public.task_events (task_id, created_at);
create index if not exists task_events_board_idx on public.task_events (board_id, created_at);

-- -----------------------------------------------------------------------------
-- Las tareas cambian de tablero solo a través del motor de reglas
-- -----------------------------------------------------------------------------
-- pg_trigger_depth() > 1 solo ocurre cuando la actualización la hace otro
-- trigger (el motor de reglas); una actualización directa de la API llega con
-- profundidad 1 y conserva su tablero.
create or replace function public.prepare_task()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.title := btrim(new.title);
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
  else
    if pg_trigger_depth() <= 1 then
      new.board_id := old.board_id;
    end if;
    new.created_by := old.created_by;
  end if;

  if new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id
          or new.board_id is distinct from old.board_id)
     and not exists (
       select 1
       from public.boards b
       join public.workspace_members m on m.workspace_id = b.workspace_id
       where b.id = new.board_id and m.user_id = new.assignee_id
     )
  then
    raise exception 'El responsable tiene que ser miembro del espacio.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Funciones del motor (esquema private, no expuesto por la API)
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER necesario: una regla la configura quien administra ambos
-- tableros, pero la dispara cualquier persona que mueva un ítem, y esa persona
-- puede no tener acceso al tablero de destino. El motor solo ejecuta reglas
-- guardadas (validadas por RLS y por prepare_automation), nunca datos que
-- envíe el cliente; todas fijan search_path = '' y no se pueden invocar desde
-- la API.

create or replace function private.current_automation()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('vetta.automation', true), '')::uuid;
$$;

create or replace function private.resolve_group(p_board uuid, p_group uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select g.id from public.board_groups g where g.id = p_group and g.board_id = p_board),
    (select g.id from public.board_groups g where g.board_id = p_board order by g.position, g.created_at limit 1)
  );
$$;

-- Estado de destino: el indicado en la regla; si no, el de mismo nombre; si no, el primero.
create or replace function private.map_status(p_status uuid, p_board uuid, p_explicit uuid, p_keep boolean)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.id from public.board_statuses s where s.id = p_explicit and s.board_id = p_board),
    case when p_keep then (
      select t.id
      from public.board_statuses f
      join public.board_statuses t on t.board_id = p_board and lower(btrim(t.label)) = lower(btrim(f.label))
      where f.id = p_status
      order by t.position
      limit 1
    ) end,
    (select s.id from public.board_statuses s where s.board_id = p_board order by s.position, s.created_at limit 1)
  );
$$;

create or replace function private.next_position(p_group uuid)
returns double precision
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(t.position), 0) + 1000 from public.tasks t where t.group_id = p_group;
$$;

-- Traduce los valores de columnas del tablero de origen al de destino según el
-- mapeo (en listas, por nombre de opción) y agrega los valores fijos.
create or replace function private.map_custom(p_values jsonb, p_map jsonb, p_extra jsonb, p_target uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_object_agg(x.key, x.value)
    from (
      select m ->> 'to' as key,
             case
               when ct.kind = 'list' then (
                 select to_jsonb(o2 ->> 'id')
                 from jsonb_array_elements(cf.options) o1
                 join jsonb_array_elements(ct.options) o2
                   on lower(btrim(o2 ->> 'label')) = lower(btrim(o1 ->> 'label'))
                 where o1 ->> 'id' = p_values ->> (m ->> 'from')
                 limit 1
               )
               else p_values -> (m ->> 'from')
             end as value
      from jsonb_array_elements(p_map) m
      join public.board_columns cf on cf.id::text = m ->> 'from'
      join public.board_columns ct on ct.id::text = m ->> 'to' and ct.board_id = p_target and ct.kind = cf.kind
      where p_values ? (m ->> 'from')
    ) x
    where x.value is not null and x.value <> 'null'::jsonb
  ), '{}'::jsonb)
  || coalesce((
    select jsonb_object_agg(e.key, e.value)
    from jsonb_each(p_extra) e
    where exists (select 1 from public.board_columns c where c.id::text = e.key and c.board_id = p_target)
  ), '{}'::jsonb);
$$;

create or replace function private.automation_copy(r public.board_automations, p_task uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t       public.tasks%rowtype;
  v_group uuid;
  v_new   uuid := gen_random_uuid();
begin
  -- Cada regla copia un mismo ítem una sola vez.
  if exists (select 1 from public.task_links l where l.source_task_id = p_task and l.automation_id = r.id) then
    return;
  end if;
  if not exists (select 1 from public.boards b where b.id = r.target_board_id and not b.is_archived) then
    return;
  end if;
  select * into t from public.tasks where id = p_task;
  v_group := private.resolve_group(r.target_board_id, r.target_group_id);
  if t.id is null or v_group is null then
    return;
  end if;

  insert into public.task_links (source_task_id, target_task_id, automation_id)
  values (p_task, v_new, r.id);

  insert into public.tasks (id, board_id, group_id, status_id, title, description, priority,
                            assignee_id, due_date, custom_values, position)
  values (
    v_new, r.target_board_id, v_group,
    private.map_status(t.status_id, r.target_board_id, r.target_status_id, 'status' = any (r.copy_fields)),
    t.title,
    case when 'description' = any (r.copy_fields) then t.description end,
    case when 'priority' = any (r.copy_fields) then t.priority else 'medium'::public.task_priority end,
    case when 'assignee' = any (r.copy_fields) then t.assignee_id end,
    case when 'due_date' = any (r.copy_fields) then t.due_date end,
    private.map_custom(t.custom_values, r.column_map, r.extra_values, r.target_board_id),
    private.next_position(v_group)
  );

  insert into public.task_events (workspace_id, board_id, task_id, kind, detail, automation_id, automation_name, actor_id)
  values (r.workspace_id, t.board_id, p_task, 'copied_to',
          jsonb_build_object('task_id', v_new,
                             'board', (select b.name from public.boards b where b.id = r.target_board_id),
                             'group', (select g.name from public.board_groups g where g.id = v_group)),
          r.id, r.name, (select auth.uid()));
end;
$$;

create or replace function private.automation_move(r public.board_automations, p_task uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t       public.tasks%rowtype;
  v_group uuid;
begin
  if not exists (select 1 from public.boards b where b.id = r.target_board_id and not b.is_archived) then
    return;
  end if;
  select * into t from public.tasks where id = p_task;
  v_group := private.resolve_group(r.target_board_id, r.target_group_id);
  if t.id is null or v_group is null then
    return;
  end if;

  if r.target_board_id = t.board_id then
    if v_group = t.group_id and (r.target_status_id is null or r.target_status_id = t.status_id) then
      return;
    end if;
    update public.tasks
       set group_id  = v_group,
           status_id = coalesce(r.target_status_id, t.status_id),
           position  = case when v_group = t.group_id then t.position else private.next_position(v_group) end
     where id = p_task;
  else
    update public.tasks
       set board_id      = r.target_board_id,
           group_id      = v_group,
           status_id     = private.map_status(t.status_id, r.target_board_id, r.target_status_id, true),
           custom_values = private.map_custom(t.custom_values, r.column_map, r.extra_values, r.target_board_id),
           position      = private.next_position(v_group)
     where id = p_task;
  end if;
end;
$$;

create or replace function private.automation_update_linked(r public.board_automations, p_task uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if r.target_status_id is null and r.target_group_id is null then
    return;
  end if;
  for v_id in
    with recursive chain(id, depth) as (
      select case when r.link_direction = 'copies' then l.target_task_id else l.source_task_id end, 1
      from public.task_links l
      where (r.link_direction = 'copies' and l.source_task_id = p_task)
         or (r.link_direction <> 'copies' and l.target_task_id = p_task)
      union
      select case when r.link_direction = 'copies' then l.target_task_id else l.source_task_id end, c.depth + 1
      from public.task_links l
      join chain c on (r.link_direction = 'copies' and l.source_task_id = c.id)
                   or (r.link_direction <> 'copies' and l.target_task_id = c.id)
      where c.depth < 20
    )
    select distinct c.id
    from chain c
    join public.tasks t on t.id = c.id
    where t.board_id = r.target_board_id
  loop
    update public.tasks t
       set status_id = coalesce(r.target_status_id, t.status_id),
           group_id  = coalesce(r.target_group_id, t.group_id),
           position  = case when r.target_group_id is null or r.target_group_id = t.group_id
                            then t.position else private.next_position(r.target_group_id) end
     where t.id = v_id
       and (t.status_id is distinct from coalesce(r.target_status_id, t.status_id)
            or t.group_id is distinct from coalesce(r.target_group_id, t.group_id));
  end loop;
end;
$$;

-- Motor: se ejecuta después de cada alta o cambio de estado, carpeta o tablero.
create or replace function private.run_automations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r         public.board_automations%rowtype;
  v_arrived boolean := tg_op = 'INSERT' or new.board_id is distinct from old.board_id;
  v_prev    text;
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
    where a.board_id = new.board_id
      and a.is_active
      and (
        (a.trigger_type = 'item_arrived' and v_arrived
          and (a.trigger_group_id is null or a.trigger_group_id = new.group_id))
        or (a.trigger_type = 'status_changed' and not v_arrived
          and new.status_id is distinct from old.status_id
          and (a.trigger_status_id is null or a.trigger_status_id = new.status_id))
        or (a.trigger_type = 'group_changed' and not v_arrived
          and new.group_id is distinct from old.group_id
          and (a.trigger_group_id is null or a.trigger_group_id = new.group_id))
      )
    order by a.position, a.created_at
  loop
    -- Una regla anterior pudo haber movido el ítem a otro tablero.
    exit when not exists (select 1 from public.tasks t where t.id = new.id and t.board_id = r.board_id);
    v_prev := current_setting('vetta.automation', true);
    perform set_config('vetta.automation', r.id::text, true);
    if r.action_type = 'copy' then
      perform private.automation_copy(r, new.id);
    elsif r.action_type = 'move' then
      perform private.automation_move(r, new.id);
    else
      perform private.automation_update_linked(r, new.id);
    end if;
    perform set_config('vetta.automation', coalesce(v_prev, ''), true);
  end loop;
  return null;
end;
$$;

-- Historial: registra altas, cambios de estado, carpeta, tablero, responsable,
-- vencimiento, prioridad y título, y bajas.
create or replace function private.log_task_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws    uuid;
  v_auto  uuid := private.current_automation();
  v_aname text;
  v_actor uuid := (select auth.uid());
  v_rows  jsonb := '[]'::jsonb;
  v_row   jsonb;
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
          'to', (select s.label from public.board_statuses s where s.id = new.status_id),
          'to_color', (select s.color from public.board_statuses s where s.id = new.status_id),
          'done', (select s.is_done from public.board_statuses s where s.id = new.status_id)));
      end if;
      if new.assignee_id is distinct from old.assignee_id then
        v_rows := v_rows || jsonb_build_object('kind', 'assignee_changed', 'detail', jsonb_build_object(
          'to', (select coalesce(p.full_name, p.email) from public.profiles p where p.id = new.assignee_id)));
      end if;
      if new.due_date is distinct from old.due_date then
        v_rows := v_rows || jsonb_build_object('kind', 'due_changed', 'detail', jsonb_build_object('to', new.due_date));
      end if;
      if new.priority is distinct from old.priority then
        v_rows := v_rows || jsonb_build_object('kind', 'priority_changed', 'detail', jsonb_build_object('to', new.priority));
      end if;
      if new.title is distinct from old.title then
        v_rows := v_rows || jsonb_build_object('kind', 'renamed', 'detail', jsonb_build_object('from', old.title, 'to', new.title));
      end if;
    end if;
  end if;

  if jsonb_array_length(v_rows) = 0 or v_ws is null then
    return null;
  end if;
  if v_auto is not null then
    select a.name into v_aname from public.board_automations a where a.id = v_auto;
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

revoke all on function private.current_automation() from public, anon, authenticated;
revoke all on function private.resolve_group(uuid, uuid) from public, anon, authenticated;
revoke all on function private.map_status(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function private.next_position(uuid) from public, anon, authenticated;
revoke all on function private.map_custom(jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;
revoke all on function private.automation_copy(public.board_automations, uuid) from public, anon, authenticated;
revoke all on function private.automation_move(public.board_automations, uuid) from public, anon, authenticated;
revoke all on function private.automation_update_linked(public.board_automations, uuid) from public, anon, authenticated;
revoke all on function private.run_automations() from public, anon, authenticated;
revoke all on function private.log_task_event() from public, anon, authenticated;

-- Los triggers AFTER se ejecutan en orden alfabético: primero el historial, después el motor.
create or replace trigger tasks_a_log_event
  after insert or update or delete on public.tasks
  for each row execute function private.log_task_event();

create or replace trigger tasks_b_run_automations
  after insert or update of status_id, group_id, board_id on public.tasks
  for each row execute function private.run_automations();

-- -----------------------------------------------------------------------------
-- Cadena de un ítem (orígenes y copias). SECURITY INVOKER: respeta RLS, los
-- ítems de tableros sin acceso aparecen sin datos.
-- -----------------------------------------------------------------------------
create or replace function public.task_trace(p_task_id uuid)
returns table (
  task_id         uuid,
  parent_id       uuid,
  depth           integer,
  linked_at       timestamptz,
  automation_name text,
  title           text,
  board_id        uuid,
  board_name      text,
  group_name      text,
  status_label    text,
  status_color    text,
  status_done     boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive
  up (id, parent, depth, linked_at, automation_id) as (
    select l.source_task_id, l.target_task_id, -1, l.created_at, l.automation_id
    from public.task_links l where l.target_task_id = p_task_id
    union all
    select l.source_task_id, l.target_task_id, u.depth - 1, l.created_at, l.automation_id
    from public.task_links l join up u on l.target_task_id = u.id
    where u.depth > -20
  ),
  down (id, parent, depth, linked_at, automation_id) as (
    select l.target_task_id, l.source_task_id, 1, l.created_at, l.automation_id
    from public.task_links l where l.source_task_id = p_task_id
    union all
    select l.target_task_id, l.source_task_id, d.depth + 1, l.created_at, l.automation_id
    from public.task_links l join down d on l.source_task_id = d.id
    where d.depth < 20
  ),
  chain as (
    select * from up
    union all
    select p_task_id, null::uuid, 0, null::timestamptz, null::uuid
    union all
    select * from down
  )
  select c.id, c.parent, c.depth, c.linked_at, a.name, t.title, t.board_id, b.name, g.name, s.label, s.color, s.is_done
  from chain c
  left join public.tasks t on t.id = c.id
  left join public.boards b on b.id = t.board_id
  left join public.board_groups g on g.id = t.group_id
  left join public.board_statuses s on s.id = t.status_id
  left join public.board_automations a on a.id = c.automation_id
  order by c.depth, c.linked_at;
$$;
revoke all on function public.task_trace(uuid) from public, anon;
grant execute on function public.task_trace(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Permisos y RLS
-- -----------------------------------------------------------------------------
revoke all on public.board_columns, public.board_automations, public.task_links, public.task_events from anon;
grant select, insert, update, delete on public.board_columns, public.board_automations to authenticated;
-- Vínculos e historial: solo lectura. Los escribe el motor.
revoke all on public.task_links, public.task_events from authenticated;
grant select on public.task_links, public.task_events to authenticated;

alter table public.board_columns     enable row level security;
alter table public.board_automations enable row level security;
alter table public.task_links        enable row level security;
alter table public.task_events       enable row level security;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'board_columns' and policyname = 'columns_select') then
    create policy "columns_select" on public.board_columns
      for select to authenticated using (private.can_access_board(board_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'board_columns' and policyname = 'columns_insert') then
    create policy "columns_insert" on public.board_columns
      for insert to authenticated with check (private.can_manage_board(board_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'board_columns' and policyname = 'columns_update') then
    create policy "columns_update" on public.board_columns
      for update to authenticated
      using (private.can_manage_board(board_id))
      with check (private.can_manage_board(board_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'board_columns' and policyname = 'columns_delete') then
    create policy "columns_delete" on public.board_columns
      for delete to authenticated using (private.can_manage_board(board_id));
  end if;
end $do$;

-- Reglas: las ve quien ve el tablero; las configura quien administra el tablero
-- de origen y también el de destino.
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'board_automations' and policyname = 'automations_select') then
    create policy "automations_select" on public.board_automations
      for select to authenticated using (private.can_access_board(board_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'board_automations' and policyname = 'automations_insert') then
    create policy "automations_insert" on public.board_automations
      for insert to authenticated
      with check (private.can_manage_board(board_id) and private.can_manage_board(target_board_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'board_automations' and policyname = 'automations_update') then
    create policy "automations_update" on public.board_automations
      for update to authenticated
      using (private.can_manage_board(board_id))
      with check (private.can_manage_board(board_id) and private.can_manage_board(target_board_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'board_automations' and policyname = 'automations_delete') then
    create policy "automations_delete" on public.board_automations
      for delete to authenticated using (private.can_manage_board(board_id));
  end if;
end $do$;

-- Un vínculo se ve si se ve al menos uno de los dos ítems.
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'task_links' and policyname = 'links_select') then
    create policy "links_select" on public.task_links
      for select to authenticated
      using (exists (select 1 from public.tasks t where t.id in (source_task_id, target_task_id)));
  end if;
end $do$;

-- El historial se ve desde el tablero donde ocurrió, o completo si hoy se ve el ítem.
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'task_events' and policyname = 'events_select') then
    create policy "events_select" on public.task_events
      for select to authenticated
      using (private.can_access_board(board_id) or exists (select 1 from public.tasks t where t.id = task_id));
  end if;
end $do$;
