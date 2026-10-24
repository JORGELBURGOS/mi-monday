-- =============================================================================
-- Pruebas: dashboards editables (permisos).
-- Transacción que se revierte: no deja datos.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/dashboards_test.sql
-- =============================================================================
begin;

create or replace function pg_temp.check(cond boolean, label text) returns void
language plpgsql as $$
begin
  if not coalesce(cond, false) then
    raise exception 'FALLÓ: %', label;
  end if;
  raise notice 'ok  %', label;
end $$;

create or replace function pg_temp.act_as(uid uuid) returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

do $t$
declare
  ow uuid := gen_random_uuid();
  us uuid := gen_random_uuid();
  ot uuid := gen_random_uuid();
  ws uuid; ws2 uuid; d_pub uuid; d_priv uuid; d_own uuid; n int; failed boolean;
begin
  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', x.id, 'authenticated', 'authenticated', x.email, now(),
         jsonb_build_object('vetta_provision_token', public.admin_issue_provision_token()), '{}', now(), now()
  from (values (ow, 'dsh-ow@example.test'), (us, 'dsh-us@example.test'), (ot, 'dsh-ot@example.test')) x(id, email);
  execute 'reset role';
  insert into public.workspaces (name) values ('Tableros SA') returning id into ws;
  insert into public.workspaces (name) values ('Otra SA') returning id into ws2;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, ow, 'owner'), (ws, us, 'member'), (ws2, ot, 'owner');

  -- El administrador crea uno compartido y uno privado.
  perform pg_temp.act_as(ow);
  insert into public.dashboards (workspace_id, name, widgets) values (ws, 'Ventas', '[{"id":"a","type":"kpi"}]') returning id into d_pub;
  insert into public.dashboards (workspace_id, name, visibility) values (ws, 'Privado del admin', 'private') returning id into d_priv;
  perform pg_temp.check((select created_by from public.dashboards where id = d_pub) = ow, 'guarda quién lo creó');

  -- Un usuario común ve el compartido, no el privado ajeno.
  perform pg_temp.act_as(us);
  select count(*) into n from public.dashboards where workspace_id = ws;
  perform pg_temp.check(n = 1, 'un usuario ve solo los compartidos (y los suyos)');
  -- No puede editar ni borrar el del administrador.
  update public.dashboards set name = 'X' where id = d_pub;
  get diagnostics n = row_count;
  perform pg_temp.check(n = 0, 'no edita el dashboard de otro');
  delete from public.dashboards where id = d_pub;
  get diagnostics n = row_count;
  perform pg_temp.check(n = 0, 'no borra el dashboard de otro');
  -- Crea el suyo y lo edita.
  insert into public.dashboards (workspace_id, name, visibility) values (ws, 'Mío', 'private') returning id into d_own;
  update public.dashboards set widgets = '[{"id":"b","type":"bar"}]', created_by = ow where id = d_own;
  perform pg_temp.check((select created_by from public.dashboards where id = d_own) = us, 'no se puede cambiar el creador');
  perform pg_temp.check((select jsonb_array_length(widgets) from public.dashboards where id = d_own) = 1, 'edita el suyo');

  -- El administrador ve y edita todos (incluido el privado del usuario).
  perform pg_temp.act_as(ow);
  select count(*) into n from public.dashboards where workspace_id = ws;
  perform pg_temp.check(n = 3, 'el administrador ve todos');
  update public.dashboards set name = 'Mío (revisado)' where id = d_own;
  get diagnostics n = row_count;
  perform pg_temp.check(n = 1, 'el administrador edita cualquiera');

  -- Otra empresa no ve nada ni puede crear en esta.
  perform pg_temp.act_as(ot);
  select count(*) into n from public.dashboards where workspace_id = ws;
  perform pg_temp.check(n = 0, 'otra empresa no ve los dashboards');
  failed := false;
  begin
    insert into public.dashboards (workspace_id, name) values (ws, 'Intruso');
  exception when insufficient_privilege then failed := true;
  end;
  perform pg_temp.check(failed, 'otra empresa no puede crear dashboards acá');

  -- Límite de widgets.
  perform pg_temp.act_as(ow);
  failed := false;
  begin
    update public.dashboards set widgets = (select jsonb_agg(jsonb_build_object('id', g)) from generate_series(1, 61) g) where id = d_pub;
  exception when check_violation then failed := true;
  end;
  perform pg_temp.check(failed, 'máximo 60 widgets');

  execute 'reset role';
  raise notice 'TODAS LAS PRUEBAS PASARON';
end $t$;

rollback;
