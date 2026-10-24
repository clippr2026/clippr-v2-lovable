-- ============================================================================
-- Pagos pendientes — esquema base (ledger de cobros y comisiones recuperadas)
-- ============================================================================
-- Hoy toda venta se asume cobrada por completo en el momento: register_sale
-- crea payments + commission_records/tip_records por el total de la venta, y
-- prepare_settlement_run bloquea esa comisión a la liquidación cuya ventana
-- cubre payments.created_at (la fecha de la VENTA). No hay forma de dejar un
-- saldo pendiente y, cuando se cobre semanas después, que la comisión quede
-- disponible en la liquidación de la fecha del COBRO — ni de repartir la
-- comisión de una misma venta entre dos liquidaciones distintas si se cobra
-- en dos pagos parciales en semanas distintas (commission_records tiene
-- UNIQUE(sale_id): una sola fila, un solo settlement_run_id).
--
-- Este archivo agrega el ledger que hace falta, sin tocar el comportamiento
-- de ninguna venta que se cobra completa en el momento (el camino de hoy
-- sigue exactamente igual: cero filas nuevas en las tablas de este archivo
-- para esas ventas).
--
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase (primero en
-- desarrollo, después en producción) y ejecutar. Idempotente.
-- ============================================================================
begin;

-- ── 1. payments: saldo ───────────────────────────────────────────────────
-- collected_amount = cuánto de payments.total se cobró efectivamente hasta
-- ahora. Para todo lo existente (siempre cobrado completo) es simplemente
-- el total — se backfillea una sola vez acá y de ahí en más lo mantienen
-- register_sale/collect_pending_payment/reverse_payment_collection, nunca
-- se recalcula con un SUM en cada lectura (evita un join extra en cada
-- pantalla que hoy ya lee payments directo: Caja, Historial, Revisar
-- cierre, etc.).
alter table public.payments
  add column if not exists collected_amount numeric(12,2);

update public.payments
  set collected_amount = coalesce(total, amount, 0)
  where collected_amount is null;

alter table public.payments
  alter column collected_amount set not null,
  alter column collected_amount set default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public' and rel.relname = 'payments'
      and con.conname = 'payments_collected_amount_range'
  ) then
    alter table public.payments
      add constraint payments_collected_amount_range
      check (collected_amount >= 0 and collected_amount <= coalesce(total, amount, 0) + 0.01);
  end if;
end $$;

-- 'pendiente' y 'parcial' — 'pendiente' ya era un valor admitido por el
-- check de status en código de aplicación (register-payment.ts) pero
-- ningún flujo lo escribía; 'parcial' es nuevo. 'cobrado'/'anulado'/
-- 'reembolsado' no cambian de significado.
comment on column public.payments.collected_amount is
  'Cuánto de total/amount se cobró efectivamente hasta ahora. == total
   cuando status=cobrado (todo lo existente); < total cuando status en
   (pendiente, parcial) — el saldo es total - collected_amount. Lo
   mantienen register_sale/collect_pending_payment/reverse_payment_collection,
   nunca se recalcula con un SUM.';

-- ── 2. commission_records: split servicios/productos ───────────────────
-- Para el desglose "Comisiones por servicios cobrados" vs "Comisiones por
-- productos" (Liquidaciones) hace falta saber cuánto de `amount` vino de
-- servicios y cuánto de productos — hoy es un solo número por venta.
-- Nullable: ventas ya registradas no tienen este desglose (se muestran
-- como "servicios" por default en la UI, ver Fase 3) y eso es correcto,
-- no hace falta backfillear nada histórico para esto.
alter table public.commission_records
  add column if not exists amount_services numeric(12,2),
  add column if not exists amount_products numeric(12,2);

do $$
begin
  if not exists (
    select 1 from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public' and rel.relname = 'commission_records'
      and con.conname = 'commission_records_split_matches_amount'
  ) then
    alter table public.commission_records
      add constraint commission_records_split_matches_amount
      check (
        amount_services is null
        or amount_products is null
        or abs((amount_services + amount_products) - amount) < 0.01
      );
  end if;
end $$;

-- ── 3. settlement_runs: desglose del nuevo origen "recuperado" ─────────
-- new_commissions se mantiene como el TOTAL (compatibilidad con cualquier
-- lectura existente) — estas tres columnas lo desagregan para el detalle
-- de Liquidaciones pedido: servicios / productos / pagos pendientes
-- recuperados. recovered_tips acompaña a new_tips con el mismo criterio
-- (propina de una venta que fue pago pendiente, habilitada al cobrarse).
alter table public.settlement_runs
  add column if not exists new_commissions_services numeric(12,2) not null default 0,
  add column if not exists new_commissions_products numeric(12,2) not null default 0,
  add column if not exists recovered_commissions numeric(12,2) not null default 0,
  add column if not exists recovered_tips numeric(12,2) not null default 0;

-- ── 4. payment_collections ──────────────────────────────────────────────
-- Un renglón por cada evento de cobro contra una venta con saldo. La venta
-- original (payments.id) nunca cambia ni se duplica — toda la trazabilidad
-- "cuánto se cobró y cuándo" vive acá.
create table if not exists public.payment_collections (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null,
  branch_id          uuid,
  payment_id         uuid not null references public.payments(id) on delete cascade,
  amount             numeric(12,2) not null,
  method             text not null,
  receipt_path       text,
  observations       text,
  collected_by       uuid not null references public.profiles(id),
  collected_by_name  text,
  collected_at       timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  idempotency_key    text,
  -- Reversión: nunca se borra ni se edita un renglón existente. Revertir
  -- un cobro INSERTA un renglón nuevo con amount negativo apuntando acá
  -- (reverses_id) y marca este renglón como revertido — ver
  -- reverse_payment_collection.
  reverses_id        uuid references public.payment_collections(id),
  reversed_at        timestamptz,
  reversed_by        uuid references public.profiles(id),
  reversal_reason    text,
  constraint payment_collections_amount_not_zero check (amount <> 0),
  constraint payment_collections_reversal_needs_reason
    check (reverses_id is null or coalesce(trim(reversal_reason), '') <> '')
);

create unique index if not exists idx_payment_collections_idempotency
  on public.payment_collections (business_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists idx_payment_collections_payment
  on public.payment_collections (payment_id, collected_at);
create index if not exists idx_payment_collections_business
  on public.payment_collections (business_id, collected_at desc);

comment on table public.payment_collections is
  'Ledger de cobros contra una venta con saldo pendiente (payments.status en
   pendiente/parcial). Nunca crea una venta nueva ni duplica payments — un
   payment_id puede tener muchos renglones acá (varios pagos parciales a lo
   largo del tiempo). Una reversión es un renglón NUEVO con amount negativo
   (reverses_id → el renglón original), nunca un UPDATE/DELETE del original.';

-- ── 5. commission_collection_events / tip_collection_events ─────────────
-- Por qué un ledger separado y no alcanza con commission_records.paid_amount:
-- prepare_settlement_run necesita bloquear la comisión HABILITADA POR ESTE
-- COBRO PUNTUAL a la liquidación cuya ventana cubre la fecha de ESE cobro —
-- no la fecha de la venta. Si una deuda se cobra en dos pagos parciales en
-- dos semanas distintas, cada pago habilita una porción de comisión con su
-- propia fecha, y cada porción se bloquea a su propio settlement_run_id de
-- forma independiente. Eso es imposible con una sola fila por venta
-- (commission_records.sale_id es UNIQUE) — de ahí este ledger de eventos,
-- 1:1 con cada renglón de payment_collections.
create table if not exists public.commission_collection_events (
  id                      uuid primary key default gen_random_uuid(),
  business_id             uuid not null,
  commission_record_id    uuid not null references public.commission_records(id) on delete cascade,
  payment_collection_id   uuid not null references public.payment_collections(id) on delete cascade,
  amount                  numeric(12,2) not null,
  collected_at            timestamptz not null,
  settlement_run_id       uuid references public.settlement_runs(id),
  created_at              timestamptz not null default now(),
  constraint commission_collection_events_amount_not_zero check (amount <> 0)
);

create table if not exists public.tip_collection_events (
  id                      uuid primary key default gen_random_uuid(),
  business_id             uuid not null,
  tip_record_id           uuid not null references public.tip_records(id) on delete cascade,
  payment_collection_id   uuid not null references public.payment_collections(id) on delete cascade,
  amount                  numeric(12,2) not null,
  collected_at            timestamptz not null,
  settlement_run_id       uuid references public.settlement_runs(id),
  created_at              timestamptz not null default now(),
  constraint tip_collection_events_amount_not_zero check (amount <> 0)
);

create index if not exists idx_cce_commission on public.commission_collection_events (commission_record_id);
create index if not exists idx_cce_collection on public.commission_collection_events (payment_collection_id);
create index if not exists idx_cce_sweep on public.commission_collection_events (business_id, settlement_run_id, collected_at);

create index if not exists idx_tce_tip on public.tip_collection_events (tip_record_id);
create index if not exists idx_tce_collection on public.tip_collection_events (payment_collection_id);
create index if not exists idx_tce_sweep on public.tip_collection_events (business_id, settlement_run_id, collected_at);

comment on table public.commission_collection_events is
  'Un renglón por cada porción de comisión habilitada por un cobro puntual
   (1:1 con payment_collections, para la venta cuya commission_record_id
   corresponde). prepare_settlement_run suma/bloquea por collected_at —
   NUNCA por la fecha de la venta — así cada porción cae en la liquidación
   de la semana en que realmente se cobró. Independiente entre sí: dos
   eventos de la misma commission_record_id pueden quedar en dos
   settlement_run_id distintos.';
comment on table public.tip_collection_events is
  'Igual patrón que commission_collection_events, para propinas. Separado
   de la comisión (igual criterio que tip_records/commission_records).';

-- ── 6. RLS ────────────────────────────────────────────────────────────────
-- Mismo patrón que el resto de las tablas de dinero: visible para todo el
-- negocio salvo que seas profesional (en ese caso, solo lo tuyo via join);
-- solo roles no-profesional pueden escribir, y siempre a través de los RPCs
-- de abajo (register_sale/collect_pending_payment/reverse_payment_collection),
-- nunca con un insert/update directo desde el cliente.
alter table public.payment_collections enable row level security;
alter table public.commission_collection_events enable row level security;
alter table public.tip_collection_events enable row level security;

grant usage on schema public to authenticated;
grant select on table public.payment_collections to authenticated;
grant select on table public.commission_collection_events to authenticated;
grant select on table public.tip_collection_events to authenticated;

drop policy if exists payment_collections_select on public.payment_collections;
create policy payment_collections_select on public.payment_collections
  for select
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (
      (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
      or exists (
        select 1 from public.payments pm
        where pm.id = payment_collections.payment_id
          and pm.employee_id = (select p.employee_id from public.profiles p where p.id = auth.uid())
      )
    )
  );

drop policy if exists commission_collection_events_select on public.commission_collection_events;
create policy commission_collection_events_select on public.commission_collection_events
  for select
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (
      (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
      or exists (
        select 1 from public.commission_records cr
        where cr.id = commission_collection_events.commission_record_id
          and cr.professional_id = (select p.employee_id from public.profiles p where p.id = auth.uid())
      )
    )
  );

drop policy if exists tip_collection_events_select on public.tip_collection_events;
create policy tip_collection_events_select on public.tip_collection_events
  for select
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (
      (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
      or exists (
        select 1 from public.tip_records tr
        where tr.id = tip_collection_events.tip_record_id
          and tr.professional_id = (select p.employee_id from public.profiles p where p.id = auth.uid())
      )
    )
  );

-- Sin policy de insert/update/delete para authenticated — igual que
-- business_movements: solo se escribe desde dentro de los RPCs
-- security definer de los próximos archivos.

NOTIFY pgrst, 'reload schema';

commit;
