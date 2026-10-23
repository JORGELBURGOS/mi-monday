-- =============================================================================
-- Vetta · subelementos (como en Monday)
-- -----------------------------------------------------------------------------
--   * tasks.parent_id: un elemento puede tener subelementos (un solo nivel).
--   * Un subelemento vive en el mismo tablero y carpeta que su elemento; si el
--     elemento cambia de carpeta o viaja a otro tablero, sus subelementos lo
--     acompañan (el estado se busca por nombre en el tablero nuevo).
--   * Al eliminar un elemento se eliminan sus subelementos.
--   * Las reglas del tablero se aplican a los elementos, no a los subelementos.
-- No elimina objetos ni datos.
-- =============================================================================

alter table public.tasks add column if not exists parent_id uuid;

do $do$ begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_parent_fk') then
    alter table public.tasks add constraint tasks_parent_fk
      foreign key (parent_id) references public.tasks (id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_parent_not_self') then
    alter table public.tasks add constraint tasks_parent_not_self check (parent_id is null or parent_id <> id);
  end if;
end $do$;

create index if not exists tasks_parent_idx on public.tasks (parent_id) where parent_id is not null;

-- Valida el elemento padre y alinea tablero y carpeta con él.
create or replace function public.prepare_subitem()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  p record;
begin
  if new.parent_id is null then
    return new;
  end if;
  select t.id, t.board_id, t.group_id, t.parent_id into p from public.tasks t where t.id = new.parent_id;
  if p.id is null then
    raise exception 'El elemento principal no existe.' using errcode = 'P0001';
  end if;
  if p.parent_id is not null then
    raise exception 'Un subelemento no puede tener subelementos.' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and exists (select 1 from public.tasks c where c.parent_id = new.id) then
    raise exception 'Un elemento con subelementos no puede pasar a ser subelemento.' using errcode = 'P0001';
  end if;
  if p.board_id <> new.board_id then
    raise exception 'El subelemento tiene que estar en el mismo tablero que su elemento.' using errcode = 'P0001';
  end if;
  new.group_id := p.group_id;
  return new;
end;
$$;

create or replace trigger tasks_a_prepare_subitem
  before insert or update of parent_id, group_id, board_id on public.tasks
  for each row execute function public.prepare_subitem();

-- Los subelementos acompañan a su elemento (carpeta y tablero).
create or replace function private.move_subitems()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- SECURITY DEFINER: si el elemento viaja a otro tablero por una regla, los
  -- subelementos tienen que poder acompañarlo aunque quien disparó la regla no
  -- tenga acceso al tablero de destino. Solo toca hijos de la fila modificada.
  update public.tasks c
     set board_id  = new.board_id,
         group_id  = new.group_id,
         status_id = case when new.board_id = old.board_id then c.status_id
                          else private.map_status(c.status_id, new.board_id, null, true) end
   where c.parent_id = new.id
     and (c.board_id is distinct from new.board_id or c.group_id is distinct from new.group_id);
  return null;
end;
$$;
revoke all on function private.move_subitems() from public, anon, authenticated;

create or replace trigger tasks_c_move_subitems
  after update of group_id, board_id on public.tasks
  for each row
  when (new.parent_id is null and (old.group_id is distinct from new.group_id or old.board_id is distinct from new.board_id))
  execute function private.move_subitems();

-- Las reglas (cambios de estado, carpeta, etc.) no se disparan en subelementos.
create or replace trigger tasks_b_run_automations
  after insert or update of status_id, group_id, board_id, assignee_id, priority, custom_values on public.tasks
  for each row
  when (new.parent_id is null)
  execute function private.run_automations();

-- Reglas por fecha, quietos y programadas: solo elementos (no subelementos).
create or replace function private.run_scheduled_automations(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r       public.board_automations%rowtype;
  t       public.tasks%rowtype;
  cfg     jsonb;
  v_today date := private.local_today(p_now);
  v_hour  int := extract(hour from (p_now at time zone 'America/Argentina/Buenos_Aires'))::int;
  v_key   text;
  v_date  date;
  v_off   int;
  v_since timestamptz;
  v_due   boolean;
  v_field text;
  v_count int := 0;
begin
  for r in
    select a.*
    from public.board_automations a
    join public.boards b on b.id = a.board_id and not b.is_archived
    where a.is_active and a.trigger_type in ('date_arrives', 'stale', 'schedule')
    order by a.created_at
  loop
    cfg := r.trigger_config;
    -- Cada regla corre a partir de su hora (por defecto, 8 de la mañana).
    continue when v_hour < coalesce(case when cfg ->> 'hour' ~ '^[0-9]+$' then (cfg ->> 'hour')::int end, 8);

    if r.trigger_type = 'schedule' then
      v_due := case coalesce(cfg ->> 'freq', 'daily')
        when 'daily' then true
        when 'weekdays' then extract(isodow from v_today) between 1 and 5
        when 'weekly' then extract(isodow from v_today)::int = coalesce((cfg ->> 'weekday')::int, 1)
        when 'monthly' then extract(day from v_today)::int = least(
          coalesce((cfg ->> 'monthday')::int, 1),
          extract(day from (date_trunc('month', v_today) + interval '1 month - 1 day'))::int)
        else false
      end;
      continue when not v_due;
      v_key := 'schedule|' || v_today::text;
      continue when exists (
        select 1 from public.automation_runs x
        where x.automation_id = r.id and x.task_id is null and x.fire_key = v_key
      );
      insert into public.automation_runs (automation_id, task_id, fire_key, ok) values (r.id, null, v_key, true);
      if r.action_type = 'create_item' then
        perform private.execute_rule(r, null, null);
        v_count := v_count + 1;
      else
        for t in select * from public.tasks x where x.board_id = r.board_id and x.parent_id is null order by x.position limit 1000 loop
          continue when not private.conditions_met(r.conditions, t);
          perform private.execute_rule(r, t.id, v_key);
          v_count := v_count + 1;
        end loop;
      end if;

    elsif r.trigger_type = 'date_arrives' then
      v_field := coalesce(cfg ->> 'date_field', 'due_date');
      v_off := coalesce(case when cfg ->> 'offset_days' ~ '^-?[0-9]+$' then (cfg ->> 'offset_days')::int end, 0);
      for t in
        select * from public.tasks x
        where x.board_id = r.board_id
          and x.parent_id is null
          and (v_field <> 'due_date' or x.due_date between v_today - 7 - v_off and v_today - v_off)
        limit 2000
      loop
        v_date := case when v_field = 'due_date' then t.due_date
                       when t.custom_values ->> v_field ~ '^\d{4}-\d{2}-\d{2}$' then (t.custom_values ->> v_field)::date
                  end;
        continue when v_date is null;
        -- Se dispara el día que corresponde; si el servidor no corrió, recupera hasta 7 días.
        continue when v_date + v_off > v_today or v_date + v_off < v_today - 7;
        v_key := 'date|' || v_date::text || '|' || v_off;
        continue when exists (
          select 1 from public.automation_runs x
          where x.automation_id = r.id and x.task_id = t.id and x.fire_key = v_key
        );
        continue when not private.conditions_met(r.conditions, t);
        perform private.execute_rule(r, t.id, v_key);
        v_count := v_count + 1;
      end loop;

    elsif r.trigger_type = 'stale' then
      for t in select * from public.tasks x where x.board_id = r.board_id and x.parent_id is null limit 2000 loop
        continue when cfg ->> 'status_id' is not null and t.status_id::text is distinct from cfg ->> 'status_id';
        select max(e.created_at) into v_since
        from public.task_events e
        where e.task_id = t.id and e.kind in ('status_changed', 'created', 'moved');
        v_since := coalesce(v_since, t.created_at);
        continue when v_since > p_now - make_interval(days => greatest(coalesce(
          case when cfg ->> 'days' ~ '^[0-9]+$' then (cfg ->> 'days')::int end, 3), 1));
        v_key := 'stale|' || v_since::text;
        continue when exists (
          select 1 from public.automation_runs x
          where x.automation_id = r.id and x.task_id = t.id and x.fire_key = v_key
        );
        continue when not private.conditions_met(r.conditions, t);
        perform private.execute_rule(r, t.id, v_key);
        v_count := v_count + 1;
      end loop;
    end if;
  end loop;
  return v_count;
end;
$$;

