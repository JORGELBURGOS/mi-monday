-- =============================================================================
-- Vetta · superadministrador con acceso total e invisible para las empresas
-- -----------------------------------------------------------------------------
--   * El superadministrador (profiles.is_platform_admin) ve y administra todas
--     las empresas, tableros, usuarios y datos, sin necesidad de ser miembro:
--     cuenta como administrador principal en cualquier empresa.
--   * Los usuarios de una empresa (incluido su administrador principal) no
--     ven al superadministrador: ni en la lista de usuarios ni su perfil, y no
--     lo pueden editar ni quitar.
--   * Solo el superadministrador elimina empresas.
-- Solo redefine funciones y políticas (create or replace / alter policy).
-- No elimina objetos ni datos.
-- =============================================================================

-- ¿Una persona dada es superadministradora? (para ocultarla a los demás)
create or replace function private.is_platform_admin_user(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.is_platform_admin from public.profiles p where p.id = p_user), false);
$$;
revoke all on function private.is_platform_admin_user(uuid) from public, anon;
grant execute on function private.is_platform_admin_user(uuid) to authenticated;

create or replace function private.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.account_active() and (
    private.is_platform_admin()
    or exists (
      select 1 from public.workspace_members m
      where m.workspace_id = p_workspace_id
        and m.user_id = (select auth.uid())
    )
  );
$$;

create or replace function private.has_workspace_role(p_workspace_id uuid, p_roles public.workspace_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.account_active() and (
    private.is_platform_admin()
    or exists (
      select 1 from public.workspace_members m
      where m.workspace_id = p_workspace_id
        and m.user_id = (select auth.uid())
        and m.role = any (p_roles)
    )
  );
$$;

create or replace function private.shares_workspace(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.account_active() and (
    private.is_platform_admin()
    or (
      not private.is_platform_admin_user(p_user_id)
      and exists (
        select 1
        from public.workspace_members mine
        join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
        where mine.user_id = (select auth.uid())
          and theirs.user_id = p_user_id
      )
    )
  );
$$;

create or replace function private.can_access_board(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.account_active() and (
    (private.is_platform_admin() and exists (select 1 from public.boards b where b.id = p_board_id))
    or exists (
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
    )
  );
$$;

create or replace function private.can_manage_board(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.account_active() and (
    (private.is_platform_admin() and exists (select 1 from public.boards b where b.id = p_board_id))
    or exists (
      select 1
      from public.boards b
      join public.workspace_members m
        on m.workspace_id = b.workspace_id
       and m.user_id = (select auth.uid())
      where b.id = p_board_id
        and (m.role in ('owner', 'admin') or b.created_by = (select auth.uid()))
    )
  );
$$;

-- Empresas: el superadministrador ve todas; solo él las elimina.
alter policy "workspaces_select" on public.workspaces
  using (private.is_workspace_member(id) or created_by = (select auth.uid()));
alter policy "workspaces_delete" on public.workspaces
  using (private.is_platform_admin());

-- Usuarios de la empresa: el superadministrador no aparece ni se puede tocar.
alter policy "members_select" on public.workspace_members
  using (private.is_workspace_member(workspace_id) and (private.is_platform_admin() or not private.is_platform_admin_user(user_id)));

alter policy "members_update" on public.workspace_members
  using (
    private.is_platform_admin()
    or (
      not private.is_platform_admin_user(user_id)
      and (
        private.has_workspace_role(workspace_id, array['owner']::public.workspace_role[])
        or (private.has_workspace_role(workspace_id, array['admin']::public.workspace_role[]) and role <> 'owner')
      )
    )
  )
  with check (
    private.is_platform_admin()
    or private.has_workspace_role(workspace_id, array['owner']::public.workspace_role[])
    or (private.has_workspace_role(workspace_id, array['admin']::public.workspace_role[]) and role <> 'owner')
  );

alter policy "members_delete" on public.workspace_members
  using (
    private.is_platform_admin()
    or user_id = (select auth.uid())
    or (
      not private.is_platform_admin_user(user_id)
      and (
        private.has_workspace_role(workspace_id, array['owner']::public.workspace_role[])
        or (private.has_workspace_role(workspace_id, array['admin']::public.workspace_role[]) and role = 'member')
      )
    )
  );

-- Perfiles: los demás no ven el del superadministrador.
alter policy "profiles_select" on public.profiles
  using (id = (select auth.uid()) or private.shares_workspace(id));
