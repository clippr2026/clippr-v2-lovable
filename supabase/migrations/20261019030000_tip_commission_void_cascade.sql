-- ============================================================================
-- Propinas/comisiones — cascada automática al anular/reembolsar un cobro
-- ============================================================================
-- Causa raíz (auditoría de propinas, 19/10/2026): payments.status admite
-- 'anulado'/'reembolsado' (ver register-payment.ts), pero nada pone en 0 la
-- comisión/propina pendiente de ese cobro cuando eso pasa. Hoy ningún flujo
-- de la UI todavía escribe esos estados (la única forma de sacar un cobro
-- mal cargado es deletePayment(), que borra la fila entera y se lleva
-- commission_records/tip_records por ON DELETE CASCADE) — este archivo es
-- preventivo: si en el futuro se agrega un "Anular"/"Reembolsar" que solo
-- cambie payments.status, esa propina/comisión no debe quedar pendiente de
-- cobro para siempre.
--
-- No es destructivo ni toca datos existentes: hoy, con cero filas en
-- payments.status in ('anulado','reembolsado'), este trigger no dispara
-- para ningún cobro ya cargado — cero cambio de comportamiento hasta que
-- algo empiece a usar esos estados.
--
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase (recomendado:
-- primero en el proyecto de desarrollo, después en el de producción) y
-- ejecutar. Idempotente — seguro re-ejecutar.
-- ============================================================================

-- Transacción explícita: si cualquier paso falla, Postgres hace rollback de
-- TODO (constraints y trigger incluidos) — nunca queda la mitad aplicada.
begin;

-- ── 1. Permitir 'voided' en commission_records.status / tip_records.status ──
-- Se busca el nombre real del check constraint en vez de asumirlo (los dos
-- se crearon como `check (...)` inline, sin nombre explícito — Postgres les
-- asigna un nombre default que puede no ser el que uno esperaría) para que
-- esto no falle silenciosamente si el nombre real fuera otro.
do $$
declare
  v_conname text;
begin
  select con.conname into v_conname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'commission_records'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%partially_paid%';

  if v_conname is not null then
    execute format('alter table public.commission_records drop constraint %I', v_conname);
  end if;

  alter table public.commission_records
    add constraint commission_records_status_check
    check (status in ('pending', 'partially_paid', 'paid', 'voided'));
end $$;

do $$
declare
  v_conname text;
begin
  select con.conname into v_conname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'tip_records'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%partially_paid%';

  if v_conname is not null then
    execute format('alter table public.tip_records drop constraint %I', v_conname);
  end if;

  alter table public.tip_records
    add constraint tip_records_status_check
    check (status in ('pending', 'partially_paid', 'paid', 'voided'));
end $$;

-- ── 2. Trigger: AFTER UPDATE OF status ON payments ──────────────────────────
-- Cuando un cobro pasa a anulado/reembolsado, la comisión/propina de ESE
-- cobro puntual se marca 'voided' y paid_amount = amount (pending_amount es
-- `generated always as (amount - paid_amount)`, así que pasa a 0 solo —
-- todas las sumas de "pendiente" en toda la app ya filtran por
-- pending_amount > 0, así que esto alcanza sin tocar ninguna query).
--
-- SOLO si settlement_run_id is null: una comisión/propina que ya quedó
-- bloqueada dentro de una liquidación preparada NUNCA se toca acá — esa
-- liquidación ya congeló su total (ver prepare_settlement_run), corregirla
-- es una decisión manual (Ajuste/Deducción en Liquidaciones), no algo que
-- un trigger deba hacer solo. No borra ninguna fila, no cambia `amount`
-- (el importe original cobrado queda intacto para auditoría).
create or replace function public.void_tip_and_commission_on_payment_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('anulado', 'reembolsado')
     and old.status is distinct from new.status then

    -- business_id = new.business_id es redundante en la práctica (sale_id
    -- ya es único y referencia exactamente a ESTE payment, imposible que
    -- apunte a una fila de otro negocio) — se deja explícito igual, para
    -- que el aislamiento por negocio sea visible en la query y no dependa
    -- únicamente de un constraint de otra tabla.
    update public.commission_records
      set paid_amount = amount,
          status = 'voided'
      where sale_id = new.id
        and business_id = new.business_id
        and settlement_run_id is null
        and status <> 'voided';

    update public.tip_records
      set paid_amount = amount,
          status = 'voided'
      where sale_id = new.id
        and business_id = new.business_id
        and settlement_run_id is null
        and status <> 'voided';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_void_tip_and_commission_on_payment_status on public.payments;
create trigger trg_void_tip_and_commission_on_payment_status
  after update of status on public.payments
  for each row
  execute function public.void_tip_and_commission_on_payment_status();

NOTIFY pgrst, 'reload schema';

commit;
