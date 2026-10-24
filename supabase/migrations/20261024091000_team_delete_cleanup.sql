-- =============================================================================
-- Vetta · al eliminar un equipo, se quita de responsables y permisos
-- -----------------------------------------------------------------------------
-- Sin esto, un equipo borrado quedaría como responsable "fantasma" y una carpeta
-- o columna restringida solo a ese equipo quedaría bloqueada para todos.
-- Solo toca referencias al equipo que se está borrando.
-- =============================================================================
create or replace function private.forget_team()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
-- SECURITY DEFINER: limpia referencias en elementos, carpetas y columnas de
-- tableros que quien borra el equipo (un administrador) quizá no edita.
declare
  v_id text := old.id::text;
begin
  update public.tasks set team_ids = array_remove(team_ids, old.id)
   where old.id = any (team_ids)
     and board_id in (select b.id from public.boards b where b.workspace_id = old.workspace_id);

  update public.board_groups g
     set editors = jsonb_set(g.editors, '{teams}', coalesce((select jsonb_agg(x) from jsonb_array_elements(g.editors -> 'teams') x where x #>> '{}' <> v_id), '[]'::jsonb))
   where g.editors -> 'teams' ? v_id;

  update public.board_columns c
     set settings = jsonb_set(c.settings, '{editors,teams}', coalesce((select jsonb_agg(x) from jsonb_array_elements(c.settings -> 'editors' -> 'teams') x where x #>> '{}' <> v_id), '[]'::jsonb))
   where c.settings -> 'editors' -> 'teams' ? v_id;

  update public.boards b
     set settings = jsonb_set(b.settings, '{columns}', (
           select jsonb_object_agg(k, case when v -> 'editors' -> 'teams' ? v_id
                                           then jsonb_set(v, '{editors,teams}', coalesce((select jsonb_agg(x) from jsonb_array_elements(v -> 'editors' -> 'teams') x where x #>> '{}' <> v_id), '[]'::jsonb))
                                           else v end)
           from jsonb_each(b.settings -> 'columns') e(k, v)))
   where b.workspace_id = old.workspace_id
     and jsonb_typeof(b.settings -> 'columns') = 'object'
     and exists (select 1 from jsonb_each(b.settings -> 'columns') e(k, v) where v -> 'editors' -> 'teams' ? v_id);
  return old;
end;
$$;
revoke all on function private.forget_team() from public, anon, authenticated;
create or replace trigger workspace_teams_forget
  before delete on public.workspace_teams
  for each row execute function private.forget_team();
