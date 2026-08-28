-- "Precio efectivo": segundo precio estático por servicio (Configuración →
-- Servicios), distinto de price_catalog.cash_discount ("Precio en
-- efectivo", el descuento por pago en efectivo). Se muestra en la Página
-- Pública además del precio de lista, y es overrideable por profesional en
-- Equipo → Comisiones → Servicios → Personalizar duración y precio.
-- Columna nueva, nullable, aditiva — no afecta filas ni consultas
-- existentes.
ALTER TABLE public.price_catalog
  ADD COLUMN IF NOT EXISTS effective_price numeric NULL;
