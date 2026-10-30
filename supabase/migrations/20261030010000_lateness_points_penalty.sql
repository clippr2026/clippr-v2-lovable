-- ============================================================================
-- ESTADO: probada en clippr-dev (transacción con rollback, datos reales) y
-- con el impacto en producción medido en solo lectura. NO aplicada todavía en
-- producción: se aplica con el script apply-lateness-points-prod.sh, que antes
-- hace y verifica un respaldo. Impacto medido: una sola jornada pendiente
-- (Daniel, 29/10: de $4.500 a $10.000); ninguna liquidación hecha cambia.
-- ============================================================================
-- Tardanza: la regla "percent" resta PUNTOS PORCENTUALES a la tasa de comisión
-- ============================================================================
-- Antes: una regla "percent" de 10 descontaba el 10% de la COMISIÓN del día
-- (45% -> 40,5%). Lo correcto para el negocio: restar 10 PUNTOS a la tasa
-- (45% -> 35%). Sobre un corte de $20.000:
--   a tiempo        -> $9.000   (45%)
--   regla de 5 pts  -> $8.000   (40%)  descuento $1.000
--   regla de 10 pts -> $7.000   (35%)  descuento $2.000
--
-- Cómo se calcula (por cada servicio vendido ese día por el profesional):
--   penalización = comisión de servicios × puntos ÷ tasa propia del servicio
-- (= precio cobrado × puntos: la comisión ya se calcula sobre el precio
-- efectivamente cobrado, con el tope del precio efectivo, y sin propinas).
--
-- La TASA es la que usó el cobro (register-payment.ts / computeCommissionAmount):
--   · la configuración de ese servicio para ese profesional
--     (business_settings.schedule._employeeCommissions[prof][servicio]),
--     si existe y no está desactivada (enabled <> false): modo "percent" ->
--     su valor (45, 40, 10...); modo "fixed" -> importe fijo, SIN penalización;
--   · si no hay configuración del servicio: la tasa general del profesional
--     (employees.commission_pct).
-- Decisión del negocio: los puntos se restan a la tasa PROPIA de cada
-- servicio, aunque sea especial (un servicio al 10% con 10 puntos queda en
-- 0%, nunca en negativo: el descuento tiene como tope la propia comisión del
-- servicio). Los servicios de importe fijo no se penalizan.
--
-- El CATÁLOGO (productos) NO lleva descuento por puntualidad: solo cuenta la
-- comisión de servicios (amount_services). En una venta mixta anterior al
-- desglose (amount_services vacío) no se puede separar, así que se excluye.
-- Una venta con varios servicios de tasas distintas, o sin servicios
-- identificables, también se excluye (no hay una tasa única para derivar el
-- precio); hoy ninguna venta es así (509 de 1 servicio, ninguna de 2+).
--   · Una regla "fixed" no cambia: sigue siendo un importe fijo por jornada.
--
-- Cambios:
--   1) lateness_points_penalty(): cuenta pura (comisión, tasa, puntos).
--   1b) lateness_service_commission(): comisión de SERVICIOS de una venta.
--   2) _lateness_record_penalty(): penalización de UNA venta con su tasa.
--   3) _attendance_discount_for_rule(): el descuento total de la jornada para
--      una regla — única fuente (la usan _compute_attendance, el recálculo y
--      el desglose por servicio).
--   4) _compute_attendance(): MISMA firma; usa (3) y trunca los minutos de
--      tardanza (11:14:59 sigue siendo 14 min; 11:00:59 sigue siendo 11:00).
--   5) preview_attendance_at(): igual que preview_attendance pero con una hora
--      de llegada corregida opcional — la revisión de cierre muestra con ella
--      el resultado real ANTES de guardar, sin duplicar la cuenta en pantalla.
--   6) attendance_penalty_breakdown(): penalización de cada venta de la
--      jornada (para mostrar el descuento en cada servicio de Liquidaciones).
--   7) Recalcula SOLO las jornadas todavía no liquidadas del sistema de
--      puntualidad (desde attendance_system_start_date()), con la misma regla
--      con la que ya fueron confirmadas, sin tocar las que tienen ajuste
--      manual (penalty_overridden), ni las ya absorbidas por una liquidación
--      (settlement_run_id), ni estado, minutos ni hora de entrada. Cada
--      cambio deja su fila en attendance_adjustments (auditoría).
--
-- NO cambia: las liquidaciones ya hechas, los registros históricos, las
-- comisiones ya generadas (commission_records), las propinas.
-- Es seguro re-ejecutarlo: el recálculo solo toca filas cuyo importe cambia.
--
-- IMPORTANTE (umbral): las reglas hoy son "desde 0 min -> 5" y "desde 16 min
-- -> 10". Para que 11:15 (15 min) ya cuente 10 puntos hay que pasar 16 a 15
-- (un cambio de datos en lateness_rules, que NO está en esta migración).
--
-- Cómo revertirlo: volver a aplicar la definición anterior de
-- _compute_attendance (migración 20261029030000_presentismo_schema.sql) y
-- borrar las funciones nuevas. Los importes recalculados quedan en
-- attendance_adjustments con el valor anterior (previous_discount_amount).
-- ============================================================================

-- ── 1. Cuenta pura ──────────────────────────────────────────────────────────
create or replace function public.lateness_points_penalty(
  p_commission numeric, p_pct numeric, p_points numeric
) returns numeric language sql immutable as $$
  select case
    when coalesce(p_commission, 0) <= 0 or coalesce(p_pct, 0) <= 0 or coalesce(p_points, 0) <= 0 then 0
    else least(p_commission * p_points / p_pct, p_commission)
  end
$$;

-- ── 1b. Comisión de SERVICIOS de una venta (el catálogo no lleva descuento) ─
create or replace function public.lateness_service_commission(
  p_amount numeric, p_amount_services numeric, p_items jsonb
) returns numeric language sql immutable as $$
  select case
    when p_amount_services is not null then greatest(p_amount_services, 0)
    when exists (
      select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) it
      where coalesce((it ->> 'is_catalog')::boolean, false)
    ) then 0
    else greatest(coalesce(p_amount, 0), 0)
  end
$$;

-- ── 2. Penalización de UNA venta, con la tasa propia de su servicio ─────────
create or replace function public._lateness_record_penalty(
  p_record_id uuid, p_points numeric
) returns numeric language plpgsql stable as $$
declare
  v_prof uuid;
  v_amount numeric;
  v_amount_services numeric;
  v_items jsonb;
  v_sched jsonb;
  v_general numeric;
  v_svc numeric;
  v_line jsonb;
  v_cfg jsonb;
  v_rate numeric;
  v_line_rate numeric;
  v_lines int := 0;
begin
  if coalesce(p_points, 0) <= 0 then
    return 0;
  end if;

  select cr.professional_id, cr.amount, cr.amount_services, p.items, bs.schedule, e.commission_pct
    into v_prof, v_amount, v_amount_services, v_items, v_sched, v_general
  from public.commission_records cr
  left join public.payments p on p.id = cr.sale_id
  left join public.employees e on e.id = cr.professional_id
  left join public.business_settings bs on bs.business_id = cr.business_id
  where cr.id = p_record_id;

  v_svc := public.lateness_service_commission(v_amount, v_amount_services, v_items);
  if v_svc <= 0 then
    return 0;
  end if;

  -- Tasa de cada línea de SERVICIO de la venta (mismo criterio que el cobro).
  for v_line in
    select it from jsonb_array_elements(coalesce(v_items, '[]'::jsonb)) it
    where not coalesce((it ->> 'is_catalog')::boolean, false)
  loop
    v_lines := v_lines + 1;
    v_cfg := v_sched -> '_employeeCommissions' -> v_prof::text -> (v_line ->> 'id');
    if v_cfg is not null and coalesce((v_cfg ->> 'enabled')::boolean, true) then
      if v_cfg ->> 'mode' = 'fixed' then
        return 0; -- importe fijo: sin penalización
      end if;
      v_line_rate := nullif(v_cfg ->> 'value', '')::numeric;
    else
      v_line_rate := v_general; -- sin configuración propia: tasa general
    end if;
    if v_line_rate is null or v_line_rate <= 0 then
      return 0;
    end if;
    if v_rate is not null and v_rate <> v_line_rate then
      return 0; -- varios servicios con tasas distintas: no hay una tasa única
    end if;
    v_rate := v_line_rate;
  end loop;

  if v_lines = 0 or v_rate is null then
    return 0;
  end if;

  return public.lateness_points_penalty(v_svc, v_rate, p_points);
end;
$$;

-- ── 3. Descuento total de una jornada para una regla ────────────────────────
create or replace function public._attendance_discount_for_rule(
  p_employee_id uuid, p_date date, p_rule_id uuid
) returns numeric language plpgsql stable as $$
declare
  v_type text;
  v_value numeric;
  v_services numeric;
  v_discount numeric;
begin
  if p_rule_id is null then
    return 0;
  end if;

  select lr.discount_type, lr.discount_value into v_type, v_value
  from public.lateness_rules lr
  where lr.id = p_rule_id;
  if v_type is null then
    return 0;
  end if;

  -- Comisión de SERVICIOS del día (sin catálogo): el tope del descuento.
  select coalesce(sum(public.lateness_service_commission(cr.amount, cr.amount_services, p.items)), 0)
    into v_services
  from public.commission_records cr
  left join public.payments p on p.id = cr.sale_id
  where cr.professional_id = p_employee_id and cr.sale_date = p_date;

  if v_type = 'fixed' then
    v_discount := round(v_value);
  else
    select coalesce(sum(public._lateness_record_penalty(cr.id, v_value)), 0)
      into v_discount
    from public.commission_records cr
    where cr.professional_id = p_employee_id and cr.sale_date = p_date;
    v_discount := round(v_discount);
  end if;

  return greatest(0, least(v_discount, v_services));
end;
$$;

-- ── 4. _compute_attendance: misma firma, descuento en puntos ────────────────
create or replace function public._compute_attendance(
  p_business_id uuid, p_employee_id uuid, p_branch_id uuid, p_date date,
  p_corrected_clock_in_at timestamptz default null
) returns table (
  work_session_id uuid,
  expected_start_at timestamptz,
  effective_clock_in_at timestamptz,
  late_minutes integer,
  status text,
  rule_id uuid,
  commission_services_available numeric,
  discount_amount_requested numeric
) language plpgsql stable as $$
declare
  v_session_id uuid;
  v_session_clock_in timestamptz;
  v_expected timestamptz;
  v_actual timestamptz;
  v_late integer;
  v_rule_id uuid;
  v_services numeric;
  v_discount numeric;
begin
  select ws.id, ws.clock_in_at into v_session_id, v_session_clock_in
  from public.work_sessions ws
  where ws.employee_id = p_employee_id
    and (ws.clock_in_at at time zone 'America/Argentina/Buenos_Aires')::date = p_date
  order by ws.clock_in_at desc
  limit 1;

  select s.expected_start_at into v_expected
  from public.get_scheduled_professionals_for_date(p_business_id, p_branch_id, p_date) s
  where s.employee_id = p_employee_id;

  v_actual := coalesce(p_corrected_clock_in_at, v_session_clock_in);

  -- Minutos TRUNCADOS: 11:00:59 -> 0 (a tiempo), 11:01:00 -> 1, 11:14:59 -> 14,
  -- 11:15:00 -> 15. Antes se redondeaban al minuto más cercano, así que
  -- 11:14:40 caía en el tramo de 11:15.
  v_late := case
    when v_expected is null or v_actual is null then 0
    else greatest(0, floor(extract(epoch from (v_actual - v_expected)) / 60)::int)
  end;

  select lr.id into v_rule_id
  from public.lateness_rules lr
  where lr.branch_id = p_branch_id and lr.min_minutes <= v_late and v_late > 0
  order by lr.min_minutes desc
  limit 1;

  select coalesce(sum(public.lateness_service_commission(cr.amount, cr.amount_services, p.items)), 0)
    into v_services
  from public.commission_records cr
  left join public.payments p on p.id = cr.sale_id
  where cr.professional_id = p_employee_id and cr.sale_date = p_date;

  v_discount := public._attendance_discount_for_rule(p_employee_id, p_date, v_rule_id);

  return query select
    v_session_id, v_expected, v_actual, v_late,
    case when v_actual is null then null when v_late > 0 then 'tarde' else 'a_tiempo' end,
    v_rule_id, v_services, v_discount;
end;
$$;

-- ── 5. Vista previa con hora de llegada corregida (solo lectura) ────────────
create or replace function public.preview_attendance_at(
  p_business_id uuid, p_employee_id uuid, p_branch_id uuid, p_date date,
  p_corrected_clock_in_at timestamptz default null
) returns table (
  work_session_id uuid, expected_start_at timestamptz, effective_clock_in_at timestamptz,
  late_minutes integer, status text, rule_id uuid,
  commission_services_available numeric, discount_amount_requested numeric
) language sql stable as $$
  select * from public._compute_attendance(p_business_id, p_employee_id, p_branch_id, p_date, p_corrected_clock_in_at);
$$;

-- ── 6. Desglose por venta de la penalización de una jornada ─────────────────
create or replace function public.attendance_penalty_breakdown(
  p_employee_id uuid, p_date date, p_rule_id uuid
) returns table (commission_record_id uuid, penalty numeric) language sql stable as $$
  select cr.id, public._lateness_record_penalty(cr.id, lr.discount_value)
  from public.commission_records cr
  join public.lateness_rules lr on lr.id = p_rule_id and lr.discount_type = 'percent'
  where cr.professional_id = p_employee_id and cr.sale_date = p_date
$$;

-- ── 7. Recalcular lo todavía no liquidado, con auditoría ────────────────────
-- Solo jornadas "tarde" con regla, sin ajuste manual, sin liquidar y dentro
-- del sistema de puntualidad. Se conserva la regla con la que ya se confirmó
-- (rule_id), el estado, los minutos y la hora de entrada: solo cambia el
-- importe, y solo si cambia.
with calculo as (
  select ac.id,
         ac.discount_amount_applied as anterior,
         public._attendance_discount_for_rule(ac.employee_id, ac.date, ac.rule_id) as nuevo
  from public.attendance_confirmations ac
  where ac.settlement_run_id is null
    and ac.penalty_overridden = false
    and ac.status = 'tarde'
    and ac.rule_id is not null
    and ac.date >= public.attendance_system_start_date()
),
cambios as (
  select * from calculo where nuevo is distinct from anterior
),
actualizadas as (
  update public.attendance_confirmations ac
     set discount_amount_requested = c.nuevo,
         discount_amount_applied = c.nuevo,
         updated_at = now()
    from cambios c
   where ac.id = c.id
  returning ac.business_id, ac.branch_id, ac.employee_id, ac.date, ac.work_session_id,
            ac.effective_clock_in_at, ac.late_minutes, ac.status, ac.rule_id,
            ac.confirmed_by, c.anterior, c.nuevo
)
insert into public.attendance_adjustments (
  business_id, branch_id, employee_id, date, work_session_id, action, reason,
  previous_clock_in_at, new_clock_in_at, previous_late_minutes, new_late_minutes,
  previous_discount_amount, new_discount_amount, previous_status, new_status, rule_id,
  performed_by, performed_by_name
)
select a.business_id, a.branch_id, a.employee_id, a.date, a.work_session_id,
       'override_penalty',
       'Recálculo automático: la regla de tardanza ahora resta puntos porcentuales a la tasa de comisión',
       a.effective_clock_in_at, a.effective_clock_in_at, a.late_minutes, a.late_minutes,
       a.anterior, a.nuevo, a.status, a.status, a.rule_id,
       a.confirmed_by, 'Sistema · recálculo de puntualidad'
from actualizadas a;

-- Que la API vea las funciones nuevas (preview_attendance_at,
-- attendance_penalty_breakdown) sin esperar a que se recargue sola.
notify pgrst, 'reload schema';
