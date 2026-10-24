-- =============================================================================
-- Vetta · formularios
-- -----------------------------------------------------------------------------
--   * board_forms: cada formulario carga elementos en un tablero. Lo crean y
--     editan quienes administran el tablero. La configuración (preguntas,
--     páginas, lógica, diseño, destino) va en `config` (jsonb).
--   * La contraseña (si el acceso es con contraseña) se guarda con hash bcrypt
--     en private.form_secrets: nadie la puede leer desde la API.
--   * form_submissions: cada respuesta (con el elemento que creó). Solo lectura
--     para quienes ven el tablero; las escribe la función de servidor
--     "vetta-formularios" con la clave de servicio, después de validar todo.
--   * form_uploads: archivos subidos a un formulario antes de enviarlo.
-- Solo crea objetos nuevos: no modifica datos existentes.
-- =============================================================================

create table if not exists public.board_forms (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  board_id      uuid not null references public.boards (id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 120),
  slug          text not null unique check (slug ~ '^[A-Za-z0-9]{8,32}$'),
  is_published  boolean not null default false,
  access        text not null default 'public' check (access in ('public', 'members', 'password')),
  opens_at      timestamptz,
  closes_at     timestamptz,
  max_responses int check (max_responses is null or max_responses between 1 and 1000000),
  config        jsonb not null default '{}'::jsonb
                check (jsonb_typeof(config) = 'object' and pg_column_size(config) <= 300000),
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists board_forms_board_idx on public.board_forms (board_id);
create index if not exists board_forms_ws_idx on public.board_forms (workspace_id);
create index if not exists board_forms_created_by_idx on public.board_forms (created_by);

create table if not exists private.form_secrets (
  form_id       uuid primary key references public.board_forms (id) on delete cascade,
  password_hash text not null
);
revoke all on private.form_secrets from public, anon, authenticated;

create table if not exists public.form_submissions (
  id            uuid primary key default gen_random_uuid(),
  form_id       uuid not null references public.board_forms (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  board_id      uuid not null references public.boards (id) on delete cascade,
  task_id       uuid references public.tasks (id) on delete set null,
  submitted_by  uuid references public.profiles (id) on delete set null,
  answers       jsonb not null default '{}'::jsonb check (pg_column_size(answers) <= 300000),
  tracking_hash text unique,
  ip_hash       text,
  duration_ms   int,
  created_at    timestamptz not null default now()
);
create index if not exists form_submissions_form_idx on public.form_submissions (form_id, created_at desc);
create index if not exists form_submissions_board_idx on public.form_submissions (board_id);
create index if not exists form_submissions_ws_idx on public.form_submissions (workspace_id);
create index if not exists form_submissions_task_idx on public.form_submissions (task_id);
create index if not exists form_submissions_by_idx on public.form_submissions (submitted_by);
create index if not exists form_submissions_ip_idx on public.form_submissions (form_id, ip_hash, created_at);

create table if not exists public.form_uploads (
  id          uuid primary key default gen_random_uuid(),
  form_id     uuid not null references public.board_forms (id) on delete cascade,
  question_id text not null,
  path        text not null unique,
  name        text not null,
  size        bigint not null,
  type        text not null,
  ip_hash     text,
  used        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists form_uploads_form_idx on public.form_uploads (form_id, ip_hash, created_at);

-- -----------------------------------------------------------------------------
-- Preparar: empresa del tablero, autor, enlace corto y fechas.
-- -----------------------------------------------------------------------------
create or replace function private.prepare_board_form()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  v_slug  text := '';
begin
  new.name := btrim(new.name);
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    new.created_at := now();
    select b.workspace_id into new.workspace_id from public.boards b where b.id = new.board_id;
    if new.slug is null or new.slug = '' then
      for i in 1..10 loop
        v_slug := v_slug || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
      end loop;
      new.slug := v_slug;
    end if;
  else
    new.board_id := old.board_id;
    new.workspace_id := old.workspace_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  if new.opens_at is not null and new.closes_at is not null and new.closes_at <= new.opens_at then
    raise exception 'La fecha de cierre tiene que ser posterior a la de apertura.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.prepare_board_form() from public, anon, authenticated;

create or replace trigger board_forms_prepare
  before insert or update on public.board_forms
  for each row execute function private.prepare_board_form();

-- -----------------------------------------------------------------------------
-- Contraseña del formulario
-- -----------------------------------------------------------------------------
create or replace function public.set_form_password(p_form uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
-- SECURITY DEFINER: escribe el hash en private.form_secrets (no accesible por la
-- API). Solo quien administra el tablero del formulario puede usarla.
declare
  v_board uuid;
  v_pw    text := coalesce(p_password, '');
begin
  select f.board_id into v_board from public.board_forms f where f.id = p_form;
  if v_board is null or not private.can_manage_board(v_board) then
    raise exception 'No tenés permiso para cambiar este formulario.' using errcode = '42501';
  end if;
  if v_pw = '' then
    delete from private.form_secrets where form_id = p_form;
    return;
  end if;
  if char_length(v_pw) < 4 or char_length(v_pw) > 100 then
    raise exception 'La contraseña tiene que tener entre 4 y 100 caracteres.' using errcode = 'P0001';
  end if;
  insert into private.form_secrets (form_id, password_hash)
  values (p_form, extensions.crypt(v_pw, extensions.gen_salt('bf', 8)))
  on conflict (form_id) do update set password_hash = excluded.password_hash;
end;
$$;
revoke all on function public.set_form_password(uuid, text) from public, anon;
grant execute on function public.set_form_password(uuid, text) to authenticated;

-- ¿El formulario tiene contraseña? (para mostrarlo en el editor, sin revelarla)
create or replace function public.form_has_password(p_form uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- SECURITY DEFINER: solo informa si existe; nunca devuelve el hash.
  select exists (select 1 from private.form_secrets s join public.board_forms f on f.id = s.form_id
                 where s.form_id = p_form and private.can_access_board(f.board_id));
$$;
revoke all on function public.form_has_password(uuid) from public, anon;
grant execute on function public.form_has_password(uuid) to authenticated;

-- Verificar la contraseña: SOLO la función de servidor (service_role).
create or replace function public.form_password_ok(p_form uuid, p_password text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- SECURITY DEFINER: compara contra el hash guardado en el esquema privado.
  select coalesce((select s.password_hash = extensions.crypt(coalesce(p_password, ''), s.password_hash)
                   from private.form_secrets s where s.form_id = p_form), false);
$$;
revoke all on function public.form_password_ok(uuid, text) from public, anon, authenticated;
grant execute on function public.form_password_ok(uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- Permisos
-- -----------------------------------------------------------------------------
alter table public.board_forms enable row level security;
alter table public.form_submissions enable row level security;
alter table public.form_uploads enable row level security;
revoke all on public.board_forms, public.form_submissions, public.form_uploads from anon;
revoke all on public.form_uploads from authenticated;
grant select, insert, update, delete on public.board_forms to authenticated;
revoke insert, update, delete on public.form_submissions from authenticated;
grant select on public.form_submissions to authenticated;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'board_forms' and policyname = 'forms_select') then
    create policy "forms_select" on public.board_forms
      for select to authenticated using (private.can_access_board(board_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'board_forms' and policyname = 'forms_insert') then
    create policy "forms_insert" on public.board_forms
      for insert to authenticated with check (private.can_manage_board(board_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'board_forms' and policyname = 'forms_update') then
    create policy "forms_update" on public.board_forms
      for update to authenticated using (private.can_manage_board(board_id)) with check (private.can_manage_board(board_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'board_forms' and policyname = 'forms_delete') then
    create policy "forms_delete" on public.board_forms
      for delete to authenticated using (private.can_manage_board(board_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'form_submissions' and policyname = 'form_submissions_select') then
    create policy "form_submissions_select" on public.form_submissions
      for select to authenticated using (private.can_access_board(board_id));
  end if;
end $do$;
