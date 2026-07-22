-- ============================================================================
-- Liquidaciones — consolida y repara el esquema (idempotente)
-- ============================================================================
-- Producción quedó con el frontend ya desplegado (llamando
-- prepare_settlement_run con 6 parámetros, sin p_cutoff_date, y
-- consultando settlement_runs.period_start_at) pero sin la migración
-- 20260723010000_settlement_run_exact_timestamp_period.sql aplicada — de
-- ahí "column settlement_runs.period_start_at does not exist" y
-- "Could not find the function prepare_settlement_run(...)".
--
-- Esta migración es la unión de TODAS las columnas y la función que
-- deberían existir a esta altura, escrita para poder pegarse y
-- ejecutarse una sola vez sin importar cuáles de las migraciones
-- anteriores ya corrieron o no — cada paso es "si no existe, agregar" o
-- "crear o reemplazar", así que repetir esto no rompe nada.
--
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase y ejecutar.
-- ============================================================================

-- ── 1. Columnas de settlement_runs que deberían existir ────────────────────
alter table public.settlement_runs
  add column if not exists period_start date,
  add column if not exists period_start_at timestamptz,
  add column if not exists previous_settlement_run_id uuid references public.settlement_runs(id),
  add column if not exists adjustment_items jsonb not null default '[]'::jsonb,
  add column if not exists deduction_items jsonb not null default '[]'::jsonb;

-- ── 2. Columnas de commission_records que deberían existir ─────────────────
alter table public.commission_records
  add column if not exists commission_pct numeric(6,2),
  add column if not exists settlement_run_id uuid references public.settlement_runs(id);

create index if not exists idx_commission_records_settlement_run
  on public.commission_records (settlement_run_id);

-- ── 3. Backfill: commission_records.created_at = payments.created_at ──────
-- Sin esto, las comisiones cargadas por el backfill original de fase 0
-- tendrían created_at = el momento en que corrió ESA migración, no la
-- fecha real de la venta — rompería el corte por hora.
update public.commission_records cr
  set created_at = p.created_at
  from public.payments p
  where p.id = cr.sale_id
    and cr.created_at is distinct from p.created_at;

-- ── 4. prepare_settlement_run: firma actual (6 parámetros, sin corte) ─────
-- Borra TODAS las firmas anteriores conocidas de esta función antes de
-- crear la actual — si alguna quedó a mitad de camino en producción, el
-- create or replace de una firma distinta no la reemplaza, la deja como
-- una segunda función sobrecargada y PostgREST no puede elegir cuál usar
-- ("Could not find the function" es exactamente ese síntoma).
drop function if exists public.prepare_settlement_run(
  uuid, uuid, date, numeric, numeric, uuid, text
);
drop function if exists public.prepare_settlement_run(
  uuid, uuid, date, jsonb, jsonb, uuid, text
);
drop function if exists public.prepare_settlement_run(
  uuid, uuid, jsonb, jsonb, uuid, text
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
  -- también lo que evita doble pago si se toca "Confirmar" dos veces:
  -- la segunda llamada espera a que la primera termine y confirme, y
  -- ve el run recién creado como "el último", no puede duplicarlo.
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || p_professional_id::text, 0));

  select * into v_previous_run
  from public.settlement_runs
  where business_id = p_business_id and professional_id = p_professional_id
  order by cutoff_date desc, created_at desc
  limit 1;

  if found then
    if v_cutoff_at <= v_previous_run.prepared_at then
      raise exception 'Ya existe una liquidación posterior a este momento';
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

-- ── 5. Refresca el schema cache de PostgREST ───────────────────────────────
-- Sin esto, Supabase puede seguir sirviendo el esquema viejo desde caché
-- por un rato aunque las columnas/función ya estén creadas.
NOTIFY pgrst, 'reload schema';
