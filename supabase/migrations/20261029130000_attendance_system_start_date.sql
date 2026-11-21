-- El sistema de presentismo/tardanza (confirmación administrativa
-- obligatoria + bloqueo de cierre) empieza a exigirse desde el
-- 29/10/2026 — jornadas anteriores a esa fecha quedan completamente
-- afuera de estas validaciones nuevas, sin excepción y sin necesidad de
-- confirmar nada retroactivamente. Esto NO toca el gate de "cajas
-- pendientes de cierre" de prepare_settlement_run/get_pending_cierres_in_
-- period — ese sigue aplicando a cualquier período, pasado o presente,
-- sin cambios: son dos bloqueos independientes y esta migración solo
-- ajusta el de presentismo.
--
-- Fecha centralizada en una sola función (attendance_system_start_date)
-- para que el trigger de cierre y confirm_attendance usen siempre el
-- mismo corte, sin poder desincronizarse entre sí.
create or replace function public.attendance_system_start_date()
returns date language sql immutable as $$
  select date '2026-10-29'
$$;

-- Cierre de un día ANTERIOR al corte: nunca exige presentismo confirmado
-- ni calcula snapshot (no hay nada que confirmar, ni debe haberlo) — se
-- comporta exactamente como se comportaba este trigger antes de que
-- existiera el sistema de presentismo. Cierre de un día igual o
-- posterior al corte: sin cambios, sigue exigiendo confirmación de
-- TODOS los profesionales programados ese día.
create or replace function public.check_attendance_confirmed_before_close()
returns trigger language plpgsql as $$
declare
  v_missing text;
begin
  if coalesce(NEW.eventos -> -1 ->> 'tipo', '') is distinct from 'cierre' then
    return NEW;
  end if;

  if NEW.fecha < public.attendance_system_start_date() then
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

-- confirm_attendance también rechaza explícitamente una fecha anterior al
-- corte — defensa en profundidad: aunque el trigger de cierre ya no exige
-- nada para esos días, esto evita que CUALQUIER camino (panel, API, RPC
-- directo) pueda crear una confirmación/ajuste de presentismo atado a una
-- jornada histórica, que es exactamente lo que no se quiere ("no
-- modificar jornadas históricas").
create or replace function public.confirm_attendance(
  p_business_id uuid, p_employee_id uuid, p_branch_id uuid, p_date date,
  p_action text,
  p_corrected_clock_in_at timestamptz default null,
  p_override_discount_amount numeric default null,
  p_reason text default null,
  p_confirmed_by uuid default null,
  p_confirmed_by_name text default null
) returns public.attendance_confirmations
language plpgsql security definer set search_path to 'public' as $$
declare
  v_caller_business uuid;
  v_caller_role text;
  v_computed record;
  v_status text;
  v_discount numeric;
  v_prev public.attendance_confirmations;
  v_row public.attendance_confirmations;
begin
  select p.business_id, p.role into v_caller_business, v_caller_role
  from public.profiles p where p.id = auth.uid();

  if v_caller_business is null or v_caller_business is distinct from p_business_id then
    raise exception 'No autorizado para confirmar presentismo en este negocio';
  end if;
  if v_caller_role = 'profesional' then
    raise exception 'Un profesional no puede confirmar su propio presentismo';
  end if;
  if p_confirmed_by is null or p_confirmed_by is distinct from auth.uid() then
    raise exception 'confirmed_by debe ser el usuario autenticado';
  end if;
  if p_action not in
     ('confirm_on_time', 'confirm_late', 'mark_absent', 'correct_time', 'override_penalty', 'revert_absent') then
    raise exception 'Acción inválida: %', p_action;
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'El motivo es obligatorio';
  end if;
  if p_action = 'override_penalty' and p_override_discount_amount is null then
    raise exception 'Especificá el importe del ajuste';
  end if;
  if p_date < public.attendance_system_start_date() then
    raise exception 'El sistema de presentismo aplica desde el %, no se puede confirmar una jornada anterior.',
      to_char(public.attendance_system_start_date(), 'DD/MM/YYYY');
  end if;

  select * into v_computed
  from public._compute_attendance(p_business_id, p_employee_id, p_branch_id, p_date, p_corrected_clock_in_at);

  select * into v_prev from public.attendance_confirmations
  where business_id = p_business_id and employee_id = p_employee_id and date = p_date;

  v_status := case
    when p_action = 'mark_absent' then 'ausente'
    when p_action = 'confirm_on_time' then 'a_tiempo'
    when p_action = 'confirm_late' then 'tarde'
    when p_action = 'revert_absent' then coalesce(v_computed.status, 'a_tiempo')
    when p_action = 'override_penalty' then coalesce(v_prev.status, v_computed.status, 'a_tiempo')
    else coalesce(v_computed.status, 'ausente') -- correct_time
  end;

  v_discount := case
    when p_action = 'override_penalty' then p_override_discount_amount
    when v_status = 'ausente' then 0
    when p_action = 'confirm_on_time' then 0
    else coalesce(v_computed.discount_amount_requested, 0)
  end;
  if v_discount > 0 then
    v_discount := least(v_discount, coalesce(v_computed.commission_services_available, 0));
  end if;

  insert into public.attendance_confirmations (
    business_id, branch_id, employee_id, date, work_session_id,
    expected_start_at, effective_clock_in_at, late_minutes, status, rule_id,
    commission_services_available, discount_amount_requested, discount_amount_applied,
    penalty_overridden, confirmed_by, confirmed_by_name
  ) values (
    p_business_id, p_branch_id, p_employee_id, p_date, v_computed.work_session_id,
    v_computed.expected_start_at, coalesce(p_corrected_clock_in_at, v_computed.effective_clock_in_at),
    coalesce(v_computed.late_minutes, 0), v_status, v_computed.rule_id,
    coalesce(v_computed.commission_services_available, 0), v_discount, v_discount,
    p_action = 'override_penalty', p_confirmed_by, p_confirmed_by_name
  )
  on conflict (business_id, employee_id, date) do update set
    work_session_id = excluded.work_session_id,
    expected_start_at = excluded.expected_start_at,
    effective_clock_in_at = excluded.effective_clock_in_at,
    late_minutes = excluded.late_minutes,
    status = excluded.status,
    rule_id = excluded.rule_id,
    commission_services_available = excluded.commission_services_available,
    discount_amount_requested = excluded.discount_amount_requested,
    discount_amount_applied = excluded.discount_amount_applied,
    penalty_overridden = excluded.penalty_overridden,
    confirmed_by = excluded.confirmed_by,
    confirmed_by_name = excluded.confirmed_by_name,
    confirmed_at = now(),
    updated_at = now()
  returning * into v_row;

  insert into public.attendance_adjustments (
    business_id, branch_id, employee_id, date, work_session_id, action, reason,
    previous_clock_in_at, new_clock_in_at, previous_late_minutes, new_late_minutes,
    previous_discount_amount, new_discount_amount, previous_status, new_status, rule_id,
    performed_by, performed_by_name
  ) values (
    p_business_id, p_branch_id, p_employee_id, p_date, v_computed.work_session_id, p_action, p_reason,
    v_prev.effective_clock_in_at, v_row.effective_clock_in_at,
    v_prev.late_minutes, v_row.late_minutes,
    v_prev.discount_amount_applied, v_row.discount_amount_applied,
    v_prev.status, v_row.status, v_computed.rule_id,
    p_confirmed_by, p_confirmed_by_name
  );

  return v_row;
end;
$$;
