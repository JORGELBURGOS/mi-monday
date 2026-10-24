-- =============================================================================
-- Vetta · esquema inicial
-- -----------------------------------------------------------------------------
-- Idempotente: se puede ejecutar más de una vez sin borrar datos.
-- No contiene sentencias DROP ni modifica datos existentes: usa
-- CREATE OR REPLACE y crea las políticas solo si todavía no existen.
-- =============================================================================

-- Esquema privado para funciones auxiliares de seguridad.
-- No está expuesto por la API REST de Supabase.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.workspace_role as enum ('owner', 'admin', 'member');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.board_visibility as enum ('workspace', 'private');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_priority as enum ('low', 'medium', 'high', 'urgent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.invitation_status as enum ('pending', 'accepted', 'revoked', 'declined');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- updated_at automático
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Tablas
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text check (full_name is null or char_length(full_name) <= 120),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role         public.workspace_role not null default 'member',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.workspace_invitations (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  workspace_name text not null default '',
  email          text not null check (
                   email = lower(btrim(email))
                   and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
                   and char_length(email) <= 254
                 ),
  role           public.workspace_role not null default 'member' check (role <> 'owner'),
  status         public.invitation_status not null default 'pending',
  invited_by     uuid default auth.uid() references public.profiles (id) on delete set null,
  expires_at     timestamptz not null default (now() + interval '14 days'),
  responded_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.boards (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 80),
  description  text check (description is null or char_length(description) <= 1000),
  visibility   public.board_visibility not null default 'workspace',
  is_archived  boolean not null default false,
  archived_at  timestamptz,
  created_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.board_statuses (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references public.boards (id) on delete cascade,
  label      text not null check (char_length(btrim(label)) between 1 and 40),
  color      text not null default 'gray' check (
               color in ('gray', 'amber', 'blue', 'green', 'red', 'violet', 'teal', 'pink', 'orange')
             ),
  position   integer not null default 0,
  is_done    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, board_id)
);

create table if not exists public.board_groups (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references public.boards (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 80),
  color      text not null default 'blue' check (
               color in ('gray', 'amber', 'blue', 'green', 'red', 'violet', 'teal', 'pink', 'orange')
             ),
  position   double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, board_id)
);

create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.boards (id) on delete cascade,
  group_id    uuid not null,
  status_id   uuid,
  title       text not null check (char_length(btrim(title)) between 1 and 500),
  description text check (description is null or char_length(description) <= 10000),
  priority    public.task_priority not null default 'medium',
  assignee_id uuid references public.profiles (id) on delete set null,
  due_date    date,
  position    double precision not null default 0,
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- El grupo y el estado deben pertenecer al mismo tablero que la tarea.
  constraint tasks_group_same_board foreign key (group_id, board_id)
    references public.board_groups (id, board_id) on delete cascade,
  constraint tasks_status_same_board foreign key (status_id, board_id)
    references public.board_statuses (id, board_id) on delete set null (status_id)
);

create table if not exists public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks (id) on delete cascade,
  author_id  uuid default auth.uid() references public.profiles (id) on delete set null,
  body       text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Índices
-- -----------------------------------------------------------------------------
create index if not exists workspaces_created_by_idx       on public.workspaces (created_by);
create index if not exists workspace_members_user_idx      on public.workspace_members (user_id);
create index if not exists workspace_invitations_ws_idx    on public.workspace_invitations (workspace_id);
create index if not exists workspace_invitations_email_idx on public.workspace_invitations (email) where status = 'pending';
create index if not exists workspace_invitations_by_idx    on public.workspace_invitations (invited_by);
create unique index if not exists workspace_invitations_one_pending
  on public.workspace_invitations (workspace_id, email) where status = 'pending';
create index if not exists boards_workspace_idx            on public.boards (workspace_id);
create index if not exists boards_created_by_idx           on public.boards (created_by);
create index if not exists board_statuses_board_idx        on public.board_statuses (board_id, position);
create index if not exists board_groups_board_idx          on public.board_groups (board_id, position);
create index if not exists tasks_board_idx                 on public.tasks (board_id);
create index if not exists tasks_group_idx                 on public.tasks (group_id, board_id, position);
create index if not exists tasks_status_idx                on public.tasks (status_id, board_id);
create index if not exists tasks_assignee_idx              on public.tasks (assignee_id);
create index if not exists tasks_created_by_idx            on public.tasks (created_by);
create index if not exists tasks_due_date_idx              on public.tasks (board_id, due_date) where due_date is not null;
create index if not exists task_comments_task_idx          on public.task_comments (task_id, created_at);
create index if not exists task_comments_author_idx        on public.task_comments (author_id);

-- -----------------------------------------------------------------------------
-- Triggers updated_at
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profiles', 'workspaces', 'workspace_members', 'workspace_invitations',
                           'boards', 'board_statuses', 'board_groups', 'tasks', 'task_comments']
  loop
    execute format('create or replace trigger set_updated_at before update on public.%I
                    for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Funciones auxiliares de autorización (esquema private)
-- -----------------------------------------------------------------------------
-- Se usan SECURITY DEFINER a propósito: las políticas de workspace_members no
-- pueden consultar la propia tabla sin provocar recursión infinita de RLS.
-- Estas funciones solo devuelven un booleano sobre el usuario que llama
-- (auth.uid()), no exponen filas, fijan search_path = '' y viven en un esquema
-- que no está publicado por la API.

create or replace function private.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.has_workspace_role(p_workspace_id uuid, p_roles public.workspace_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

-- Un tablero es visible si el usuario es miembro del espacio y el tablero es
-- compartido, o es privado y lo creó él, o el usuario es propietario del espacio.
create or replace function private.can_access_board(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.boards b
    join public.workspace_members m
      on m.workspace_id = b.workspace_id
     and m.user_id = (select auth.uid())
    where b.id = p_board_id
      and (b.visibility = 'workspace' or b.created_by = (select auth.uid()) or m.role = 'owner')
  );
$$;

-- Administrar un tablero (renombrar, archivar, eliminar, configurar estados):
-- su creador, o un administrador/propietario que pueda verlo.
create or replace function private.can_manage_board(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.boards b
    join public.workspace_members m
      on m.workspace_id = b.workspace_id
     and m.user_id = (select auth.uid())
    where b.id = p_board_id
      and (b.visibility = 'workspace' or b.created_by = (select auth.uid()) or m.role = 'owner')
      and (b.created_by = (select auth.uid()) or m.role in ('owner', 'admin'))
  );
$$;

create or replace function private.shares_workspace(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members mine
    join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = p_user_id
  );
$$;

revoke all on function private.is_workspace_member(uuid) from public, anon;
revoke all on function private.has_workspace_role(uuid, public.workspace_role[]) from public, anon;
revoke all on function private.can_access_board(uuid) from public, anon;
revoke all on function private.can_manage_board(uuid) from public, anon;
revoke all on function private.shares_workspace(uuid) from public, anon;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.has_workspace_role(uuid, public.workspace_role[]) to authenticated;
grant execute on function private.can_access_board(uuid) to authenticated;
grant execute on function private.can_manage_board(uuid) to authenticated;
grant execute on function private.shares_workspace(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Perfiles automáticos para cada usuario de auth.users
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER necesario: se ejecuta desde el esquema auth, donde el rol que
-- registra al usuario no tiene permiso de escritura sobre public.profiles.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    lower(new.email),
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function private.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = lower(new.email) where id = new.id;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;
revoke all on function private.handle_user_email_change() from public, anon, authenticated;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();

-- Usuarios que ya existían antes de esta migración (no modifica perfiles existentes).
insert into public.profiles (id, email)
select u.id, lower(u.email) from auth.users u
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Espacios: el creador queda como propietario
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER necesario: no hay política de INSERT en workspace_members
-- (las membresías solo nacen así o aceptando una invitación). La función solo
-- inserta la fila del propio creador.
create or replace function private.add_workspace_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is not null then
    insert into public.workspace_members (workspace_id, user_id, role)
    values (new.id, new.created_by, 'owner')
    on conflict (workspace_id, user_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.add_workspace_owner() from public, anon, authenticated;

create or replace trigger add_workspace_owner
  after insert on public.workspaces
  for each row execute function private.add_workspace_owner();

-- Evita dejar un espacio sin propietario.
create or replace function public.protect_last_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner')
     and exists (select 1 from public.workspaces w where w.id = old.workspace_id)
     and not exists (
       select 1 from public.workspace_members m
       where m.workspace_id = old.workspace_id
         and m.role = 'owner'
         and m.user_id <> old.user_id
     )
  then
    raise exception 'Un espacio necesita al menos un propietario.'
      using errcode = 'P0001', hint = 'last_owner';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace trigger protect_last_owner
  before update of role or delete on public.workspace_members
  for each row execute function public.protect_last_owner();

-- Al quitar a alguien del espacio, se le desasignan las tareas de ese espacio.
-- SECURITY DEFINER necesario: quien quita al miembro puede no ver tableros
-- privados donde esa persona tenía tareas asignadas.
create or replace function private.clear_assignments_on_member_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tasks t
     set assignee_id = null
    from public.boards b
   where b.id = t.board_id
     and b.workspace_id = old.workspace_id
     and t.assignee_id = old.user_id;
  return old;
end;
$$;
revoke all on function private.clear_assignments_on_member_removal() from public, anon, authenticated;

create or replace trigger clear_assignments_on_member_removal
  after delete on public.workspace_members
  for each row execute function private.clear_assignments_on_member_removal();

-- -----------------------------------------------------------------------------
-- Invitaciones
-- -----------------------------------------------------------------------------
create or replace function public.prepare_invitation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.email := lower(btrim(new.email));
  if tg_op = 'INSERT' then
    new.invited_by := (select auth.uid());
    select w.name into new.workspace_name from public.workspaces w where w.id = new.workspace_id;
  else
    -- Campos inmutables después de crear la invitación.
    new.workspace_id := old.workspace_id;
    new.email := old.email;
    new.invited_by := old.invited_by;
    new.workspace_name := old.workspace_name;
  end if;
  return new;
end;
$$;

create or replace trigger prepare_invitation
  before insert or update on public.workspace_invitations
  for each row execute function public.prepare_invitation();

-- SECURITY DEFINER necesario: la persona invitada todavía no es miembro, así
-- que no puede insertar su membresía bajo RLS. La función valida que el email
-- confirmado de quien llama coincida con el de la invitación.
create or replace function public.respond_to_invitation(p_invitation_id uuid, p_accept boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_inv   public.workspace_invitations%rowtype;
begin
  if v_uid is null then
    raise exception 'Necesitás iniciar sesión.' using errcode = '28000';
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id = v_uid and u.email_confirmed_at is not null;

  if v_email is null then
    raise exception 'Confirmá tu email antes de responder invitaciones.' using errcode = 'P0001';
  end if;

  select * into v_inv
  from public.workspace_invitations i
  where i.id = p_invitation_id
  for update;

  if not found or v_inv.email <> v_email then
    raise exception 'La invitación no existe o no es para tu cuenta.' using errcode = 'P0001';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'Esta invitación ya fue respondida o revocada.' using errcode = 'P0001';
  end if;
  if v_inv.expires_at < now() then
    raise exception 'La invitación venció. Pedí una nueva.' using errcode = 'P0001';
  end if;

  if p_accept then
    insert into public.workspace_members (workspace_id, user_id, role)
    values (v_inv.workspace_id, v_uid, v_inv.role)
    on conflict (workspace_id, user_id) do nothing;
  end if;

  update public.workspace_invitations
     set status = case when p_accept then 'accepted'::public.invitation_status
                       else 'declined'::public.invitation_status end,
         responded_at = now()
   where id = p_invitation_id;

  return v_inv.workspace_id;
end;
$$;
revoke all on function public.respond_to_invitation(uuid, boolean) from public, anon;
grant execute on function public.respond_to_invitation(uuid, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- Tableros: valores iniciales e inmutabilidad del espacio
-- -----------------------------------------------------------------------------
create or replace function public.prepare_board()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
  else
    new.workspace_id := old.workspace_id;
    new.created_by := old.created_by;
  end if;
  if new.is_archived and (tg_op = 'INSERT' or not old.is_archived) then
    new.archived_at := now();
  elsif not new.is_archived then
    new.archived_at := null;
  end if;
  return new;
end;
$$;

create or replace trigger prepare_board
  before insert or update on public.boards
  for each row execute function public.prepare_board();

create or replace function public.seed_board_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.board_statuses (board_id, label, color, position, is_done) values
    (new.id, 'Pendiente',   'gray',  0, false),
    (new.id, 'En progreso', 'amber', 1, false),
    (new.id, 'En revisión', 'blue',  2, false),
    (new.id, 'Hecho',       'green', 3, true);
  insert into public.board_groups (board_id, name, color, position)
  values (new.id, 'Tareas', 'blue', 1000);
  return new;
end;
$$;

create or replace trigger seed_board_defaults
  after insert on public.boards
  for each row execute function public.seed_board_defaults();

-- Tareas, grupos y estados no cambian de tablero; el responsable debe ser
-- miembro del espacio.
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
    new.board_id := old.board_id;
    new.created_by := old.created_by;
  end if;

  if new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
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

create or replace trigger prepare_task
  before insert or update on public.tasks
  for each row execute function public.prepare_task();

create or replace function public.keep_board_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.board_id := old.board_id;
  return new;
end;
$$;

create or replace trigger keep_board_id before update on public.board_groups
  for each row execute function public.keep_board_id();

create or replace trigger keep_board_id before update on public.board_statuses
  for each row execute function public.keep_board_id();

create or replace function public.prepare_comment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.author_id := (select auth.uid());
  else
    new.task_id := old.task_id;
    new.author_id := old.author_id;
  end if;
  return new;
end;
$$;

create or replace trigger prepare_comment
  before insert or update on public.task_comments
  for each row execute function public.prepare_comment();

-- -----------------------------------------------------------------------------
-- Vista de resumen (respeta RLS por security_invoker)
-- -----------------------------------------------------------------------------
create or replace view public.board_overview
with (security_invoker = true)
as
select
  b.id,
  b.workspace_id,
  b.name,
  b.description,
  b.visibility,
  b.is_archived,
  b.created_by,
  b.created_at,
  b.updated_at,
  greatest(b.updated_at, coalesce(max(t.updated_at), b.updated_at)) as last_activity_at,
  count(t.id)::int as task_count,
  (count(t.id) filter (where s.is_done))::int as done_count
from public.boards b
left join public.tasks t on t.board_id = b.id
left join public.board_statuses s on s.id = t.status_id
group by b.id;

-- -----------------------------------------------------------------------------
-- Permisos de tabla: solo usuarios autenticados
-- -----------------------------------------------------------------------------
revoke all on public.profiles, public.workspaces, public.workspace_members,
  public.workspace_invitations, public.boards, public.board_statuses,
  public.board_groups, public.tasks, public.task_comments, public.board_overview
  from anon;

grant select, insert, update, delete on public.profiles, public.workspaces,
  public.workspace_members, public.workspace_invitations, public.boards,
  public.board_statuses, public.board_groups, public.tasks, public.task_comments
  to authenticated;
grant select on public.board_overview to authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.profiles              enable row level security;
alter table public.workspaces            enable row level security;
alter table public.workspace_members     enable row level security;
alter table public.workspace_invitations enable row level security;
alter table public.boards                enable row level security;
alter table public.board_statuses        enable row level security;
alter table public.board_groups          enable row level security;
alter table public.tasks                 enable row level security;
alter table public.task_comments         enable row level security;

-- profiles ---------------------------------------------------------------------
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select') then
    create policy "profiles_select" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.shares_workspace(id));
  end if;
end $do$;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_update_self') then
    create policy "profiles_update_self" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
  end if;
end $do$;

-- workspaces -------------------------------------------------------------------
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workspaces' and policyname = 'workspaces_select') then
    create policy "workspaces_select" on public.workspaces
  for select to authenticated
  using (private.is_workspace_member(id) or created_by = (select auth.uid()));
  end if;
end $do$;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workspaces' and policyname = 'workspaces_insert') then
    create policy "workspaces_insert" on public.workspaces
  for insert to authenticated
  with check (created_by = (select auth.uid()));
  end if;
end $do$;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workspaces' and policyname = 'workspaces_update') then
    create policy "workspaces_update" on public.workspaces
  for update to authenticated
  using (private.has_workspace_role(id, array['owner', 'admin']::public.workspace_role[]))
  with check (private.has_workspace_role(id, array['owner', 'admin']::public.workspace_role[]));
  end if;
end $do$;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workspaces' and policyname = 'workspaces_delete') then
    create policy "workspaces_delete" on public.workspaces
  for delete to authenticated
  using (private.has_workspace_role(id, array['owner']::public.workspace_role[]));
  end if;
end $do$;

-- workspace_members ------------------------------------------------------------
-- Sin política INSERT: las membresías se crean al crear el espacio o al aceptar
-- una invitación (funciones validadas más arriba).
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workspace_members' and policyname = 'members_select') then
    create policy "members_select" on public.workspace_members
  for select to authenticated
  using (private.is_workspace_member(workspace_id));
  end if;
end $do$;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workspace_members' and policyname = 'members_update') then
    create policy "members_update" on public.workspace_members
  for update to authenticated
  using (
    private.has_workspace_role(workspace_id, array['owner']::public.workspace_role[])
    or (private.has_workspace_role(workspace_id, array['admin']::public.workspace_role[]) and role <> 'owner')
  )
  with check (
    private.has_workspace_role(workspace_id, array['owner']::public.workspace_role[])
    or (private.has_workspace_role(workspace_id, array['admin']::public.workspace_role[]) and role <> 'owner')
  );
  end if;
end $do$;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workspace_members' and policyname = 'members_delete') then
    create policy "members_delete" on public.workspace_members
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    or private.has_workspace_role(workspace_id, array['owner']::public.workspace_role[])
    or (private.has_workspace_role(workspace_id, array['admin']::public.workspace_role[]) and role = 'member')
  );
  end if;
end $do$;

-- workspace_invitations --------------------------------------------------------
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workspace_invitations' and policyname = 'invitations_select') then
    create policy "invitations_select" on public.workspace_invitations
  for select to authenticated
  using (
    private.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
    or (status = 'pending' and email = lower((select auth.jwt()) ->> 'email'))
  );
  end if;
end $do$;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workspace_invitations' and policyname = 'invitations_insert') then
    create policy "invitations_insert" on public.workspace_invitations
  for insert to authenticated
  with check (
    private.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
    and status = 'pending'
    and (role <> 'admin' or private.has_workspace_role(workspace_id, array['owner']::public.workspace_role[]))
  );
  end if;
end $do$;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workspace_invitations' and policyname = 'invitations_update') then
    create policy "invitations_update" on public.workspace_invitations
  for update to authenticated
  using (private.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]))
  with check (
    private.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
    and (role <> 'admin' or private.has_workspace_role(workspace_id, array['owner']::public.workspace_role[]))
  );
  end if;
end $do$;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workspace_invitations' and policyname = 'invitations_delete') then
    create policy "invitations_delete" on public.workspace_invitations
  for delete to authenticated
  using (private.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));
  end if;
end $do$;

-- boards -----------------------------------------------------------------------
-- Las condiciones usan las columnas de la fila (no can_access_board) para que
-- INSERT ... RETURNING funcione sobre la fila recién creada.
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'boards' and policyname = 'boards_select') then
    create policy "boards_select" on public.boards
  for select to authenticated
  using (
    private.is_workspace_member(workspace_id)
    and (
      visibility = 'workspace'
      or created_by = (select auth.uid())
      or private.has_workspace_role(workspace_id, array['owner']::public.workspace_role[])
    )
  );
  end if;
end $do$;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'boards' and policyname = 'boards_insert') then
    create policy "boards_insert" on public.boards
  for insert to authenticated
  with check (private.is_workspace_member(workspace_id));
  end if;
end $do$;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'boards' and policyname = 'boards_update') then
    create policy "boards_update" on public.boards
  for update to authenticated
  using (private.can_manage_board(id))
  with check (
    private.is_workspace_member(workspace_id)
    and (
      created_by = (select auth.uid())
      or private.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
    )
  );
  end if;
end $do$;

-- Solo se puede eliminar un tablero archivado (protección contra borrados accidentales).
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'boards' and policyname = 'boards_delete') then
    create policy "boards_delete" on public.boards
  for delete to authenticated
  using (is_archived and private.can_manage_board(id));
  end if;
end $do$;

-- board_statuses ---------------------------------------------------------------
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'board_statuses' and policyname = 'statuses_select') then
    create policy "statuses_select" on public.board_statuses
  for select to authenticated using (private.can_access_board(board_id));
  end if;
end $do$;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'board_statuses' and policyname = 'statuses_insert') then
    create policy "statuses_insert" on public.board_statuses
  for insert to authenticated with check (private.can_manage_board(board_id));
  end if;
end $do$;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'board_statuses' and policyname = 'statuses_update') then
    create policy "statuses_update" on public.board_statuses
  for update to authenticated
  using (private.can_manage_board(board_id))
  with check (private.can_manage_board(board_id));
  end if;
end $do$;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'board_statuses' and policyname = 'statuses_delete') then
    create policy "statuses_delete" on public.board_statuses
  for delete to authenticated using (private.can_manage_board(board_id));
  end if;
end $do$;

-- board_groups -----------------------------------------------------------------
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'board_groups' and policyname = 'groups_select') then
    create policy "groups_select" on public.board_groups
  for select to authenticated using (private.can_access_board(board_id));
  end if;
end $do$;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'board_groups' and policyname = 'groups_insert') then
    create policy "groups_insert" on public.board_groups
  for insert to authenticated with check (private.can_access_board(board_id));
  end if;
end $do$;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'board_groups' and policyname = 'groups_update') then
    create policy "groups_update" on public.board_groups
  for update to authenticated
  using (private.can_access_board(board_id))
  with check (private.can_access_board(board_id));
  end if;
end $do$;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'board_groups' and policyname = 'groups_delete') then
    create policy "groups_delete" on public.board_groups
  for delete to authenticated using (private.can_access_board(board_id));
  end if;
end $do$;

-- tasks ------------------------------------------------------------------------
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tasks' and policyname = 'tasks_select') then
    create policy "tasks_select" on public.tasks
  for select to authenticated using (private.can_access_board(board_id));
  end if;
end $do$;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tasks' and policyname = 'tasks_insert') then
    create policy "tasks_insert" on public.tasks
  for insert to authenticated with check (private.can_access_board(board_id));
  end if;
end $do$;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tasks' and policyname = 'tasks_update') then
    create policy "tasks_update" on public.tasks
  for update to authenticated
  using (private.can_access_board(board_id))
  with check (private.can_access_board(board_id));
  end if;
end $do$;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tasks' and policyname = 'tasks_delete') then
    create policy "tasks_delete" on public.tasks
  for delete to authenticated using (private.can_access_board(board_id));
  end if;
end $do$;

-- task_comments ----------------------------------------------------------------
-- La subconsulta sobre tasks aplica el RLS de tasks: solo se ven comentarios de
-- tareas a las que el usuario tiene acceso.
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'task_comments' and policyname = 'comments_select') then
    create policy "comments_select" on public.task_comments
  for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));
  end if;
end $do$;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'task_comments' and policyname = 'comments_insert') then
    create policy "comments_insert" on public.task_comments
  for insert to authenticated
  with check (exists (select 1 from public.tasks t where t.id = task_id));
  end if;
end $do$;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'task_comments' and policyname = 'comments_update') then
    create policy "comments_update" on public.task_comments
  for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));
  end if;
end $do$;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'task_comments' and policyname = 'comments_delete') then
    create policy "comments_delete" on public.task_comments
  for delete to authenticated
  using (
    author_id = (select auth.uid())
    or exists (
      select 1 from public.tasks t
      where t.id = task_id and private.can_manage_board(t.board_id)
    )
  );
  end if;
end $do$;
