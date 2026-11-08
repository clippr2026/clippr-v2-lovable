-- Gestionar turno (cliente): ver, confirmar asistencia, reprogramar y cancelar
-- con los límites de Configuración → Horarios, más la base para los
-- recordatorios por correo (1 día y 2 horas antes).
--
-- Solo agrega objetos nuevos (tabla + funciones *_v2). No modifica datos ni
-- funciones existentes (las *_v1 quedan como están).

-- 1) Registro de correos enviados por turno (evita duplicados).
create table if not exists public.booking_notifications (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  kind text not null check (kind in ('confirmation','reminder_1d','reminder_2h','reschedule','cancellation')),
  -- Hora del turno a la que se refiere el correo: si se reprograma, los
  -- recordatorios vuelven a salir para la nueva hora.
  starts_at timestamptz not null,
  sent_at timestamptz not null default now(),
  unique (appointment_id, kind, starts_at)
);

alter table public.booking_notifications enable row level security;
revoke all on public.booking_notifications from anon, authenticated;

-- 2) Límites del cliente (Configuración → Horarios) de la sucursal del turno.
create or replace function public._booking_limits(p_business_id uuid, p_branch_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'minCancel', coalesce(nullif(s ->> 'minCancel', '')::numeric, 2),
    'minReschedule', coalesce(nullif(s ->> 'minReschedule', '')::numeric, 2),
    'minAdvance', coalesce(nullif(s ->> 'minAdvance', '')::numeric, 60),
    'maxAdvance', coalesce(nullif(s ->> 'maxAdvance', '')::numeric, 30)
  )
  from (
    select (
      select bs.schedule -> '_settings'
      from public.branch_settings bs
      where bs.business_id = p_business_id
        and bs.branch_id is not distinct from p_branch_id
      limit 1
    ) as s
  ) q;
$$;

revoke all on function public._booking_limits(uuid, uuid) from public, anon, authenticated;

-- 3) Ver el turno por token.
create or replace function public.get_public_booking_v2(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  a record;
  b record;
  v_limits jsonb;
  v_brand jsonb;
  v_emp_name text;
  v_hours numeric;
  v_active boolean;
begin
  select ap.id, ap.business_id, ap.branch_id, ap.employee_id, ap.status::text as status,
         ap.starts_at, ap.ends_at, ap.duration_min, ap.service_name, ap.service_price,
         ap.client_name, ap.recurring_series_id
    into a
  from public.appointments ap
  where ap.manage_token = p_token
  limit 1;

  if a.id is null then
    return jsonb_build_object('ok', false, 'error', 'Turno no encontrado');
  end if;

  select bz.name, bz.slug, bz.address, bz.phone, bz.logo_url, bz.avatar_url,
         bz.accent_color, coalesce(bz.timezone, 'America/Argentina/Buenos_Aires') as timezone
    into b
  from public.businesses bz
  where bz.id = a.business_id;

  select st.schedule -> '_branding'
    into v_brand
  from public.business_settings st
  where st.business_id = a.business_id;

  select e.full_name into v_emp_name from public.employees e where e.id = a.employee_id;

  v_limits := public._booking_limits(a.business_id, a.branch_id);
  v_hours := extract(epoch from (a.starts_at - now())) / 3600.0;
  v_active := a.status in ('pending', 'confirmed') and a.starts_at > now();

  return jsonb_build_object(
    'ok', true,
    'appointment', jsonb_build_object(
      'id', a.id,
      'status', a.status,
      'starts_at', a.starts_at,
      'ends_at', a.ends_at,
      'duration_min', a.duration_min,
      'service_name', a.service_name,
      'service_price', a.service_price,
      'client_name', a.client_name,
      'employee_id', a.employee_id,
      'employee_name', v_emp_name,
      'branch_id', a.branch_id,
      'is_series', a.recurring_series_id is not null
    ),
    'business', jsonb_build_object(
      'id', a.business_id,
      'name', b.name,
      'slug', b.slug,
      'address', b.address,
      'phone', coalesce(nullif(v_brand ->> 'phone', ''), b.phone),
      'logo_url', coalesce(b.avatar_url, b.logo_url),
      'accent_color', b.accent_color,
      'timezone', b.timezone,
      'branding', v_brand
    ),
    'limits', v_limits,
    'can_confirm', a.status = 'pending' and a.starts_at > now(),
    'can_cancel', v_active and v_hours >= (v_limits ->> 'minCancel')::numeric,
    'can_reschedule', v_active and v_hours >= (v_limits ->> 'minReschedule')::numeric
  );
end;
$$;

-- 4) Confirmar asistencia (pendiente → confirmado).
create or replace function public.confirm_public_booking_v2(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  a record;
begin
  select id, status::text as status, starts_at
    into a
  from public.appointments
  where manage_token = p_token
  for update;

  if a.id is null then
    return jsonb_build_object('ok', false, 'error', 'Turno no encontrado');
  end if;
  if a.status = 'confirmed' then
    return jsonb_build_object('ok', true, 'status', 'confirmed');
  end if;
  if a.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'not_active', 'error', 'Este turno ya no se puede confirmar');
  end if;
  if a.starts_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'past', 'error', 'El turno ya pasó');
  end if;

  update public.appointments
  set status = 'confirmed', updated_at = now()
  where id = a.id;

  return jsonb_build_object('ok', true, 'status', 'confirmed');
end;
$$;

-- 5) Cancelar (respeta el límite de Cancelación).
create or replace function public.cancel_public_booking_v2(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  a record;
  v_limits jsonb;
begin
  select id, business_id, branch_id, status::text as status, starts_at
    into a
  from public.appointments
  where manage_token = p_token
  for update;

  if a.id is null then
    return jsonb_build_object('ok', false, 'error', 'Turno no encontrado');
  end if;
  if a.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'status', 'cancelled');
  end if;
  if a.status not in ('pending', 'confirmed') or a.starts_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'not_active', 'error', 'Este turno ya no se puede cancelar');
  end if;

  v_limits := public._booking_limits(a.business_id, a.branch_id);
  if extract(epoch from (a.starts_at - now())) / 3600.0 < (v_limits ->> 'minCancel')::numeric then
    return jsonb_build_object('ok', false, 'code', 'too_late',
      'error', 'Ya pasó el plazo para cancelar este turno', 'limit_hours', v_limits -> 'minCancel');
  end if;

  update public.appointments
  set status = 'cancelled',
      cancelled_at = now(),
      cancel_reason = 'Cancelado por el cliente',
      cancelled_by_name = 'Cliente',
      cancelled_by_role = 'public',
      updated_at = now()
  where id = a.id;

  return jsonb_build_object('ok', true, 'status', 'cancelled');
end;
$$;

-- 6) Reprogramar (respeta el límite de Reprogramación, cierres, anticipación y solapes).
create or replace function public.reschedule_public_booking_v2(p_token uuid, p_starts_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  a record;
  v_limits jsonb;
  v_tz text;
  v_new_end timestamptz;
  v_dur interval;
begin
  select id, business_id, branch_id, employee_id, status::text as status, starts_at, ends_at, duration_min
    into a
  from public.appointments
  where manage_token = p_token
  for update;

  if a.id is null then
    return jsonb_build_object('ok', false, 'error', 'Turno no encontrado');
  end if;
  if a.status not in ('pending', 'confirmed') or a.starts_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'not_active', 'error', 'Este turno ya no se puede reprogramar');
  end if;

  v_limits := public._booking_limits(a.business_id, a.branch_id);

  if extract(epoch from (a.starts_at - now())) / 3600.0 < (v_limits ->> 'minReschedule')::numeric then
    return jsonb_build_object('ok', false, 'code', 'too_late',
      'error', 'Ya pasó el plazo para reprogramar este turno', 'limit_hours', v_limits -> 'minReschedule');
  end if;

  if p_starts_at is null or p_starts_at < now() + make_interval(mins => (v_limits ->> 'minAdvance')::int) then
    return jsonb_build_object('ok', false, 'code', 'too_soon', 'error', 'Elegí un horario con más anticipación');
  end if;
  if p_starts_at > now() + make_interval(days => (v_limits ->> 'maxAdvance')::int) then
    return jsonb_build_object('ok', false, 'code', 'too_far', 'error', 'Elegí una fecha más cercana');
  end if;

  select coalesce(timezone, 'America/Argentina/Buenos_Aires') into v_tz
  from public.businesses where id = a.business_id;

  if exists (
    select 1 from public.closures c
    where c.business_id = a.business_id
      and c.branch_id is not distinct from a.branch_id
      and (p_starts_at at time zone v_tz)::date between c.start_date and c.end_date
  ) then
    return jsonb_build_object('ok', false, 'code', 'closed', 'error', 'El negocio está cerrado ese día');
  end if;

  v_dur := coalesce(a.ends_at - a.starts_at, make_interval(mins => coalesce(a.duration_min, 30)));
  v_new_end := p_starts_at + v_dur;

  -- Evita que dos reprogramaciones simultáneas ocupen el mismo hueco.
  perform pg_advisory_xact_lock(hashtext(a.employee_id::text));

  if exists (
    select 1 from public.appointments x
    where x.business_id = a.business_id
      and x.employee_id = a.employee_id
      and x.id <> a.id
      and coalesce(x.status, 'pending') not in ('cancelled', 'canceled')
      and x.starts_at < v_new_end
      and coalesce(x.ends_at, x.starts_at + make_interval(mins => coalesce(x.duration_min, 30))) > p_starts_at
  ) then
    return jsonb_build_object('ok', false, 'code', 'busy', 'error', 'Ese horario ya no está disponible');
  end if;

  update public.appointments
  set starts_at = p_starts_at,
      ends_at = v_new_end,
      status = 'pending',
      updated_at = now()
  where id = a.id;

  return jsonb_build_object('ok', true, 'status', 'pending',
    'old_starts_at', a.starts_at, 'starts_at', p_starts_at, 'ends_at', v_new_end);
end;
$$;

-- 7) Recordatorios: turnos que toca avisar ahora (solo para el servidor).
--    1 día antes: ventana 22–24 h, se omite si el turno se reservó con menos
--    de un día de anticipación y en turnos de series fijas (ya confirmados).
--    2 horas antes: ventana 1–2 h, se omite si se reservó con menos de 2 h.
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
        b.recurring_series_id is null
        and b.starts_at between p_now + interval '22 hours' and p_now + interval '24 hours'
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

-- 8) Marcar (reclamar) un correo enviado; devuelve false si ya estaba.
create or replace function public.claim_booking_notification(p_appointment_id uuid, p_kind text, p_starts_at timestamptz)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  insert into public.booking_notifications (appointment_id, kind, starts_at)
  values (p_appointment_id, p_kind, p_starts_at)
  on conflict (appointment_id, kind, starts_at) do nothing
  returning id into v_id;
  return v_id is not null;
end;
$$;

-- 9) Permisos: la página pública usa solo las 4 del cliente; el resto, solo el servidor.
revoke all on function public.get_public_booking_v2(uuid) from public;
revoke all on function public.confirm_public_booking_v2(uuid) from public;
revoke all on function public.cancel_public_booking_v2(uuid) from public;
revoke all on function public.reschedule_public_booking_v2(uuid, timestamptz) from public;
revoke all on function public.due_booking_reminders(timestamptz) from public, anon, authenticated;
revoke all on function public.claim_booking_notification(uuid, text, timestamptz) from public, anon, authenticated;

grant execute on function public.get_public_booking_v2(uuid) to anon, authenticated;
grant execute on function public.confirm_public_booking_v2(uuid) to anon, authenticated;
grant execute on function public.cancel_public_booking_v2(uuid) to anon, authenticated;
grant execute on function public.reschedule_public_booking_v2(uuid, timestamptz) to anon, authenticated;
grant execute on function public.due_booking_reminders(timestamptz) to service_role;
grant execute on function public.claim_booking_notification(uuid, text, timestamptz) to service_role;
