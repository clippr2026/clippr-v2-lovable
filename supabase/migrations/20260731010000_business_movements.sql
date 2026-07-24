-- ============================================================================
-- Movimiento #N — ledger global de movimientos de dinero del negocio
-- ============================================================================
-- Reemplaza el concepto "Liquidación #N" (run_number, por lote) por un
-- identificador único por MOVIMIENTO individual (adelanto, pago parcial,
-- pago total), compartiendo una sola secuencia global por negocio que
-- arranca en 100. business_movements es la única fuente de verdad de esa
-- numeración: la unicidad la impone su propia unique constraint, no la
-- disciplina de locking replicada en cada RPC que inserta un movimiento.
--
-- Un pago múltiple (varios métodos en la misma acción de "Pagar") inserta
-- varias filas en settlement_payments pero TODAS comparten un mismo
-- movement_number/movement_id — se resuelve en la migración de RPCs
-- (20260801010000), acá solo se prepara el esquema.
--
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase (proyecto
-- pypduwtioxudgepwjvom, el de myclippr.com) y ejecutar. Idempotente.
-- ============================================================================

-- 1. business_movements
create table if not exists public.business_movements (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null,
  movement_number  int not null,
  movement_type    text not null check (movement_type in ('adelanto', 'pago_parcial', 'pago_total')),
  professional_id  uuid not null references public.employees(id) on delete cascade,
  amount           numeric(12,2) not null check (amount > 0),
  occurred_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  constraint business_movements_number_unique unique (business_id, movement_number)
);

create index if not exists idx_business_movements_business
  on public.business_movements (business_id, movement_number desc);
create index if not exists idx_business_movements_professional
  on public.business_movements (professional_id, occurred_at desc);

comment on table public.business_movements is
  'Ledger de todo movimiento de dinero: adelanto, pago parcial o pago total. Fuente unica de verdad de la numeracion Movimiento #N, global por negocio, arranca en 100, nunca se repite ni se reinicia. amount es el total del movimiento (suma de splits si es pago multiple); el detalle real (metodo, nota, saldo antes/despues) sigue viviendo en settlement_payments/professional_advances, vinculado por movement_id.';

alter table public.business_movements enable row level security;

grant usage on schema public to authenticated;
grant select on table public.business_movements to authenticated;

drop policy if exists business_movements_select on public.business_movements;
create policy business_movements_select on public.business_movements
  for select
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (
      (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
      or professional_id = (select p.employee_id from public.profiles p where p.id = auth.uid())
    )
  );

-- Sin policy de insert/update/delete para authenticated: solo se escribe
-- desde next_business_movement_number, que es security definer y no se
-- expone directamente (ver abajo) — evita que cualquier cliente pida
-- numeros al voleo sin registrar el movimiento real que los respalda.

-- 2. Columnas de vinculo en las tablas de detalle
alter table public.settlement_payments
  add column if not exists movement_number int;
alter table public.settlement_payments
  add column if not exists movement_id uuid references public.business_movements(id);

alter table public.professional_advances
  add column if not exists movement_number int;
alter table public.professional_advances
  add column if not exists movement_id uuid references public.business_movements(id);

create index if not exists idx_settlement_payments_movement
  on public.settlement_payments (movement_number);
create index if not exists idx_professional_advances_movement
  on public.professional_advances (movement_number);

-- 3. next_business_movement_number
-- No se expone a "authenticated" (sin grant execute) — solo la llaman los
-- RPCs de negocio (register_settlement_run_payment_batch,
-- register_professional_advance) desde DENTRO de su misma transaccion, asi
-- un rollback tambien deshace el insert aca y el numero no se "quema".
-- Reutiliza el mismo advisory lock que ya usa prepare_settlement_run para
-- run_number (hashtextextended(business_id, 0)), sin nuevos puntos de
-- contencion.
create or replace function public.next_business_movement_number(
  p_business_id uuid,
  p_movement_type text,
  p_professional_id uuid,
  p_amount numeric,
  p_occurred_at timestamptz default null
)
returns public.business_movements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_movement public.business_movements;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));

  insert into public.business_movements (
    business_id, movement_number, movement_type, professional_id, amount, occurred_at
  ) values (
    p_business_id,
    coalesce((select max(movement_number) from public.business_movements where business_id = p_business_id), 99) + 1,
    p_movement_type, p_professional_id, p_amount, coalesce(p_occurred_at, now())
  ) returning * into v_movement;

  return v_movement;
end;
$$;

NOTIFY pgrst, 'reload schema';
