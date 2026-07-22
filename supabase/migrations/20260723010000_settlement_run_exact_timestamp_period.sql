-- ============================================================================
-- Liquidaciones — corte por fecha y hora exacta (no solo por día)
-- ============================================================================
-- Hasta acá el período se cortaba por sale_date (date, sin hora): una
-- comisión generada el mismo día de la última liquidación, aunque fuera
-- varias horas después, corría riesgo de quedar mal clasificada — un
-- date no puede distinguir "antes de las 15:00" de "después de las
-- 15:00" en la misma fecha. Esta migración cambia el piso del período a
-- la marca de tiempo exacta de la última liquidación (prepared_at,
-- timestamptz, ya existía) y el techo siempre a "ahora" — por eso
-- "Preparar liquidación" deja de recibir una fecha de corte elegida a
-- mano: el corte ya no se elige, se calcula.
--
-- Compatibilidad con lo existente: esta migración NO toca
-- settlement_run_id de ninguna comisión ni ninguna fila de
-- settlement_runs ya creada — ninguna liquidación, historial o
-- comprobante ya generado cambia. Lo único que se corrige es
-- commission_records.created_at (nunca se usó para nada hasta ahora),
-- para que de acá en adelante el nuevo corte por hora sea exacto incluso
-- para profesionales con historial de antes de esta migración.
--
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase y ejecutar.
-- Seguro re-ejecutar (el backfill solo toca filas que difieren; add
-- column if not exists; el drop+create de la función es idempotente).
-- ============================================================================

-- ── 1. Backfill: commission_records.created_at = payments.created_at ──────
-- Sin esto, todas las comisiones cargadas por el backfill original de
-- fase 0 (20260721070100_liquidaciones_backfill_apply.sql) tendrían
-- created_at = el momento en que corrió ESA migración, no la fecha real
-- de la venta — rompería el corte por hora para cualquier profesional
-- con historial previo a este sistema.
update public.commission_records cr
  set created_at = p.created_at
  from public.payments p
  where p.id = cr.sale_id
    and cr.created_at is distinct from p.created_at;

-- ── 2. settlement_runs: piso del período con hora exacta ───────────────────
alter table public.settlement_runs
  add column if not exists period_start_at timestamptz;

comment on column public.settlement_runs.period_start_at is
  'Igual que period_start (date) pero con hora exacta — es prepared_at de
   la liquidación anterior. commission_records.created_at > este valor es
   el filtro real de "comisiones nuevas"; period_start (date) se queda
   solo para los textos ya existentes ("Período: del X al Y").';

-- ── 3. prepare_settlement_run: el corte ya no se elige, se calcula ────────
-- Cambia la firma (se saca p_cutoff_date): drop primero para no dejar dos
-- funciones sobrecargadas y romper la resolución de PostgREST.
drop function if exists public.prepare_settlement_run(
  uuid, uuid, date, jsonb, jsonb, uuid, text
);

create or replace function public.prepare_settlement_run(
  p_business_id uuid,
  p_professional_id uuid,
  p_adjustment_items jsonb,
  p_deduction_items jsonb,
  p_prepared_by uuid,
  p_prepared_by_name text
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
  v_cutoff_at timestamptz := now();
  v_cutoff_date date := now()::date;
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
  v_item jsonb;
  v_item_amount numeric;
  v_total numeric;
  v_run_number int;
  v_run public.settlement_runs;
begin
  if p_prepared_by is distinct from auth.uid() then
    raise exception 'prepared_by debe ser el usuario autenticado';
  end if;

  select p.role, p.business_id into v_role, v_caller_business
  from public.profiles p where p.id = auth.uid();

  if v_caller_business is distinct from p_business_id then
    raise exception 'No tenés permiso sobre este negocio';
  end if;

  if v_role = 'profesional' then
    raise exception 'Un profesional no puede preparar sus propias liquidaciones';
  end if;

  -- Valida y suma los ajustes: cada item con importe > 0 necesita motivo.
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

  -- Valida y suma las deducciones: misma regla.
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

  -- Serializa preparaciones concurrentes para el mismo profesional: sin
  -- esto, dos llamadas simultáneas podrían leer el mismo "último run" como
  -- previous_run y las dos arrastrarían el mismo saldo, perdiéndolo de una.
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || p_professional_id::text, 0));

  -- Saldo anterior: lo que quedó pendiente del último run (si lo hay),
  -- congelado en ese momento. El período nuevo arranca justo después de
  -- la hora exacta en que se preparó esa liquidación — no del día
  -- siguiente — así una comisión generada esa misma tarde, después del
  -- corte, entra en la próxima liquidación en vez de perderse.
  select * into v_previous_run
  from public.settlement_runs
  where business_id = p_business_id and professional_id = p_professional_id
  order by cutoff_date desc, created_at desc
  limit 1;

  if found then
    -- No debería poder pasar nunca (el corte siempre es "ahora", y el
    -- lock de arriba serializa contra la última preparación) — queda
    -- como red de seguridad, no como validación de flujo normal.
    if v_cutoff_at <= v_previous_run.prepared_at then
      raise exception 'Ya existe una liquidación posterior a este momento';
    end if;
    v_previous_balance := greatest(v_previous_run.total_to_settle - v_previous_run.amount_paid, 0);
    v_period_start_at := v_previous_run.prepared_at;
    v_period_start := v_period_start_at::date;
  end if;

  -- Comisiones nuevas: SOLO la deuda real pendiente (pending_amount),
  -- generadas después de la hora exacta del corte anterior (o desde
  -- siempre si es la primera liquidación) y todavía sin asignar a
  -- ningún run.
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

  v_total := v_previous_balance + v_new_commissions + v_adjustments - v_deductions;
  if v_total < 0 then
    raise exception 'El total a liquidar no puede ser negativo (revisá ajustes/deducciones)';
  end if;

  select coalesce(max(run_number), 0) + 1 into v_run_number
  from public.settlement_runs
  where business_id = p_business_id and professional_id = p_professional_id;

  insert into public.settlement_runs (
    business_id, professional_id, run_number, cutoff_date, prepared_at,
    period_start, period_start_at,
    previous_settlement_run_id,
    previous_balance, new_commissions,
    adjustments, deductions, adjustment_items, deduction_items,
    total_to_settle,
    service_count, total_sold, status, prepared_by, prepared_by_name
  ) values (
    p_business_id, p_professional_id, v_run_number, v_cutoff_date, v_cutoff_at,
    v_period_start, v_period_start_at,
    v_previous_run.id,
    v_previous_balance, v_new_commissions,
    v_adjustments, v_deductions, v_adjustment_items, v_deduction_items,
    v_total,
    v_service_count, v_total_sold, 'pendiente', p_prepared_by, p_prepared_by_name
  ) returning * into v_run;

  -- Bloquea las comisiones incluidas: ya no pueden entrar en otro run.
  update public.commission_records
    set settlement_run_id = v_run.id
    where business_id = p_business_id
      and professional_id = p_professional_id
      and settlement_run_id is null
      and (v_period_start_at is null or created_at > v_period_start_at)
      and created_at <= v_cutoff_at;

  return v_run;
end;
$$;

grant execute on function public.prepare_settlement_run(
  uuid, uuid, jsonb, jsonb, uuid, text
) to authenticated;
