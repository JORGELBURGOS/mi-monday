-- =============================================================================
-- Vetta · bloqueo de datos mientras la contraseña está pendiente de cambio
-- -----------------------------------------------------------------------------
-- Si un administrador asigna una contraseña temporal, la cuenta no puede leer ni
-- escribir datos de ningún espacio hasta que la persona elija una contraseña
-- nueva (lo que exige conocer la temporal). Así, una sesión abierta antes del
-- reseteo queda sin acceso de inmediato. Idempotente; solo reemplaza funciones.
-- =============================================================================

-- SECURITY DEFINER: lee el perfil propio sin depender de las políticas de profiles.
create or replace function private.account_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select not p.must_change_password from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;
revoke all on function private.account_active() from public, anon;
grant execute on function private.account_active() to authenticated;

create or replace function private.is_workspace_member(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.account_active() and exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.has_workspace_role(p_workspace_id uuid, p_roles public.workspace_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select private.account_active() and exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

create or replace function private.can_access_board(p_board_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.account_active() and exists (
    select 1
    from public.boards b
    join public.workspace_members m
      on m.workspace_id = b.workspace_id
     and m.user_id = (select auth.uid())
    where b.id = p_board_id
      and (b.visibility = 'workspace' or b.created_by = (select auth.uid()) or m.role = 'owner')
  );
$$;

create or replace function private.can_manage_board(p_board_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.account_active() and exists (
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
returns boolean language sql stable security definer set search_path = '' as $$
  select private.account_active() and exists (
    select 1
    from public.workspace_members mine
    join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = p_user_id
  );
$$;
