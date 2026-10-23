-- =============================================================================
-- Vetta · cuentas administradas (sin emails)
-- -----------------------------------------------------------------------------
-- Las cuentas las crea un administrador desde la plataforma y las contraseñas
-- se asignan y resetean sin enviar correos. Idempotente y sin sentencias DROP.
-- =============================================================================

-- Marcas de cuenta ------------------------------------------------------------
alter table public.profiles
  add column if not exists is_platform_admin boolean not null default false,
  add column if not exists must_change_password boolean not null default false,
  add column if not exists created_by uuid references public.profiles (id) on delete set null;

create index if not exists profiles_created_by_idx on public.profiles (created_by);

-- Cada usuario solo puede modificar su nombre. Las marcas de administrador y de
-- cambio obligatorio de contraseña solo las cambia el servidor (service_role).
revoke insert, update, delete on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

-- Cerrar todas las sesiones de un usuario (tras un reseteo de contraseña) -----
-- SECURITY DEFINER necesario: auth.sessions no es accesible para otros roles.
-- Solo puede ejecutarla service_role (la función de administración del servidor).
create or replace function public.admin_revoke_sessions(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from auth.sessions where user_id = p_user_id;
end;
$$;
revoke all on function public.admin_revoke_sessions(uuid) from public, anon, authenticated;
grant execute on function public.admin_revoke_sessions(uuid) to service_role;

-- Registro cerrado --------------------------------------------------------------
-- Solo se aceptan usuarios creados por la función de administración del
-- servidor. Antes de cada alta, esa función pide un token de un solo uso
-- (válido 2 minutos) y lo envía en los metadatos del usuario. Un alta por la API
-- pública de registro no tiene token y se rechaza, así no se envía ningún correo.
-- (Los metadatos de app de Supabase se escriben después del INSERT, por eso el
-- token viaja en user_metadata, que sí está presente al insertar.)
create table if not exists private.provision_tokens (
  token      text primary key,
  expires_at timestamptz not null default (now() + interval '2 minutes')
);
revoke all on private.provision_tokens from public, anon, authenticated;

-- SECURITY DEFINER necesario: escribe en el esquema privado. Solo service_role.
create or replace function public.admin_issue_provision_token()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  delete from private.provision_tokens where expires_at < now();
  insert into private.provision_tokens (token) values (v_token);
  return v_token;
end;
$$;
revoke all on function public.admin_issue_provision_token() from public, anon, authenticated;
grant execute on function public.admin_issue_provision_token() to service_role;

-- SECURITY DEFINER necesario: se ejecuta como el rol interno de Auth, que no
-- tiene acceso al esquema privado donde están los tokens.
create or replace function private.require_provisioned_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := new.raw_user_meta_data ->> 'vetta_provision_token';
begin
  if v_token is null or not exists (
    select 1 from private.provision_tokens t where t.token = v_token and t.expires_at >= now()
  ) then
    raise exception 'El registro público está deshabilitado. Pedile acceso a un administrador.'
      using errcode = 'P0001';
  end if;
  delete from private.provision_tokens where token = v_token;
  new.raw_user_meta_data := new.raw_user_meta_data - 'vetta_provision_token';
  return new;
end;
$$;
revoke all on function private.require_provisioned_user() from public, anon, authenticated;

create or replace trigger require_provisioned_user
  before insert on auth.users
  for each row execute function private.require_provisioned_user();
