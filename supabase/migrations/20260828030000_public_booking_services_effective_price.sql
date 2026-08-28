-- Expone effective_price ("Precio efectivo", ver 20260828020000) en la vista
-- pública public_booking_services, que hasta ahora no la tenía. Se mantiene
-- exactamente el resto de la definición (columnas, alias is_active, filtros
-- de duration_min/active) tal cual está hoy en producción.
CREATE OR REPLACE VIEW public.public_booking_services AS
SELECT
  id,
  business_id,
  name,
  price,
  effective_price,
  duration_min,
  active AS is_active
FROM price_catalog
WHERE duration_min IS NOT NULL
  AND COALESCE(active, true) = true;
