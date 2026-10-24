-- =============================================================================
-- Pruebas: formularios (permisos y contraseña).
-- Transacción que se revierte: no deja datos.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/forms_test.sql
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
  ws uuid; b uuid; f uuid; n int; failed boolean; s text;
begin
  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', x.id, 'authenticated', 'authenticated', x.email, now(),
         jsonb_build_object('vetta_provision_token', public.admin_issue_provision_token()), '{}', now(), now()
  from (values (ow, 'frm-ow@example.test'), (us, 'frm-us@example.test'), (ot, 'frm-ot@example.test')) x(id, email);
  execute 'reset role';
  insert into public.workspaces (name) values ('Formularios SA') returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, ow, 'owner'), (ws, us, 'member');

  perform pg_temp.act_as(ow);
  insert into public.boards (workspace_id, name) values (ws, 'Pedidos') returning id into b;
  insert into public.board_forms (board_id, name, config) values (b, '  Pedido de compra ', '{"title":"Pedido"}') returning id, slug into f, s;
  perform pg_temp.check(s ~ '^[A-Za-z0-9]{10}$', 'genera un enlace corto');
  perform pg_temp.check((select workspace_id from public.board_forms where id = f) = ws, 'toma la empresa del tablero');
  perform pg_temp.check((select name from public.board_forms where id = f) = 'Pedido de compra', 'limpia el nombre');

  -- Contraseña: se guarda con hash, no se puede leer y solo la verifica el servidor.
  perform public.set_form_password(f, 'secreta1');
  perform pg_temp.check(public.form_has_password(f), 'informa que tiene contraseña');
  failed := false;
  begin
    perform public.form_password_ok(f, 'secreta1');
  exception when insufficient_privilege then failed := true;
  end;
  perform pg_temp.check(failed, 'un usuario no puede verificar contraseñas');
  execute 'reset role';
  perform pg_temp.check(public.form_password_ok(f, 'secreta1') and not public.form_password_ok(f, 'otra'), 'la verificación funciona');
  perform pg_temp.check((select password_hash from private.form_secrets where form_id = f) like '$2%', 'guarda hash bcrypt');

  -- Un usuario común (sin administrar el tablero) lo ve pero no lo edita ni crea.
  perform pg_temp.act_as(us);
  perform pg_temp.check((select count(*) from public.board_forms where id = f) = 1, 'un usuario del tablero lo ve');
  update public.board_forms set name = 'X' where id = f;
  get diagnostics n = row_count;
  perform pg_temp.check(n = 0, 'un usuario común no lo edita');
  failed := false;
  begin
    insert into public.board_forms (board_id, name) values (b, 'Mío');
  exception when insufficient_privilege then failed := true;
  end;
  perform pg_temp.check(failed, 'un usuario común no crea formularios');
  failed := false;
  begin
    perform public.set_form_password(f, 'hack');
  exception when insufficient_privilege then failed := true;
  end;
  perform pg_temp.check(failed, 'un usuario común no cambia la contraseña');
  failed := false;
  begin
    insert into public.form_submissions (form_id, workspace_id, board_id) values (f, ws, b);
  exception when insufficient_privilege then failed := true;
  end;
  perform pg_temp.check(failed, 'nadie escribe respuestas desde la API');

  -- Otra empresa no lo ve.
  perform pg_temp.act_as(ot);
  perform pg_temp.check((select count(*) from public.board_forms where id = f) = 0, 'otra empresa no ve el formulario');

  -- Fechas coherentes.
  perform pg_temp.act_as(ow);
  failed := false;
  begin
    update public.board_forms set opens_at = now(), closes_at = now() - interval '1 day' where id = f;
  exception when others then failed := true;
  end;
  perform pg_temp.check(failed, 'el cierre tiene que ser posterior a la apertura');
  perform public.set_form_password(f, '');
  perform pg_temp.check(not public.form_has_password(f), 'quitar la contraseña');

  execute 'reset role';
  raise notice 'TODAS LAS PRUEBAS PASARON';
end $t$;

rollback;
