-- ============================================================================
-- Liquidaciones — elegir hasta qué fecha liquidar (corte manual)
-- ============================================================================
-- Hasta ahora prepare_settlement_run siempre usaba now() como corte. Esto
-- agrega un séptimo parámetro opcional (p_cutoff_at) para poder liquidar
-- "hasta tal día" en vez de "hasta ahora mismo" — el frontend arma ese
-- instante como:
--   - fecha elegida = hoy      → now() (comportamiento actual, sin cambios)
--   - fecha elegida = pasada   → 23:59:59.999 de esa fecha (el día elegido
--                                queda completo incluido; lo generado desde
--                                el día siguiente 00:00 en adelante queda
--                                pendiente para la próxima liquidación)
--
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase y ejecutar.
-- ============================================================================

drop function if exists public.prepare_settlement_run(
  uuid, uuid, jsonb, jsonb, uuid, text
);

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
  v_cutoff_date date := coalesce(p_cutoff_at, now())::date;
  v_period_start date;
  v_period_start_at timestamptz;
  v_previous_balance numeric := 0;
  v_new_commissions numeric := 0;
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

  -- Serializa preparaciones concurrentes para el mismo profesional —
  -- también lo que evita doble pago si se toca "Confirmar" dos veces.
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || p_professional_id::text, 0));

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

  select coalesce(count(*), 0), coalesce(sum(pending_amount), 0)
    into v_service_count, v_new_commissions
  from public.commission_records
  where business_id = p_business_id
    and professional_id = p_professional_id
    and settlement_run_id is null
    and (v_period_start_at is null or created_at > v_period_start_at)
    and created_at <= v_cutoff_at
    and pending_amount > 0;

  select coalesce(sum(coalesce(pm.total, pm.amount, 0)), 0)
    into v_total_sold
  from public.commission_records cr
  join public.payments pm on pm.id = cr.sale_id
  where cr.business_id = p_business_id
    and cr.professional_id = p_professional_id
    and cr.settlement_run_id is null
    and (v_period_start_at is null or cr.created_at > v_period_start_at)
    and cr.created_at <= v_cutoff_at;

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

  v_total := v_previous_balance + v_new_commissions + v_adjustments - v_deductions - v_advances;
  if v_total < 0 then
    raise exception 'El total a liquidar no puede ser negativo (revisá ajustes/deducciones/adelantos)';
  end if;

  select coalesce(max(run_number), 0) + 1 into v_run_number
  from public.settlement_runs
  where business_id = p_business_id and professional_id = p_professional_id;

  insert into public.settlement_runs (
    business_id, professional_id, run_number, cutoff_date, prepared_at,
    period_start, period_start_at,
    previous_settlement_run_id,
    previous_balance, new_commissions,
    adjustments, deductions, adjustment_items, deduction_items, advances,
    total_to_settle,
    service_count, total_sold, status, prepared_by, prepared_by_name
  ) values (
    p_business_id, p_professional_id, v_run_number, v_cutoff_date, v_cutoff_at,
    v_period_start, v_period_start_at,
    v_previous_run.id,
    v_previous_balance, v_new_commissions,
    v_adjustments, v_deductions, v_adjustment_items, v_deduction_items, v_advances,
    v_total,
    v_service_count, v_total_sold, 'pendiente', p_prepared_by, p_prepared_by_name
  ) returning * into v_run;

  update public.commission_records
    set settlement_run_id = v_run.id
    where business_id = p_business_id
      and professional_id = p_professional_id
      and settlement_run_id is null
      and (v_period_start_at is null or created_at > v_period_start_at)
      and created_at <= v_cutoff_at;

  update public.professional_advances
    set settlement_run_id = v_run.id
    where business_id = p_business_id
      and professional_id = p_professional_id
      and settlement_run_id is null
      and advanced_at <= v_cutoff_at;

  return v_run;
end;
$$;

grant execute on function public.prepare_settlement_run(
  uuid, uuid, jsonb, jsonb, uuid, text, timestamptz
) to authenticated;

NOTIFY pgrst, 'reload schema';
