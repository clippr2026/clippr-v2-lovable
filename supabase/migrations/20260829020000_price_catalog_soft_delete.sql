-- Baja lógica de price_catalog (Configuración → Catálogo): "Eliminar" deja
-- de bloquear con "ya posee historial" y de hacer DELETE físico. Ahora
-- siempre marca deleted_at (y active=false), preservando la fila para que
-- appointments/payments/commission_records — que ya guardan una copia
-- congelada de nombre/precio/comisión al momento de cada operación, sin
-- volver a leer price_catalog — sigan resolviéndose correctamente. Columna
-- nueva, nullable, aditiva.
ALTER TABLE public.price_catalog
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
