-- Señas: avisos por correo al cliente.
--   deposit_reminder  a los 10 min de reservar si todavía no envió el comprobante
--   deposit_confirmed cuando la seña quedó recibida (turno confirmado)
--   deposit_expired   cuando el turno se canceló por no pagar a tiempo
-- Los saca el programador (send-reminders) y cada uno sale una sola vez por turno
-- (booking_notifications). Solo se avisa lo reciente (últimas 24 h) para no mandar
-- correos por hechos viejos.

alter table public.booking_notifications drop constraint if exists booking_notifications_kind_check;
alter table public.booking_notifications add constraint booking_notifications_kind_check
  check (kind in ('confirmation','reminder_1d','reminder_2h','reschedule','cancellation',
                  'deposit_reminder','deposit_confirmed','deposit_expired'));

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

revoke all on function public.due_deposit_notices(timestamptz) from public, anon, authenticated;
grant execute on function public.due_deposit_notices(timestamptz) to service_role;

-- Plazo para pagar la seña: 30 minutos por defecto (antes 2 horas) cuando no está configurado.
create or replace function public._deposit_instructions(p_business_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'proof_mode', coalesce(c ->> 'proof_mode', 'review'),
    'hold_minutes', coalesce(nullif(c ->> 'hold_minutes', '')::int, 30),
    'message', c ->> 'message',
    'payment', coalesce(c -> 'payment', '{}'::jsonb)
  )
  from (select public._senas_config(p_business_id) as c) q;
$$;

create or replace function public.ensure_public_deposit_v1(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  a record;
  d record;
  cl record;
  v_ids uuid[];
  v_req jsonb;
  v_hold int;
begin
  select ap.id, ap.business_id, ap.branch_id, ap.client_id, ap.service_name, ap.service_price,
         ap.status::text as status, ap.created_at
    into a
  from public.appointments ap
  where ap.manage_token = p_token;

  if a.id is null then
    return jsonb_build_object('ok', false, 'error', 'Turno no encontrado');
  end if;

  select * into d from public.appointment_deposits where appointment_id = a.id;
  if d.id is not null then
    return jsonb_build_object('ok', true, 'required', true,
      'deposit', jsonb_build_object('id', d.id, 'status', d.status, 'amount', d.amount, 'paid_amount', d.paid_amount, 'expires_at', d.expires_at),
      'instructions', public._deposit_instructions(a.business_id));
  end if;

  if a.status not in ('pending', 'confirmed') or a.created_at < now() - interval '30 minutes' then
    return jsonb_build_object('ok', true, 'required', false);
  end if;

  select phone, email into cl from public.clients where id = a.client_id;

  select coalesce(array_agg(p.id), '{}') into v_ids
  from public.price_catalog p
  where p.business_id = a.business_id
    -- Los nombres de servicio pueden llevar " + " (ej. "Mechas + Corte"): se busca cada nombre del
    -- catálogo como un tramo completo dentro de la lista de servicios del turno.
    and position(' + ' || p.name || ' + ' in ' + ' || a.service_name || ' + ') > 0;

  v_req := public._deposit_requirement(a.business_id, v_ids, a.service_price, cl.phone, cl.email);
  if not coalesce((v_req ->> 'required')::boolean, false) then
    return jsonb_build_object('ok', true, 'required', false);
  end if;

  v_hold := coalesce(nullif(public._senas_config(a.business_id) ->> 'hold_minutes', '')::int, 30);

  insert into public.appointment_deposits (business_id, branch_id, appointment_id, amount, expires_at, events)
  values (a.business_id, a.branch_id, a.id, (v_req ->> 'amount')::numeric, now() + make_interval(mins => v_hold),
          jsonb_build_array(jsonb_build_object('at', now(), 'action', 'requested', 'by', 'cliente', 'note', v_req -> 'reasons')))
  on conflict (appointment_id) do nothing
  returning * into d;

  if d.id is null then
    select * into d from public.appointment_deposits where appointment_id = a.id;
  end if;

  return jsonb_build_object('ok', true, 'required', true,
    'deposit', jsonb_build_object('id', d.id, 'status', d.status, 'amount', d.amount, 'paid_amount', d.paid_amount, 'expires_at', d.expires_at),
    'instructions', public._deposit_instructions(a.business_id));
end;
$$;
