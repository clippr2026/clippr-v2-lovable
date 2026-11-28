-- Se sacó «No avisar más» de las notificaciones: la tabla quedó sin uso. No toca ninguna otra tabla.
-- Reversa: volver a aplicar 20261128100000_deudas_no_avisar.sql y recargar las filas desde el respaldo.
drop table public.debt_notice_mutes;
