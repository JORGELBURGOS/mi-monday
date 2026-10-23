-- =============================================================================
-- Vetta · acceso por tablero, superadministrador y empresas
-- -----------------------------------------------------------------------------
--   * board_members: a qué tableros privados tiene acceso cada persona. Los
--     administradores de la empresa ven y administran todos los tableros.
--     Tableros "para todo el equipo" (visibility = 'workspace') siguen visibles
--     para todos los miembros.
--   * profiles.deactivated_at: una cuenta desactivada no puede leer ni
--     escribir nada (además se bloquea su inicio de sesión desde vetta-admin).
--   * Solo el superadministrador da de alta empresas.
--   * El superadministrador es jorgeleonburgos@gmail.com.
-- No elimina objetos ni datos.
-- =============================================================================

alter table public.profiles add column if not exists deactivated_at timestamptz;

-- Cuenta habilitada: sin cambio de contraseña pendiente y no desactivada.
create or replace function private.account_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select not p.must_change_password and p.deactivated_at is null
       from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_platform_admin and p.deactivated_at is null and not p.must_change_password
       from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;
revoke all on function private.is_platform_admin() from public, anon;
grant execute on function private.is_platform_admin() to authenticated;

-- -----------------------------------------------------------------------------
-- Acceso a tableros
-- -----------------------------------------------------------------------------
create table if not exists public.board_members (
  board_id   uuid not null references public.boards (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  granted_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (board_id, user_id)
);
create index if not exists board_members_user_idx on public.board_members (user_id);
create index if not exists board_members_granted_by_idx on public.board_members (granted_by);

-- Solo se da acceso a miembros de la misma empresa.
create or replace function public.prepare_board_member()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.granted_by := (select auth.uid());
  if not exists (
    select 1
    from public.boards b
    join public.workspace_members m on m.workspace_id = b.workspace_id and m.user_id = new.user_id
    where b.id = new.board_id
  ) then
    raise exception 'La persona tiene que ser miembro de la empresa.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace trigger prepare_board_member
  before insert on public.board_members
  for each row execute function public.prepare_board_member();

-- ¿La persona tiene acceso explícito a un tablero? (SECURITY DEFINER para no
-- depender de las políticas de board_members dentro de otras políticas.)
create or replace function private.has_board_grant(p_board_id uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.board_members bm where bm.board_id = p_board_id and bm.user_id = p_user);
$$;
revoke all on function private.has_board_grant(uuid, uuid) from public, anon;
grant execute on function private.has_board_grant(uuid, uuid) to authenticated;

-- Ve un tablero: administradores de la empresa, quien lo creó, todos si es
-- "para todo el equipo", o quien tiene acceso explícito.
create or replace function private.can_access_board(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.account_active() and exists (
    select 1
    from public.boards b
    join public.workspace_members m
      on m.workspace_id = b.workspace_id
     and m.user_id = (select auth.uid())
    where b.id = p_board_id
      and (
        m.role in ('owner', 'admin')
        or b.visibility = 'workspace'
        or b.created_by = (select auth.uid())
        or private.has_board_grant(b.id, (select auth.uid()))
      )
  );
$$;

-- Administra un tablero: administradores de la empresa o quien lo creó.
create or replace function private.can_manage_board(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.account_active() and exists (
    select 1
    from public.boards b
    join public.workspace_members m
      on m.workspace_id = b.workspace_id
     and m.user_id = (select auth.uid())
    where b.id = p_board_id
      and (m.role in ('owner', 'admin') or b.created_by = (select auth.uid()))
  );
$$;

-- Lo mismo para otra persona (lo usa el motor de avisos).
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
    join public.profiles p on p.id = p_user and p.deactivated_at is null
    where b.id = p_board
      and (
        m.role in ('owner', 'admin')
        or b.visibility = 'workspace'
        or b.created_by = p_user
        or private.has_board_grant(b.id, p_user)
      )
  );
$$;

alter policy "boards_select" on public.boards
  using (
    private.is_workspace_member(workspace_id)
    and (
      visibility = 'workspace'
      or created_by = (select auth.uid())
      or private.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
      or private.has_board_grant(id, (select auth.uid()))
    )
  );

revoke all on public.board_members from anon;
grant select, insert, delete on public.board_members to authenticated;
alter table public.board_members enable row level security;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'board_members' and policyname = 'board_members_select') then
    create policy "board_members_select" on public.board_members
      for select to authenticated
      using ((user_id = (select auth.uid()) and private.account_active()) or private.can_access_board(board_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'board_members' and policyname = 'board_members_insert') then
    create policy "board_members_insert" on public.board_members
      for insert to authenticated
      with check (private.can_manage_board(board_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'board_members' and policyname = 'board_members_delete') then
    create policy "board_members_delete" on public.board_members
      for delete to authenticated
      using (private.can_manage_board(board_id));
  end if;
end $do$;

-- -----------------------------------------------------------------------------
-- Solo el superadministrador crea empresas (la función vetta-admin, con
-- privilegios de servicio, también puede: ahí auth.uid() es nulo).
-- -----------------------------------------------------------------------------
create or replace function public.require_platform_admin_for_workspace()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not private.is_platform_admin() then
    raise exception 'Solo el superadministrador puede dar de alta empresas.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace trigger require_platform_admin_for_workspace
  before insert on public.workspaces
  for each row execute function public.require_platform_admin_for_workspace();

-- -----------------------------------------------------------------------------
-- Superadministrador: jorgeleonburgos@gmail.com (autorizado por el dueño).
-- -----------------------------------------------------------------------------
update public.profiles
   set is_platform_admin = (lower(coalesce(email, '')) = 'jorgeleonburgos@gmail.com')
 where is_platform_admin is distinct from (lower(coalesce(email, '')) = 'jorgeleonburgos@gmail.com');
