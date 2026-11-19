-- ============================================================================
-- Clientes que se fueron: motivo "por el precio"
-- ============================================================================
-- El botón "Se fue" de la Agenda suma una opción: el cliente se fue por el precio. Se guarda en la columna
-- `preferencia` con el valor 'precio' (sin profesional pedido).
--
-- Solo amplía la restricción de la columna: no modifica ni borra filas existentes.
--
-- Cómo revertirlo (si todavía no hay filas con 'precio'; si las hay, primero pasarlas a null):
--   alter table public.clientes_no_atendidos drop constraint clientes_no_atendidos_preferencia_check;
--   alter table public.clientes_no_atendidos add constraint clientes_no_atendidos_preferencia_check
--     check (preferencia is null or (preferencia = 'cualquiera' and requested_employee_id is null) or preferencia = 'especifico');
-- ============================================================================

alter table public.clientes_no_atendidos drop constraint if exists clientes_no_atendidos_preferencia_check;
alter table public.clientes_no_atendidos add constraint clientes_no_atendidos_preferencia_check
  check (
    preferencia is null
    or (preferencia in ('cualquiera', 'precio') and requested_employee_id is null)
    or preferencia = 'especifico'
  );
