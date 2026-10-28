-- ============================================================================
-- Caso real: un adelanto se registró el 28/10 pero el negocio lo quiere
-- organizar como si fuera del 24/10 en Adelantos/Movimientos — sin mover
-- la fecha financiera real, porque esa es la que ya usan Caja (conciliación
-- de efectivo/cuenta esperados) y Liquidaciones (período/corte) para ESE
-- adelanto puntual.
--
-- professional_advances.advanced_at es, hoy, la ÚNICA fecha — sirve a la
-- vez para el cálculo financiero (computeExpectedCashAndDigital vía el
-- filtro por día en buildCierreSnapshotForDate/buildSingleDayCierrePreview,
-- y prepare_settlement_run: "advanced_at <= corte") y para lo que se
-- MUESTRA en pantalla (Movimientos de Caja/Panel del profesional, detalle
-- del adelanto). No hay forma de separar una cosa de la otra.
--
-- Este archivo agrega una columna nueva, nullable, puramente aditiva:
-- display_date. NULL (el default, y el valor de TODO adelanto existente)
-- significa "mostrar advanced_at, como siempre" — cero cambio de
-- comportamiento para cualquier adelanto que no se toque a mano.
--
-- advanced_at NUNCA se deja de usar para nada financiero: ningún cálculo
-- de Caja, conciliación, comisión ni liquidación se toca en esta
-- migración (no se modifica ninguna función SQL) — display_date es
-- exclusivamente para lectura desde el frontend (Movimientos/detalle).
--
-- Cómo correrlo: SQL Editor de Supabase, primero en desarrollo si existe,
-- después en producción. Idempotente.
-- ============================================================================
begin;

alter table public.professional_advances
  add column if not exists display_date timestamptz;

comment on column public.professional_advances.display_date is
  'Fecha/hora SOLO para mostrar en Movimientos/detalle (historial-movimientos.ts) — NULL = usar advanced_at. advanced_at sigue siendo la única fecha real para Caja/conciliación/período de liquidación, nunca se deriva de acá.';

NOTIFY pgrst, 'reload schema';

commit;
