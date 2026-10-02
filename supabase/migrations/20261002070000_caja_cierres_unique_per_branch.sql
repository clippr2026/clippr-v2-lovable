-- ============================================================================
-- caja_cierres: único por (business_id, branch_id, fecha) en vez de
-- (business_id, fecha)
-- ============================================================================
-- 20260930050000 agregó branch_id a caja_cierres pero nunca tocó el único
-- original (business_id, fecha) — con un solo negocio/una sola sucursal en
-- producción no se notaba, pero bloquea que dos sucursales del MISMO
-- negocio tengan cada una su propio cierre el mismo día (la segunda
-- chocaría contra el cierre de la primera).
--
-- Antes de aplicar: 0 duplicados posibles por (business_id, branch_id,
-- fecha) y 0 filas con branch_id null en producción (verificado), así que
-- el nuevo único no puede fallar por datos existentes.
--
-- Genérica, re-ejecutable.
-- ============================================================================

alter table public.caja_cierres
  drop constraint if exists caja_cierres_business_id_fecha_key;

alter table public.caja_cierres
  add constraint caja_cierres_business_branch_fecha_key
  unique (business_id, branch_id, fecha);

NOTIFY pgrst, 'reload schema';
