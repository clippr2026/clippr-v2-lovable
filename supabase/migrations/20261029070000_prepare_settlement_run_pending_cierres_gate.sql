-- Bloquea liquidaciones DEFINITIVAS (prepare_settlement_run) si existe
-- alguna caja pendiente de cierre dentro del período que se va a liquidar.
-- Único RPC que genera un settlement_runs real — no hay otro camino desde
-- ninguna pantalla, así que esto no se puede saltar "por otra pantalla,
-- API o RPC". Reutiliza get_pending_cierres_in_period (misma fuente que el
-- aviso de la UI), así nunca hay dos criterios distintos de "pendiente".
-- register_professional_advance no se toca — los adelantos siguen
-- funcionando sin importar el estado de ninguna caja.
--
-- Cambio quirúrgico sobre la versión previa (20261024010000_prepare_
-- settlement_run_fix_pending_exclusion.sql + el parche de display_date en
-- 20261028190000): 2 variables nuevas (v_branch_id, v_pending_cierres),
-- resolver branch_id junto con el nombre del profesional, y un chequeo
-- nuevo justo después de resolver v_period_start_at/v_cutoff_date — antes
-- de calcular ninguna comisión. Nada más de la función cambia.
drop function if exists public.prepare_settlement_run(uuid, uuid, jsonb, jsonb, uuid, text, timestamptz);

CREATE OR REPLACE FUNCTION public.prepare_settlement_run(p_business_id uuid, p_professional_id uuid, p_adjustment_items jsonb, p_deduction_items jsonb, p_prepared_by uuid, p_prepared_by_name text, p_cutoff_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS settlement_runs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_available_for_deduction numeric;
  v_applied_queue_ids uuid[] := array[]::uuid[];
  v_branch_id uuid;
  v_pending_cierres text;
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

  select e.full_name, e.branch_id into v_professional_name, v_branch_id
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

  -- Bloqueo: ninguna liquidación DEFINITIVA puede prepararse si existe
  -- alguna caja pendiente de cierre dentro del período que esta liquidación
  -- va a cubrir (desde el fin del período anterior de ESTE profesional, o
  -- "siempre" si es su primera liquidación, hasta la fecha de corte
  -- elegida). Mismo criterio de "pendiente" que usa la UI para el aviso
  -- ("Fechas pendientes: ..."), get_pending_cierres_in_period — nunca un
  -- criterio inventado acá. Días sin actividad real (no correspondía abrir
  -- caja) y días ya cerrados (sin importar si después se reabrieron y se
  -- volvieron a cerrar) nunca entran en esta lista. Si una caja se reabre
  -- ANTES de la próxima liquidación que la incluya, vuelve a bloquear
  -- (get_pending_cierres_in_period usa is_caja_closed_now, que sí detecta
  -- una reapertura sin volver a cerrar). No aplica a adelantos
  -- (register_professional_advance no pasa por acá).
  select string_agg(to_char(fecha, 'DD/MM/YYYY'), ', ' order by fecha)
    into v_pending_cierres
  from public.get_pending_cierres_in_period(
    p_business_id, v_branch_id, coalesce(v_period_start_at::date, '2000-01-01'::date), v_cutoff_date
  );
  if v_pending_cierres is not null then
    raise exception 'No se puede realizar la liquidación: existen cajas pendientes de cierre dentro del período seleccionado (%).', v_pending_cierres;
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

  -- "Liquidar hasta" decide por coalesce(display_date, advanced_at) — ver
  -- 20261028170000_professional_advances_display_date.sql. Sin
  -- display_date (NULL, el caso de siempre), es exactamente advanced_at.
  select coalesce(sum(amount), 0) into v_advances
  from public.professional_advances
  where business_id = p_business_id
    and professional_id = p_professional_id
    and settlement_run_id is null
    and coalesce(display_date, advanced_at) <= v_cutoff_at;

  -- "Venta anulada" — créditos pendientes (venta restablecida cuya
  -- deducción ya estaba compensada): siempre se aplican completos, en
  -- orden — sumar plata a favor del profesional nunca puede dejar el
  -- total en negativo, así que no hace falta ningún tope acá.
  for v_queue_row in
    select * from public.commission_adjustment_queue
    where business_id = p_business_id
      and professional_id = p_professional_id
      and applied_settlement_run_id is null
      and created_at <= v_cutoff_at
      and kind = 'credito'
    order by created_at asc
  loop
    v_queue_credito := v_queue_credito + v_queue_row.commission_amount;
    v_adjustment_items := v_adjustment_items || jsonb_build_object(
      'amount', v_queue_row.commission_amount,
      'reason', v_queue_row.reason,
      'sale_id', v_queue_row.sale_id,
      'commission_adjustment_queue_id', v_queue_row.id
    );
    v_applied_queue_ids := v_applied_queue_ids || v_queue_row.id;
  end loop;
  v_adjustments := v_adjustments + v_queue_credito;

  -- "Venta anulada" — deducciones pendientes (comisión ya pagada de una
  -- venta que se anuló después): se aplican en orden cronológico, cada una
  -- COMPLETA, solo mientras entre en lo disponible hasta ese momento
  -- (previousBalance + comisiones/propinas nuevas y recuperadas + ajustes
  -- — incluido el crédito de arriba — menos deducciones manuales y
  -- adelantos). La primera que no entra, y todas las que vengan después
  -- en orden, quedan pendientes tal cual estaban — nunca se aplica una
  -- deducción a medias, nunca se genera un total negativo por esto (caso
  -- real: Franco, $9.000 pendientes sin comisión nueva que los cubra —
  -- antes esto hacía fallar la función entera con una excepción).
  v_available_for_deduction := v_previous_balance + v_new_commissions + v_recovered_commissions
    + v_new_tips + v_recovered_tips + v_adjustments - v_deductions - v_advances;

  for v_queue_row in
    select * from public.commission_adjustment_queue
    where business_id = p_business_id
      and professional_id = p_professional_id
      and applied_settlement_run_id is null
      and created_at <= v_cutoff_at
      and kind = 'deduccion'
    order by created_at asc
  loop
    exit when v_queue_row.commission_amount > v_available_for_deduction;
    v_queue_deduction := v_queue_deduction + v_queue_row.commission_amount;
    v_available_for_deduction := v_available_for_deduction - v_queue_row.commission_amount;
    v_deduction_items := v_deduction_items || jsonb_build_object(
      'amount', v_queue_row.commission_amount,
      'reason', v_queue_row.reason,
      'sale_id', v_queue_row.sale_id,
      'commission_adjustment_queue_id', v_queue_row.id
    );
    v_applied_queue_ids := v_applied_queue_ids || v_queue_row.id;
  end loop;
  v_deductions := v_deductions + v_queue_deduction;

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

  -- Bloquea cada adelanto absorbido en ESTA liquidación — mismo criterio
  -- de corte que el SELECT de arriba (coalesce(display_date, advanced_at)),
  -- nunca "todo lo pendiente": un adelanto con fecha (real o de
  -- visualización) posterior al corte elegido queda sin tocar, disponible
  -- para la próxima liquidación.
  update public.professional_advances
    set settlement_run_id = v_run.id
    where business_id = p_business_id
      and professional_id = p_professional_id
      and settlement_run_id is null
      and coalesce(display_date, advanced_at) <= v_cutoff_at;

  -- "Venta anulada" (deducción o crédito): recién ACA, con el run ya
  -- creado y su monto ya adentro de total_to_settle, pasa de "pendiente"
  -- a "compensado" — pero SOLO las filas que de verdad se aplicaron
  -- (v_applied_queue_ids), nunca "todo lo pendiente" — lo que no entró
  -- por falta de margen sigue, de verdad, pendiente para la próxima vez.
  if array_length(v_applied_queue_ids, 1) > 0 then
    update public.commission_adjustment_queue
      set applied_settlement_run_id = v_run.id
      where id = any(v_applied_queue_ids);
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
$function$;
