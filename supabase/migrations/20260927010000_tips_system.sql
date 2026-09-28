-- ============================================================================
-- Propinas — sistema completo, separado de comisiones/facturación
-- ============================================================================
-- La propina es plata del profesional, no del negocio: no debe sumar a
-- facturación/ingresos/utilidad/ticket promedio ni a la base de comisión,
-- pero sí queda pendiente de liquidación al profesional (mismo mecanismo
-- que las comisiones, en una tabla propia para no mezclar los dos
-- conceptos en una sola fila).
--
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase (proyecto de
-- myclippr.com) y ejecutar. Idempotente (create if not exists / create or
-- replace en todo, seguro re-ejecutar).
-- ============================================================================

-- ── 1. payments.tip_amount ──────────────────────────────────────────────────
-- Monto de propina de ese cobro. NUNCA se suma dentro de payments.total/
-- amount (esas columnas siguen siendo pura facturación de servicios/
-- productos, post-descuento) — es la columna que hace que "Facturación",
-- "Ticket promedio", Cierre de Caja y el Asesor IA sigan excluyendo la
-- propina automáticamente, sin tocar ninguno de esos cálculos.
alter table public.payments
  add column if not exists tip_amount numeric(12,2) not null default 0 check (tip_amount >= 0);

-- ── 2. tip_records ───────────────────────────────────────────────────────────
-- Mismo patrón exacto que commission_records (20260719215606): una fila por
-- cobro con propina, pending_amount generada, se bloquea a una liquidación
-- (settlement_run_id) en el mismo momento que las comisiones de ese cobro,
-- pero nunca se lee junto con ellas — "Comisiones generadas" y "Propinas"
-- quedan siempre como dos sumas separadas.
create table if not exists public.tip_records (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null,
  professional_id   uuid not null references public.employees(id) on delete cascade,
  sale_id           uuid not null references public.payments(id) on delete cascade,
  amount            numeric(12,2) not null check (amount >= 0),
  sale_date         date not null,
  status            text not null default 'pending'
                       check (status in ('pending', 'partially_paid', 'paid')),
  paid_amount       numeric(12,2) not null default 0 check (paid_amount >= 0),
  pending_amount    numeric(12,2) generated always as (amount - paid_amount) stored,
  settlement_run_id uuid references public.settlement_runs(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint tip_records_sale_unique unique (sale_id),
  constraint tip_records_paid_not_over_amount check (paid_amount <= amount)
);

create index if not exists idx_tip_records_business
  on public.tip_records (business_id);
create index if not exists idx_tip_records_professional
  on public.tip_records (professional_id, sale_date);
create index if not exists idx_tip_records_settlement
  on public.tip_records (settlement_run_id);

comment on table public.tip_records is
  'Una fila por propina cobrada (una por venta con tip_amount > 0). Igual
   patrón que commission_records pero deliberadamente separada: la propina
   nunca debe sumarse junto con la comisión.';

create or replace function public.set_tip_records_updated_at()
returns trigger
language plpgsql
as $settip$
begin
  new.updated_at = now();
  return new;
end;
$settip$;

drop trigger if exists trg_tip_records_updated_at on public.tip_records;
create trigger trg_tip_records_updated_at
  before update on public.tip_records
  for each row
  execute function public.set_tip_records_updated_at();

alter table public.tip_records enable row level security;

drop policy if exists tip_records_select on public.tip_records;
create policy tip_records_select on public.tip_records
  for select
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (
      (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
      or professional_id = (select p.employee_id from public.profiles p where p.id = auth.uid())
    )
  );

drop policy if exists tip_records_write on public.tip_records;
create policy tip_records_write on public.tip_records
  for all
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  )
  with check (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  );

-- ── 3. settlement_runs.new_tips ─────────────────────────────────────────────
-- Fotografía inmutable de cuánta propina entró en esta liquidación —
-- análoga a new_commissions, pero su propia columna (nunca se suman entre
-- sí salvo en total_to_settle).
alter table public.settlement_runs
  add column if not exists new_tips numeric(12,2) not null default 0 check (new_tips >= 0);

-- ── 4. prepare_settlement_run: suma y bloquea también las propinas ─────────
-- Misma firma de 7 parámetros que la versión en producción
-- (20260803010000_ajuste_deduccion_movements.sql). Único cambio real:
-- v_new_tips se calcula y bloquea con el mismo criterio que
-- v_new_commissions, pero desde tip_records — nunca se mezclan en la misma
-- suma ni en la misma fila.
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
as $run$
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

  select coalesce(count(*), 0), coalesce(sum(pending_amount), 0)
    into v_service_count, v_new_commissions
  from public.commission_records
  where business_id = p_business_id
    and professional_id = p_professional_id
    and settlement_run_id is null
    and (v_period_start_at is null or created_at > v_period_start_at)
    and created_at <= v_cutoff_at
    and pending_amount > 0;

  -- Propinas pendientes del mismo período/corte — misma ventana exacta que
  -- las comisiones de arriba, pero sumada aparte (v_new_tips nunca se
  -- mezcla con v_new_commissions salvo al calcular v_total).
  select coalesce(sum(pending_amount), 0)
    into v_new_tips
  from public.tip_records
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

  -- Mismo bloqueo para las propinas del período — tabla separada, mismo
  -- momento exacto de "nace la liquidación".
  update public.tip_records tr
    set settlement_run_id = v_run.id
    where tr.business_id = p_business_id
      and tr.professional_id = p_professional_id
      and tr.settlement_run_id is null
      and (v_period_start_at is null or tr.created_at > v_period_start_at)
      and tr.created_at <= v_cutoff_at;

  update public.professional_advances
    set settlement_run_id = v_run.id
    where business_id = p_business_id
      and professional_id = p_professional_id
      and settlement_run_id is null
      and advanced_at <= v_cutoff_at;

  return v_run;
end;
$run$;

grant execute on function public.prepare_settlement_run(
  uuid, uuid, jsonb, jsonb, uuid, text, timestamptz
) to authenticated;

NOTIFY pgrst, 'reload schema';
