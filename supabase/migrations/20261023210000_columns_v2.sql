-- =============================================================================
-- Vetta · columnas al estilo Monday
-- -----------------------------------------------------------------------------
--   * Más tipos de columna (estado, desplegable múltiple, texto largo,
--     cronograma, calificación, enlace, email, teléfono, hora, fórmula,
--     ID del ítem, registro de creación y última actualización).
--   * board_columns.settings: configuración por columna (unidad y decimales de
--     un número, resumen al pie, fórmula, máximo de una calificación…).
--   * Paleta de 18 colores para estados, etiquetas y carpetas.
--   * boards.settings: nombre visible, etiquetas y ocultamiento de las columnas
--     fijas (Responsable, Estado, Prioridad, Vencimiento).
--
-- Los CHECK originales sobre `kind` y `color` tenían una lista cerrada de
-- valores. Para ampliarla sin eliminar restricciones (esta migración no borra
-- nada), las columnas originales se conservan renombradas como legacy_* con un
-- valor por defecto válido, y se agregan columnas nuevas validadas por
-- funciones que se pueden ampliar en el futuro con `create or replace`.
-- No elimina objetos ni datos.
-- =============================================================================

-- Validadores (inmutables, sin privilegios especiales).
create or replace function private.valid_color(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p = any (array[
    'gray', 'amber', 'blue', 'green', 'red', 'violet', 'teal', 'pink', 'orange',
    'lime', 'yellow', 'sky', 'indigo', 'purple', 'rose', 'brown', 'navy', 'olive'
  ]);
$$;

create or replace function private.valid_column_kind(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p = any (array[
    'text', 'long_text', 'number', 'date', 'timeline', 'person', 'list', 'tags',
    'checkbox', 'rating', 'link', 'email', 'phone', 'hour', 'formula',
    'item_id', 'created_log', 'updated_log'
  ]);
$$;

revoke all on function private.valid_color(text) from public, anon;
revoke all on function private.valid_column_kind(text) from public, anon;
grant execute on function private.valid_color(text) to authenticated, service_role;
grant execute on function private.valid_column_kind(text) to authenticated, service_role;

-- El tipo heredado sigue un valor válido para su CHECK original.
create or replace function public.prepare_board_column()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  new.legacy_kind := case when new.kind in ('text', 'number', 'date', 'person', 'list', 'checkbox') then new.kind else 'text' end;
  if tg_op = 'UPDATE' then
    new.board_id := old.board_id;
    -- El tipo solo cambia entre tipos que guardan el mismo valor.
    if new.kind is distinct from old.kind and not (
      (old.kind in ('text', 'long_text', 'link', 'email', 'phone') and new.kind in ('text', 'long_text', 'link', 'email', 'phone'))
      or (old.kind in ('list', 'tags') and new.kind in ('list', 'tags'))
    ) then
      new.kind := old.kind;
    end if;
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- board_columns.kind → legacy_kind + kind (ampliable) · settings
-- -----------------------------------------------------------------------------
do $do$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'board_columns' and column_name = 'legacy_kind') then
    alter table public.board_columns rename column kind to legacy_kind;
    alter table public.board_columns alter column legacy_kind set default 'text';
    alter table public.board_columns add column kind text not null default 'text';
    alter table public.board_columns disable trigger user;
    update public.board_columns set kind = legacy_kind;
    alter table public.board_columns enable trigger user;
    alter table public.board_columns add constraint board_columns_kind_valid check (private.valid_column_kind(kind));
  end if;
end $do$;

alter table public.board_columns add column if not exists settings jsonb not null default '{}'::jsonb;

do $do$ begin
  if not exists (select 1 from pg_constraint where conname = 'board_columns_settings_shape') then
    alter table public.board_columns add constraint board_columns_settings_shape
      check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) < 16384);
  end if;
end $do$;

-- -----------------------------------------------------------------------------
-- Colores: board_statuses.color y board_groups.color → paleta ampliada
-- -----------------------------------------------------------------------------
do $do$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'board_statuses' and column_name = 'legacy_color') then
    alter table public.board_statuses rename column color to legacy_color;
    alter table public.board_statuses alter column legacy_color set default 'gray';
    alter table public.board_statuses add column color text not null default 'gray';
    alter table public.board_statuses disable trigger user;
    update public.board_statuses set color = legacy_color;
    alter table public.board_statuses enable trigger user;
    alter table public.board_statuses add constraint board_statuses_color_valid check (private.valid_color(color));
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'board_groups' and column_name = 'legacy_color') then
    alter table public.board_groups rename column color to legacy_color;
    alter table public.board_groups alter column legacy_color set default 'gray';
    alter table public.board_groups add column color text not null default 'blue';
    alter table public.board_groups disable trigger user;
    update public.board_groups set color = legacy_color;
    alter table public.board_groups enable trigger user;
    alter table public.board_groups add constraint board_groups_color_valid check (private.valid_color(color));
  end if;
end $do$;

-- -----------------------------------------------------------------------------
-- boards.settings: columnas fijas (nombre, ocultar, etiquetas de prioridad)
-- -----------------------------------------------------------------------------
alter table public.boards add column if not exists settings jsonb not null default '{}'::jsonb;

do $do$ begin
  if not exists (select 1 from pg_constraint where conname = 'boards_settings_shape') then
    alter table public.boards add constraint boards_settings_shape
      check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) < 16384);
  end if;
end $do$;
