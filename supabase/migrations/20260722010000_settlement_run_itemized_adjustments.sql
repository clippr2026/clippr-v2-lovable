-- ============================================================================
-- Liquidaciones — ajustes y deducciones itemizados (importe + motivo)
-- ============================================================================
-- Hasta acá, "Preparar liquidación" tomaba un único número de ajuste y uno
-- de deducción, sin motivo — el comprobante y el historial solo podían
-- mostrar el total, nunca por qué se agregó. Esta migración agrega dos
-- columnas jsonb con el detalle línea por línea (importe + motivo) y
-- reescribe prepare_settlement_run para recibirlas, validarlas y sumarlas.
-- La fórmula del total NO cambia: sigue siendo
-- previous_balance + new_commissions + adjustments - deductions, donde
-- adjustments/deductions ahora se calculan sumando los items en vez de
-- venir directo del cliente.
--
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase y ejecutar.
-- Seguro re-ejecutar (add column if not exists; el drop+create de la
-- función es idempotente).
-- ============================================================================

-- ── 1. Columnas nuevas ───────────────────────────────────────────────────
alter table public.settlement_runs
  add column if not exists adjustment_items jsonb not null default '[]'::jsonb,
  add column if not exists deduction_items jsonb not null default '[]'::jsonb;

comment on column public.settlement_runs.adjustment_items is
  'Detalle itemizado de los ajustes (+) aplicados al preparar esta
   liquidación: [{"amount": number, "reason": string}, ...]. La columna
   adjustments (numeric) sigue siendo la suma, calculada server-side a
   partir de este detalle — no se recalcula después.';
comment on column public.settlement_runs.deduction_items is
  'Detalle itemizado de las deducciones (−) aplicadas al preparar esta
   liquidación: [{"amount": number, "reason": string}, ...]. La columna
   deductions (numeric) sigue siendo la suma, calculada server-side a
   partir de este detalle — no se recalcula después.';

-- ── 2. prepare_settlement_run: recibe items, no montos sueltos ─────────────
-- Cambia el tipo de dos parámetros (numeric -> jsonb): create or replace
-- con una firma distinta dejaría dos funciones sobrecargadas y rompería
-- la resolución de PostgREST, así que primero se borra la firma vieja.
drop function if exists public.prepare_settlement_run(
  uuid, uuid, date, numeric, numeric, uuid, text
);

create or replace function public.prepare_settlement_run(
  p_business_id uuid,
  p_professional_id uuid,
  p_cutoff_date date,
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
  v_period_start date;
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
  if p_cutoff_date is null or p_cutoff_date > current_date then
    raise exception 'La fecha de corte no puede ser futura';
  end if;

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
  -- congelado en ese momento — nunca se recalcula desde cero. El período
  -- nuevo arranca al día siguiente de ese corte.
  select * into v_previous_run
  from public.settlement_runs
  where business_id = p_business_id and professional_id = p_professional_id
  order by cutoff_date desc, created_at desc
  limit 1;

  if found then
    if p_cutoff_date <= v_previous_run.cutoff_date then
      raise exception 'La fecha de corte debe ser posterior a la última liquidación (%)',
        to_char(v_previous_run.cutoff_date, 'DD/MM/YYYY');
    end if;
    v_previous_balance := greatest(v_previous_run.total_to_settle - v_previous_run.amount_paid, 0);
    v_period_start := v_previous_run.cutoff_date + 1;
  end if;

  -- Comisiones nuevas: SOLO la deuda real pendiente (pending_amount) de
  -- comisiones dentro del período y todavía sin asignar a ningún run.
  select coalesce(count(*), 0), coalesce(sum(pending_amount), 0)
    into v_service_count, v_new_commissions
  from public.commission_records
  where business_id = p_business_id
    and professional_id = p_professional_id
    and settlement_run_id is null
    and sale_date <= p_cutoff_date
    and (v_period_start is null or sale_date >= v_period_start)
    and pending_amount > 0;

  select coalesce(sum(coalesce(pm.total, pm.amount, 0)), 0)
    into v_total_sold
  from public.commission_records cr
  join public.payments pm on pm.id = cr.sale_id
  where cr.business_id = p_business_id
    and cr.professional_id = p_professional_id
    and cr.settlement_run_id is null
    and cr.sale_date <= p_cutoff_date
    and (v_period_start is null or cr.sale_date >= v_period_start);

  v_total := v_previous_balance + v_new_commissions + v_adjustments - v_deductions;
  if v_total < 0 then
    raise exception 'El total a liquidar no puede ser negativo (revisá ajustes/deducciones)';
  end if;

  select coalesce(max(run_number), 0) + 1 into v_run_number
  from public.settlement_runs
  where business_id = p_business_id and professional_id = p_professional_id;

  insert into public.settlement_runs (
    business_id, professional_id, run_number, cutoff_date, period_start,
    previous_settlement_run_id,
    previous_balance, new_commissions,
    adjustments, deductions, adjustment_items, deduction_items,
    total_to_settle,
    service_count, total_sold, status, prepared_by, prepared_by_name
  ) values (
    p_business_id, p_professional_id, v_run_number, p_cutoff_date, v_period_start,
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
      and sale_date <= p_cutoff_date
      and (v_period_start is null or sale_date >= v_period_start);

  return v_run;
end;
$$;

grant execute on function public.prepare_settlement_run(
  uuid, uuid, date, jsonb, jsonb, uuid, text
) to authenticated;
