-- ============================================================================
-- Liquidaciones — Historial 100% inmutable (fotografía al momento de pagar)
-- ============================================================================
-- Hasta ahora "Servicios incluidos" del detalle de una liquidación se
-- armaba con un join en vivo a public.payments (cliente, servicio,
-- método) — si después se editaba/borraba ese cliente o servicio, el
-- historial ya liquidado cambiaba con él. Esto agrega columnas de
-- snapshot a commission_records (cliente/servicio/precio/método al
-- momento del pago del servicio) y a settlement_runs (nombre del
-- profesional al momento de liquidar), pobladas una sola vez cuando
-- prepare_settlement_run bloquea cada comisión dentro de un run —
-- nunca más se vuelven a tocar, así que quedan fijas para siempre,
-- pase lo que pase después con el cliente/servicio/profesional
-- original.
--
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase y
-- ejecutar. Sin riesgo de repetir: agrega columnas si no existen y
-- hace un backfill con los datos actuales para todo lo que ya estaba
-- liquidado antes de esta migración (es lo mejor que se puede
-- reconstruir retroactivamente — de acá en adelante, cada liquidación
-- nueva congela sus propios datos en el momento exacto de pagar).
-- ============================================================================

-- ── 1. Columnas de snapshot ─────────────────────────────────────────────────
alter table public.commission_records
  add column if not exists snapshot_client_name text,
  add column if not exists snapshot_service_name text,
  add column if not exists snapshot_sale_total numeric(12,2),
  add column if not exists snapshot_payment_method text;

alter table public.settlement_runs
  add column if not exists professional_name text;

comment on column public.commission_records.snapshot_client_name is
  'Nombre del cliente al momento de liquidar esta comisión (copiado de
   payments.client_name cuando prepare_settlement_run bloqueó esta fila
   en un run) — no se vuelve a actualizar, aunque el cliente original se
   edite o se borre después.';
comment on column public.settlement_runs.professional_name is
  'Nombre del profesional al momento de preparar esta liquidación —
   congelado, no se actualiza si el profesional cambia de nombre
   después.';

-- ── 2. Backfill de lo ya liquidado antes de esta migración ─────────────────
-- Reconstruye lo mejor posible con los datos ACTUALES — es la única
-- fotografía disponible retroactivamente para liquidaciones viejas.
update public.commission_records cr
  set snapshot_client_name = pm.client_name,
      snapshot_service_name = pm.service_name,
      snapshot_sale_total = coalesce(pm.total, pm.amount),
      snapshot_payment_method = coalesce(pm.method, pm.payment_method)
  from public.payments pm
  where cr.sale_id = pm.id
    and cr.settlement_run_id is not null
    and cr.snapshot_client_name is null;

update public.settlement_runs sr
  set professional_name = e.full_name
  from public.employees e
  where sr.professional_id = e.id
    and sr.professional_name is null;

-- ── 3. prepare_settlement_run: puebla el snapshot al bloquear cada fila ────
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
  v_professional_name text;
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
    business_id, professional_id, professional_name, run_number, cutoff_date, prepared_at,
    period_start, period_start_at,
    previous_settlement_run_id,
    previous_balance, new_commissions,
    adjustments, deductions, adjustment_items, deduction_items, advances,
    total_to_settle,
    service_count, total_sold, status, prepared_by, prepared_by_name
  ) values (
    p_business_id, p_professional_id, v_professional_name, v_run_number, v_cutoff_date, v_cutoff_at,
    v_period_start, v_period_start_at,
    v_previous_run.id,
    v_previous_balance, v_new_commissions,
    v_adjustments, v_deductions, v_adjustment_items, v_deduction_items, v_advances,
    v_total,
    v_service_count, v_total_sold, 'pendiente', p_prepared_by, p_prepared_by_name
  ) returning * into v_run;

  -- Bloquea cada comisión Y congela, en el mismo momento, todo lo que se
  -- muestra en "Servicios incluidos" — de acá en más esta fila nunca más
  -- se vuelve a leer de payments, así que el comprobante queda fijo para
  -- siempre aunque el cliente/servicio original se edite o se borre.
  update public.commission_records cr
    set settlement_run_id = v_run.id,
        snapshot_client_name = (select pm.client_name from public.payments pm where pm.id = cr.sale_id),
        snapshot_service_name = (select pm.service_name from public.payments pm where pm.id = cr.sale_id),
        snapshot_sale_total = (select coalesce(pm.total, pm.amount) from public.payments pm where pm.id = cr.sale_id),
        snapshot_payment_method = (select coalesce(pm.method, pm.payment_method) from public.payments pm where pm.id = cr.sale_id)
    where cr.business_id = p_business_id
      and cr.professional_id = p_professional_id
      and cr.settlement_run_id is null
      and (v_period_start_at is null or cr.created_at > v_period_start_at)
      and cr.created_at <= v_cutoff_at;

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
