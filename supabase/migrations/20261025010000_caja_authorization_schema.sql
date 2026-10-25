-- ============================================================================
-- Autorizaciones de caja — esquema (contraseñas de corrección/anulación)
-- ============================================================================
-- "Eliminar cobro" (deletePayment, register-payment.ts) es hoy la única
-- acción sobre un cobro ya cargado, sin ningún control de permisos ni
-- contraseña, y borra la fila entera. Este archivo prepara el esquema para
-- dos acciones nuevas ("Corregir cobro"/"Anular venta") que van a requerir
-- una contraseña de autorización propia (independiente de la de login),
-- configurable por negocio, una por tipo de acción.
--
-- Todo lo sensible (hash, intentos fallidos) vive en una tabla SIN ningún
-- grant a "authenticated" — se lee/escribe exclusivamente desde RPCs
-- security definer (ver próximas migraciones), nunca directo desde el
-- cliente. payment_authorization_log sí es legible por el negocio (es el
-- historial auditable que se muestra en el detalle de un cobro).
--
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase (primero en
-- desarrollo, después en producción) y ejecutar. Idempotente.
-- ============================================================================
begin;

-- pgcrypto: no está habilitada en ninguna migración trackeada hasta ahora.
-- Hace falta para crypt()/gen_salt() más abajo.
create extension if not exists pgcrypto with schema extensions;

-- ── 1. caja_authorization_codes ─────────────────────────────────────────────
-- Una fila por negocio + tipo de acción. password_hash nunca se expone: ni
-- select ni insert/update directo para "authenticated" (sin policy = deny
-- por default con RLS habilitado). failed_attempts/locked_until implementan
-- el rate-limit exigido ("limitar intentos fallidos").
create table if not exists public.caja_authorization_codes (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null,
  action_type      text not null check (action_type in ('correction', 'void')),
  password_hash    text not null,
  failed_attempts  int not null default 0,
  locked_until     timestamptz,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  constraint caja_authorization_codes_unique unique (business_id, action_type)
);

alter table public.caja_authorization_codes enable row level security;
-- Sin ninguna policy ni grant a "authenticated": toda lectura/escritura pasa
-- por RPCs security definer (ver 20261025020000/30000/40000).

comment on table public.caja_authorization_codes is
  'Contraseña de autorización por negocio+acción (correction|void), hasheada con pgcrypto. Nunca legible/escribible directo desde el cliente — solo a través de RPCs security definer.';

-- ── 2. payment_authorization_log ────────────────────────────────────────────
-- Auditoría de cada corrección/anulación realizada: quién, qué, cuándo.
-- Legible por miembros del negocio (se muestra en el detalle del cobro);
-- insert solo vía RPC (sin policy de insert para "authenticated").
create table if not exists public.payment_authorization_log (
  id                      uuid primary key default gen_random_uuid(),
  business_id             uuid not null,
  payment_id              uuid not null references public.payments(id) on delete cascade,
  action_type             text not null check (action_type in ('correction', 'void')),
  reason                  text not null,
  performed_by            uuid,
  performed_by_name       text,
  before_snapshot         jsonb,
  after_snapshot          jsonb,
  adjustment_payment_id   uuid references public.payments(id) on delete set null,
  created_at              timestamptz not null default now()
);

create index if not exists idx_payment_authorization_log_payment
  on public.payment_authorization_log (payment_id, created_at desc);
create index if not exists idx_payment_authorization_log_business
  on public.payment_authorization_log (business_id, created_at desc);

alter table public.payment_authorization_log enable row level security;

grant select on table public.payment_authorization_log to authenticated;

drop policy if exists payment_authorization_log_select on public.payment_authorization_log;
create policy payment_authorization_log_select on public.payment_authorization_log
  for select
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
  );

comment on table public.payment_authorization_log is
  'Historial auditable de Corregir cobro/Anular venta: quién, qué cambió y cuándo. Insert solo desde void_payment_authorized/correct_payment_authorized (security definer) — nunca directo desde el cliente.';

-- ── 3. payments.adjustment_of_payment_id ────────────────────────────────────
-- Encadena un asiento de ajuste (corrección de una venta de un día YA
-- cerrado, ver correct_payment_authorized) con la venta original que
-- corrige. La venta original jamás se edita en ese caso — este es el único
-- vínculo entre las dos filas.
alter table public.payments
  add column if not exists adjustment_of_payment_id uuid references public.payments(id) on delete set null;

create index if not exists idx_payments_adjustment_of
  on public.payments (adjustment_of_payment_id) where adjustment_of_payment_id is not null;

comment on column public.payments.adjustment_of_payment_id is
  'Si no es null, esta fila es un ajuste (Corregir cobro sobre un día ya cerrado) que corrige la venta referenciada, sin tocarla. El delta queda en total/amount/tip_amount de ESTA fila.';

-- ── 4. commission_adjustment_queue ──────────────────────────────────────────
-- Si se anula una venta cuya comisión ya fue liquidada (settlement_run_id
-- ya seteado), el trigger de void NO la toca (protege la liquidación
-- histórica, ver 20261019030000) — esta tabla registra la deducción
-- pendiente para que quien prepare la PRÓXIMA liquidación de ese
-- profesional la vea y la cargue como "Deducción" (prepare_settlement_run
-- ya admite deduction_items con amount+reason). No descuenta solo: es el
-- registro auditable que exige el requisito, la aplicación real sigue
-- siendo una decisión manual de quien liquida — mismo criterio que ya usa
-- el propio trigger para este caso.
create table if not exists public.commission_adjustment_queue (
  id                        uuid primary key default gen_random_uuid(),
  business_id               uuid not null,
  professional_id           uuid not null references public.employees(id) on delete cascade,
  sale_id                   uuid not null references public.payments(id) on delete cascade,
  commission_amount         numeric(12,2) not null check (commission_amount >= 0),
  reason                    text not null,
  created_at                timestamptz not null default now(),
  applied_settlement_run_id uuid references public.settlement_runs(id)
);

create index if not exists idx_commission_adjustment_queue_pending
  on public.commission_adjustment_queue (business_id, professional_id)
  where applied_settlement_run_id is null;

alter table public.commission_adjustment_queue enable row level security;

grant select on table public.commission_adjustment_queue to authenticated;

drop policy if exists commission_adjustment_queue_select on public.commission_adjustment_queue;
create policy commission_adjustment_queue_select on public.commission_adjustment_queue
  for select
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
  );

comment on table public.commission_adjustment_queue is
  'Deducciones pendientes de aplicar en la próxima liquidación de un profesional, generadas al anular una venta cuya comisión ya estaba liquidada. Insert solo desde void_payment_authorized (security definer).';

NOTIFY pgrst, 'reload schema';

commit;
