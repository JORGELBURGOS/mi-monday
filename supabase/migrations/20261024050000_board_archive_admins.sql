-- =============================================================================
-- Vetta · archivar, restaurar y eliminar tableros: solo administradores de la
-- empresa (administrador principal o administrador; el superadministrador
-- también). Quien creó el tablero ya no puede archivarlo ni eliminarlo si es
-- usuario común. No modifica datos.
-- =============================================================================

create or replace function private.guard_board_archive()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_archived is distinct from old.is_archived
     and (select auth.uid()) is not null
     and not private.has_workspace_role(old.workspace_id, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'Solo un administrador de la empresa puede archivar o restaurar tableros.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_board_archive() from public, anon, authenticated;

create or replace trigger boards_guard_archive
  before update of is_archived on public.boards
  for each row execute function private.guard_board_archive();

-- Eliminar: el tablero tiene que estar archivado y quien lo elimina, ser administrador.
alter policy "boards_delete" on public.boards
  using (is_archived and private.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));
