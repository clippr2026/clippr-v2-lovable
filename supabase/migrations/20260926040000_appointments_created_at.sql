-- ============================================================================
-- Agenda — "Reserva creada" en el detalle del turno
-- ============================================================================
-- appointments no tenía columna created_at (ninguna consulta del código la
-- pedía hasta ahora). Se agrega para poder mostrar cuándo se creó cada
-- reserva (distinto de starts_at, que es el horario del turno).
--
-- No se backfillea con un valor inventado para los turnos ya existentes:
-- no hay forma de saber cuándo se crearon realmente, así que quedan en
-- null (la UI simplemente no muestra la línea "Reserva creada" para esos
-- turnos, en vez de mostrar una fecha falsa). De acá en más, tanto la
-- reserva pública como el panel/admin insertan sin pasar created_at
-- explícito, así que el default now() de abajo alcanza para cubrir ambos
-- orígenes automáticamente.
-- ============================================================================
alter table public.appointments
  add column if not exists created_at timestamptz;

alter table public.appointments
  alter column created_at set default now();
