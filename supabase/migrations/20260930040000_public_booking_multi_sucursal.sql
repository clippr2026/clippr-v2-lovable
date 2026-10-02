-- ============================================================================
-- Multi-sucursal — página de reservas pública
-- ============================================================================
-- El booking público (/negocio/:slug, /reservar/:slug) corre sobre 4 vistas
-- (public_booking_*) y una función RPC (create_public_booking_public_v3),
-- ninguna con noción de sucursal hoy. Esta migración:
--
--   1. Agrega branch_id a public_booking_services y public_booking_employees
--      (CREATE OR REPLACE VIEW agregando una columna al final — no rompe
--      nada de lo que ya las usa, mismo criterio que toda esta fundación).
--   2. public_booking_businesses queda TAL CUAL — identidad (nombre, logo,
--      slug, colores) sigue siendo del negocio completo, una sola página.
--   3. public_booking_settings (business_settings.schedule, usado hoy para
--      _branding/_publicSiteStatus/visibilidad) queda TAL CUAL también.
--   4. Vista nueva public_booking_branches: lista de sucursales activas de
--      un negocio, legible de forma anónima (branches en sí tiene RLS que
--      exige sesión — esta vista es la puerta pública, mismo patrón que el
--      resto de las public_booking_*).
--   5. Vista nueva public_booking_branch_settings: espejo público de
--      branch_settings (horario semanal + promociones por sucursal).
--   6. Función nueva create_public_booking_public_v4: + p_branch_id opcional
--      — valida que el profesional/servicio pertenezcan a esa sucursal
--      cuando se pasa, y lo graba en clients.branch_id (solo al crear,
--      nunca reasigna uno existente) y en appointments.branch_id.
--
-- ── AJUSTE aplicado al correr esto en producción ───────────────────────────
-- Para cuando esto se corrió en producción, create_public_booking_public_v4
-- ya existía ahí con 11 parámetros (sin p_branch_id, con la lógica de
-- identidad mail-primero/teléfono-respaldo — migración 20261002010000).
-- Agregar solo una v4 de 12 parámetros sin tocar la de 11 las deja
-- coexistir como dos funciones distintas con el mismo nombre — PostgREST
-- no puede elegir cuál usar cuando el frontend (todavía sin desplegar la
-- versión que manda p_branch_id) llama a v4 sin ese parámetro, porque
-- ambas califican (p_branch_id tiene default null). Eso rompía la reserva
-- pública con "Could not choose the best candidate function" hasta
-- desplegar el frontend nuevo.
--
-- Por eso esta migración (a) elimina explícitamente la v4 vieja de 11
-- parámetros antes de crear la de 12 — nunca coexisten dos — y (b) la v4
-- nueva ya incluye la lógica de identidad correcta (mail primero,
-- teléfono de respaldo, nunca duplicar) en vez de la lógica con OR sin
-- prioridad de la versión original de esta migración — cero ventana de
-- regresión mientras se completaba el resto de la migración por fases.
--
-- Genérica, re-ejecutable.
-- ============================================================================

-- ── 1. branch_id en las vistas de servicios y empleados ────────────────────
create or replace view public.public_booking_services as
select id, business_id, name, price, duration_min, active as is_active, branch_id
from public.price_catalog
where duration_min is not null and coalesce(active, true) = true;

create or replace view public.public_booking_employees as
select id, business_id, full_name, avatar_url, is_active, branch_id
from public.employees
where coalesce(is_active, true) = true;

-- ── 2. Sucursales visibles públicamente ─────────────────────────────────────
create or replace view public.public_booking_branches as
select br.id, br.business_id, br.name, br.address
from public.branches br
join public.businesses b on b.id = br.business_id
where coalesce(br.is_active, true) = true
  and coalesce(b.is_active, true) = true;

grant select on public.public_booking_branches to anon, authenticated;

-- ── 3. Horario/promociones por sucursal, versión pública ───────────────────
create or replace view public.public_booking_branch_settings as
select bs.business_id, bs.branch_id, bs.schedule
from public.branch_settings bs
join public.businesses b on b.id = bs.business_id
where coalesce(b.is_active, true) = true;

grant select on public.public_booking_branch_settings to anon, authenticated;

-- ── 4. create_public_booking_public_v4: elimina la v4 vieja (11 params,
--      sin branch_id) antes de crear la nueva (12 params) — nunca deben
--      coexistir dos señas distintas con el mismo nombre.
drop function if exists public.create_public_booking_public_v4(
  uuid, text, uuid, timestamp with time zone, text, text, text, date, text, text, text
);

create or replace function public.create_public_booking_public_v4(
  p_business_id uuid,
  p_service_ids text,
  p_employee_id uuid,
  p_starts_at timestamp with time zone,
  p_client_name text,
  p_client_phone text,
  p_client_email text,
  p_client_birth_date date,
  p_notes text,
  p_acquisition_source text default null,
  p_acquisition_source_custom text default null,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_service_id uuid;
  v_service_ids uuid[];
  v_service_names text[] := '{}';
  v_total_price numeric := 0;
  v_total_duration int := 0;
  v_service_name text;
  v_service_price numeric;
  v_service_duration int;
  v_client_id uuid;
  v_ends_at timestamptz;
  v_conflict_id uuid;
  v_appointment_id uuid;
  v_phone text := nullif(trim(coalesce(p_client_phone, '')), '');
  v_phone_digits text := regexp_replace(coalesce(p_client_phone, ''), '\D', '', 'g');
  v_email text := nullif(lower(trim(coalesce(p_client_email, ''))), '');
  v_name text := nullif(trim(coalesce(p_client_name, '')), '');
  v_has_employee boolean := false;
begin
  if p_business_id is null then
    raise exception 'Falta el negocio para crear la reserva.' using errcode = 'P0001';
  end if;

  if p_employee_id is null then
    raise exception 'Falta seleccionar un profesional.' using errcode = 'P0001';
  end if;

  if v_name is null then
    raise exception 'Ingresá el nombre del cliente.' using errcode = 'P0001';
  end if;

  if v_phone is null then
    raise exception 'Ingresá el teléfono del cliente.' using errcode = 'P0001';
  end if;

  select array_agg(trim(x)::uuid)
    into v_service_ids
  from unnest(string_to_array(coalesce(p_service_ids, ''), ',')) as x
  where trim(x) <> '';

  if v_service_ids is null or array_length(v_service_ids, 1) is null then
    raise exception 'Elegí al menos un servicio.' using errcode = 'P0001';
  end if;

  -- Validación con la misma vista que usa la pantalla pública. Si se pasa
  -- sucursal, el profesional tiene que pertenecer a ESA sucursal (o no
  -- tener ninguna asignada todavía — negocio recién migrado).
  select exists(
    select 1
    from public.public_booking_employees e
    where e.id = p_employee_id
      and e.business_id = p_business_id
      and coalesce(e.is_active, true) = true
      and (p_branch_id is null or e.branch_id is null or e.branch_id = p_branch_id)
  ) into v_has_employee;

  if not coalesce(v_has_employee, false) then
    raise exception 'El profesional seleccionado no está disponible.' using errcode = 'P0001';
  end if;

  foreach v_service_id in array v_service_ids loop
    v_service_name := null;
    v_service_price := 0;
    v_service_duration := 30;

    select s.name, coalesce(s.price, 0), coalesce(s.duration_min, 30)
      into v_service_name, v_service_price, v_service_duration
    from public.public_booking_services s
    where s.id = v_service_id
      and s.business_id = p_business_id
      and coalesce(s.is_active, true) = true
      and (p_branch_id is null or s.branch_id is null or s.branch_id = p_branch_id)
    limit 1;

    if v_service_name is null then
      raise exception 'El servicio seleccionado no existe, está desactivado o no pertenece a este negocio.' using errcode = 'P0001';
    end if;

    v_service_names := array_append(v_service_names, v_service_name);
    v_total_price := v_total_price + coalesce(v_service_price, 0);
    v_total_duration := v_total_duration + greatest(coalesce(v_service_duration, 30), 1);
  end loop;

  if v_total_duration <= 0 then
    v_total_duration := 30;
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_total_duration);

  select a.id
    into v_conflict_id
  from public.appointments a
  where a.business_id = p_business_id
    and a.employee_id = p_employee_id
    and coalesce(a.status, 'pending') not in ('cancelled', 'canceled')
    and a.starts_at < v_ends_at
    and coalesce(a.ends_at, a.starts_at + make_interval(mins => coalesce(a.duration_min, v_total_duration, 30))) > p_starts_at
  limit 1;

  if v_conflict_id is not null then
    raise exception 'Ese horario ya no está disponible. Elegí otro turno.' using errcode = 'P0001';
  end if;

  -- Identificación de cliente: mail primero (fuente de verdad una vez que
  -- existe), teléfono como respaldo (dígitos, sin espacios/signos/código de
  -- país) — mismo criterio que la v4 ya vigente en producción. Nunca
  -- duplicar si ya se puede identificar por cualquiera de los dos.
  if v_email is not null then
    select c.id
      into v_client_id
    from public.clients c
    where c.business_id = p_business_id
      and lower(coalesce(c.email, '')) = v_email
    order by c.created_at asc nulls last
    limit 1;
  end if;

  if v_client_id is null and v_phone is not null then
    select c.id
      into v_client_id
    from public.clients c
    where c.business_id = p_business_id
      and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = v_phone_digits
    order by c.created_at asc nulls last
    limit 1;
  end if;

  if v_client_id is null then
    insert into public.clients (
      business_id,
      branch_id,
      full_name,
      phone,
      email,
      birth_date,
      notes,
      acquisition_source,
      acquisition_source_custom,
      acquisition_captured_at
    )
    values (
      p_business_id,
      p_branch_id,
      v_name,
      v_phone,
      v_email,
      p_client_birth_date,
      nullif(p_notes, ''),
      p_acquisition_source,
      p_acquisition_source_custom,
      case
        when p_acquisition_source is not null then now()
        else null
      end
    )
    returning id into v_client_id;
  else
    update public.clients
      set
        full_name = v_name,
        -- Siempre se actualiza al valor nuevo: si el cliente quedó
        -- identificado por mail, el teléfono puede haber cambiado y tiene
        -- que quedar al día.
        phone = v_phone,
        -- Solo se completa si estaba vacío — nunca pisa un mail ya cargado.
        email = case
          when nullif(email, '') is null then v_email
          else email
        end,
        birth_date = coalesce(birth_date, p_client_birth_date),
        notes = coalesce(notes, nullif(p_notes, '')),
        acquisition_source = case
          when acquisition_source is null
               and p_acquisition_source is not null
          then p_acquisition_source
          else acquisition_source
        end,
        acquisition_source_custom = case
          when acquisition_source is null
               and p_acquisition_source is not null
          then p_acquisition_source_custom
          else acquisition_source_custom
        end,
        acquisition_captured_at = case
          when acquisition_source is null
               and p_acquisition_source is not null
          then now()
          else acquisition_captured_at
        end
    where id = v_client_id;
  end if;

  insert into public.appointments (
    business_id,
    branch_id,
    client_id,
    client_name,
    employee_id,
    service_name,
    service_price,
    starts_at,
    ends_at,
    duration_min,
    status,
    notes,
    created_by_name,
    created_by_role,
    updated_at
  ) values (
    p_business_id,
    p_branch_id,
    v_client_id,
    v_name,
    p_employee_id,
    array_to_string(v_service_names, ' + '),
    v_total_price,
    p_starts_at,
    v_ends_at,
    v_total_duration,
    'pending',
    nullif(p_notes, ''),
    'Reserva online',
    'public',
    now()
  ) returning id into v_appointment_id;

  return jsonb_build_object(
    'ok', true,
    'appointment_id', v_appointment_id,
    'client_id', v_client_id,
    'starts_at', p_starts_at,
    'ends_at', v_ends_at,
    'duration_min', v_total_duration,
    'service_name', array_to_string(v_service_names, ' + '),
    'service_price', v_total_price
  );
end;
$function$;

grant execute on function public.create_public_booking_public_v4(
  uuid, text, uuid, timestamp with time zone, text, text, text, date, text, text, text, uuid
) to anon, authenticated;

NOTIFY pgrst, 'reload schema';
