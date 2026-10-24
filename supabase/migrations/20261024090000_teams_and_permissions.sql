-- =============================================================================
-- Vetta · equipos, responsables múltiples y permisos finos
-- -----------------------------------------------------------------------------
-- 1. Equipos de la empresa (workspace_teams + team_members). Los arman los
--    dueños y administradores; los ve toda la empresa.
-- 2. Responsables múltiples: tasks.assignee_ids (personas, en orden) y
--    tasks.team_ids (equipos). tasks.assignee_id sigue existiendo como "el
--    primero" y se mantiene sincronizado, así todo lo anterior sigue andando.
-- 3. Permisos por tablero: board_members.role y board_teams (permiso a un equipo
--    entero). Roles: admin, editor, own (solo lo suyo), commenter, viewer.
--    boards.default_role: el rol de la empresa en tableros "para todos".
-- 4. Restricciones finas (vacías = sin restricción):
--      board_groups.editors          quién edita los elementos de la carpeta
--      board_columns.settings.editors quién cambia la columna
--      boards.settings.columns.<fija>.editors  ídem para columnas fijas
--    y cada sección del checklist cuyo título coincide con una carpeta
--    restringida solo la marca la gente de esa carpeta.
--    Se controla en la base (trigger), no solo en la pantalla. Las reglas
--    automáticas, los formularios y el sistema no quedan bloqueados.
--
-- Compatibilidad: todos los permisos nuevos arrancan en "editor" (lo de hoy) y
-- sin restricciones. El único dato que se completa es assignee_ids a partir del
-- responsable actual de cada elemento (sin tocar updated_at). No borra nada.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Equipos
-- -----------------------------------------------------------------------------
create table if not exists public.workspace_teams (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 60),
  color        text not null default 'blue' check (color ~ '^[a-z]{3,12}$'),
  description  text check (description is null or char_length(description) <= 300),
  created_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists workspace_teams_name_idx on public.workspace_teams (workspace_id, lower(btrim(name)));
create index if not exists workspace_teams_created_by_idx on public.workspace_teams (created_by);

create table if not exists public.team_members (
  team_id    uuid not null references public.workspace_teams (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index if not exists team_members_user_idx on public.team_members (user_id);

create or replace trigger set_updated_at
  before update on public.workspace_teams
  for each row execute function public.set_updated_at();

-- Integrante = miembro de la empresa del equipo.
create or replace function private.check_team_member()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.workspace_teams t
    join public.workspace_members m on m.workspace_id = t.workspace_id and m.user_id = new.user_id
    where t.id = new.team_id
  ) then
    raise exception 'La persona tiene que ser de la empresa del equipo.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.check_team_member() from public, anon, authenticated;
create or replace trigger team_members_check
  before insert or update on public.team_members
  for each row execute function private.check_team_member();

-- Quien deja la empresa deja sus equipos.
create or replace function private.leave_teams()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
-- SECURITY DEFINER: borra filas de team_members que la persona que quita al
-- miembro quizá no administra directamente (es limpieza del sistema).
begin
  delete from public.team_members tm
   using public.workspace_teams t
   where t.id = tm.team_id and t.workspace_id = old.workspace_id and tm.user_id = old.user_id;
  return null;
end;
$$;
revoke all on function private.leave_teams() from public, anon, authenticated;
create or replace trigger workspace_members_leave_teams
  after delete on public.workspace_members
  for each row execute function private.leave_teams();

alter table public.workspace_teams enable row level security;
alter table public.team_members enable row level security;
revoke all on public.workspace_teams, public.team_members from anon;
grant select, insert, update, delete on public.workspace_teams, public.team_members to authenticated;

do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'workspace_teams' and policyname = 'teams_select') then
    create policy "teams_select" on public.workspace_teams for select to authenticated
      using (private.is_workspace_member(workspace_id));
    create policy "teams_insert" on public.workspace_teams for insert to authenticated
      with check (private.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]) or private.is_platform_admin());
    create policy "teams_update" on public.workspace_teams for update to authenticated
      using (private.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]) or private.is_platform_admin())
      with check (private.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]) or private.is_platform_admin());
    create policy "teams_delete" on public.workspace_teams for delete to authenticated
      using (private.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]) or private.is_platform_admin());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'team_members' and policyname = 'team_members_select') then
    create policy "team_members_select" on public.team_members for select to authenticated
      using (exists (select 1 from public.workspace_teams t where t.id = team_id and private.is_workspace_member(t.workspace_id)));
    create policy "team_members_insert" on public.team_members for insert to authenticated
      with check (exists (select 1 from public.workspace_teams t where t.id = team_id
                          and (private.has_workspace_role(t.workspace_id, array['owner', 'admin']::public.workspace_role[]) or private.is_platform_admin())));
    create policy "team_members_delete" on public.team_members for delete to authenticated
      using (exists (select 1 from public.workspace_teams t where t.id = team_id
                     and (private.has_workspace_role(t.workspace_id, array['owner', 'admin']::public.workspace_role[]) or private.is_platform_admin())));
  end if;
end $do$;

-- -----------------------------------------------------------------------------
-- 2. Responsables múltiples
-- -----------------------------------------------------------------------------
alter table public.tasks add column if not exists assignee_ids uuid[] not null default '{}';
alter table public.tasks add column if not exists team_ids uuid[] not null default '{}';
alter table public.tasks drop constraint if exists tasks_assignees_size;
alter table public.tasks add constraint tasks_assignees_size check (cardinality(assignee_ids) <= 50 and cardinality(team_ids) <= 20);
create index if not exists tasks_assignee_ids_idx on public.tasks using gin (assignee_ids);
create index if not exists tasks_team_ids_idx on public.tasks using gin (team_ids);

-- Completar la lista con el responsable actual (sin cambiar la fecha de modificación).
alter table public.tasks disable trigger set_updated_at;
update public.tasks set assignee_ids = array[assignee_id]
 where assignee_id is not null and cardinality(assignee_ids) = 0;
alter table public.tasks enable trigger set_updated_at;

-- Lista sin repetidos ni nulos, en el orden original.
create or replace function private.uniq_uuids(p uuid[])
returns uuid[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(x order by o), '{}')
  from (select x, min(o) o from unnest(coalesce(p, '{}')) with ordinality u(x, o) where x is not null group by x) s;
$$;

-- assignee_id (el primero) ↔ assignee_ids, y validación de personas y equipos.
create or replace function private.sync_assignees()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ws uuid;
begin
  new.assignee_ids := private.uniq_uuids(new.assignee_ids);
  new.team_ids := private.uniq_uuids(new.team_ids);
  if tg_op = 'INSERT' then
    if cardinality(new.assignee_ids) = 0 and new.assignee_id is not null then
      new.assignee_ids := array[new.assignee_id];
    end if;
  elsif new.assignee_ids is distinct from old.assignee_ids then
    null; -- manda la lista
  elsif new.assignee_id is distinct from old.assignee_id then
    -- Cambio "de a uno" (reglas, formularios, versiones anteriores): ese pasa a ser el responsable.
    new.assignee_ids := case when new.assignee_id is null then '{}'::uuid[] else array[new.assignee_id] end;
  end if;
  new.assignee_id := new.assignee_ids[1];

  if tg_op = 'INSERT' or new.assignee_ids is distinct from old.assignee_ids or new.team_ids is distinct from old.team_ids
     or new.board_id is distinct from old.board_id then
    select b.workspace_id into v_ws from public.boards b where b.id = new.board_id;
    if exists (select 1 from unnest(new.assignee_ids) u(id)
               where not exists (select 1 from public.workspace_members m where m.workspace_id = v_ws and m.user_id = u.id)) then
      raise exception 'Los responsables tienen que ser de la empresa.' using errcode = 'P0001';
    end if;
    if exists (select 1 from unnest(new.team_ids) u(id)
               where not exists (select 1 from public.workspace_teams t where t.workspace_id = v_ws and t.id = u.id)) then
      raise exception 'Alguno de los equipos ya no existe.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.sync_assignees() from public, anon, authenticated;
create or replace trigger tasks_a_assignees
  before insert or update on public.tasks
  for each row execute function private.sync_assignees();

-- Nombres de los responsables (personas y equipos) para el historial y los textos.
create or replace function private.assignee_names(p_users uuid[], p_teams uuid[])
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(concat_ws(', ',
    (select string_agg(coalesce(nullif(btrim(p.full_name), ''), p.email), ', ' order by u.o)
       from unnest(coalesce(p_users, '{}')) with ordinality u(id, o) join public.profiles p on p.id = u.id),
    (select string_agg('equipo ' || t.name, ', ' order by u.o)
       from unnest(coalesce(p_teams, '{}')) with ordinality u(id, o) join public.workspace_teams t on t.id = u.id)
  ), '');
$$;
revoke all on function private.assignee_names(uuid[], uuid[]) from public, anon, authenticated;

-- Aviso a quien se suma como responsable (o a los integrantes del equipo que se suma).
create or replace function private.notify_assignees()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
-- SECURITY DEFINER: notifications solo la escribe el sistema.
declare
  v_actor uuid := (select auth.uid());
  v_ws    uuid;
  v_board text;
begin
  if tg_op = 'INSERT' and coalesce(current_setting('vetta.automation', true), '') <> '' then
    return null; -- copias y altas hechas por reglas: no se avisa de nuevo
  end if;
  select b.workspace_id, b.name into v_ws, v_board from public.boards b where b.id = new.board_id;
  insert into public.notifications (user_id, workspace_id, board_id, task_id, title, body)
  select x.user_id, v_ws, new.board_id, new.id, x.title, left(new.title, 200) || ' · ' || v_board
  from (
    select distinct on (user_id) user_id, title from (
      select u.id as user_id, 'Te asignaron un elemento' as title, 1 as pri
        from unnest(new.assignee_ids) u(id)
       where tg_op = 'INSERT' or not (u.id = any (old.assignee_ids))
      union all
      select tm.user_id, 'Asignaron un elemento a tu equipo «' || t.name || '»', 2
        from unnest(new.team_ids) x(id)
        join public.workspace_teams t on t.id = x.id
        join public.team_members tm on tm.team_id = t.id
       where tg_op = 'INSERT' or not (x.id = any (old.team_ids))
    ) a
    order by user_id, pri
  ) x
  where x.user_id is distinct from v_actor
    and private.user_can_access_board(x.user_id, new.board_id);
  return null;
end;
$$;
revoke all on function private.notify_assignees() from public, anon, authenticated;
create or replace trigger tasks_e_notify_assignees
  after insert or update of assignee_ids, team_ids on public.tasks
  for each row execute function private.notify_assignees();

-- -----------------------------------------------------------------------------
-- 3. Permisos por tablero
-- -----------------------------------------------------------------------------
alter table public.board_members add column if not exists role text not null default 'editor';
alter table public.board_members drop constraint if exists board_members_role_check;
alter table public.board_members add constraint board_members_role_check check (role in ('admin', 'editor', 'own', 'commenter', 'viewer'));

alter table public.boards add column if not exists default_role text not null default 'editor';
alter table public.boards drop constraint if exists boards_default_role_check;
alter table public.boards add constraint boards_default_role_check check (default_role in ('editor', 'own', 'commenter', 'viewer'));

create table if not exists public.board_teams (
  board_id   uuid not null references public.boards (id) on delete cascade,
  team_id    uuid not null references public.workspace_teams (id) on delete cascade,
  role       text not null default 'editor' check (role in ('admin', 'editor', 'own', 'commenter', 'viewer')),
  granted_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (board_id, team_id)
);
create index if not exists board_teams_team_idx on public.board_teams (team_id);
create index if not exists board_teams_granted_by_idx on public.board_teams (granted_by);

-- El equipo tiene que ser de la empresa del tablero.
create or replace function private.check_board_team()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.boards b join public.workspace_teams t on t.workspace_id = b.workspace_id
                 where b.id = new.board_id and t.id = new.team_id) then
    raise exception 'El equipo tiene que ser de la empresa del tablero.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.check_board_team() from public, anon, authenticated;
create or replace trigger board_teams_check
  before insert or update on public.board_teams
  for each row execute function private.check_board_team();

create or replace function private.role_rank(p text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case p when 'admin' then 5 when 'editor' then 4 when 'own' then 3 when 'commenter' then 2 when 'viewer' then 1 else 0 end;
$$;

-- Acceso directo o por equipo a un tablero.
create or replace function private.has_board_grant(p_board_id uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.board_members bm where bm.board_id = p_board_id and bm.user_id = p_user)
      or exists (select 1 from public.board_teams bt join public.team_members tm on tm.team_id = bt.team_id
                 where bt.board_id = p_board_id and tm.user_id = p_user);
$$;

-- Rol efectivo de una persona en un tablero (null = sin acceso).
create or replace function private.board_role_of(p_user uuid, p_board uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
-- SECURITY DEFINER: lee permisos de tableros y equipos para resolver el rol.
-- No se expone a la API (solo lo usan las políticas y los triggers).
declare
  b      public.boards%rowtype;
  v_role public.workspace_role;
  v_best text;
begin
  select * into b from public.boards where id = p_board;
  if b.id is null then
    return null;
  end if;
  select m.role into v_role from public.workspace_members m where m.workspace_id = b.workspace_id and m.user_id = p_user;
  if v_role is null then
    return null;
  end if;
  if v_role in ('owner', 'admin') or b.created_by = p_user then
    return 'admin';
  end if;
  select r into v_best from (
    select bm.role r from public.board_members bm where bm.board_id = p_board and bm.user_id = p_user
    union all
    select bt.role from public.board_teams bt join public.team_members tm on tm.team_id = bt.team_id and tm.user_id = p_user
     where bt.board_id = p_board
  ) g order by private.role_rank(r) desc limit 1;
  if v_best is not null then
    return v_best;
  end if;
  if b.visibility = 'workspace' then
    return b.default_role;
  end if;
  return null;
end;
$$;
revoke all on function private.board_role_of(uuid, uuid) from public, anon, authenticated;

-- Rol de quien está conectado.
create or replace function private.my_board_role(p_board uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not private.account_active() then null
    when private.is_platform_admin() then case when exists (select 1 from public.boards b where b.id = p_board) then 'admin' end
    else private.board_role_of((select auth.uid()), p_board)
  end;
$$;
revoke all on function private.my_board_role(uuid) from public, anon;
grant execute on function private.my_board_role(uuid) to authenticated;

create or replace function private.can_manage_board(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.my_board_role(p_board_id) = 'admin', false);
$$;

create or replace function private.can_write_board(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.role_rank(private.my_board_role(p_board_id)) >= 3;
$$;
revoke all on function private.can_write_board(uuid) from public, anon;
grant execute on function private.can_write_board(uuid) to authenticated;

create or replace function private.can_comment_board(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.role_rank(private.my_board_role(p_board_id)) >= 2;
$$;
revoke all on function private.can_comment_board(uuid) from public, anon;
grant execute on function private.can_comment_board(uuid) to authenticated;

-- Para la app: mi rol en un tablero (solo el de quien pregunta).
create or replace function public.my_board_role(p_board uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select private.my_board_role(p_board);
$$;
revoke all on function public.my_board_role(uuid) from public, anon;
grant execute on function public.my_board_role(uuid) to authenticated;

alter table public.board_teams enable row level security;
revoke all on public.board_teams from anon;
grant select, insert, update, delete on public.board_teams to authenticated;
grant update (role) on public.board_members to authenticated;

do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'board_teams' and policyname = 'board_teams_select') then
    create policy "board_teams_select" on public.board_teams for select to authenticated using (private.can_access_board(board_id));
    create policy "board_teams_insert" on public.board_teams for insert to authenticated with check (private.can_manage_board(board_id));
    create policy "board_teams_update" on public.board_teams for update to authenticated
      using (private.can_manage_board(board_id)) with check (private.can_manage_board(board_id));
    create policy "board_teams_delete" on public.board_teams for delete to authenticated using (private.can_manage_board(board_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'board_members' and policyname = 'board_members_update') then
    create policy "board_members_update" on public.board_members for update to authenticated
      using (private.can_manage_board(board_id)) with check (private.can_manage_board(board_id));
  end if;
end $do$;

-- Un administrador del tablero (por permiso) también puede editar su configuración.
drop policy if exists "boards_update" on public.boards;
create policy "boards_update" on public.boards for update to authenticated
  using (private.can_manage_board(id))
  with check (private.is_workspace_member(workspace_id) and private.can_manage_board(id));

-- Carpetas: las crean y editan quienes pueden editar el tablero.
alter table public.board_groups add column if not exists editors jsonb not null default '{}'::jsonb;
alter table public.board_groups drop constraint if exists board_groups_editors_shape;
alter table public.board_groups add constraint board_groups_editors_shape
  check (jsonb_typeof(editors) = 'object' and pg_column_size(editors) < 16384);

drop policy if exists "groups_insert" on public.board_groups;
drop policy if exists "groups_update" on public.board_groups;
drop policy if exists "groups_delete" on public.board_groups;
create policy "groups_insert" on public.board_groups for insert to authenticated with check (private.can_write_board(board_id));
create policy "groups_update" on public.board_groups for update to authenticated
  using (private.can_write_board(board_id)) with check (private.can_write_board(board_id));
create policy "groups_delete" on public.board_groups for delete to authenticated using (private.can_write_board(board_id));

-- Quién edita cada carpeta lo decide solo quien administra el tablero.
create or replace function private.guard_group_editors()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' and new.editors <> '{}'::jsonb) or (tg_op = 'UPDATE' and new.editors is distinct from old.editors) then
    if (select auth.uid()) is not null and not private.can_manage_board(new.board_id) then
      raise exception 'Solo quien administra el tablero decide quién edita cada carpeta.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_group_editors() from public, anon, authenticated;
create or replace trigger board_groups_guard_editors
  before insert or update on public.board_groups
  for each row execute function private.guard_group_editors();

-- Actualizaciones: hace falta poder comentar (comentarista o más).
drop policy if exists "comments_insert" on public.task_comments;
create policy "comments_insert" on public.task_comments for insert to authenticated
  with check (exists (select 1 from public.tasks t where t.id = task_comments.task_id and private.can_comment_board(t.board_id)));

-- -----------------------------------------------------------------------------
-- 4. Control de edición de elementos
-- -----------------------------------------------------------------------------
-- ¿La persona (o uno de sus equipos) está en la lista {users:[…], teams:[…]}?
create or replace function private.in_editors(p_editors jsonb, p_user uuid, p_teams uuid[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_editors -> 'users', '[]'::jsonb) ? p_user::text
      or exists (select 1 from jsonb_array_elements_text(coalesce(p_editors -> 'teams', '[]'::jsonb)) t(id) where t.id = any (p_teams::text[]));
$$;

create or replace function private.restricted(p_editors jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_editors) = 'object'
     and (jsonb_array_length(case when jsonb_typeof(p_editors -> 'users') = 'array' then p_editors -> 'users' else '[]'::jsonb end)
        + jsonb_array_length(case when jsonb_typeof(p_editors -> 'teams') = 'array' then p_editors -> 'teams' else '[]'::jsonb end)) > 0;
$$;

-- Sección (encabezado anterior) de cada paso de un checklist.
create or replace function private.checklist_sections(p_list jsonb)
returns table (step_id text, step jsonb, section text)
language sql
immutable
set search_path = ''
as $$
  select x.e ->> 'id', x.e,
         (select h.e ->> 'text'
            from jsonb_array_elements(p_list) with ordinality h(e, o)
           where coalesce((h.e ->> 'header')::boolean, false) and h.o <= x.o
           order by h.o desc limit 1)
  from jsonb_array_elements(case when jsonb_typeof(p_list) = 'array' then p_list else '[]'::jsonb end) with ordinality x(e, o);
$$;

create or replace function private.guard_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
-- SECURITY DEFINER: lee permisos, equipos y restricciones del tablero (que la
-- persona no siempre puede leer) para decidir si el cambio está permitido.
declare
  v_uid    uuid := (select auth.uid());
  v_row    public.tasks%rowtype;
  v_board  uuid;
  v_role   text;
  v_teams  uuid[];
  v_group  public.board_groups%rowtype;
  v_bset   jsonb;
  v_name   text;
  c        record;
  v_label  text;
begin
  -- Sistema, reglas automáticas, cambios en cascada y superadministrador: sin control.
  if v_uid is null or pg_trigger_depth() > 1
     or coalesce(current_setting('vetta.automation', true), '') <> ''
     or private.is_platform_admin() then
    return coalesce(new, old);
  end if;

  v_row := case when tg_op = 'DELETE' then old else new end;
  v_board := case when tg_op = 'INSERT' then new.board_id else old.board_id end;
  v_role := private.board_role_of(v_uid, v_board);

  if tg_op = 'UPDATE' and new.board_id is distinct from old.board_id
     and private.role_rank(private.board_role_of(v_uid, new.board_id)) < 3 then
    raise exception 'No tenés permiso para pasar elementos a ese tablero.' using errcode = '42501';
  end if;
  if private.role_rank(v_role) < 3 then
    raise exception '%', case when v_role = 'commenter' then 'En este tablero solo podés escribir actualizaciones.'
                              else 'Tenés acceso de solo lectura a este tablero.' end
      using errcode = '42501';
  end if;
  if v_role = 'admin' then
    return coalesce(new, old);
  end if;

  select coalesce(array_agg(tm.team_id), '{}') into v_teams from public.team_members tm where tm.user_id = v_uid;

  -- Solo lo suyo: elementos donde es responsable (o su equipo) o que creó.
  if v_role = 'own' and tg_op <> 'INSERT' then
    if not (v_uid = any (old.assignee_ids) or old.team_ids && v_teams or old.created_by = v_uid
            or exists (select 1 from public.tasks p where p.id = old.parent_id
                       and (v_uid = any (p.assignee_ids) or p.team_ids && v_teams or p.created_by = v_uid))) then
      raise exception 'Solo podés editar los elementos donde sos responsable (vos o tu equipo).' using errcode = '42501';
    end if;
  end if;

  -- Carpeta restringida.
  select * into v_group from public.board_groups g
   where g.id = case when tg_op = 'INSERT' then new.group_id else old.group_id end;
  if v_group.id is not null and private.restricted(v_group.editors) and not private.in_editors(v_group.editors, v_uid, v_teams) then
    raise exception 'Los elementos de la carpeta «%» solo los editan las personas o equipos asignados a ella.', v_group.name
      using errcode = '42501';
  end if;

  if tg_op <> 'UPDATE' then
    return coalesce(new, old);
  end if;

  -- Columnas fijas restringidas.
  select b.settings -> 'columns' into v_bset from public.boards b where b.id = old.board_id;
  for v_name, v_label in
    select k, l from (values
      ('title', 'Elemento', new.title is distinct from old.title),
      ('status', 'Estado', new.status_id is distinct from old.status_id),
      ('priority', 'Prioridad', new.priority is distinct from old.priority),
      ('due', 'Vencimiento', new.due_date is distinct from old.due_date),
      ('assignee', 'Responsable', new.assignee_ids is distinct from old.assignee_ids or new.team_ids is distinct from old.team_ids)
    ) v(k, l, changed) where changed
  loop
    if private.restricted(v_bset -> v_name -> 'editors') and not private.in_editors(v_bset -> v_name -> 'editors', v_uid, v_teams) then
      raise exception 'La columna «%» solo la cambian las personas o equipos asignados a ella.',
        coalesce(nullif(v_bset -> v_name ->> 'label', ''), v_label) using errcode = '42501';
    end if;
  end loop;

  if new.custom_values is not distinct from old.custom_values then
    return new;
  end if;

  -- Columnas propias restringidas y secciones de checklist por carpeta.
  for c in
    select bc.id::text as id, bc.name, bc.kind, bc.settings -> 'editors' as editors
    from public.board_columns bc
    where bc.board_id = old.board_id
      and (new.custom_values -> bc.id::text) is distinct from (old.custom_values -> bc.id::text)
  loop
    if private.restricted(c.editors) and not private.in_editors(c.editors, v_uid, v_teams) then
      raise exception 'La columna «%» solo la cambian las personas o equipos asignados a ella.', c.name using errcode = '42501';
    end if;
    if c.kind = 'checklist' then
      select g.name into v_name
      from (
        select coalesce(n.section, o.section) as section
        from private.checklist_sections(new.custom_values -> c.id) n
        full join private.checklist_sections(old.custom_values -> c.id) o on o.step_id = n.step_id
        where n.step is distinct from o.step
      ) ch
      join public.board_groups g on g.board_id = old.board_id and lower(btrim(g.name)) = lower(btrim(ch.section))
      where private.restricted(g.editors) and not private.in_editors(g.editors, v_uid, v_teams)
      limit 1;
      if v_name is not null then
        raise exception 'Los pasos de «%» solo los marca el equipo de esa carpeta.', v_name using errcode = '42501';
      end if;
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function private.guard_task() from public, anon, authenticated;
create or replace trigger tasks_0_guard
  before insert or update or delete on public.tasks
  for each row execute function private.guard_task();

-- -----------------------------------------------------------------------------
-- 5. Reglas: responsables múltiples y equipos
-- -----------------------------------------------------------------------------
-- {responsable} = todos los responsables (personas y equipos).
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
      '{responsable}', coalesce(private.assignee_names(t.assignee_ids, t.team_ids), 'sin responsable')),
      '{hoy}', to_char(private.local_today(), 'DD/MM/YYYY')),
    2000)
  from (select 1) one
  left join public.tasks t on t.id = p_task
  left join public.boards b on b.id = t.board_id
  left join public.board_groups g on g.id = t.group_id
  left join public.board_statuses s on s.id = t.status_id;
$$;

-- Condición "responsable es …": persona o equipo entre los responsables.
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
  if f = 'assignee' then
    return case op
             when 'is' then v = any (t.assignee_ids::text[]) or v = any (t.team_ids::text[])
             when 'is_not' then not (coalesce(v = any (t.assignee_ids::text[]), false) or coalesce(v = any (t.team_ids::text[]), false))
             when 'empty' then cardinality(t.assignee_ids) = 0 and cardinality(t.team_ids) = 0
             when 'not_empty' then cardinality(t.assignee_ids) > 0 or cardinality(t.team_ids) > 0
             else false
           end;
  elsif f in ('status', 'group', 'priority') then
    cur := case f
             when 'status' then t.status_id::text
             when 'group' then t.group_id::text
             else t.priority::text
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

-- Aviso "al responsable" = a todos los responsables y a los integrantes de sus equipos.
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
    select x.id from unnest(coalesce(t.assignee_ids, '{}')) x(id) where cfg ->> 'to' = 'assignee'
    union select tm.user_id from public.team_members tm where cfg ->> 'to' = 'assignee' and tm.team_id = any (coalesce(t.team_ids, '{}'))
    union select t.created_by where cfg ->> 'to' = 'creator'
    union select (cfg ->> 'user_id')::uuid where cfg ->> 'to' = 'user'
    union select tm.user_id from public.team_members tm where cfg ->> 'to' = 'team' and tm.team_id::text = cfg ->> 'team_id'
    union select m.user_id from public.workspace_members m
          where cfg ->> 'to' = 'admins' and m.workspace_id = r.workspace_id and m.role in ('owner', 'admin')
  ) u
  where u.id is not null and private.user_can_access_board(u.id, v_board);
end;
$$;

-- Borrar una carpeta restringida: solo quien la edita o administra el tablero.
create or replace function private.guard_group_editors()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_teams uuid[];
begin
  if (select auth.uid()) is null then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if private.restricted(old.editors) and not private.can_manage_board(old.board_id) then
      select coalesce(array_agg(tm.team_id), '{}') into v_teams from public.team_members tm where tm.user_id = (select auth.uid());
      if not private.in_editors(old.editors, (select auth.uid()), v_teams) then
        raise exception 'La carpeta «%» solo la pueden borrar las personas o equipos asignados a ella.', old.name using errcode = '42501';
      end if;
    end if;
    return old;
  end if;
  if (tg_op = 'INSERT' and new.editors <> '{}'::jsonb) or (tg_op = 'UPDATE' and new.editors is distinct from old.editors) then
    if not private.can_manage_board(new.board_id) then
      raise exception 'Solo quien administra el tablero decide quién edita cada carpeta.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_group_editors() from public, anon, authenticated;
create or replace trigger board_groups_guard_editors
  before insert or update or delete on public.board_groups
  for each row execute function private.guard_group_editors();

-- Historial: el cambio de responsables muestra personas y equipos.
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
      if new.assignee_ids is distinct from old.assignee_ids or new.team_ids is distinct from old.team_ids then
        v_rows := v_rows || jsonb_build_object('kind', 'assignee_changed', 'detail', jsonb_build_object(
          'from', private.assignee_names(old.assignee_ids, old.team_ids),
          'to', private.assignee_names(new.assignee_ids, new.team_ids)));
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

-- Regla "asignar": también a un equipo.
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
      if cfg ->> 'mode' = 'team' then
        -- El elemento pasa a ser del equipo (reemplaza a los responsables anteriores).
        update public.tasks set team_ids = array[(cfg ->> 'team_id')::uuid], assignee_ids = '{}'
         where id = p_task and board_id = r.board_id
           and (team_ids is distinct from array[(cfg ->> 'team_id')::uuid] or cardinality(assignee_ids) > 0);
        return;
      end if;
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
