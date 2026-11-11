-- ============================================================================
-- Clientes que se fueron: ¿quería a un profesional en especial?
-- ============================================================================
-- Agrega a `clientes_no_atendidos`:
--   · preferencia: 'cualquiera' (aceptaba a cualquier profesional → falta de lugar general)
--                  o 'especifico' (quería a uno en particular).
--   · requested_employee_id: el profesional pedido, si corresponde.
--
-- Las filas que ya existían quedan con ambos campos vacíos (registro histórico sin ese dato).
-- No modifica ni borra filas existentes.
--
-- Cómo revertirlo:
--   alter table public.clientes_no_atendidos drop column requested_employee_id, drop column preferencia;
-- ============================================================================

alter table public.clientes_no_atendidos
  add column if not exists preferencia text,
  add column if not exists requested_employee_id uuid references public.employees(id) on delete set null;

alter table public.clientes_no_atendidos drop constraint if exists clientes_no_atendidos_preferencia_check;
alter table public.clientes_no_atendidos add constraint clientes_no_atendidos_preferencia_check
  check (
    preferencia is null
    or (preferencia = 'cualquiera' and requested_employee_id is null)
    or preferencia = 'especifico'
  );
