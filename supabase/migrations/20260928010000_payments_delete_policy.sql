-- ============================================================================
-- Permite eliminar un cobro desde Caja → Últimos ingresos → detalle →
-- "Eliminar cobro" (uso pensado para corregir cobros de prueba/errores,
-- ej. un cobro de prueba cargado con un cliente real).
-- ============================================================================
-- payments no tenía ninguna policy de DELETE explícita en las migraciones
-- de este repo (su RLS original es anterior a este historial). Esta policy
-- es ADITIVA: RLS con varias policies permisivas se combinan con OR, así
-- que esto solo puede sumar permiso de none→delete para roles no-
-- profesional del mismo negocio — nunca puede quitar ni romper el
-- select/insert/update que ya funciona hoy.
--
-- commission_records y tip_records ya tienen "on delete cascade" hacia
-- payments(id) (ver 20260719215606_liquidaciones_system.sql y
-- 20260927010000_tips_system.sql) — borrar acá el pago se lleva puestas su
-- comisión y su propina asociadas automáticamente, sin dejar filas
-- huérfanas.
--
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase y ejecutar.
-- Idempotente, seguro re-ejecutar.
-- ============================================================================

alter table public.payments enable row level security;

drop policy if exists payments_delete_non_profesional on public.payments;
create policy payments_delete_non_profesional on public.payments
  for delete
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  );

NOTIFY pgrst, 'reload schema';
