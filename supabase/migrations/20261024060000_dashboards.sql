-- =============================================================================
-- Vetta · dashboards editables
-- -----------------------------------------------------------------------------
-- Cada empresa puede tener varios dashboards. Cada uno guarda su lista de
-- widgets (gráficos, KPI, tablas, textos) en `widgets` (jsonb). Los datos que
-- muestran se calculan con lo que cada persona puede ver (RLS de tareas), así
-- que un dashboard compartido nunca muestra tableros a los que alguien no
-- tiene acceso.
--   * visibility 'workspace': lo ve toda la empresa; 'private': solo quien lo creó.
--   * Lo edita quien lo creó o un administrador de la empresa.
-- Solo crea objetos nuevos: no modifica datos existentes.
-- =============================================================================

create table if not exists public.dashboards (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 80),
  description  text check (description is null or char_length(description) <= 300),
  visibility   text not null default 'workspace' check (visibility in ('workspace', 'private')),
  widgets      jsonb not null default '[]'::jsonb
               check (jsonb_typeof(widgets) = 'array' and jsonb_array_length(widgets) <= 60 and pg_column_size(widgets) <= 200000),
  position     double precision not null default 0,
  created_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists dashboards_ws_idx on public.dashboards (workspace_id, position);
create index if not exists dashboards_created_by_idx on public.dashboards (created_by);

create or replace function private.prepare_dashboard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    new.created_at := now();
  else
    new.workspace_id := old.workspace_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
revoke all on function private.prepare_dashboard() from public, anon, authenticated;

create or replace trigger dashboards_prepare
  before insert or update on public.dashboards
  for each row execute function private.prepare_dashboard();

alter table public.dashboards enable row level security;
revoke all on public.dashboards from anon;
grant select, insert, update, delete on public.dashboards to authenticated;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'dashboards' and policyname = 'dashboards_select') then
    create policy "dashboards_select" on public.dashboards
      for select to authenticated
      using (
        private.is_workspace_member(workspace_id)
        and (visibility = 'workspace'
             or created_by = (select auth.uid())
             or private.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'dashboards' and policyname = 'dashboards_insert') then
    create policy "dashboards_insert" on public.dashboards
      for insert to authenticated
      with check (private.is_workspace_member(workspace_id) and private.account_active());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'dashboards' and policyname = 'dashboards_update') then
    create policy "dashboards_update" on public.dashboards
      for update to authenticated
      using (created_by = (select auth.uid()) or private.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]))
      with check (private.is_workspace_member(workspace_id)
                  and (created_by = (select auth.uid()) or private.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'dashboards' and policyname = 'dashboards_delete') then
    create policy "dashboards_delete" on public.dashboards
      for delete to authenticated
      using (created_by = (select auth.uid()) or private.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));
  end if;
end $do$;
