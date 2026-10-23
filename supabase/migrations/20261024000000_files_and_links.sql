-- =============================================================================
-- Vetta · archivos, personas, checklist, dependencias y conexión entre tableros
-- -----------------------------------------------------------------------------
--   * Tipos de columna nuevos: files, people, checklist, dependency,
--     connect (conectar tableros) y mirror (espejo).
--   * Bucket privado "vetta-files" para los archivos adjuntos. La ruta de cada
--     archivo es <empresa>/<tablero>/<elemento>/<archivo> y el acceso se valida
--     con el mismo permiso del tablero (private.can_access_board).
-- No elimina objetos ni datos.
-- =============================================================================

create or replace function private.valid_column_kind(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p = any (array[
    'text', 'long_text', 'number', 'date', 'timeline', 'person', 'list', 'tags',
    'checkbox', 'rating', 'link', 'email', 'phone', 'hour', 'formula',
    'item_id', 'created_log', 'updated_log',
    'files', 'people', 'checklist', 'dependency', 'connect', 'mirror'
  ]);
$$;

-- -----------------------------------------------------------------------------
-- Archivos
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('vetta-files', 'vetta-files', false, 26214400)
on conflict (id) do nothing;

-- Tablero dueño de un archivo, según su ruta (segunda carpeta).
create or replace function private.file_board(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 2)::uuid
  end;
$$;
revoke all on function private.file_board(text) from public, anon;
grant execute on function private.file_board(text) to authenticated;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'vetta_files_select') then
    create policy "vetta_files_select" on storage.objects
      for select to authenticated
      using (bucket_id = 'vetta-files' and private.can_access_board(private.file_board(name)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'vetta_files_insert') then
    create policy "vetta_files_insert" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'vetta-files'
        and private.can_access_board(private.file_board(objects.name))
        -- La primera carpeta es la empresa dueña del tablero. (objects.name: dentro
        -- de la subconsulta, "name" a secas sería boards.name.)
        and exists (
          select 1 from public.boards b
          where b.id = private.file_board(objects.name) and b.workspace_id::text = split_part(objects.name, '/', 1)
        )
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'vetta_files_remove') then
    create policy "vetta_files_remove" on storage.objects
      for delete to authenticated
      using (bucket_id = 'vetta-files' and private.can_access_board(private.file_board(name)));
  end if;
end $do$;
