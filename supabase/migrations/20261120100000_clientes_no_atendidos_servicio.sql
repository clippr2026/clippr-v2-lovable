-- ============================================================================
-- Clientes que se fueron: servicio por el que se fueron (para "Se fue por el precio")
-- ============================================================================
-- Agrega la columna opcional `servicio` (nombre del servicio). Las filas existentes quedan con el valor vacío.
-- No modifica ni borra filas.
--
-- Cómo revertirlo:
--   alter table public.clientes_no_atendidos drop column servicio;
-- ============================================================================

alter table public.clientes_no_atendidos add column if not exists servicio text;
