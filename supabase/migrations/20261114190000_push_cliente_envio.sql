-- Avisos push al cliente: lectura de sus celulares para el envío (solo servidor).
--
-- Los avisos salen desde la función de correos (send-booking-email) en los mismos momentos que el correo:
-- agendado, recordatorio de 1 día y de 2 horas, reprogramado, cancelado y señas. El rol del servidor no lee las
-- tablas directo, así que necesita dos funciones:
--   1. get_client_push_targets_v1(client_id): los celulares (endpoint y claves) de ese cliente.
--   2. delete_push_subscription_v1(id): borra un celular vencido (el teléfono ya no acepta avisos).
-- Solo las puede ejecutar el servidor (service_role). No tocan turnos, clientes ni cobros.
-- Cómo revertirlo: drop function public.get_client_push_targets_v1(uuid), public.delete_push_subscription_v1(uuid);

create or replace function public.get_client_push_targets_v1(p_client_id uuid)
returns table (id uuid, endpoint text, p256dh text, auth text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select s.id, s.endpoint, s.p256dh, s.auth
  from public.push_subscriptions s
  where s.app = 'auro' and s.client_id = p_client_id;
$$;

create or replace function public.delete_push_subscription_v1(p_id uuid)
returns void
language sql
security definer
set search_path to 'public'
as $$
  delete from public.push_subscriptions where id = p_id;
$$;

revoke all on function public.get_client_push_targets_v1(uuid) from public, anon, authenticated;
revoke all on function public.delete_push_subscription_v1(uuid) from public, anon, authenticated;
grant execute on function public.get_client_push_targets_v1(uuid) to service_role;
grant execute on function public.delete_push_subscription_v1(uuid) to service_role;
