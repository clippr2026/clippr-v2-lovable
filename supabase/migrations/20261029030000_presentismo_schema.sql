-- Presentismo: confirmación administrativa de asistencia, con auditoría
-- append-only y descuento de tardanza RECALCULADO server-side contra las
-- comisiones de SERVICIOS reales del día (nunca congelado en $0 al fichar
-- entrada, que era el bug real de antes — ver lib/fichaje.ts).
--
-- Todo lo de acá es aditivo: no toca work_sessions/lateness_rules/
-- lateness_discounts existentes, ni ningún dato de ventas/comisiones.

create table public.attendance_confirmations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  branch_id uuid not null references public.branches(id),
  employee_id uuid not null references public.employees(id),
  date date not null,
  work_session_id uuid references public.work_sessions(id),
  expected_start_at timestamptz,
  effective_clock_in_at timestamptz,
  late_minutes integer not null default 0,
  status text not null check (status in ('a_tiempo', 'tarde', 'ausente')),
  rule_id uuid references public.lateness_rules(id),
  commission_services_available numeric(12, 2) not null default 0,
  discount_amount_requested numeric(12, 2) not null default 0,
  discount_amount_applied numeric(12, 2) not null default 0,
  penalty_overridden boolean not null default false,
  confirmed_by uuid not null references public.profiles(id),
  confirmed_by_name text not null,
  confirmed_at timestamptz not null default now(),
  caja_cierre_id uuid references public.caja_cierres(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_confirmations_unique_per_day unique (business_id, employee_id, date)
);

create index idx_attendance_confirmations_branch_date on public.attendance_confirmations (branch_id, date);
create index idx_attendance_confirmations_employee on public.attendance_confirmations (employee_id, date);

alter table public.attendance_confirmations enable row level security;

create policy attendance_confirmations_select on public.attendance_confirmations
  for select using (
    business_id in (select p.business_id from public.profiles p where p.id = auth.uid())
  );

-- INSERT/UPDATE/DELETE directos quedan cerrados a propósito — todo cambio
-- pasa por confirm_attendance (security definer), nunca un UPDATE/INSERT
-- directo desde el cliente, para que la auditoría en attendance_adjustments
-- nunca pueda quedar desincronizada de esta tabla.

create table public.attendance_adjustments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  branch_id uuid not null references public.branches(id),
  employee_id uuid not null references public.employees(id),
  date date not null,
  work_session_id uuid references public.work_sessions(id),
  action text not null check (action in
    ('confirm_on_time', 'confirm_late', 'mark_absent', 'correct_time', 'override_penalty', 'revert_absent')),
  reason text not null,
  previous_clock_in_at timestamptz,
  new_clock_in_at timestamptz,
  previous_late_minutes integer,
  new_late_minutes integer,
  previous_discount_amount numeric(12, 2),
  new_discount_amount numeric(12, 2),
  performed_by uuid not null references public.profiles(id),
  performed_by_name text not null,
  created_at timestamptz not null default now()
);

create index idx_attendance_adjustments_employee_date on public.attendance_adjustments (employee_id, date);
create index idx_attendance_adjustments_business on public.attendance_adjustments (business_id, created_at desc);

alter table public.attendance_adjustments enable row level security;

create policy attendance_adjustments_select on public.attendance_adjustments
  for select using (
    business_id in (select p.business_id from public.profiles p where p.id = auth.uid())
  );

-- Append-only real: ninguna policy de insert/update/delete directo desde
-- el cliente — la única fila que puede existir es la que confirm_attendance
-- (security definer) inserta. Sin política de UPDATE/DELETE para ningún
-- rol, el candado vive en la base, no en que la UI no muestre un botón.

-- Snapshot al cerrar una jornada (closeSingleDayCierre la completa, mismo
-- patrón que cobros_snapshot/gastos_snapshot ya existentes).
alter table public.caja_cierres add column if not exists presentismo_snapshot jsonb;

-- Profesionales activos de una sucursal con horario propio configurado
-- para una fecha dada (business_settings.schedule._employeeSchedules) —
-- único punto de verdad para "¿quién tenía jornada programada?". Mismo
-- criterio simple que ya usa resolveExpectedStartToday en fichaje.ts (sin
-- fechas especiales, sin heredar el horario del negocio) — gap conocido y
-- documentado: vacaciones cargadas como fecha especial no excluyen acá.
create or replace function public.get_scheduled_professionals_for_date(
  p_business_id uuid, p_branch_id uuid, p_date date
) returns table (employee_id uuid, expected_start_at timestamptz)
language sql stable as $$
  select
    e.id,
    (
      (p_date::text || ' ' || (d.day_cfg ->> 'start'))::timestamp
      at time zone 'America/Argentina/Buenos_Aires'
    )
  from public.employees e
  join public.business_settings bs on bs.business_id = e.business_id
  cross join lateral (
    select bs.schedule -> '_employeeSchedules' -> e.id::text ->
      (array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from p_date)::int + 1] as day_cfg
  ) d
  where e.business_id = p_business_id
    and e.branch_id = p_branch_id
    and e.is_active = true
    and d.day_cfg is not null
    and (d.day_cfg ->> 'enabled') is distinct from 'false'
    and (d.day_cfg ->> 'start') is not null
    and (d.day_cfg ->> 'end') is not null;
$$;

-- Cálculo compartido entre preview_attendance (solo lectura) y
-- confirm_attendance (que además persiste) — una sola fórmula, nunca dos.
-- p_corrected_clock_in_at reemplaza la hora real fichada SOLO para este
-- cálculo (corrección manual con motivo); el fichaje original en
-- work_sessions nunca se modifica acá.
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
  v_rule_type text;
  v_rule_value numeric;
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

  v_late := case
    when v_expected is null or v_actual is null then 0
    else greatest(0, round(extract(epoch from (v_actual - v_expected)) / 60)::int)
  end;

  select lr.id, lr.discount_type, lr.discount_value into v_rule_id, v_rule_type, v_rule_value
  from public.lateness_rules lr
  where lr.branch_id = p_branch_id and lr.min_minutes <= v_late and v_late > 0
  order by lr.min_minutes desc
  limit 1;

  -- Comisión de SERVICIOS del día (no bruta, no incluye productos) — misma
  -- fuente que prepare_settlement_run: coalesce(amount_services, amount)
  -- para filas viejas sin ese desglose.
  select coalesce(sum(coalesce(cr.amount_services, cr.amount)), 0) into v_services
  from public.commission_records cr
  where cr.professional_id = p_employee_id and cr.sale_date = p_date;

  v_discount := case
    when v_rule_id is null then 0
    when v_rule_type = 'fixed' then round(v_rule_value)
    else round(v_services * v_rule_value / 100)
  end;
  v_discount := greatest(0, least(v_discount, v_services));

  return query select
    v_session_id, v_expected, v_actual, v_late,
    case when v_actual is null then null when v_late > 0 then 'tarde' else 'a_tiempo' end,
    v_rule_id, v_services, v_discount;
end;
$$;

create or replace function public.preview_attendance(
  p_business_id uuid, p_employee_id uuid, p_branch_id uuid, p_date date
) returns table (
  work_session_id uuid, expected_start_at timestamptz, effective_clock_in_at timestamptz,
  late_minutes integer, status text, rule_id uuid,
  commission_services_available numeric, discount_amount_requested numeric
) language sql stable as $$
  select * from public._compute_attendance(p_business_id, p_employee_id, p_branch_id, p_date, null);
$$;

-- Confirma/corrige/ausenta/ajusta el presentismo de UN profesional en UNA
-- fecha — siempre upsert (1 fila vigente por business_id+employee_id+date)
-- + 1 fila nueva en attendance_adjustments (append-only, nunca se
-- actualiza ni se borra). El motivo es obligatorio en TODAS las acciones,
-- no solo en las de corrección — así el log siempre explica por qué,
-- incluso para "confirmo a tiempo, nada que corregir".
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
  v_discount := greatest(0, least(v_discount, coalesce(v_computed.commission_services_available, 0)));

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
    previous_discount_amount, new_discount_amount, performed_by, performed_by_name
  ) values (
    p_business_id, p_branch_id, p_employee_id, p_date, v_computed.work_session_id, p_action, p_reason,
    v_prev.effective_clock_in_at, v_row.effective_clock_in_at,
    v_prev.late_minutes, v_row.late_minutes,
    v_prev.discount_amount_applied, v_row.discount_amount_applied,
    p_confirmed_by, p_confirmed_by_name
  );

  return v_row;
end;
$$;

-- "¿Está cerrado ESTE día AHORA MISMO?" — NO es estado='cerrada' (ese
-- nunca vuelve a cambiar cuando se reabre un día, ver "Reabrir caja" en
-- cash-register.tsx: solo agrega un evento 'reapertura', nunca toca
-- estado). El criterio real es el ÚLTIMO evento de tipo 'cierre' o
-- 'reapertura' en la columna eventos (jsonb) — ignorando cualquier
-- 'correccion' que se haya agregado después sin reabrir nada (hay casos
-- reales así en producción: un día cerrado, con una corrección de cobro
-- anotada después, sigue cerrado). Mismo criterio que closeSingleDayCierre
-- usa como su propio guard anti-doble-cierre (lastExistingEvent?.tipo).
create or replace function public.is_caja_closed_now(
  p_business_id uuid, p_branch_id uuid, p_fecha date
) returns boolean language sql stable as $$
  select coalesce(
    (
      select elem ->> 'tipo'
      from public.caja_cierres cc, jsonb_array_elements(cc.eventos) with ordinality as e(elem, ord)
      where cc.business_id = p_business_id
        and (cc.branch_id = p_branch_id or (p_branch_id is null and cc.branch_id is null))
        and cc.fecha = p_fecha
        and elem ->> 'tipo' in ('cierre', 'reapertura')
      order by ord desc
      limit 1
    ) = 'cierre',
    false
  );
$$;

-- Fechas con actividad real (mismo criterio EXACTO que pendingDatesFromActivity
-- en caja-cierre.ts: payments no anulados/reembolsados + expenses, por día
-- calendario de Buenos Aires) que no están cerradas AHORA — usado tanto
-- por la UI ("Fechas pendientes: ...") como por el gate dentro de
-- prepare_settlement_run. Una sola fuente, nunca dos criterios distintos.
create or replace function public.get_pending_cierres_in_period(
  p_business_id uuid, p_branch_id uuid, p_from date, p_to date
) returns table (fecha date) language sql stable as $$
  with candidatas as (
    select generate_series(p_from, p_to, interval '1 day')::date as fecha
  ),
  activas as (
    select c.fecha from candidatas c
    where exists (
      select 1 from public.payments pm
      where pm.business_id = p_business_id
        and (p_branch_id is null or pm.branch_id = p_branch_id or pm.branch_id is null)
        and pm.status not in ('anulado', 'reembolsado')
        and (pm.created_at at time zone 'America/Argentina/Buenos_Aires')::date = c.fecha
    ) or exists (
      select 1 from public.expenses ex
      where ex.business_id = p_business_id
        and (p_branch_id is null or ex.branch_id = p_branch_id or ex.branch_id is null)
        and ex.date = c.fecha
    )
  )
  select fecha from activas
  where not public.is_caja_closed_now(p_business_id, p_branch_id, fecha)
  order by fecha;
$$;

NOTIFY pgrst, 'reload schema';
