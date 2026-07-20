-- ============================================================================
-- Sistema de liquidaciones de profesionales — Caja → Liquidaciones
-- ============================================================================
-- Reemplaza el cálculo "solo por rango de fechas" (que podía pagar dos veces
-- la misma comisión o perder de vista un pago parcial) por un modelo donde
-- cada comisión generada por una venta tiene su propio estado de
-- liquidación, y cada pago queda vinculado exactamente a las comisiones que
-- cubre — con soporte para pagos parciales y rangos superpuestos sin
-- duplicar ni perder plata.
--
-- Cómo correrlo: pegar este archivo completo en el SQL Editor de Supabase
-- (Dashboard del proyecto → SQL Editor → New query) y ejecutarlo una vez.
-- Es seguro re-ejecutarlo (usa IF NOT EXISTS / OR REPLACE en todo).
-- ============================================================================

-- ── 1. commission_records ───────────────────────────────────────────────────
-- Una fila por cada comisión generada (una por venta cobrada). Es la
-- "fuente de verdad" de cuánto se le debe a cada profesional y cuánto de
-- eso ya se le pagó.
create table if not exists public.commission_records (
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
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint commission_records_sale_unique unique (sale_id),
  constraint commission_records_paid_not_over_amount check (paid_amount <= amount)
);

create index if not exists idx_commission_records_business
  on public.commission_records (business_id);
create index if not exists idx_commission_records_professional
  on public.commission_records (professional_id, sale_date);
create index if not exists idx_commission_records_status
  on public.commission_records (business_id, professional_id, status);

comment on table public.commission_records is
  'Una fila por comisión generada (una por venta cobrada). status/paid_amount
   se actualizan cuando se crea una liquidación que la cubre (ver
   settlement_commission_links) — nunca se recalcula por rango de fechas.';

-- ── 2. professional_settlements (liquidaciones) ─────────────────────────────
-- Una fila por cada pago confirmado desde Caja → Liquidaciones. Guarda una
-- "fotografía" exacta de la situación en el momento del pago: no se
-- recalcula después aunque cambien filtros o se generen ventas nuevas.
create table if not exists public.professional_settlements (
  id                          uuid primary key default gen_random_uuid(),
  business_id                 uuid not null,
  professional_id             uuid not null references public.employees(id) on delete cascade,
  range_from                  date not null,
  range_to                    date not null,
  -- Snapshot: comisión total generada en ese rango al momento del pago.
  commission_total_in_range   numeric(12,2) not null check (commission_total_in_range >= 0),
  -- Snapshot: cuánto de esas mismas comisiones ya estaba pagado ANTES de
  -- esta liquidación (de liquidaciones previas que se solapan con este rango).
  already_paid_before         numeric(12,2) not null default 0 check (already_paid_before >= 0),
  -- Importe efectivamente pagado en ESTA liquidación (puede ser parcial).
  amount_paid                 numeric(12,2) not null check (amount_paid > 0),
  -- Snapshot: saldo pendiente inmediatamente después de este pago.
  pending_after                numeric(12,2) not null default 0 check (pending_after >= 0),
  payment_method               text,
  -- Auditoría: usuario que confirmó el pago, congelado en el momento (no
  -- sigue al perfil si después se edita el nombre).
  paid_by                      uuid not null references public.profiles(id),
  paid_by_name                 text not null,
  paid_at                      timestamptz not null default now(),
  created_at                   timestamptz not null default now(),
  constraint professional_settlements_range_valid check (range_to >= range_from)
);

create index if not exists idx_settlements_business
  on public.professional_settlements (business_id);
create index if not exists idx_settlements_professional
  on public.professional_settlements (professional_id, paid_at desc);
create index if not exists idx_settlements_range
  on public.professional_settlements (professional_id, range_from, range_to);

comment on table public.professional_settlements is
  'Un registro por pago confirmado en Caja → Liquidaciones. Nunca se edita
   después de creado — es una fotografía histórica, no un total en vivo.';

-- ── 3. settlement_commission_links ──────────────────────────────────────────
-- Qué comisiones específicas cubrió cada liquidación, y cuánto se aplicó a
-- cada una — esto es lo que hace posible pagos parciales sin duplicar: una
-- comisión puede aparecer en más de un link (varios pagos parciales a lo
-- largo del tiempo) y una liquidación puede cubrir varias comisiones.
create table if not exists public.settlement_commission_links (
  id                    uuid primary key default gen_random_uuid(),
  settlement_id         uuid not null references public.professional_settlements(id) on delete cascade,
  commission_record_id  uuid not null references public.commission_records(id) on delete cascade,
  amount_applied        numeric(12,2) not null check (amount_applied > 0),
  created_at            timestamptz not null default now(),
  constraint settlement_commission_links_unique unique (settlement_id, commission_record_id)
);

create index if not exists idx_settlement_links_settlement
  on public.settlement_commission_links (settlement_id);
create index if not exists idx_settlement_links_commission
  on public.settlement_commission_links (commission_record_id);

comment on table public.settlement_commission_links is
  'Join table: qué comisiones cubrió cada liquidación y cuánto se le aplicó
   a cada una. Sumar amount_applied por commission_record_id = paid_amount
   de esa comisión (se mantiene sincronizado desde la aplicación al crear
   una liquidación, dentro de la misma transacción).';

-- ── 4. updated_at automático en commission_records ──────────────────────────
create or replace function public.set_commission_records_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_commission_records_updated_at on public.commission_records;
create trigger trg_commission_records_updated_at
  before update on public.commission_records
  for each row
  execute function public.set_commission_records_updated_at();

-- ── 5. RLS ───────────────────────────────────────────────────────────────
alter table public.commission_records enable row level security;
alter table public.professional_settlements enable row level security;
alter table public.settlement_commission_links enable row level security;

-- commission_records: cualquier usuario autenticado del mismo negocio puede
-- leer; un profesional solo ve las suyas, el resto de los roles ve todas las
-- del negocio. Solo roles no-profesional pueden escribir (las comisiones se
-- crean desde el backend/app al cobrar una venta, nunca por el profesional).
drop policy if exists commission_records_select on public.commission_records;
create policy commission_records_select on public.commission_records
  for select
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (
      (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
      or professional_id = (select p.employee_id from public.profiles p where p.id = auth.uid())
    )
  );

drop policy if exists commission_records_write on public.commission_records;
create policy commission_records_write on public.commission_records
  for all
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  )
  with check (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  );

-- professional_settlements: mismo criterio — el profesional ve solo sus
-- propias liquidaciones (nunca las de otros), y solo puede CREAR
-- liquidaciones alguien que no sea profesional ("no puede pagarse a sí
-- mismo").
drop policy if exists settlements_select on public.professional_settlements;
create policy settlements_select on public.professional_settlements
  for select
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (
      (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
      or professional_id = (select p.employee_id from public.profiles p where p.id = auth.uid())
    )
  );

drop policy if exists settlements_write on public.professional_settlements;
create policy settlements_write on public.professional_settlements
  for all
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  )
  with check (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  );

-- settlement_commission_links: visibilidad heredada de professional_settlements
-- (join), escritura restringida igual que settlements.
drop policy if exists settlement_links_select on public.settlement_commission_links;
create policy settlement_links_select on public.settlement_commission_links
  for select
  using (
    exists (
      select 1 from public.professional_settlements s
      where s.id = settlement_commission_links.settlement_id
        and s.business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
        and (
          (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
          or s.professional_id = (select p.employee_id from public.profiles p where p.id = auth.uid())
        )
    )
  );

drop policy if exists settlement_links_write on public.settlement_commission_links;
create policy settlement_links_write on public.settlement_commission_links
  for all
  using (
    exists (
      select 1 from public.professional_settlements s
      where s.id = settlement_commission_links.settlement_id
        and s.business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
        and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
    )
  )
  with check (
    exists (
      select 1 from public.professional_settlements s
      where s.id = settlement_commission_links.settlement_id
        and s.business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
        and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
    )
  );

-- ============================================================================
-- Notas para la siguiente etapa (implementación en la app, después de correr
-- esto):
--
-- 1. Al cobrar una venta (handleCobrar en cash-register.tsx, cualquiera de
--    sus 3 flujos: turno pendiente, mostrador pendiente, venta directa),
--    además de registerPayment() se debe insertar UNA fila en
--    commission_records (professional_id, sale_id=payment.id, amount=
--    comisión calculada, sale_date=fecha de la venta, status='pending').
--
-- 2. Caja → Liquidaciones, al elegir profesional + rango:
--      Comisión generada = sum(amount)   where professional_id=X and
--                                              sale_date between from/to
--      Pagado            = sum(paid_amount) de esas mismas filas
--      Pendiente         = sum(pending_amount) de esas mismas filas
--    (nunca "comisión del rango menos liquidaciones cuyo rango se solape" —
--    siempre a nivel de comisión individual, así nunca importa cómo se
--    hayan superpuesto los rangos de pagos anteriores).
--
-- 3. Botón "Pagar": dentro de una transacción (RPC / Edge Function, no
--    varios requests sueltos desde el cliente, para que no pueda quedar a
--    medio hacer),
--      a) tomar las commission_records pending/partially_paid del
--         profesional en el rango, ordenadas por sale_date;
--      b) repartir el importe a pagar entre ellas (más viejas primero),
--         insertando un settlement_commission_links por cada una con el
--         amount_applied correspondiente;
--      c) actualizar paid_amount y status (paid cuando pending_amount
--         llega a 0, si no partially_paid) de cada commission_record
--         tocada;
--      d) insertar UNA fila en professional_settlements con los 5 snapshots
--         (commission_total_in_range, already_paid_before, amount_paid,
--         pending_after) ya calculados en (a)/(b).
--
-- 4. "Pendiente de liquidar" en el panel del profesional se lee de la MISMA
--    fuente (commission_records), filtrando professional_id = su propio
--    employee_id — nunca se recalcula distinto entre Caja y el panel.
-- ============================================================================
