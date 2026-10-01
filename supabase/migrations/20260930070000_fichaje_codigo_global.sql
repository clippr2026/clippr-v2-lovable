-- ============================================================================
-- Fichaje — código único también a nivel negocio (no solo por sucursal)
-- ============================================================================
-- "Ingresar código" en el panel del profesional recibe SOLO el código (6
-- caracteres), sin saber de antemano a qué sucursal pertenece — necesita
-- poder resolverla buscando únicamente por (fecha, código). Si dos
-- sucursales del mismo negocio generaran por azar el mismo código el
-- mismo día, esa búsqueda sería ambigua. Este índice único adicional
-- evita que eso pase (branch_checkin_codes ya tenía un único por
-- (branch_id, fecha) — este es un único DISTINTO, por (fecha, código),
-- conviven los dos).
--
-- Genérica, re-ejecutable. NO tocar producción todavía — correr solo en
-- clippr-dev, después de la migración de Fichaje (20260930060000).
-- ============================================================================

create unique index if not exists idx_branch_checkin_codes_date_code
  on public.branch_checkin_codes (date, code);

NOTIFY pgrst, 'reload schema';
