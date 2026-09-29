-- ============================================================================
-- Índices para acelerar Caja → Resumen (Ingresos/Pendientes/Gastos)
-- ============================================================================
-- La carga de Caja filtra payments/expenses por business_id + rango de
-- fecha (hoy), y appointments por business_id + status, en cada visita a
-- la pantalla. Sin un índice compuesto que empiece por business_id, esas
-- consultas (y el filtro de business_id que ya aplica RLS en TODAS las
-- consultas de esta app) dependen de un scan más costoso a medida que
-- crecen las tablas.
--
-- Aditivo y de solo lectura de performance — no cambia ninguna columna,
-- constraint ni policy existente. Cómo correrlo: pegar completo en el SQL
-- Editor de Supabase y ejecutar. Seguro re-ejecutar (IF NOT EXISTS).
-- ============================================================================

-- payments: "Últimos ingresos" filtra por business_id + created_at (hoy) y
-- ordena por created_at desc.
create index if not exists idx_payments_business_created_at
  on public.payments (business_id, created_at desc);

-- expenses: "Gastos" filtra por business_id + date (hoy).
create index if not exists idx_expenses_business_date
  on public.expenses (business_id, date);

-- appointments: la cola de "Pendientes" filtra por business_id + status
-- (antes del ILIKE sobre notes, que no se puede indexar con un btree
-- simple) — este índice acota el scan a las filas del negocio en un
-- estado relevante antes de aplicar ese filtro de texto.
create index if not exists idx_appointments_business_status
  on public.appointments (business_id, status);
