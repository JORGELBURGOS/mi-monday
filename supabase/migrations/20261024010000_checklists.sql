-- =============================================================================
-- Vetta · checklists completos
-- -----------------------------------------------------------------------------
--   * checklist_templates: plantillas de checklist por empresa.
--   * Una columna Checklist puede tener una plantilla automática: todo elemento
--     nuevo del tablero (también los que crean las reglas) arranca con ella.
--   * "Al terminar el elemento, tildar todo": al pasar a un estado terminado se
--     completan los pasos pendientes.
--   * Historial: cada paso tildado/destildado y el checklist completo quedan en
--     el recorrido del elemento.
--   * Avisos: a quien le asignan un paso le llega un aviso en Vetta.
-- No elimina objetos ni datos.
-- =============================================================================

create table if not exists public.checklist_templates (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 80),
  items        jsonb not null default '[]'::jsonb
               check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 300 and pg_column_size(items) < 65536),
  created_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists checklist_templates_ws_idx on public.checklist_templates (workspace_id, name);
create index if not exists checklist_templates_created_by_idx on public.checklist_templates (created_by);

create or replace trigger set_updated_at
  before update on public.checklist_templates
  for each row execute function public.set_updated_at();

revoke all on public.checklist_templates from anon;
grant select, insert, update, delete on public.checklist_templates to authenticated;
alter table public.checklist_templates enable row level security;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'checklist_templates' and policyname = 'templates_select') then
    create policy "templates_select" on public.checklist_templates
      for select to authenticated using (private.is_workspace_member(workspace_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'checklist_templates' and policyname = 'templates_insert') then
    create policy "templates_insert" on public.checklist_templates
      for insert to authenticated
      with check (private.is_workspace_member(workspace_id) and created_by = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'checklist_templates' and policyname = 'templates_update') then
    create policy "templates_update" on public.checklist_templates
      for update to authenticated
      using (created_by = (select auth.uid()) or private.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]))
      with check (private.is_workspace_member(workspace_id));
  end if;
end $do$;

-- -----------------------------------------------------------------------------
-- Pasos nuevos a partir de una plantilla (ids nuevos, todo sin tildar)
-- -----------------------------------------------------------------------------
create or replace function private.checklist_from_template(p_items jsonb)
returns jsonb
language sql
volatile
set search_path = ''
as $$
  select coalesce(jsonb_agg(
           jsonb_strip_nulls(jsonb_build_object(
             'id', substr(md5(random()::text || clock_timestamp()::text), 1, 10),
             'text', i ->> 'text',
             'done', false,
             'header', case when (i ->> 'header')::boolean then true end,
             'note', i ->> 'note'
           )) order by ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(i, ord)
  where coalesce(i ->> 'text', '') <> '';
$$;

-- Antes de guardar: plantilla automática al crear y "tildar todo" al terminar.
create or replace function private.checklist_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
-- SECURITY DEFINER: lee las plantillas de la empresa del tablero aunque el
-- elemento lo cree una regla (motor) en nombre de alguien. Solo modifica la
-- fila que se está guardando.
declare
  c      record;
  v_tpl  jsonb;
  v_done boolean;
begin
  if tg_op = 'INSERT' then
    if new.parent_id is null then
      for c in
        select bc.id, bc.settings
        from public.board_columns bc
        where bc.board_id = new.board_id and bc.kind = 'checklist' and bc.settings ? 'templateId'
      loop
        continue when new.custom_values ? c.id::text;
        select t.items into v_tpl
        from public.checklist_templates t
        join public.boards b on b.id = new.board_id and b.workspace_id = t.workspace_id
        where t.id::text = c.settings ->> 'templateId';
        continue when v_tpl is null or jsonb_array_length(v_tpl) = 0;
        new.custom_values := jsonb_set(new.custom_values, array[c.id::text], private.checklist_from_template(v_tpl));
      end loop;
    end if;
    return new;
  end if;

  -- UPDATE de estado: si pasa a un estado terminado, se tildan los pasos.
  if new.status_id is distinct from old.status_id and new.status_id is not null then
    select s.is_done into v_done from public.board_statuses s where s.id = new.status_id;
    if coalesce(v_done, false) then
      for c in
        select bc.id from public.board_columns bc
        where bc.board_id = new.board_id and bc.kind = 'checklist' and (bc.settings ->> 'completeOnDone')::boolean
      loop
        continue when jsonb_typeof(new.custom_values -> c.id::text) <> 'array';
        new.custom_values := jsonb_set(new.custom_values, array[c.id::text], (
          select coalesce(jsonb_agg(
                   case when (i ->> 'header')::boolean or i ->> 'status' = 'na' then i
                        else i || jsonb_build_object('done', true) - 'status' end
                   order by ord), '[]'::jsonb)
          from jsonb_array_elements(new.custom_values -> c.id::text) with ordinality as t(i, ord)
        ));
      end loop;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.checklist_before() from public, anon, authenticated;
revoke all on function private.checklist_from_template(jsonb) from public, anon, authenticated;

create or replace trigger tasks_a_checklist_insert
  before insert on public.tasks
  for each row execute function private.checklist_before();

create or replace trigger tasks_a_checklist_status
  before update of status_id on public.tasks
  for each row execute function private.checklist_before();

-- -----------------------------------------------------------------------------
-- Después de guardar: historial de pasos y avisos de asignación
-- -----------------------------------------------------------------------------
create or replace function private.checklist_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
-- SECURITY DEFINER: task_events y notifications solo los escribe el sistema.
-- Compara la versión anterior y la nueva de las columnas checklist de la fila.
declare
  c       record;
  v_ws    uuid;
  v_actor uuid := (select auth.uid());
  v_new   jsonb;
  v_old   jsonb;
  i       jsonb;
  o       jsonb;
  v_n     int := 0;
  v_total int;
  v_ok    int;
  v_prev  int;
begin
  select b.workspace_id into v_ws from public.boards b where b.id = new.board_id;
  if v_ws is null then
    return null;
  end if;
  for c in select bc.id, bc.name from public.board_columns bc where bc.board_id = new.board_id and bc.kind = 'checklist' loop
    v_new := case when jsonb_typeof(new.custom_values -> c.id::text) = 'array' then new.custom_values -> c.id::text else '[]'::jsonb end;
    v_old := case when tg_op = 'UPDATE' and jsonb_typeof(old.custom_values -> c.id::text) = 'array' then old.custom_values -> c.id::text else '[]'::jsonb end;
    continue when v_new = v_old;

    for i in select * from jsonb_array_elements(v_new) loop
      select x into o from jsonb_array_elements(v_old) x where x ->> 'id' = i ->> 'id' limit 1;
      -- Paso tildado o destildado.
      if o is not null and coalesce((o ->> 'done')::boolean, false) <> coalesce((i ->> 'done')::boolean, false) and v_n < 20 then
        insert into public.task_events (workspace_id, board_id, task_id, kind, detail, actor_id)
        values (v_ws, new.board_id, new.id, 'checklist_item',
                jsonb_build_object('column', c.name, 'item', left(i ->> 'text', 200), 'done', coalesce((i ->> 'done')::boolean, false)), v_actor);
        v_n := v_n + 1;
      end if;
      -- Paso asignado a otra persona: aviso.
      if i ->> 'assignee' is not null
         and (o is null or o ->> 'assignee' is distinct from i ->> 'assignee')
         and (i ->> 'assignee') <> coalesce(v_actor::text, '')
         and exists (select 1 from public.workspace_members m where m.workspace_id = v_ws and m.user_id::text = i ->> 'assignee')
      then
        insert into public.notifications (user_id, workspace_id, board_id, task_id, title, body)
        values ((i ->> 'assignee')::uuid, v_ws, new.board_id, new.id,
                'Te asignaron un paso del checklist',
                left(i ->> 'text', 200) || ' · ' || left(new.title, 200)
                  || case when i ->> 'due' is not null then ' · vence ' || (i ->> 'due') else '' end);
      end if;
    end loop;

    -- Checklist completo (todos los pasos que cuentan, tildados).
    select count(*) filter (where not coalesce((x ->> 'header')::boolean, false) and coalesce(x ->> 'status', '') <> 'na'),
           count(*) filter (where not coalesce((x ->> 'header')::boolean, false) and coalesce(x ->> 'status', '') <> 'na' and coalesce((x ->> 'done')::boolean, false))
      into v_total, v_ok from jsonb_array_elements(v_new) x;
    select count(*) filter (where not coalesce((x ->> 'header')::boolean, false) and coalesce(x ->> 'status', '') <> 'na' and coalesce((x ->> 'done')::boolean, false))
      into v_prev from jsonb_array_elements(v_old) x;
    if v_total > 0 and v_ok = v_total and v_prev < v_total then
      insert into public.task_events (workspace_id, board_id, task_id, kind, detail, actor_id)
      values (v_ws, new.board_id, new.id, 'checklist_completed', jsonb_build_object('column', c.name, 'total', v_total), v_actor);
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function private.checklist_after() from public, anon, authenticated;

create or replace trigger tasks_d_checklist_log
  after insert or update of custom_values on public.tasks
  for each row execute function private.checklist_after();

-- Eliminar plantillas: quien la creó o un administrador.
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'checklist_templates' and policyname = 'templates_remove') then
    create policy "templates_remove" on public.checklist_templates
      for delete to authenticated
      using (created_by = (select auth.uid()) or private.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));
  end if;
end $do$;
