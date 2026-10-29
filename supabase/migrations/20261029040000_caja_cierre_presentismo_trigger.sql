-- Bloquea el cierre de una caja mientras exista algún profesional
-- programado ese día/sucursal (get_scheduled_professionals_for_date) sin
-- fila vigente en attendance_confirmations. Único write-path existente de
-- cierre (closeSingleDayCierre, src/lib/caja-cierre.ts) — un trigger
-- blinda este candado sin importar qué código futuro llegue a escribir
-- caja_cierres, y sin tener que reimplementar el control de concurrencia
-- ya probado de esa función.
--
-- OJO, bug real que NO hay que reintroducir: `estado` en esta tabla
-- prácticamente nunca cambia de valor (siempre 'cerrada', incluso en un
-- día reabierto — ver "Reabrir caja", que solo agrega un evento al jsonb
-- `eventos` sin tocar `estado`). Si el trigger disparara con
-- `NEW.estado = 'cerrada'` bloquearía TAMBIÉN reabrir caja y cualquier
-- otra actualización futura de la fila, no solo el cierre real. El
-- criterio correcto es mirar el ÚLTIMO elemento de `eventos` tal como
-- queda DESPUÉS de este write — closeSingleDayCierre siempre agrega un
-- evento {tipo:"cierre"} al cerrar de verdad; "Reabrir caja" agrega
-- {tipo:"reapertura"}; ninguna otra escritura conocida agrega 'cierre'.
create or replace function public.check_attendance_confirmed_before_close()
returns trigger language plpgsql as $$
declare
  v_missing text;
begin
  if coalesce(NEW.eventos -> -1 ->> 'tipo', '') is distinct from 'cierre' then
    return NEW;
  end if;

  select string_agg(e.full_name, ', ')
    into v_missing
  from public.get_scheduled_professionals_for_date(NEW.business_id, NEW.branch_id, NEW.fecha) s
  join public.employees e on e.id = s.employee_id
  where not exists (
    select 1 from public.attendance_confirmations ac
    where ac.business_id = NEW.business_id
      and ac.employee_id = s.employee_id
      and ac.date = NEW.fecha
  );

  if v_missing is not null then
    raise exception 'No se puede cerrar: presentismo sin confirmar para %', v_missing;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_check_attendance_before_close on public.caja_cierres;
create trigger trg_check_attendance_before_close
  before insert or update on public.caja_cierres
  for each row execute function public.check_attendance_confirmed_before_close();
