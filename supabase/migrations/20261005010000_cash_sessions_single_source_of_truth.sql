-- ============================================================================
-- cash_sessions pasa a ser la ÚNICA fuente de verdad de "¿hay una caja
-- abierta ahora mismo, desde cuándo?" — caja_cierres queda como historial
-- puro, inmutable una vez cerrado.
-- ============================================================================
-- Bug que esto corrige: "Reabrir caja" mutaba en el lugar la MISMA fila de
-- caja_cierres (estado 'cerrada' -> 'reabierta') sin tocar su `fecha`. Una
-- caja vencida de varios días atrás podía quedar "reabierta" para siempre
-- con esa fecha vieja — cada vez que se volvía a abrir, Ingresos/Efectivo
-- esperado/Dinero esperado en cuenta sumaban TODOS los días desde esa
-- fecha vieja hasta hoy, acumulándose más en cada ciclo de cerrar/reabrir.
--
-- A partir de ahora: reabrir SIEMPRE crea una fila NUEVA en cash_sessions
-- con opened_at = now(); caja_cierres.estado nunca vuelve a 'reabierta'.
-- ============================================================================

-- Como mucho una sesión abierta por sucursal (o por negocio si branch_id es
-- null) — lo garantiza la base, no solo el código. coalesce(branch_id, ...)
-- trata NULL como un valor fijo: sin esto, dos filas con branch_id NULL y
-- status='open' NO chocarían entre sí (Postgres trata NULL <> NULL en los
-- índices únicos comunes).
drop index if exists idx_cash_sessions_one_open_per_branch;
create unique index idx_cash_sessions_one_open_per_branch
  on public.cash_sessions (business_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'open';

-- Trazabilidad opcional: de qué sesión nace una reapertura (nunca se usa
-- para calcular rangos, solo para auditoría/soporte).
alter table public.cash_sessions
  add column if not exists reopened_from_session_id uuid references public.cash_sessions(id);

-- ── Transición del estado actual en producción ──────────────────────────
-- Cualquier caja_cierres que haya quedado en 'reabierta' (el estado que
-- este fix elimina) vuelve a 'cerrada' — pasa a ser el cierre histórico
-- que siempre debió ser; ya no se vuelve a leer como "sesión actual".
update public.caja_cierres
  set estado = 'cerrada'
  where estado = 'reabierta';

-- Cualquier cash_sessions que haya quedado 'open' de antes de este fix (con
-- un opened_at potencialmente corrupto por el mismo bug, o apuntado por el
-- id equivocado) se cierra acá — ninguna sesión vieja sigue "operativa"
-- después del deploy. La próxima vez que alguien reabra caja, nace una
-- sesión nueva y limpia con fecha de hoy.
update public.cash_sessions
  set status = 'closed', closed_at = now()
  where status = 'open';

NOTIFY pgrst, 'reload schema';
