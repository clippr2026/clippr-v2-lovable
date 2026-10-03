-- "Ingresar dinero"/"Retirar dinero" ahora distinguen Efectivo vs Cuenta
-- (antes cash_movements solo existía para el cajón físico). Filas viejas
-- quedan clasificadas como 'efectivo' por el default (comportamiento
-- idéntico al que tenían antes de esta columna).
alter table public.cash_movements
  add column if not exists method text not null default 'efectivo'
    check (method in ('efectivo', 'cuenta'));

-- "Dinero en cuenta" no se resetea en cada cierre: dinero_cuenta_esperado
-- ya existía (saldo esperado de este cierre); estas dos son nuevas —
-- cuánto informó el usuario que realmente había (dinero_cuenta_real) y el
-- ajuste resultante, sin mezclarlo con la diferencia de efectivo físico.
alter table public.caja_cierres
  add column if not exists dinero_cuenta_real numeric,
  add column if not exists dinero_cuenta_ajuste numeric;
