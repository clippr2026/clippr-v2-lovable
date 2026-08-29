-- Corrige el intento anterior (20260828040000), que fallaba porque
-- PostgreSQL no permite reordenar ni renombrar columnas existentes de una
-- vista con CREATE OR REPLACE — solo agregar columnas nuevas al final.
-- Se preserva exactamente el orden y los nombres de las columnas actuales
-- (confirmados por pg_get_viewdef) y se agrega cash_discount al final.
-- effective_price se deja tal cual, sin usarse en el código pero sin
-- eliminarse todavía.
CREATE OR REPLACE VIEW public.public_booking_services AS
SELECT
  id,
  business_id,
  name,
  price,
  duration_min,
  active AS is_active,
  effective_price,
  cash_discount
FROM price_catalog
WHERE duration_min IS NOT NULL
  AND COALESCE(active, true) = true;
