-- ============================================================================
-- "Venta anulada" en Caja → Liquidaciones → Adelantos — ciclo completo de
-- commission_adjustment_queue: hasta ahora se encolaba una deducción
-- pendiente al anular una venta ya liquidada, pero NADA la aplicaba nunca
-- (ninguna función tocaba applied_settlement_run_id salvo para leerlo) —
-- "pendiente" nunca pasaba a "compensado". Este cambio:
--
-- 1) commission_adjustment_queue.authorization_log_id (nuevo, nullable,
--    FK a payment_authorization_log) — vínculo DIRECTO para motivo/quién
--    anuló/quién autorizó, en vez de encontrarlo por coincidencia de
--    sale_id + created_at (que funcionaba porque now() es estable dentro
--    de una misma transacción, pero era frágil para construir encima).
--
-- 2) void_payment_authorized: reordenado para insertar primero en
--    payment_authorization_log (con RETURNING id), recién después en
--    commission_adjustment_queue usando ese id. Mismo comportamiento de
--    siempre en todo lo demás (cero cambios de lógica, solo el orden).
--
-- 3) prepare_settlement_run: al preparar una liquidación nueva, también
--    suma las filas pendientes (applied_settlement_run_id is null) de
--    commission_adjustment_queue de ese profesional como parte de
--    `deductions` (mismo total que ya usan los ajustes/deducciones
--    manuales) — y recién en ese momento, cuando el run ya se creó con
--    ese monto adentro de su total, las marca `applied_settlement_run_id
--    = v_run.id` ("compensado"). Nunca antes. Nunca toca una liquidación
--    ya creada — solo lee filas sin aplicar y las suma a la liquidación
--    NUEVA que se está creando ahora mismo.
--
-- 4) commission_adjustment_queue.kind ('deduccion' | 'credito', default
--    'deduccion' — todas las filas existentes ya eran deducciones). Si una
--    venta ya tiene su deducción COMPENSADA (aplicada a una liquidación ya
--    creada) y se restablece, restore_payment_authorized sigue sin poder
--    tocar esa liquidación ya creada (correcto) — pero ahora SÍ encola un
--    crédito a favor del profesional (kind='credito'), por el neto
--    pendiente de revertir (deducciones aplicadas menos créditos ya
--    encolados para esa venta — nunca un segundo crédito por la misma
--    deducción). prepare_settlement_run suma los créditos pendientes a
--    `adjustments` (mismo mecanismo ya probado que los ajustes manuales),
--    nunca a `deductions`. Ni el crédito ni la deducción que revierte
--    tocan ninguna liquidación ya creada — solo se absorben en la
--    liquidación NUEVA que se esté preparando cuando corresponda.
-- ============================================================================
-- Cómo correrlo: SQL Editor de Supabase, primero en desarrollo si existe,
-- después en producción. Requiere 20261026010000 ya corrida. Idempotente.
-- ============================================================================
begin;

alter table public.commission_adjustment_queue
  add column if not exists authorization_log_id uuid references public.payment_authorization_log(id);

create index if not exists idx_commission_adjustment_queue_log
  on public.commission_adjustment_queue (authorization_log_id)
  where authorization_log_id is not null;

alter table public.commission_adjustment_queue
  add column if not exists kind text not null default 'deduccion';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'commission_adjustment_queue_kind_check'
  ) then
    alter table public.commission_adjustment_queue
      add constraint commission_adjustment_queue_kind_check
      check (kind in ('deduccion', 'credito'));
  end if;
end $$;

-- ── void_payment_authorized: reordenado para capturar authorization_log_id ─
drop function if exists public.void_payment_authorized(uuid, uuid, text, text, text, text);

create or replace function public.void_payment_authorized(
  p_payment_id uuid,
  p_business_id uuid,
  p_password text,
  p_reason text,
  p_authorized_by_name text default null,
  p_performed_by_name text default null
)
returns table (new_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_business uuid;
  v_caller_name text;
  v_payment public.payments;
  v_employee_name text;
  v_commission public.commission_records;
  v_commission_found boolean;
  v_impact_note text;
  v_sale_date date;
  v_is_closed boolean;
  v_cash_method text;
  v_cash_amount numeric;
  v_log_id uuid;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'El motivo es obligatorio';
  end if;
  if length(p_reason) > 50 then
    raise exception 'El motivo no puede superar los 50 caracteres';
  end if;
  if p_authorized_by_name is not null and length(trim(p_authorized_by_name)) > 20 then
    raise exception 'El nombre de quien autorizó no puede superar los 20 caracteres';
  end if;
  if p_performed_by_name is not null and length(trim(p_performed_by_name)) > 20 then
    raise exception 'El nombre de quien hizo el cambio no puede superar los 20 caracteres';
  end if;

  select p.business_id into v_caller_business
  from public.profiles p where p.id = auth.uid();

  if v_caller_business is distinct from p_business_id then
    raise exception 'No tenés permiso sobre este negocio';
  end if;

  select coalesce(
    nullif(trim(p_performed_by_name), ''),
    nullif(trim(e.full_name), ''),
    nullif(trim(p.full_name), ''),
    'Usuario'
  ) into v_caller_name
  from public.profiles p
  left join public.employees e on e.id = p.employee_id
  where p.id = auth.uid();

  perform public._verify_caja_authorization_password(p_business_id, 'void', p_password);

  select * into v_payment
  from public.payments
  where id = p_payment_id and business_id = p_business_id
  for update;

  if not found then
    raise exception 'Cobro no encontrado';
  end if;

  if v_payment.status in ('anulado', 'reembolsado') then
    raise exception 'Esta venta ya está anulada';
  end if;

  select e.full_name into v_employee_name
  from public.employees e where e.id = v_payment.employee_id;

  update public.payments
    set status = 'anulado'
    where id = p_payment_id;

  v_sale_date := (v_payment.created_at at time zone 'America/Argentina/Buenos_Aires')::date;

  select exists(
    select 1 from public.caja_cierres
    where business_id = p_business_id
      and branch_id is not distinct from v_payment.branch_id
      and fecha = v_sale_date
      and estado in ('cerrada', 'reabierta')
  ) into v_is_closed;

  if v_is_closed then
    v_cash_amount := coalesce(v_payment.total, v_payment.amount, 0) + coalesce(v_payment.tip_amount, 0);
    v_cash_method := case
      when lower(trim(coalesce(v_payment.method, v_payment.payment_method, ''))) in ('', 'cash', 'efectivo') then 'efectivo'
      else 'cuenta'
    end;
    if v_cash_amount > 0 then
      insert into public.cash_movements (
        business_id, branch_id, type, amount, method, note, created_by, sale_id
      ) values (
        p_business_id, v_payment.branch_id, 'retiro', v_cash_amount, v_cash_method,
        '[AJUSTE-ANULACION] Anulación de venta del ' || to_char(v_sale_date, 'DD/MM/YYYY') || ' (día ya cerrado) — ' || trim(p_reason),
        v_caller_name, p_payment_id
      );
    end if;
  end if;

  select * into v_commission
  from public.commission_records
  where sale_id = p_payment_id and business_id = p_business_id;
  v_commission_found := found;

  if v_commission_found and v_commission.settlement_run_id is not null and v_commission.amount > 0 then
    v_impact_note := 'Comisión ya liquidada — se registró una deducción pendiente de $' || to_char(v_commission.amount, 'FM999G999G999') || ' para la próxima liquidación del profesional.';
  elsif v_commission_found and v_commission.amount > 0 then
    v_impact_note := 'Comisión y propina liberadas (la venta todavía no estaba liquidada).';
  else
    v_impact_note := 'Venta sin comisión asociada.';
  end if;

  if v_is_closed then
    v_impact_note := v_impact_note || ' El día de esta venta ya estaba cerrado — el cierre guardado no se tocó; se registró un retiro de $'
      || to_char(coalesce(v_payment.total, v_payment.amount, 0) + coalesce(v_payment.tip_amount, 0), 'FM999G999G999') || ' visible hoy en Movimientos de caja.';
  end if;

  insert into public.payment_authorization_log (
    business_id, payment_id, action_type, reason, performed_by, performed_by_name,
    authorized_by_name, impact_note, before_snapshot, after_snapshot
  ) values (
    p_business_id, p_payment_id, 'void', trim(p_reason), auth.uid(), v_caller_name,
    nullif(trim(coalesce(p_authorized_by_name, '')), ''), v_impact_note,
    jsonb_build_object(
      'status', v_payment.status, 'total', coalesce(v_payment.total, v_payment.amount),
      'client_name', v_payment.client_name, 'service_name', v_payment.service_name,
      'employee_id', v_payment.employee_id, 'employee_name', v_employee_name,
      'method', coalesce(v_payment.method, v_payment.payment_method)
    ),
    jsonb_build_object('status', 'anulado', 'day_was_closed', v_is_closed)
  ) returning id into v_log_id;

  if v_commission_found and v_commission.settlement_run_id is not null and v_commission.amount > 0 then
    insert into public.commission_adjustment_queue (
      business_id, professional_id, sale_id, commission_amount, reason, authorization_log_id, kind
    ) values (
      p_business_id, v_commission.professional_id, p_payment_id, v_commission.amount,
      'Venta anulada (ya liquidada) — ' || trim(p_reason), v_log_id, 'deduccion'
    );
  end if;

  return query select 'anulado'::text;
end;
$$;

-- ── prepare_settlement_run: consume commission_adjustment_queue pendiente ──
drop function if exists public.prepare_settlement_run(uuid, uuid, jsonb, jsonb, uuid, text, timestamptz);

create or replace function public.prepare_settlement_run(
  p_business_id uuid,
  p_professional_id uuid,
  p_adjustment_items jsonb,
  p_deduction_items jsonb,
  p_prepared_by uuid,
  p_prepared_by_name text,
  p_cutoff_at timestamp with time zone default null
)
returns settlement_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_caller_business uuid;
  v_previous_run public.settlement_runs;
  v_cutoff_at timestamptz := coalesce(p_cutoff_at, now());
  v_cutoff_date date := (coalesce(p_cutoff_at, now()) at time zone 'America/Argentina/Buenos_Aires')::date;
  v_period_start date;
  v_period_start_at timestamptz;
  v_previous_balance numeric := 0;
  v_new_commissions numeric := 0;
  v_new_commissions_services numeric := 0;
  v_new_commissions_products numeric := 0;
  v_recovered_commissions numeric := 0;
  v_new_tips numeric := 0;
  v_recovered_tips numeric := 0;
  v_service_count int := 0;
  v_total_sold numeric := 0;
  v_adjustment_items jsonb := coalesce(p_adjustment_items, '[]'::jsonb);
  v_deduction_items jsonb := coalesce(p_deduction_items, '[]'::jsonb);
  v_adjustments numeric := 0;
  v_deductions numeric := 0;
  v_advances numeric := 0;
  v_item jsonb;
  v_item_amount numeric;
  v_total numeric;
  v_run_number int;
  v_run public.settlement_runs;
  v_professional_name text;
  v_adjustment_movement public.business_movements;
  v_deduction_movement public.business_movements;
  v_queue_row public.commission_adjustment_queue;
  v_queue_deduction numeric := 0;
  v_queue_credito numeric := 0;
begin
  if p_prepared_by is distinct from auth.uid() then
    raise exception 'prepared_by debe ser el usuario autenticado';
  end if;

  if v_cutoff_at > now() then
    raise exception 'La fecha de corte no puede ser futura';
  end if;

  select p.role, p.business_id into v_role, v_caller_business
  from public.profiles p where p.id = auth.uid();

  if v_caller_business is distinct from p_business_id then
    raise exception 'No tenés permiso sobre este negocio';
  end if;

  if v_role = 'profesional' then
    raise exception 'Un profesional no puede preparar sus propias liquidaciones';
  end if;

  select e.full_name into v_professional_name
  from public.employees e where e.id = p_professional_id;

  for v_item in select * from jsonb_array_elements(v_adjustment_items)
  loop
    v_item_amount := coalesce((v_item->>'amount')::numeric, 0);
    if v_item_amount < 0 then
      raise exception 'El importe de un ajuste no puede ser negativo';
    end if;
    if v_item_amount > 0 and coalesce(trim(v_item->>'reason'), '') = '' then
      raise exception 'Cada ajuste con importe mayor a $0 necesita un motivo';
    end if;
    v_adjustments := v_adjustments + v_item_amount;
  end loop;

  for v_item in select * from jsonb_array_elements(v_deduction_items)
  loop
    v_item_amount := coalesce((v_item->>'amount')::numeric, 0);
    if v_item_amount < 0 then
      raise exception 'El importe de una deducción no puede ser negativo';
    end if;
    if v_item_amount > 0 and coalesce(trim(v_item->>'reason'), '') = '' then
      raise exception 'Cada deducción con importe mayor a $0 necesita un motivo';
    end if;
    v_deductions := v_deductions + v_item_amount;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));

  select * into v_previous_run
  from public.settlement_runs
  where business_id = p_business_id and professional_id = p_professional_id
  order by cutoff_date desc, created_at desc
  limit 1;

  if found then
    if v_cutoff_at <= v_previous_run.prepared_at then
      raise exception 'La fecha de corte no puede ser anterior al inicio del período actual';
    end if;
    v_previous_balance := greatest(v_previous_run.total_to_settle - v_previous_run.amount_paid, 0);
    v_period_start_at := v_previous_run.prepared_at;
    v_period_start := v_period_start_at::date;
  end if;

  -- Comisiones NORMALES — ventana por pm.created_at (fecha de la venta),
  -- excluyendo CUALQUIER venta pendiente/parcial (sin importar si ya tiene
  -- algún cobro registrado o no) Y cualquier venta que haya pasado alguna
  -- vez por el flujo de pendientes (not exists payment_collections — una
  -- vez cobrada del todo por ese camino, su comisión siempre sale de
  -- commission_collection_events, nunca reingresa acá).
  select coalesce(count(*), 0),
         coalesce(sum(coalesce(cr.amount_services, cr.amount)), 0),
         coalesce(sum(coalesce(cr.amount_products, 0)), 0)
    into v_service_count, v_new_commissions_services, v_new_commissions_products
  from public.commission_records cr
  join public.payments pm on pm.id = cr.sale_id
  where cr.business_id = p_business_id
    and cr.professional_id = p_professional_id
    and cr.settlement_run_id is null
    and (v_period_start_at is null or pm.created_at > v_period_start_at)
    and pm.created_at <= v_cutoff_at
    and cr.pending_amount > 0
    and pm.status not in ('pendiente', 'parcial')
    and not exists (
      select 1 from public.payment_collections pc where pc.payment_id = cr.sale_id
    );
  v_new_commissions := v_new_commissions_services + v_new_commissions_products;

  -- Comisiones RECUPERADAS — sin cambios respecto de 20261023050000.
  select coalesce(sum(cce.amount), 0)
    into v_recovered_commissions
  from public.commission_collection_events cce
  join public.commission_records cr on cr.id = cce.commission_record_id
  where cr.business_id = p_business_id
    and cr.professional_id = p_professional_id
    and cce.settlement_run_id is null
    and (v_period_start_at is null or cce.collected_at > v_period_start_at)
    and cce.collected_at <= v_cutoff_at;

  -- Propinas NORMALES — misma exclusión que comisiones normales.
  select coalesce(sum(tr.pending_amount), 0)
    into v_new_tips
  from public.tip_records tr
  join public.payments pm on pm.id = tr.sale_id
  where tr.business_id = p_business_id
    and tr.professional_id = p_professional_id
    and tr.settlement_run_id is null
    and (v_period_start_at is null or pm.created_at > v_period_start_at)
    and pm.created_at <= v_cutoff_at
    and tr.pending_amount > 0
    and pm.status not in ('pendiente', 'parcial')
    and not exists (
      select 1 from public.payment_collections pc where pc.payment_id = tr.sale_id
    );

  -- Propinas RECUPERADAS — sin cambios.
  select coalesce(sum(tce.amount), 0)
    into v_recovered_tips
  from public.tip_collection_events tce
  join public.tip_records tr on tr.id = tce.tip_record_id
  where tr.business_id = p_business_id
    and tr.professional_id = p_professional_id
    and tce.settlement_run_id is null
    and (v_period_start_at is null or tce.collected_at > v_period_start_at)
    and tce.collected_at <= v_cutoff_at;

  select coalesce(sum(coalesce(pm.total, pm.amount, 0)), 0)
    into v_total_sold
  from public.commission_records cr
  join public.payments pm on pm.id = cr.sale_id
  where cr.business_id = p_business_id
    and cr.professional_id = p_professional_id
    and cr.settlement_run_id is null
    and (v_period_start_at is null or pm.created_at > v_period_start_at)
    and pm.created_at <= v_cutoff_at;

  select coalesce(sum(amount), 0) into v_advances
  from public.professional_advances
  where business_id = p_business_id
    and professional_id = p_professional_id
    and settlement_run_id is null
    and advanced_at <= v_cutoff_at;

  -- "Venta anulada" (commission_adjustment_queue, ver
  -- void_payment_authorized/restore_payment_authorized) — pendiente de
  -- compensar, sin importar cuándo se encoló (no tiene ventana de
  -- período, es una deuda/crédito standing hasta que se absorbe en la
  -- próxima liquidación que se prepare). kind='deduccion' resta de
  -- `deductions` (venta anulada con comisión ya liquidada);
  -- kind='credito' suma a `adjustments` (venta restablecida cuya
  -- deducción ya estaba compensada — ver restore_payment_authorized).
  -- Recién después de insertar el run se marcan applied_settlement_run_id,
  -- nunca antes.
  for v_queue_row in
    select * from public.commission_adjustment_queue
    where business_id = p_business_id
      and professional_id = p_professional_id
      and applied_settlement_run_id is null
      and created_at <= v_cutoff_at
  loop
    if v_queue_row.kind = 'credito' then
      v_queue_credito := v_queue_credito + v_queue_row.commission_amount;
      v_adjustment_items := v_adjustment_items || jsonb_build_object(
        'amount', v_queue_row.commission_amount,
        'reason', v_queue_row.reason,
        'sale_id', v_queue_row.sale_id,
        'commission_adjustment_queue_id', v_queue_row.id
      );
    else
      v_queue_deduction := v_queue_deduction + v_queue_row.commission_amount;
      v_deduction_items := v_deduction_items || jsonb_build_object(
        'amount', v_queue_row.commission_amount,
        'reason', v_queue_row.reason,
        'sale_id', v_queue_row.sale_id,
        'commission_adjustment_queue_id', v_queue_row.id
      );
    end if;
  end loop;
  v_deductions := v_deductions + v_queue_deduction;
  v_adjustments := v_adjustments + v_queue_credito;

  v_total := v_previous_balance + v_new_commissions + v_recovered_commissions
             + v_new_tips + v_recovered_tips + v_adjustments - v_deductions - v_advances;
  if v_total < 0 then
    raise exception 'El total a liquidar no puede ser negativo (revisá ajustes/deducciones/adelantos)';
  end if;

  select greatest(coalesce(max(run_number), 0) + 1, 100) into v_run_number
  from public.settlement_runs
  where business_id = p_business_id;

  insert into public.settlement_runs (
    business_id, professional_id, professional_name, run_number, cutoff_date, prepared_at,
    period_start, period_start_at,
    previous_settlement_run_id,
    previous_balance, new_commissions, new_commissions_services, new_commissions_products,
    recovered_commissions, new_tips, recovered_tips,
    adjustments, deductions, adjustment_items, deduction_items, advances,
    total_to_settle,
    service_count, total_sold, status, prepared_by, prepared_by_name
  ) values (
    p_business_id, p_professional_id, v_professional_name, v_run_number, v_cutoff_date, v_cutoff_at,
    v_period_start, v_period_start_at,
    v_previous_run.id,
    v_previous_balance, v_new_commissions, v_new_commissions_services, v_new_commissions_products,
    v_recovered_commissions, v_new_tips, v_recovered_tips,
    v_adjustments, v_deductions, v_adjustment_items, v_deduction_items, v_advances,
    v_total,
    v_service_count, v_total_sold, 'pendiente', p_prepared_by, p_prepared_by_name
  ) returning * into v_run;

  if v_adjustments > 0 then
    select * into v_adjustment_movement from public.next_business_movement_number(
      p_business_id, 'ajuste', p_professional_id, v_adjustments, v_cutoff_at
    );
    v_run.adjustment_movement_number := v_adjustment_movement.movement_number;
    v_run.adjustment_movement_id := v_adjustment_movement.id;
  end if;

  if v_deductions > 0 then
    select * into v_deduction_movement from public.next_business_movement_number(
      p_business_id, 'deduccion', p_professional_id, v_deductions, v_cutoff_at
    );
    v_run.deduction_movement_number := v_deduction_movement.movement_number;
    v_run.deduction_movement_id := v_deduction_movement.id;
  end if;

  if v_adjustments > 0 or v_deductions > 0 then
    update public.settlement_runs
      set adjustment_movement_number = v_run.adjustment_movement_number,
          adjustment_movement_id = v_run.adjustment_movement_id,
          deduction_movement_number = v_run.deduction_movement_number,
          deduction_movement_id = v_run.deduction_movement_id
      where id = v_run.id;
  end if;

  -- Bloquea cada comisión NORMAL — misma exclusión que el sweep de arriba.
  update public.commission_records cr
    set settlement_run_id = v_run.id,
        snapshot_client_name = pm.client_name,
        snapshot_service_name = pm.service_name,
        snapshot_sale_total = coalesce(pm.total, pm.amount),
        snapshot_payment_method = coalesce(pm.method, pm.payment_method)
    from public.payments pm
    where pm.id = cr.sale_id
      and cr.business_id = p_business_id
      and cr.professional_id = p_professional_id
      and cr.settlement_run_id is null
      and (v_period_start_at is null or pm.created_at > v_period_start_at)
      and pm.created_at <= v_cutoff_at
      and pm.status not in ('pendiente', 'parcial')
      and not exists (
        select 1 from public.payment_collections pc where pc.payment_id = cr.sale_id
      );

  -- Mismo bloqueo para las propinas normales.
  update public.tip_records tr
    set settlement_run_id = v_run.id
    from public.payments pm
    where pm.id = tr.sale_id
      and tr.business_id = p_business_id
      and tr.professional_id = p_professional_id
      and tr.settlement_run_id is null
      and (v_period_start_at is null or pm.created_at > v_period_start_at)
      and pm.created_at <= v_cutoff_at
      and pm.status not in ('pendiente', 'parcial')
      and not exists (
        select 1 from public.payment_collections pc where pc.payment_id = tr.sale_id
      );

  update public.commission_collection_events cce
    set settlement_run_id = v_run.id
    from public.commission_records cr
    where cr.id = cce.commission_record_id
      and cr.business_id = p_business_id
      and cr.professional_id = p_professional_id
      and cce.settlement_run_id is null
      and (v_period_start_at is null or cce.collected_at > v_period_start_at)
      and cce.collected_at <= v_cutoff_at;

  update public.tip_collection_events tce
    set settlement_run_id = v_run.id
    from public.tip_records tr
    where tr.id = tce.tip_record_id
      and tr.business_id = p_business_id
      and tr.professional_id = p_professional_id
      and tce.settlement_run_id is null
      and (v_period_start_at is null or tce.collected_at > v_period_start_at)
      and tce.collected_at <= v_cutoff_at;

  update public.professional_advances
    set settlement_run_id = v_run.id
    where business_id = p_business_id
      and professional_id = p_professional_id
      and settlement_run_id is null
      and advanced_at <= v_cutoff_at;

  -- "Venta anulada" (deducción o crédito): recién ACA, con el run ya
  -- creado y su monto ya adentro de total_to_settle, pasa de "pendiente"
  -- a "compensado". Nunca antes de que el run exista de verdad.
  if v_queue_deduction > 0 or v_queue_credito > 0 then
    update public.commission_adjustment_queue
      set applied_settlement_run_id = v_run.id
      where business_id = p_business_id
        and professional_id = p_professional_id
        and applied_settlement_run_id is null
        and created_at <= v_cutoff_at;
  end if;

  insert into public.settlement_run_sales (
    business_id, settlement_run_id, professional_id, sale_id, occurred_at,
    client_name, service_name, total, method,
    discount, original_amount, promotion_id, promotion_name, tip_amount,
    commission_amount, observations
  )
  select
    p_business_id, v_run.id, p_professional_id, pm.id, pm.created_at,
    pm.client_name, pm.service_name, coalesce(pm.total, pm.amount, 0), coalesce(pm.method, pm.payment_method),
    pm.discount, pm.original_amount, pm.promotion_id, pm.promotion_name, pm.tip_amount,
    coalesce(cr.amount, 0), pm.observations
  from public.payments pm
  left join public.commission_records cr on cr.sale_id = pm.id
  where pm.business_id = p_business_id
    and pm.employee_id = p_professional_id
    and (v_period_start_at is null or pm.created_at > v_period_start_at)
    and pm.created_at <= v_cutoff_at;

  return v_run;
end;
$$;

-- ── restore_payment_authorized: + crédito inverso si ya estaba compensada ──
drop function if exists public.restore_payment_authorized(uuid, uuid, text, text, text, text);

create or replace function public.restore_payment_authorized(
  p_payment_id uuid,
  p_business_id uuid,
  p_password text,
  p_reason text,
  p_authorized_by_name text default null,
  p_performed_by_name text default null
)
returns table (new_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_business uuid;
  v_caller_name text;
  v_payment public.payments;
  v_employee_name text;
  v_commission public.commission_records;
  v_tip public.tip_records;
  v_impact_note text;
  v_commission_locked boolean := false;
  v_tip_locked boolean := false;
  v_reversed_count int := 0;
  v_reversed_amount numeric := 0;
  v_net_credito numeric := 0;
  v_sale_date date;
  v_is_closed boolean;
  v_cash_method text;
  v_net_retirado numeric;
  v_log_id uuid;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'El motivo es obligatorio';
  end if;
  if length(p_reason) > 50 then
    raise exception 'El motivo no puede superar los 50 caracteres';
  end if;
  if p_authorized_by_name is not null and length(trim(p_authorized_by_name)) > 20 then
    raise exception 'El nombre de quien autorizó no puede superar los 20 caracteres';
  end if;
  if p_performed_by_name is not null and length(trim(p_performed_by_name)) > 20 then
    raise exception 'El nombre de quien hizo el cambio no puede superar los 20 caracteres';
  end if;

  select p.business_id into v_caller_business
  from public.profiles p where p.id = auth.uid();

  if v_caller_business is distinct from p_business_id then
    raise exception 'No tenés permiso sobre este negocio';
  end if;

  select coalesce(
    nullif(trim(p_performed_by_name), ''),
    nullif(trim(e.full_name), ''),
    nullif(trim(p.full_name), ''),
    'Usuario'
  ) into v_caller_name
  from public.profiles p
  left join public.employees e on e.id = p.employee_id
  where p.id = auth.uid();

  perform public._verify_caja_authorization_password(p_business_id, 'void', p_password);

  select * into v_payment
  from public.payments
  where id = p_payment_id and business_id = p_business_id
  for update;

  if not found then
    raise exception 'Cobro no encontrado';
  end if;

  if v_payment.status not in ('anulado', 'reembolsado') then
    raise exception 'Esta venta no está anulada';
  end if;

  select e.full_name into v_employee_name
  from public.employees e where e.id = v_payment.employee_id;

  update public.payments
    set status = 'cobrado'
    where id = p_payment_id;

  select * into v_commission
  from public.commission_records
  where sale_id = p_payment_id and business_id = p_business_id;

  select * into v_tip
  from public.tip_records
  where sale_id = p_payment_id and business_id = p_business_id;

  if v_commission.id is not null and v_commission.status = 'voided' then
    if v_commission.settlement_run_id is null then
      update public.commission_records
        set status = 'pending', paid_amount = 0
        where id = v_commission.id;
    else
      v_commission_locked := true;
    end if;
  end if;

  if v_tip.id is not null and v_tip.status = 'voided' then
    if v_tip.settlement_run_id is null then
      update public.tip_records
        set status = 'pending', paid_amount = 0
        where id = v_tip.id;
    else
      v_tip_locked := true;
    end if;
  end if;

  -- Caso 2 del pedido: deducción pendiente (todavía no compensada) — se
  -- cancela sin más (borra la fila), nunca genera un crédito (nunca se
  -- descontó de verdad). Filtra por kind='deduccion' a propósito: nunca
  -- borra un crédito pendiente por error, aunque hoy no debería existir
  -- uno sin aplicar en este punto del flujo.
  select count(*), coalesce(sum(commission_amount), 0)
    into v_reversed_count, v_reversed_amount
    from public.commission_adjustment_queue
    where sale_id = p_payment_id and kind = 'deduccion' and applied_settlement_run_id is null;

  if v_reversed_count > 0 then
    delete from public.commission_adjustment_queue
      where sale_id = p_payment_id and kind = 'deduccion' and applied_settlement_run_id is null;
  end if;

  -- Caso 3 del pedido: deducción YA compensada (aplicada a una liquidación
  -- ya creada, por ende intocable) — se encola el crédito contrario, por
  -- el NETO sin revertir todavía (deducciones aplicadas menos créditos ya
  -- encolados para esta venta, pendientes o no) — nunca un segundo crédito
  -- por la misma deducción, ni aunque este restore se repitiera. Si el
  -- neto da 0 (ya se emitió el crédito completo en un ciclo anterior),
  -- no se inserta nada.
  select coalesce(sum(
    case
      when kind = 'deduccion' and applied_settlement_run_id is not null then commission_amount
      when kind = 'credito' then -commission_amount
      else 0
    end
  ), 0)
    into v_net_credito
    from public.commission_adjustment_queue
    where sale_id = p_payment_id;

  -- Retiro de caja del día cerrado (ver void_payment_authorized): si queda
  -- un neto sin revertir ligado a esta venta por sale_id, se crea el
  -- ingreso contrario por exactamente ese neto. Nunca se borra ni modifica
  -- el movimiento anterior ni el cierre histórico.
  v_sale_date := (v_payment.created_at at time zone 'America/Argentina/Buenos_Aires')::date;

  select exists(
    select 1 from public.caja_cierres
    where business_id = p_business_id
      and branch_id is not distinct from v_payment.branch_id
      and fecha = v_sale_date
      and estado in ('cerrada', 'reabierta')
  ) into v_is_closed;

  select coalesce(sum(case when type = 'retiro' then amount else -amount end), 0)
    into v_net_retirado
    from public.cash_movements
    where sale_id = p_payment_id;

  if v_is_closed and v_net_retirado > 0 then
    v_cash_method := case
      when lower(trim(coalesce(v_payment.method, v_payment.payment_method, ''))) in ('', 'cash', 'efectivo') then 'efectivo'
      else 'cuenta'
    end;
    insert into public.cash_movements (
      business_id, branch_id, type, amount, method, note, created_by, sale_id
    ) values (
      p_business_id, v_payment.branch_id, 'ingreso', v_net_retirado, v_cash_method,
      '[AJUSTE-RESTABLECIMIENTO] Restablecimiento de venta del ' || to_char(v_sale_date, 'DD/MM/YYYY') || ' (día ya cerrado) — ' || trim(p_reason),
      v_caller_name, p_payment_id
    );
  end if;

  if v_commission_locked or v_tip_locked then
    v_impact_note := 'Venta restablecida. Su comisión/propina ya estaba dentro de una liquidación cerrada — no se reactivó sola, revisarla a mano si corresponde pagarla.';
  elsif v_commission.id is not null or v_tip.id is not null then
    v_impact_note := 'Venta restablecida — comisión/propina vueltas a pendiente de cobro.';
  else
    v_impact_note := 'Venta restablecida. Sin comisión/propina asociada.';
  end if;

  if v_reversed_count > 0 then
    v_impact_note := v_impact_note || ' Se anuló la deducción pendiente de $'
      || to_char(v_reversed_amount, 'FM999G999G999') || ' que había quedado encolada de la anulación anterior — no se le va a descontar nada al profesional por esta venta.';
  end if;

  if v_net_credito > 0 then
    v_impact_note := v_impact_note || ' Esa deducción ya se había compensado en una liquidación cerrada — se encoló un crédito a favor del profesional de $'
      || to_char(v_net_credito, 'FM999G999G999') || ' para la próxima liquidación (la liquidación ya cerrada no se tocó).';
  end if;

  if v_is_closed and v_net_retirado > 0 then
    v_impact_note := v_impact_note || ' El día de esta venta ya estaba cerrado — el cierre guardado no se tocó; se registró un ingreso de $'
      || to_char(v_net_retirado, 'FM999G999G999') || ' visible hoy en Movimientos de caja, revirtiendo el retiro de la anulación anterior.';
  end if;

  insert into public.payment_authorization_log (
    business_id, payment_id, action_type, reason, performed_by, performed_by_name,
    authorized_by_name, impact_note, before_snapshot, after_snapshot
  ) values (
    p_business_id, p_payment_id, 'correction', 'Restablecimiento — ' || trim(p_reason), auth.uid(), v_caller_name,
    nullif(trim(coalesce(p_authorized_by_name, '')), ''), v_impact_note,
    jsonb_build_object(
      'status', v_payment.status, 'total', coalesce(v_payment.total, v_payment.amount),
      'client_name', v_payment.client_name, 'service_name', v_payment.service_name,
      'employee_id', v_payment.employee_id, 'employee_name', v_employee_name,
      'method', coalesce(v_payment.method, v_payment.payment_method)
    ),
    jsonb_build_object(
      'status', 'cobrado',
      'reversed_adjustment_count', v_reversed_count,
      'reversed_adjustment_amount', v_reversed_amount,
      'credito_encolado', v_net_credito,
      'day_was_closed', v_is_closed
    )
  ) returning id into v_log_id;

  if v_net_credito > 0 and v_commission.id is not null then
    insert into public.commission_adjustment_queue (
      business_id, professional_id, sale_id, commission_amount, reason, authorization_log_id, kind
    ) values (
      p_business_id, v_commission.professional_id, p_payment_id, v_net_credito,
      'Venta restablecida (su deducción ya estaba compensada) — ' || trim(p_reason), v_log_id, 'credito'
    );
  end if;

  return query select 'cobrado'::text;
end;
$$;

NOTIFY pgrst, 'reload schema';

commit;
