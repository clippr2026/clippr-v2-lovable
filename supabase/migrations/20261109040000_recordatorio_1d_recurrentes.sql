-- Recordatorios: los turnos de series recurrentes también reciben el aviso de 1 día antes (con
-- "Confirmar asistencia"), igual que los turnos normales; el de 2 horas antes sigue para todos.
-- Solo reemplaza la función; no toca datos.

create or replace function public.due_booking_reminders(p_now timestamptz default now())
returns table (appointment_id uuid, business_id uuid, kind text, to_email text, starts_at timestamptz, manage_token uuid)
language sql
stable
security definer
set search_path to 'public'
as $$
  with base as (
    select a.id, a.business_id, a.starts_at, a.manage_token, a.recurring_series_id,
           nullif(trim(c.email), '') as email,
           coalesce((
             select max(n.sent_at) from public.booking_notifications n
             where n.appointment_id = a.id
               and n.kind in ('confirmation', 'reschedule')
               and n.starts_at = a.starts_at
           ), a.created_at) as ref_time
    from public.appointments a
    join public.clients c on c.id = a.client_id
    where a.status in ('pending', 'confirmed')
      and a.starts_at > p_now
      and a.starts_at <= p_now + interval '24 hours'
  )
  select b.id, b.business_id, k.kind, b.email, b.starts_at, b.manage_token
  from base b
  cross join lateral (
    values
      ('reminder_1d',
        b.starts_at between p_now + interval '22 hours' and p_now + interval '24 hours'
        and b.ref_time <= b.starts_at - interval '24 hours'),
      ('reminder_2h',
        b.starts_at between p_now + interval '1 hour' and p_now + interval '2 hours'
        and b.ref_time <= b.starts_at - interval '2 hours')
  ) as k(kind, due)
  where k.due
    and b.email is not null
    and b.email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    and not exists (
      select 1 from public.booking_notifications n
      where n.appointment_id = b.id and n.kind = k.kind and n.starts_at = b.starts_at
    );
$$;

revoke all on function public.due_booking_reminders(timestamptz) from public, anon, authenticated;
grant execute on function public.due_booking_reminders(timestamptz) to service_role;
