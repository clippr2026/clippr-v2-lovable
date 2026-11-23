-- Corrección puntual: Sebastian H pidió turno normal y se le generó seña por "faltas" ajenas (correo ".").
-- Quita la seña pendiente de ese turno y deja el resumen del turno como el de un turno sin seña (0 | 0 | none).
-- Respaldo previo verificado: ~/Clippr-Backups/pre-arreglo-sena-faltas-20261114-131743.dump.age
-- Para revertir: reinsertar la fila de appointment_deposits (id 1dc2f2d9-bb7d-4660-80a5-aa9fe5b90f5d, monto 10950,
-- estado pending, vence 2026-11-14 16:41:51+00) y restaurar deposit_amount=10950, deposit_status='pending' en el turno.
begin;
delete from public.appointment_deposits
 where id = '1dc2f2d9-bb7d-4660-80a5-aa9fe5b90f5d'
   and appointment_id = 'd1dd230d-8575-4b18-98e6-d1fe5f9380c8'
   and status = 'pending';
update public.appointments
   set deposit_amount = 0, deposit_paid = 0, deposit_status = 'none'
 where id = 'd1dd230d-8575-4b18-98e6-d1fe5f9380c8';
commit;
