-- Señas: vuelve el aviso por correo cuando se rechaza un comprobante (con el motivo y el botón
-- para subir uno nuevo). Amplía los tipos de aviso permitidos y la lista de avisos pendientes,
-- y el contexto de correo ahora incluye el motivo del rechazo. No toca datos.

alter table public.booking_notifications drop constraint if exists booking_notifications_kind_check;
alter table public.booking_notifications add constraint booking_notifications_kind_check
  check (kind in ('confirmation','reminder_1d','reminder_2h','reschedule','cancellation',
                  'deposit_reminder','deposit_confirmed','deposit_rejected','deposit_expired'));

create or replace function public.due_deposit_notices(p_now timestamptz default now())
returns table (appointment_id uuid, business_id uuid, kind text, starts_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $$
  select a.id, a.business_id, k.kind, a.starts_at
  from public.appointment_deposits d
  join public.appointments a on a.id = d.appointment_id
  join public.clients c on c.id = a.client_id
  cross join lateral (
    values
      ('deposit_reminder',
        d.status = 'pending'
        and a.status in ('pending', 'confirmed')
        and d.created_at <= p_now - interval '10 minutes'
        and d.created_at >= p_now - interval '24 hours'),
      ('deposit_confirmed',
        d.status = 'paid'
        and a.status in ('pending', 'confirmed')
        and d.updated_at >= p_now - interval '24 hours'),
      ('deposit_rejected',
        d.status = 'rejected'
        and a.status in ('pending', 'confirmed')
        and d.updated_at >= p_now - interval '24 hours'),
      ('deposit_expired',
        d.status = 'expired'
        and a.status = 'cancelled'
        and a.cancel_reason = 'No se pagó la seña a tiempo'
        and d.updated_at >= p_now - interval '24 hours')
  ) as k(kind, due)
  where k.due
    and nullif(trim(c.email), '') ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    and not exists (
      select 1 from public.booking_notifications n
      where n.appointment_id = a.id and n.kind = k.kind and n.starts_at = a.starts_at
    );
$$;

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
    'deposit', (select jsonb_build_object('status', d.status, 'amount', d.amount, 'expires_at', d.expires_at, 'note', d.decision_note)
                from public.appointment_deposits d where d.appointment_id = a.id)
  );
end;
$$;

revoke all on function public.due_deposit_notices(timestamptz) from public, anon, authenticated;
grant execute on function public.due_deposit_notices(timestamptz) to service_role;
revoke all on function public.get_booking_email_context_v1(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_booking_email_context_v1(uuid, uuid) to service_role;
