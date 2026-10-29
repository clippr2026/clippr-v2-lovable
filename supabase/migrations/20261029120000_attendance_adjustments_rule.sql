-- Agrega "Regla automática original" al log de auditoría de presentismo
-- (attendance_adjustments) — gap detectado al construir el historial de
-- Reglas de tardanza: la tabla ya guardaba horario/estado/importe
-- anterior-nuevo, pero no qué regla calculó el motor automáticamente en
-- el momento de la acción. Columna nueva, nullable (no rompe filas ya
-- grabadas), poblada por confirm_attendance con v_computed.rule_id — la
-- regla que el cálculo automático determinó, sin importar si la acción
-- después confirma, corrige o la anula con override_penalty.
alter table public.attendance_adjustments
  add column if not exists rule_id uuid references public.lateness_rules(id);

CREATE OR REPLACE FUNCTION public.confirm_attendance(p_business_id uuid, p_employee_id uuid, p_branch_id uuid, p_date date, p_action text, p_corrected_clock_in_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_override_discount_amount numeric DEFAULT NULL::numeric, p_reason text DEFAULT NULL::text, p_confirmed_by uuid DEFAULT NULL::uuid, p_confirmed_by_name text DEFAULT NULL::text)
 RETURNS attendance_confirmations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Positivo = descuento (nunca más que la comisión de servicios
  -- disponible ese día); negativo = ajuste A FAVOR del profesional
  -- (crédito/bono autorizado, ej. "+$500") — plata que el negocio decide
  -- dar, sin tope contra ninguna comisión.
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
$function$;
