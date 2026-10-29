-- Completa attendance_confirmations.caja_cierre_id (trazabilidad inversa:
-- "esta confirmación quedó incluida en este cierre") cuando se guarda un
-- cierre real — un AFTER trigger, SECURITY DEFINER a propósito:
-- attendance_confirmations no tiene policy de UPDATE para el cliente
-- (todo cambio de esa tabla pasa por confirm_attendance, nunca un UPDATE
-- directo desde el navegador), así que esta es la única vía posible para
-- completar esta columna sin abrir un agujero de RLS nuevo.
create or replace function public.set_attendance_caja_cierre_id()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(NEW.eventos -> -1 ->> 'tipo', '') is distinct from 'cierre' then
    return NEW;
  end if;

  update public.attendance_confirmations
  set caja_cierre_id = NEW.id
  where business_id = NEW.business_id
    and date = NEW.fecha
    and (branch_id = NEW.branch_id or (NEW.branch_id is null and branch_id is null));

  return NEW;
end;
$$;

drop trigger if exists trg_set_attendance_caja_cierre_id on public.caja_cierres;
create trigger trg_set_attendance_caja_cierre_id
  after insert or update on public.caja_cierres
  for each row execute function public.set_attendance_caja_cierre_id();
