-- ============================================================================
-- Clientes no atendidos — texto libre para el motivo "Otro"
-- ============================================================================
-- Antes, elegir "Otro" en el formulario no dejaba especificar qué pasó en
-- concreto. Esta columna guarda ese texto (solo se completa cuando
-- reason = 'otro'; para el resto de los motivos queda null).
-- ============================================================================
alter table public.rejected_clients
  add column if not exists reason_detail text;
