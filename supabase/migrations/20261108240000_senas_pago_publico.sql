-- Señas, etapa 3a: pago y comprobante desde la página pública.
--
-- - Comprobantes guardados en la base (imagen/PDF chico en base64), solo legibles
--   por el equipo del negocio.
-- - submit_deposit_proof_v2: el cliente sube el comprobante con el token de su turno.
-- - public_booking_manage_token_v1: la página de reservas obtiene el token del turno
--   que el cliente acaba de crear (valida teléfono y que sea reciente).
-- - ensure_public_deposit_v1: solo crea la seña en los minutos posteriores a reservar
--   (un link viejo nunca genera una seña retroactiva).
-- - get_public_booking_v2: ahora incluye el estado de la seña.
--
-- Solo agrega una tabla y reemplaza dos funciones creadas hoy (sin uso previo en la app).

-- 1) Comprobantes.
create table if not exists public.appointment_deposit_proofs (
  id uuid primary key default gen_random_uuid(),
  deposit_id uuid not null references public.appointment_deposits(id) on delete cascade,
  business_id uuid not null,
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  data text not null,
  size_bytes integer not null,
  created_at timestamptz not null default now()
);

create index if not exists appointment_deposit_proofs_deposit_idx
  on public.appointment_deposit_proofs (deposit_id, created_at desc);

alter table public.appointment_deposit_proofs enable row level security;
revoke all on public.appointment_deposit_proofs from anon, authenticated;
grant select on public.appointment_deposit_proofs to authenticated;

drop policy if exists appointment_deposit_proofs_select on public.appointment_deposit_proofs;
create policy appointment_deposit_proofs_select on public.appointment_deposit_proofs
  for select to authenticated
  using (auth.uid() is not null and public.user_is_business_member(business_id));

-- 2) Subir comprobante (cliente).
create or replace function public.submit_deposit_proof_v2(
  p_token uuid,
  p_mime text,
  p_data text,
  p_method text default 'transfer',
  p_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid := gen_random_uuid();
  v_dep record;
  v_res jsonb;
begin
  if p_mime not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then
    return jsonb_build_object('ok', false, 'error', 'Formato no permitido. Subí una foto (JPG, PNG) o un PDF.');
  end if;
  if p_data is null or length(p_data) < 100 then
    return jsonb_build_object('ok', false, 'error', 'Falta el comprobante');
  end if;
  if length(p_data) > 1500000 then
    return jsonb_build_object('ok', false, 'error', 'El archivo es muy pesado. Probá con una captura más chica.');
  end if;

  select dp.id, dp.business_id into v_dep
  from public.appointment_deposits dp
  join public.appointments ap on ap.id = dp.appointment_id
  where ap.manage_token = p_token;

  if v_dep.id is null then
    return jsonb_build_object('ok', false, 'error', 'Este turno no tiene seña');
  end if;

  v_res := public.submit_deposit_proof_public_v1(p_token, 'db:' || v_id::text, p_method, p_reference);
  if coalesce((v_res ->> 'ok')::boolean, false) then
    insert into public.appointment_deposit_proofs (id, deposit_id, business_id, mime, data, size_bytes)
    values (v_id, v_dep.id, v_dep.business_id, p_mime, p_data, length(p_data));
  end if;
  return v_res;
end;
$$;

-- 3) Token del turno recién creado (para la página de reservas).
create or replace function public.public_booking_manage_token_v1(p_appointment_id uuid, p_phone text)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select a.manage_token
  from public.appointments a
  join public.clients c on c.id = a.client_id
  where a.id = p_appointment_id
    and a.created_at > now() - interval '30 minutes'
    and regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') <> ''
    and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = regexp_replace(p_phone, '\D', '', 'g');
$$;

-- 4) La seña se crea solo al reservar (no retroactivamente).
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
    and p.name = any(string_to_array(a.service_name, ' + '));

  v_req := public._deposit_requirement(a.business_id, v_ids, a.service_price, cl.phone, cl.email);
  if not coalesce((v_req ->> 'required')::boolean, false) then
    return jsonb_build_object('ok', true, 'required', false);
  end if;

  v_hold := coalesce(nullif(public._senas_config(a.business_id) ->> 'hold_minutes', '')::int, 120);

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

-- 5) get_public_booking_v2 con el estado de la seña.
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
  d record;
  v_limits jsonb;
  v_brand jsonb;
  v_emp_name text;
  v_hours numeric;
  v_active boolean;
  v_deposit jsonb := null;
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

  select * into d from public.appointment_deposits where appointment_id = a.id;
  if d.id is not null then
    v_deposit := jsonb_build_object(
      'id', d.id,
      'status', d.status,
      'amount', d.amount,
      'paid_amount', d.paid_amount,
      'expires_at', d.expires_at,
      'rejected_note', case when d.status = 'rejected' then d.decision_note else null end,
      'instructions', case when d.status in ('pending', 'rejected') then public._deposit_instructions(a.business_id) else null end
    );
  end if;

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
    'deposit', v_deposit,
    -- Con seña sin pagar no se puede "confirmar asistencia": primero se paga.
    'can_confirm', a.status = 'pending' and a.starts_at > now()
                   and (d.id is null or d.status in ('paid', 'applied')),
    'can_cancel', v_active and v_hours >= (v_limits ->> 'minCancel')::numeric,
    'can_reschedule', v_active and v_hours >= (v_limits ->> 'minReschedule')::numeric
  );
end;
$$;

-- 6) Permisos.
revoke all on function public.submit_deposit_proof_v2(uuid, text, text, text, text) from public;
revoke all on function public.public_booking_manage_token_v1(uuid, text) from public;
grant execute on function public.submit_deposit_proof_v2(uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.public_booking_manage_token_v1(uuid, text) to anon, authenticated;
