-- Amplía el check constraint de caja_cierres.tipo_cierre para admitir
-- "historico_regularizado": un cierre de un día pasado que nunca se cerró
-- en su momento y se registra retroactivamente a partir de los
-- movimientos reales ya existentes (nunca con apertura/efectivo contado
-- inventados). Antes solo admitía 'manual' | 'automatico'.
alter table public.caja_cierres
  drop constraint if exists caja_cierres_tipo_cierre_check;

alter table public.caja_cierres
  add constraint caja_cierres_tipo_cierre_check
  check (tipo_cierre = any (array['manual'::text, 'automatico'::text, 'historico_regularizado'::text]));
