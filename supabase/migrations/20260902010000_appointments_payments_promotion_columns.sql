-- Promociones en Agenda y Caja (no solo en la Página Pública).
--
-- appointments: promoción PREVISTA al agendar/editar un turno. Es solo
-- informativa — nunca consume uso/límite de la promo. promotion_snapshot
-- congela nombre/tipo/valor del descuento al momento de asociarla (mismo
-- criterio que ya usan commission_records.snapshot_* y price_catalog.
-- deleted_at más arriba): si la promo se edita o se borra después, el
-- turno viejo conserva qué vio el cliente/la recepción al agendar.
--
-- payments: promoción APLICADA — el dato definitivo. Se completa recién al
-- confirmar el cobro en Caja, y es ahí (no en appointments) donde se
-- consume el uso/límite de la promo. discount (columna numeric ya
-- existente, sin usar hasta ahora) pasa a guardar el monto descontado;
-- original_amount conserva el precio de lista para poder reconstruir el
-- desglose completo (lista / promo / total) en Historial, Clientes,
-- Dashboard, comisiones y liquidaciones.
--
-- Todas las columnas son nuevas, nullable y aditivas — no rompen ninguna
-- fila ni flujo existente que no las use.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS promotion_id uuid NULL,
  ADD COLUMN IF NOT EXISTS promotion_snapshot jsonb NULL;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS promotion_id uuid NULL,
  ADD COLUMN IF NOT EXISTS promotion_name text NULL,
  ADD COLUMN IF NOT EXISTS discount_type text NULL,
  ADD COLUMN IF NOT EXISTS discount_value numeric NULL,
  ADD COLUMN IF NOT EXISTS original_amount numeric NULL;
