-- Correos de turnos: el rol del servidor (service_role) no tiene acceso directo a las tablas
-- (permisos de Supabase endurecidos), así que la función de correo no podía leer el turno, el
-- cliente ni el branding y nunca enviaba nada. Se le da una lectura acotada por función:
--   get_booking_email_context_v1   turno + cliente + profesional + branding + seña, solo lectura
--   release_booking_notification   libera el registro de un aviso cuando el envío falla
--   ensure_public_deposit_v1       ahora también ejecutable por service_role
-- No toca datos ni da acceso nuevo a tablas.

create or replace function public.get_booking_email_context_v1(p_appointment_id uuid default null, p_token uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  a record;
begin
  if p_appointment_id is not null then
    select * into a from public.appointments where id = p_appointment_id;
  elsif p_token is not null then
    select * into a from public.appointments where manage_token = p_token;
  end if;
  if a.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'appointment', jsonb_build_object(
      'id', a.id, 'business_id', a.business_id, 'manage_token', a.manage_token, 'employee_id', a.employee_id,
      'client_id', a.client_id, 'status', a.status::text, 'starts_at', a.starts_at, 'duration_min', a.duration_min,
      'service_name', a.service_name, 'service_price', a.service_price, 'client_name', a.client_name, 'created_at', a.created_at),
    'client', (select jsonb_build_object('email', c.email, 'phone', c.phone, 'full_name', c.full_name)
               from public.clients c where c.id = a.client_id),
    'employee_name', (select e.full_name from public.employees e where e.id = a.employee_id),
    'branding', (select bs.schedule -> '_branding' from public.business_settings bs where bs.business_id = a.business_id),
    'deposit', (select jsonb_build_object('status', d.status, 'amount', d.amount, 'expires_at', d.expires_at)
                from public.appointment_deposits d where d.appointment_id = a.id)
  );
end;
$$;

create or replace function public.release_booking_notification(p_appointment_id uuid, p_kind text, p_starts_at timestamptz)
returns void
language sql
security definer
set search_path to 'public'
as $$
  delete from public.booking_notifications
  where appointment_id = p_appointment_id and kind = p_kind and starts_at = p_starts_at;
$$;

revoke all on function public.get_booking_email_context_v1(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_booking_notification(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.get_booking_email_context_v1(uuid, uuid) to service_role;
grant execute on function public.release_booking_notification(uuid, text, timestamptz) to service_role;
grant execute on function public.ensure_public_deposit_v1(uuid) to service_role;
