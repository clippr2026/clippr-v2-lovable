-- ============================================================================
-- Liquidaciones — Adelantos al profesional
-- ============================================================================
-- Un adelanto es dinero entregado al profesional ANTES de liquidar. Se
-- descuenta del "Total a liquidar" en la próxima liquidación que se
-- prepare — mismo patrón que ya usan las comisiones (commission_records.
-- settlement_run_id): un adelanto sin settlement_run_id todavía no fue
-- incluido en ninguna liquidación; al preparar una, se le asigna ese id
-- y deja de contar como pendiente.
--
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase y ejecutar.
-- Seguro re-ejecutar (create table if not exists / add column if not
-- exists / create or replace en todo).
-- ============================================================================

-- ── 1. professional_advances ────────────────────────────────────────────────
create table if not exists public.professional_advances (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null,
  professional_id    uuid not null references public.employees(id) on delete cascade,
  amount             numeric(12,2) not null check (amount > 0),
  payment_method     text,
  note               text,
  advanced_at        timestamptz not null default now(),
  registered_by      uuid not null references public.profiles(id),
  registered_by_name text not null,
  settlement_run_id  uuid references public.settlement_runs(id),
  created_at         timestamptz not null default now()
);

create index if not exists idx_professional_advances_business
  on public.professional_advances (business_id);
create index if not exists idx_professional_advances_professional
  on public.professional_advances (professional_id, advanced_at desc);
create index if not exists idx_professional_advances_settlement_run
  on public.professional_advances (settlement_run_id);

comment on table public.professional_advances is
  'Adelantos de dinero al profesional antes de liquidar. Se descuentan del
   total_to_settle del próximo settlement_run que se prepare —
   settlement_run_id queda null hasta que ese run los incluye.';

-- ── 2. RLS ───────────────────────────────────────────────────────────────────
alter table public.professional_advances enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.professional_advances to authenticated;

drop policy if exists professional_advances_select on public.professional_advances;
create policy professional_advances_select on public.professional_advances
  for select
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (
      (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
      or professional_id = (select p.employee_id from public.profiles p where p.id = auth.uid())
    )
  );

-- Igual que settlement_runs/settlement_payments: un profesional puede VER
-- sus propios adelantos, pero no cargarlos ni tocarlos — eso lo hace
-- Caja (o cualquier rol no-profesional) a través del RPC de abajo.
drop policy if exists professional_advances_write on public.professional_advances;
create policy professional_advances_write on public.professional_advances
  for all
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  )
  with check (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  );

-- ── 3. RPC: registrar un adelanto ────────────────────────────────────────────
create or replace function public.register_professional_advance(
  p_business_id uuid,
  p_professional_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_note text,
  p_advanced_at timestamptz,
  p_registered_by uuid,
  p_registered_by_name text
)
returns public.professional_advances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_caller_business uuid;
  v_advance public.professional_advances;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto del adelanto debe ser mayor a cero';
  end if;

  if p_registered_by is distinct from auth.uid() then
    raise exception 'registered_by debe ser el usuario autenticado';
  end if;

  select p.role, p.business_id into v_role, v_caller_business
  from public.profiles p where p.id = auth.uid();

  if v_caller_business is distinct from p_business_id then
    raise exception 'No tenés permiso sobre este negocio';
  end if;

  if v_role = 'profesional' then
    raise exception 'Un profesional no puede registrarse adelantos a sí mismo';
  end if;

  insert into public.professional_advances (
    business_id, professional_id, amount, payment_method, note,
    advanced_at, registered_by, registered_by_name
  ) values (
    p_business_id, p_professional_id, p_amount, nullif(trim(coalesce(p_payment_method, '')), ''),
    nullif(trim(coalesce(p_note, '')), ''),
    coalesce(p_advanced_at, now()), p_registered_by, p_registered_by_name
  ) returning * into v_advance;

  return v_advance;
end;
$$;

grant execute on function public.register_professional_advance(
  uuid, uuid, numeric, text, text, timestamptz, uuid, text
) to authenticated;

-- ── 4. settlement_runs: nueva columna "advances" ────────────────────────────
alter table public.settlement_runs
  add column if not exists advances numeric(12,2) not null default 0 check (advances >= 0);

-- ── 5. prepare_settlement_run: descuenta y bloquea adelantos pendientes ─────
-- Misma firma que ya usa el frontend (6 parámetros) — no cambia la
-- llamada desde la app, solo agrega el descuento de adelantos al total y
-- los bloquea (settlement_run_id) igual que ya se hace con comisiones.
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
  uuid, uuid, jsonb, jsonb, uuid, text
) to authenticated;

-- ── 6. Refresca el schema cache de PostgREST ────────────────────────────────
NOTIFY pgrst, 'reload schema';
