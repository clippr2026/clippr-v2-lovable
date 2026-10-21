-- ============================================================================
-- prepare_settlement_run — el corte "Hasta" y el período usan la fecha real
-- del pago, no commission_records.created_at/tip_records.created_at
-- ============================================================================
-- Causa real encontrada (producción, 20/10/2026): se corrigió a mano la
-- fecha operativa de un pago (payments.charged_at/created_at, 20/10 ->
-- 17/10) dejando sale_date y la UI correctos, pero esta función seguía
-- comparando contra commission_records.created_at/tip_records.created_at
-- — el momento en que se CREÓ esa fila, congelado para siempre al cobrar,
-- que una corrección de fecha nunca toca. Resultado: "Preparar liquidación
-- hasta 17/10" excluía esa comisión ($31.996) del total y de lo que se
-- bloquea, mientras "hasta 20/10" sí la incluía — la plata real a liquidar
-- dependía de un campo que no es la fecha del servicio.
--
-- La función YA tenía el criterio correcto en una sola parte: el insert a
-- settlement_run_sales (el snapshot que alimenta Historial) siempre filtró
-- por pm.created_at (payments), nunca por el created_at de la fila de
-- comisión/propina — por eso Historial podía mostrar una venta que el
-- cálculo de "Comisiones generadas"/lo efectivamente bloqueado NO había
-- incluido. Este fix unifica todo a ese mismo criterio (payments.created_at
-- via join por sale_id — columna NOT NULL + FK, join siempre seguro, nunca
-- pierde filas): el agregado de comisiones/propinas/total vendido Y el
-- UPDATE que las bloquea dentro del run pasan a comparar contra
-- pm.created_at en vez de cr.created_at/tr.created_at. v_cutoff_at y
-- v_period_start_at (ya correctos, en huso Argentina desde la migración
-- 20261011020000) no cambian — solo cambia CONTRA QUÉ columna se comparan.
--
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase (proyecto de
-- myclippr.com) y ejecutar. Idempotente (create or replace function). No
-- reescribe liquidaciones ya preparadas (settlement_runs/settlement_run_id
-- ya asignado) — solo cambia qué se incluye en la PRÓXIMA que se prepare.
-- ============================================================================

create or replace function public.prepare_settlement_run(
  p_business_id uuid,
  p_professional_id uuid,
  p_adjustment_items jsonb,
  p_deduction_items jsonb,
  p_prepared_by uuid,
  p_prepared_by_name text,
  p_cutoff_at timestamptz default null
)
returns public.settlement_runs
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
  v_new_tips numeric := 0;
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

  -- Serializa a nivel negocio (no por profesional): el número de
  -- liquidación es un recurso compartido por todos sus profesionales.
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

  -- Comisiones pendientes del período/corte — ventana contra la fecha REAL
  -- del pago (pm.created_at), no commission_records.created_at.
  select coalesce(count(*), 0), coalesce(sum(cr.pending_amount), 0)
    into v_service_count, v_new_commissions
  from public.commission_records cr
  join public.payments pm on pm.id = cr.sale_id
  where cr.business_id = p_business_id
    and cr.professional_id = p_professional_id
    and cr.settlement_run_id is null
    and (v_period_start_at is null or pm.created_at > v_period_start_at)
    and pm.created_at <= v_cutoff_at
    and cr.pending_amount > 0;

  -- Propinas pendientes del mismo período/corte — misma ventana exacta que
  -- las comisiones de arriba, pero sumada aparte (v_new_tips nunca se
  -- mezcla con v_new_commissions salvo al calcular v_total).
  select coalesce(sum(tr.pending_amount), 0)
    into v_new_tips
  from public.tip_records tr
  join public.payments pm on pm.id = tr.sale_id
  where tr.business_id = p_business_id
    and tr.professional_id = p_professional_id
    and tr.settlement_run_id is null
    and (v_period_start_at is null or pm.created_at > v_period_start_at)
    and pm.created_at <= v_cutoff_at
    and tr.pending_amount > 0;

  select coalesce(sum(coalesce(pm.total, pm.amount, 0)), 0)
    into v_total_sold
  from public.commission_records cr
  join public.payments pm on pm.id = cr.sale_id
  where cr.business_id = p_business_id
    and cr.professional_id = p_professional_id
    and cr.settlement_run_id is null
    and (v_period_start_at is null or pm.created_at > v_period_start_at)
    and pm.created_at <= v_cutoff_at;

  -- Adelantos todavía no incluidos en ninguna liquidación, entregados
  -- hasta este corte — se descuentan del total, no importa cuándo se
  -- hayan dado (no están acotados al período, igual que el saldo
  -- anterior: son deuda pendiente hasta que una liquidación los cubre).
  select coalesce(sum(amount), 0) into v_advances
  from public.professional_advances
  where business_id = p_business_id
    and professional_id = p_professional_id
    and settlement_run_id is null
    and advanced_at <= v_cutoff_at;

  v_total := v_previous_balance + v_new_commissions + v_new_tips + v_adjustments - v_deductions - v_advances;
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
    previous_balance, new_commissions, new_tips,
    adjustments, deductions, adjustment_items, deduction_items, advances,
    total_to_settle,
    service_count, total_sold, status, prepared_by, prepared_by_name
  ) values (
    p_business_id, p_professional_id, v_professional_name, v_run_number, v_cutoff_date, v_cutoff_at,
    v_period_start, v_period_start_at,
    v_previous_run.id,
    v_previous_balance, v_new_commissions, v_new_tips,
    v_adjustments, v_deductions, v_adjustment_items, v_deduction_items, v_advances,
    v_total,
    v_service_count, v_total_sold, 'pendiente', p_prepared_by, p_prepared_by_name
  ) returning * into v_run;

  -- Ajuste y deduccion son movimientos propios, uno cada uno si
  -- corresponde (no comparten numero entre si ni con el pago que
  -- eventualmente liquide este run).
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

  -- Bloquea cada comisión Y congela, en el mismo momento, todo lo que se
  -- muestra en "Servicios incluidos" — de acá en más esta fila nunca más
  -- se vuelve a leer de payments, así que el comprobante queda fijo para
  -- siempre aunque el cliente/servicio original se edite o se borre.
  -- Ventana contra pm.created_at (join), no cr.created_at.
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
      and pm.created_at <= v_cutoff_at;

  -- Mismo bloqueo para las propinas del período — tabla separada, mismo
  -- momento exacto de "nace la liquidación". Ventana contra pm.created_at.
  update public.tip_records tr
    set settlement_run_id = v_run.id
    from public.payments pm
    where pm.id = tr.sale_id
      and tr.business_id = p_business_id
      and tr.professional_id = p_professional_id
      and tr.settlement_run_id is null
      and (v_period_start_at is null or pm.created_at > v_period_start_at)
      and pm.created_at <= v_cutoff_at;

  update public.professional_advances
    set settlement_run_id = v_run.id
    where business_id = p_business_id
      and professional_id = p_professional_id
      and settlement_run_id is null
      and advanced_at <= v_cutoff_at;

  -- Snapshot completo de TODAS las ventas de este profesional en la misma
  -- ventana — a diferencia del UPDATE de comisiones de arriba (que solo
  -- toca filas de commission_records, o sea solo ventas QUE generaron
  -- comisión), esto lee directo de payments.employee_id y copia cualquier
  -- venta, tenga o no comisión (catálogo con override inactivo = $0, a
  -- propósito) — incluye retiros de stock pagados (misma tabla, se
  -- distinguen por el marcador ya existente en observations, sin columna
  -- nueva). LEFT JOIN a commission_records por sale_id: si no hay fila,
  -- commission_amount queda en 0, correcto. Esta parte YA filtraba por
  -- pm.created_at (sin cambios acá) — era la única de las cinco ventanas
  -- de esta función que ya usaba la fecha real del pago.
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

grant execute on function public.prepare_settlement_run(
  uuid, uuid, jsonb, jsonb, uuid, text, timestamptz
) to authenticated;

NOTIFY pgrst, 'reload schema';
