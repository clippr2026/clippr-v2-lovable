-- Dos usuarios confirmando el mismo cierre al mismo tiempo (sección 7 del
-- pedido: "evitar condiciones de carrera") dependen de que la base de
-- datos, no el cliente, sea quien decide cuál de los dos INSERT gana.
-- La unique constraint (business_id, branch_id, fecha) ya existe, pero el
-- estándar SQL trata dos NULL como "no iguales" entre sí: un negocio sin
-- sucursal asignada (branch_id null en TODAS sus filas) podía terminar con
-- dos cierres distintos para la misma fecha sin que la constraint lo
-- notara. NULLS NOT DISTINCT (Postgres 15+) cierra ese agujero para todos
-- los negocios, no solo los que ya tienen branch_id asignado.
alter table caja_cierres
  drop constraint caja_cierres_business_branch_fecha_key;

alter table caja_cierres
  add constraint caja_cierres_business_branch_fecha_key
  unique nulls not distinct (business_id, branch_id, fecha);
