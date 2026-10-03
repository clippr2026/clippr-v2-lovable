-- "Efectivo contado" (conteo físico manual al cerrar caja) y "Dinero
-- esperado en cuenta" (informativo) — la columna "diferencia" ya existe en
-- caja_cierres pero nunca se escribía porque no había de dónde calcularla.
alter table public.caja_cierres
  add column if not exists efectivo_contado numeric,
  add column if not exists dinero_cuenta_esperado numeric;
