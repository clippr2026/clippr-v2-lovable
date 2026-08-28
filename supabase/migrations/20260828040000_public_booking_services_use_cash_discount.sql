-- Corrige el enfoque de 20260828030000: "Precio efectivo" no debía ser un
-- campo nuevo — reutiliza el "Precio en efectivo" que ya existía
-- (price_catalog.cash_discount, un %). Se saca effective_price de la vista
-- (quedó sin uso en el código, ver service-pricing.ts) y se expone
-- cash_discount en su lugar. Resto de la vista queda igual.
CREATE OR REPLACE VIEW public.public_booking_services AS
SELECT
  id,
  business_id,
  name,
  price,
  cash_discount,
  duration_min,
  active AS is_active
FROM price_catalog
WHERE duration_min IS NOT NULL
  AND COALESCE(active, true) = true;
