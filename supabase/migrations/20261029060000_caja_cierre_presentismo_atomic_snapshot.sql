-- Mueve la foto de presentismo (presentismo_snapshot) de un fetch en el
-- cliente (dos pasos: leer attendance_confirmations, después guardar
-- caja_cierres) a este MISMO trigger BEFORE que ya valida la confirmación
-- — así queda tomada en el instante exacto de la escritura real, sin
-- ninguna ventana de carrera entre leer y guardar. El cliente ya no
-- necesita mandar presentismo_snapshot: este trigger lo sobreescribe
-- siempre con el estado vigente de attendance_confirmations para esa
-- fecha/sucursal, en la MISMA transacción que la validación y el guardado
-- de la fila — si algo falla acá, todo el INSERT/UPDATE se revierte junto
-- (nunca un cierre guardado "a medias", con snapshot pero sin validar, o
-- viceversa).
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

  select coalesce(jsonb_agg(to_jsonb(ac) - 'id' - 'business_id' - 'branch_id'), '[]'::jsonb)
    into NEW.presentismo_snapshot
  from public.attendance_confirmations ac
  where ac.business_id = NEW.business_id
    and ac.date = NEW.fecha
    and (ac.branch_id = NEW.branch_id or (NEW.branch_id is null and ac.branch_id is null));

  return NEW;
end;
$$;
