-- ============================================================================
-- Presentismo — permiso de lectura para `authenticated`
-- ============================================================================
-- En producción, attendance_confirmations y attendance_adjustments quedaron
-- con solo REFERENCES/TRIGGER/TRUNCATE para authenticated (sin SELECT), así
-- que cualquier lectura con el usuario logueado falla con
-- "permission denied for table ...". Eso rompía:
--   · el control del cierre de caja (trg_check_attendance_before_close, que
--     corre con el usuario que cierra y lee attendance_confirmations),
--   · el panel "Revisar cierre" y la tarjeta Presentismo de Liquidaciones.
--
-- Solo se da SELECT: la política RLS *_select sigue limitando cada fila al
-- negocio del usuario, y INSERT/UPDATE/DELETE siguen cerrados a propósito
-- (todo cambio pasa por confirm_attendance, security definer).
-- Es seguro re-ejecutarlo (GRANT es idempotente). No toca datos.
--
-- Cómo revertirlo:
--   revoke select on public.attendance_confirmations, public.attendance_adjustments from authenticated;
-- ============================================================================

grant select on public.attendance_confirmations to authenticated;
grant select on public.attendance_adjustments to authenticated;
