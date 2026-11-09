-- Señas: los turnos cancelados por no pagar a tiempo quedan con el motivo "Seña vencida" (antes
-- "No se pagó la seña a tiempo"), que es lo que muestra la Agenda en Cancelados. El aviso por correo
-- reconoce ambos textos. Solo reemplaza funciones; no toca datos.

create or replace function public._expire_deposit_core(p_appointment_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d record;
  a record;
begin
  select * into d from public.appointment_deposits where appointment_id = p_appointment_id for update;
  if d.id is null or d.status <> 'pending' or d.expires_at is null or d.expires_at > now() then
    return false;
  end if;

  select * into a from public.appointments where id = p_appointment_id for update;
  if a.id is null or a.status not in ('pending', 'confirmed') then
    return false;
  end if;

  update public.appointments
  set status = 'cancelled',
      cancelled_at = now(),
      cancel_reason = 'Seña vencida',
      cancelled_by_name = 'Sistema',
      cancelled_by_role = 'system',
      updated_at = now()
  where id = a.id;

  -- El trigger de turnos pasa 'pending' a 'expired'; 'rejected' lo hacemos acá.
  update public.appointment_deposits
  set status = 'expired',
      updated_at = now(),
      events = events || jsonb_build_object('at', now(), 'action', 'expired', 'by', 'system', 'note', 'plazo vencido')
  where id = d.id and status <> 'expired';

  return true;
end;
$$;

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
        and a.cancel_reason in ('Seña vencida', 'No se pagó la seña a tiempo')
        and d.updated_at >= p_now - interval '24 hours')
  ) as k(kind, due)
  where k.due
    and nullif(trim(c.email), '') ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    and not exists (
      select 1 from public.booking_notifications n
      where n.appointment_id = a.id and n.kind = k.kind and n.starts_at = a.starts_at
    );
$$;

revoke all on function public._expire_deposit_core(uuid) from public, anon, authenticated;
revoke all on function public.due_deposit_notices(timestamptz) from public, anon, authenticated;
grant execute on function public.due_deposit_notices(timestamptz) to service_role;
