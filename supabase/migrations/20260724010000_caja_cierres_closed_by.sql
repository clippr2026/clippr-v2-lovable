-- ============================================================================
-- Cierre de caja — agrega caja_cierres.closed_by
-- ============================================================================
-- No es parte de Liquidaciones — es un problema aparte que apareció en la
-- misma revisión de consola. El frontend (src/routes/cash-register.tsx,
-- src/components/cash-register/session-actions.ts) lee/escribe
-- caja_cierres.closed_by desde hace varios commits (confirmado con
-- `git log -S"closed_by"` — no es algo de esta sesión), pero la tabla
-- caja_cierres nunca se creó vía una migración de este repo (como
-- payments, existe desde antes, armada directo en el dashboard de
-- Supabase) — así que nunca se hizo el ALTER TABLE correspondiente en
-- producción.
--
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase y ejecutar.
-- Seguro re-ejecutar (add column if not exists).
-- ============================================================================

alter table public.caja_cierres
  add column if not exists closed_by text;

comment on column public.caja_cierres.closed_by is
  'Nombre de quien cerró la caja ("Automático" en cierres automáticos, o
   el nombre/email de quien la cerró a mano). El frontend cae de vuelta a
   usuario_nombre si esta columna viene null en filas viejas.';

NOTIFY pgrst, 'reload schema';
