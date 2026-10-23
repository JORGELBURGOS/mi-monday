-- =============================================================================
-- Vetta · reglas creadas con IA (DeepSeek), con un token por empresa
-- -----------------------------------------------------------------------------
--   * El token se guarda cifrado en Supabase Vault. Ninguna consulta de la app
--     ni del navegador lo puede leer: solo la función de servidor
--     "vetta-ia-reglas" (con la clave de servicio) lo obtiene para llamar a la IA.
--   * public.workspace_ai_settings guarda datos NO secretos (si está
--     configurado, los últimos 4 caracteres, el límite diario).
--   * public.ai_requests registra cada pedido (quién, qué pidió, qué devolvió).
-- No elimina objetos ni datos existentes.
-- =============================================================================

create table if not exists public.workspace_ai_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  provider     text not null default 'deepseek' check (provider in ('deepseek')),
  model        text not null default 'deepseek-chat' check (char_length(model) between 1 and 60),
  key_hint     text check (key_hint is null or char_length(key_hint) <= 12),
  daily_limit  int not null default 50 check (daily_limit between 0 and 1000),
  updated_by   uuid references public.profiles (id) on delete set null,
  updated_at   timestamptz not null default now()
);

-- Referencia al secreto del Vault: en el esquema privado (no expuesto por la API).
create table if not exists private.workspace_ai_secrets (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  secret_id    uuid not null
);
revoke all on private.workspace_ai_secrets from public, anon, authenticated;

create table if not exists public.ai_requests (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  board_id     uuid references public.boards (id) on delete set null,
  user_id      uuid references public.profiles (id) on delete set null,
  prompt       text not null check (char_length(prompt) <= 2000),
  ok           boolean not null default false,
  result       jsonb,
  error        text,
  created_at   timestamptz not null default now()
);
create index if not exists ai_requests_ws_created_idx on public.ai_requests (workspace_id, created_at desc);
create index if not exists ai_requests_board_idx on public.ai_requests (board_id);
create index if not exists ai_requests_user_idx on public.ai_requests (user_id);
create index if not exists workspace_ai_settings_updated_by_idx on public.workspace_ai_settings (updated_by);

alter table public.workspace_ai_settings enable row level security;
alter table public.ai_requests enable row level security;
revoke all on public.workspace_ai_settings from anon;
revoke all on public.ai_requests from anon;
-- La app solo lee; las escrituras van por funciones (ajustes) o por la función de servidor (pedidos).
revoke insert, update, delete on public.workspace_ai_settings from authenticated;
revoke insert, update, delete on public.ai_requests from authenticated;
grant select on public.workspace_ai_settings to authenticated;
grant select on public.ai_requests to authenticated;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workspace_ai_settings' and policyname = 'ai_settings_select') then
    -- Cualquier usuario de la empresa ve si la IA está disponible (no ve el token).
    create policy "ai_settings_select" on public.workspace_ai_settings
      for select to authenticated using (private.is_workspace_member(workspace_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_requests' and policyname = 'ai_requests_select') then
    create policy "ai_requests_select" on public.ai_requests
      for select to authenticated
      using (user_id = (select auth.uid()) or private.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));
  end if;
end $do$;

-- -----------------------------------------------------------------------------
-- Cargar / reemplazar el token de una empresa
-- -----------------------------------------------------------------------------
create or replace function public.set_workspace_ai_key(p_workspace uuid, p_key text, p_daily_limit int default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
-- SECURITY DEFINER: escribe en Supabase Vault (vault.*), al que la app no tiene
-- acceso. Solo el superadministrador o el dueño de la empresa pueden usarla.
declare
  v_key    text := btrim(coalesce(p_key, ''));
  v_secret uuid;
begin
  if not (private.is_platform_admin_user((select auth.uid()))
          or private.has_workspace_role(p_workspace, array['owner']::public.workspace_role[])) then
    raise exception 'Solo el dueño de la empresa o el superadministrador pueden configurar la IA.' using errcode = '42501';
  end if;
  if p_daily_limit is not null and (p_daily_limit < 0 or p_daily_limit > 1000) then
    raise exception 'El límite diario tiene que estar entre 0 y 1000.' using errcode = '22023';
  end if;

  if v_key <> '' then
    if char_length(v_key) < 20 or char_length(v_key) > 300 or v_key ~ '\s' then
      raise exception 'El token no parece válido.' using errcode = '22023';
    end if;
    select s.secret_id into v_secret from private.workspace_ai_secrets s where s.workspace_id = p_workspace;
    if v_secret is null then
      v_secret := vault.create_secret(v_key, 'vetta_ai_' || p_workspace::text, 'Token de IA de una empresa de Vetta');
      insert into private.workspace_ai_secrets (workspace_id, secret_id) values (p_workspace, v_secret);
    else
      perform vault.update_secret(v_secret, v_key);
    end if;
  elsif not exists (select 1 from private.workspace_ai_secrets s where s.workspace_id = p_workspace) then
    raise exception 'Pegá el token de DeepSeek.' using errcode = '22023';
  end if;

  insert into public.workspace_ai_settings (workspace_id, key_hint, daily_limit, updated_by, updated_at)
  values (p_workspace, case when v_key <> '' then '…' || right(v_key, 4) end, coalesce(p_daily_limit, 50), (select auth.uid()), now())
  on conflict (workspace_id) do update
    set key_hint = coalesce(excluded.key_hint, public.workspace_ai_settings.key_hint),
        daily_limit = coalesce(p_daily_limit, public.workspace_ai_settings.daily_limit),
        updated_by = excluded.updated_by,
        updated_at = now();
end;
$$;
revoke all on function public.set_workspace_ai_key(uuid, text, int) from public, anon;
grant execute on function public.set_workspace_ai_key(uuid, text, int) to authenticated;

-- Quitar el token de una empresa (lo hace el dueño o el superadministrador).
create or replace function public.clear_workspace_ai_key(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
-- SECURITY DEFINER: borra el secreto de esta empresa en Supabase Vault.
declare
  v_secret uuid;
begin
  if not (private.is_platform_admin_user((select auth.uid()))
          or private.has_workspace_role(p_workspace, array['owner']::public.workspace_role[])) then
    raise exception 'Solo el dueño de la empresa o el superadministrador pueden quitar el token.' using errcode = '42501';
  end if;
  select s.secret_id into v_secret from private.workspace_ai_secrets s where s.workspace_id = p_workspace;
  if v_secret is not null then
    delete from vault.secrets where id = v_secret;
    delete from private.workspace_ai_secrets where workspace_id = p_workspace;
  end if;
  update public.workspace_ai_settings set key_hint = null, updated_by = (select auth.uid()), updated_at = now()
  where workspace_id = p_workspace;
end;
$$;
revoke all on function public.clear_workspace_ai_key(uuid) from public, anon;
grant execute on function public.clear_workspace_ai_key(uuid) to authenticated;

-- Leer el token: SOLO la función de servidor (rol service_role).
create or replace function public.workspace_ai_key(p_workspace uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  -- SECURITY DEFINER: lee el secreto descifrado del Vault. Sin permisos para
  -- anon ni authenticated: solo service_role (la Edge Function) puede llamarla.
  select d.decrypted_secret
  from private.workspace_ai_secrets s
  join vault.decrypted_secrets d on d.id = s.secret_id
  where s.workspace_id = p_workspace;
$$;
revoke all on function public.workspace_ai_key(uuid) from public, anon, authenticated;
grant execute on function public.workspace_ai_key(uuid) to service_role;
