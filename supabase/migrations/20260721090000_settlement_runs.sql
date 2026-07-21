-- ============================================================================
-- Liquidaciones — Pay Runs (lotes de liquidación preparados e inmutables)
-- ============================================================================
-- Complementa el sistema de cuenta corriente ya en producción
-- (commission_records / professional_settlements / settlement_commission_links,
-- ver 20260719215606_liquidaciones_system.sql y 20260721060000_liquidaciones_rpc.sql).
-- No reemplaza ni borra nada de eso — los pagos ya registrados bajo el
-- modelo anterior quedan intactos como historial.
--
-- Nuevo modelo (estilo "Pay Runs"): en vez de pagar directamente contra el
-- saldo pendiente, primero se PREPARA un lote (settlement_run) que fija
-- qué comisiones incluye y el total a liquidar — inmutable desde ese
-- momento — y después se registran uno o más pagos (settlement_payments)
-- contra ese lote, hasta cubrirlo.
--
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase y ejecutar.
-- Seguro re-ejecutar (create table if not exists / add column if not
-- exists / create or replace en todo).
-- ============================================================================

-- ── 1. Congelar el % de comisión usado en cada venta ────────────────────────
-- Sin esto, "Ver detalle" tendría que recalcular con el % ACTUAL del
-- profesional — exactamente lo que el usuario pidió evitar. Las filas ya
-- existentes (creadas antes de esta columna) quedan en null; las nuevas
-- ventas la completan desde registerPayment.
alter table public.commission_records
  add column if not exists commission_pct numeric(6,2);

-- ── 2. settlement_runs: el lote preparado ───────────────────────────────────
create table if not exists public.settlement_runs (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null,
  professional_id    uuid not null references public.employees(id) on delete cascade,
  run_number         int not null,
  cutoff_date        date not null,
  previous_balance   numeric(12,2) not null default 0 check (previous_balance >= 0),
  new_commissions    numeric(12,2) not null default 0 check (new_commissions >= 0),
  adjustments        numeric(12,2) not null default 0,
  deductions         numeric(12,2) not null default 0 check (deductions >= 0),
  total_to_settle    numeric(12,2) not null default 0 check (total_to_settle >= 0),
  amount_paid        numeric(12,2) not null default 0 check (amount_paid >= 0),
  service_count      int not null default 0,
  total_sold         numeric(12,2) not null default 0,
  status             text not null default 'pendiente'
                       check (status in ('pendiente', 'parcial', 'pagada', 'observada')),
  prepared_by        uuid not null references public.profiles(id),
  prepared_by_name   text not null,
  prepared_at        timestamptz not null default now(),
  professional_confirmed_at timestamptz,
  professional_confirmed_by uuid references public.profiles(id),
  professional_observation  text,
  professional_observed_at timestamptz,
  created_at         timestamptz not null default now(),
  constraint settlement_runs_paid_not_over_total check (amount_paid <= total_to_settle),
  constraint settlement_runs_run_number_unique unique (business_id, professional_id, run_number)
);

create index if not exists idx_settlement_runs_business
  on public.settlement_runs (business_id);
create index if not exists idx_settlement_runs_professional
  on public.settlement_runs (professional_id, cutoff_date desc);

comment on table public.settlement_runs is
  'Un lote de liquidación preparado. Inmutable desde su creación: el
   cálculo (saldo anterior, comisiones nuevas, ajustes, deducciones,
   total) no se recalcula después aunque cambie el % de comisión del
   profesional o se generen ventas nuevas — esas van al próximo run.';

-- ── 3. Bloqueo de comisiones: qué run las incluyó ───────────────────────────
-- Una comisión con settlement_run_id ya asignado no puede volver a
-- incluirse en otro run (se filtra explícitamente al preparar uno nuevo).
alter table public.commission_records
  add column if not exists settlement_run_id uuid references public.settlement_runs(id);

create index if not exists idx_commission_records_settlement_run
  on public.commission_records (settlement_run_id);

-- ── 4. settlement_payments: pagos aplicados a un run ────────────────────────
create table if not exists public.settlement_payments (
  id                 uuid primary key default gen_random_uuid(),
  settlement_run_id  uuid not null references public.settlement_runs(id) on delete cascade,
  business_id        uuid not null,
  professional_id    uuid not null references public.employees(id) on delete cascade,
  amount             numeric(12,2) not null check (amount > 0),
  payment_method     text,
  note               text,
  balance_before     numeric(12,2) not null,
  balance_after      numeric(12,2) not null,
  paid_by            uuid not null references public.profiles(id),
  paid_by_name       text not null,
  paid_at            timestamptz not null default now()
);

create index if not exists idx_settlement_payments_run
  on public.settlement_payments (settlement_run_id);
create index if not exists idx_settlement_payments_professional
  on public.settlement_payments (professional_id, paid_at desc);

comment on table public.settlement_payments is
  'Un pago (total o parcial) aplicado a un settlement_run. Un run puede
   tener varios pagos parciales hasta quedar cubierto (status pagada).';

-- ── 5. RLS ───────────────────────────────────────────────────────────────
alter table public.settlement_runs enable row level security;
alter table public.settlement_payments enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.settlement_runs to authenticated;
grant select, insert, update, delete on table public.settlement_payments to authenticated;

drop policy if exists settlement_runs_select on public.settlement_runs;
create policy settlement_runs_select on public.settlement_runs
  for select
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (
      (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
      or professional_id = (select p.employee_id from public.profiles p where p.id = auth.uid())
    )
  );

-- Escritura directa de tabla restringida a roles no-profesional. La
-- confirmación/observación del profesional (fase 2, todavía no
-- construida) va a pasar por un RPC security definer aparte que solo
-- puede tocar esas columnas puntuales — RLS "for all" no puede
-- restringir a nivel de columna, así que no le damos UPDATE de tabla
-- directo al profesional para evitar que pueda tocar total_to_settle,
-- amount_paid, etc. de su propia liquidación.
drop policy if exists settlement_runs_write on public.settlement_runs;
create policy settlement_runs_write on public.settlement_runs
  for all
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  )
  with check (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  );

drop policy if exists settlement_payments_select on public.settlement_payments;
create policy settlement_payments_select on public.settlement_payments
  for select
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (
      (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
      or professional_id = (select p.employee_id from public.profiles p where p.id = auth.uid())
    )
  );

drop policy if exists settlement_payments_write on public.settlement_payments;
create policy settlement_payments_write on public.settlement_payments
  for all
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  )
  with check (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  );

-- ── 6. RPC: preparar una liquidación (inmutable desde que se crea) ─────────
create or replace function public.prepare_settlement_run(
  p_business_id uuid,
  p_professional_id uuid,
  p_cutoff_date date,
  p_adjustments numeric,
  p_deductions numeric,
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
  v_previous_balance numeric := 0;
  v_new_commissions numeric := 0;
  v_service_count int := 0;
  v_total_sold numeric := 0;
  v_adjustments numeric := coalesce(p_adjustments, 0);
  v_deductions numeric := coalesce(p_deductions, 0);
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

  -- Saldo anterior: lo que quedó pendiente del último run (si lo hay),
  -- congelado en ese momento — nunca se recalcula desde cero.
  select * into v_previous_run
  from public.settlement_runs
  where business_id = p_business_id and professional_id = p_professional_id
  order by cutoff_date desc, created_at desc
  limit 1;

  if found then
    v_previous_balance := greatest(v_previous_run.total_to_settle - v_previous_run.amount_paid, 0);
  end if;

  -- Comisiones nuevas: generadas hasta el corte y todavía sin asignar a
  -- ningún run (así nunca se re-incluye lo que ya quedó en uno anterior).
  select coalesce(count(*), 0), coalesce(sum(amount), 0)
    into v_service_count, v_new_commissions
  from public.commission_records
  where business_id = p_business_id
    and professional_id = p_professional_id
    and settlement_run_id is null
    and sale_date <= p_cutoff_date;

  select coalesce(sum(coalesce(pm.total, pm.amount, 0)), 0)
    into v_total_sold
  from public.commission_records cr
  join public.payments pm on pm.id = cr.sale_id
  where cr.business_id = p_business_id
    and cr.professional_id = p_professional_id
    and cr.settlement_run_id is null
    and cr.sale_date <= p_cutoff_date;

  v_total := v_previous_balance + v_new_commissions + v_adjustments - v_deductions;
  if v_total < 0 then
    raise exception 'El total a liquidar no puede ser negativo (revisá ajustes/deducciones)';
  end if;

  select coalesce(max(run_number), 0) + 1 into v_run_number
  from public.settlement_runs
  where business_id = p_business_id and professional_id = p_professional_id;

  insert into public.settlement_runs (
    business_id, professional_id, run_number, cutoff_date,
    previous_balance, new_commissions, adjustments, deductions, total_to_settle,
    service_count, total_sold, status, prepared_by, prepared_by_name
  ) values (
    p_business_id, p_professional_id, v_run_number, p_cutoff_date,
    v_previous_balance, v_new_commissions, v_adjustments, v_deductions, v_total,
    v_service_count, v_total_sold, 'pendiente', p_prepared_by, p_prepared_by_name
  ) returning * into v_run;

  -- Bloquea las comisiones incluidas: ya no pueden entrar en otro run.
  update public.commission_records
    set settlement_run_id = v_run.id
    where business_id = p_business_id
      and professional_id = p_professional_id
      and settlement_run_id is null
      and sale_date <= p_cutoff_date;

  return v_run;
end;
$$;

grant execute on function public.prepare_settlement_run(
  uuid, uuid, date, numeric, numeric, uuid, text
) to authenticated;

-- ── 7. RPC: registrar un pago contra un run (total o parcial) ──────────────
create or replace function public.register_settlement_run_payment(
  p_settlement_run_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_note text,
  p_paid_by uuid,
  p_paid_by_name text
)
returns public.settlement_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_caller_business uuid;
  v_run public.settlement_runs;
  v_remaining_before numeric;
  v_remaining_after numeric;
  v_apply_remaining numeric;
  v_rec record;
  v_apply numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto a pagar debe ser mayor a cero';
  end if;

  if p_paid_by is distinct from auth.uid() then
    raise exception 'paid_by debe ser el usuario autenticado';
  end if;

  select * into v_run from public.settlement_runs where id = p_settlement_run_id for update;
  if not found then
    raise exception 'Liquidación no encontrada';
  end if;

  select p.role, p.business_id into v_role, v_caller_business
  from public.profiles p where p.id = auth.uid();

  if v_caller_business is distinct from v_run.business_id then
    raise exception 'No tenés permiso sobre este negocio';
  end if;

  if v_role = 'profesional' then
    raise exception 'Un profesional no puede registrar sus propios pagos';
  end if;

  v_remaining_before := v_run.total_to_settle - v_run.amount_paid;
  if p_amount > v_remaining_before then
    raise exception 'El monto a pagar (%) supera el saldo de esta liquidación (%)', p_amount, v_remaining_before;
  end if;

  v_remaining_after := v_remaining_before - p_amount;

  insert into public.settlement_payments (
    settlement_run_id, business_id, professional_id, amount, payment_method, note,
    balance_before, balance_after, paid_by, paid_by_name
  ) values (
    v_run.id, v_run.business_id, v_run.professional_id, p_amount, p_payment_method,
    nullif(trim(coalesce(p_note, '')), ''), v_remaining_before, v_remaining_after,
    p_paid_by, p_paid_by_name
  );

  update public.settlement_runs
    set amount_paid = amount_paid + p_amount,
        status = case when amount_paid + p_amount >= total_to_settle then 'pagada' else 'parcial' end
    where id = v_run.id
    returning * into v_run;

  -- Aplica el pago a las comisiones incluidas en ESTE run, más viejas
  -- primero (mismo criterio que el resto del sistema) — puramente para
  -- que commission_records.pending_amount (la fuente del saldo pendiente
  -- TOTAL, sin importar rango) quede sincronizado.
  v_apply_remaining := p_amount;
  for v_rec in
    select id, pending_amount
    from public.commission_records
    where settlement_run_id = v_run.id
      and status in ('pending', 'partially_paid')
    order by sale_date asc, created_at asc
    for update
  loop
    exit when v_apply_remaining <= 0;
    v_apply := least(v_apply_remaining, v_rec.pending_amount);
    continue when v_apply <= 0;

    update public.commission_records
      set paid_amount = paid_amount + v_apply,
          status = case when paid_amount + v_apply >= amount then 'paid' else 'partially_paid' end
      where id = v_rec.id;

    v_apply_remaining := v_apply_remaining - v_apply;
  end loop;

  return v_run;
end;
$$;

grant execute on function public.register_settlement_run_payment(
  uuid, numeric, text, text, uuid, text
) to authenticated;
