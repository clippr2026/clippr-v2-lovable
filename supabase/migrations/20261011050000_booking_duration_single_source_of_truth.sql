-- ============================================================================
-- Duración/precio de reserva — una sola fuente de verdad en SQL, y la
-- reserva pública vuelve a respetar el override por profesional
-- ============================================================================
-- Causa real encontrada (auditoría 11/10/2026): create_public_booking_public_v3
-- (20260910030000_public_booking_use_employee_service_overrides.sql) había
-- agregado la resolución de precio/duración por profesional
-- (business_settings.schedule._employeeServiceOverrides, mismo criterio que
-- resolveServicePricing en TypeScript) y el switch "Ofrece este servicio".
-- Las migraciones posteriores que crearon v4 y v5 (multi-sucursal, fallback
-- de identidad por teléfono) reescribieron la función completa desde una
-- copia ANTERIOR a ese fix — perdiendo en silencio la resolución de
-- overrides Y el switch de "ofrece este servicio" Y el de "acepta reservas
-- online". create_public_booking_public_v5, tal como está hoy en
-- producción, calcula precio/duración leyendo ÚNICAMENTE
-- public_booking_services.duration_min (el estándar del catálogo) sin
-- mirar el override del profesional en absoluto.
--
-- Impacto real verificado en producción: Alan, Melany y Pipo tienen
-- "Corte en cabello corto" configurado a 60 min (estándar del catálogo:
-- 40 min) — cada reserva pública para ellos de ese servicio se guardó con
-- 40 min, mezclada en el tiempo con turnos de 60 min creados por otras vías
-- (Agenda interna, que sí resuelve bien). Mismo problema para precio: un
-- profesional con precio propio distinto del estándar también queda mal
-- en toda reserva pública.
--
-- Fix de raíz: se extrae la resolución a UNA función SQL reutilizable
-- (resolve_employee_service_pricing) — la única fuente de verdad del lado
-- del servidor, espejo exacto de resolveServicePricing (service-pricing.ts)
-- — y create_public_booking_public_v5 la llama en vez de reimplementar la
-- lógica inline. Así, la próxima vez que haya que crear v6 (o cualquier
-- otro flujo server-side que necesite precio/duración por profesional), se
-- llama a esta función en vez de copiar/pegar el cálculo y arriesgar
-- perderlo otra vez.
--
-- No cambia nada más de v5: cierre de sucursal, scoping de sucursal,
-- identidad de cliente por mail con fallback a teléfono, todo igual.
--
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase (proyecto de
-- myclippr.com) y ejecutar. Seguro re-ejecutar (create or replace).
-- ============================================================================

-- ── 1. Única fuente de verdad en SQL para precio/duración/"ofrece este
--      servicio" por profesional — espejo de resolveServicePricing. ────────
create or replace function public.resolve_employee_service_pricing(
  p_business_id uuid,
  p_employee_id uuid,
  p_service_id uuid,
  p_branch_id uuid default null
)
returns table (
  service_name text,
  price numeric,
  duration_min int,
  enabled boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_price numeric;
  v_duration int;
  v_employee_overrides jsonb;
  v_override_cfg jsonb;
  v_enabled boolean;
  v_override_price numeric;
  v_override_duration int;
begin
  select s.name, coalesce(s.price, 0), coalesce(s.duration_min, 30)
    into v_name, v_price, v_duration
  from public.price_catalog s
  where s.id = p_service_id
    and s.business_id = p_business_id
    and coalesce(s.active, true) = true
    and (p_branch_id is null or s.branch_id is null or s.branch_id = p_branch_id)
  limit 1;

  if v_name is null then
    return;
  end if;

  select bs.schedule -> '_employeeServiceOverrides' -> p_employee_id::text
    into v_employee_overrides
  from public.business_settings bs
  where bs.business_id = p_business_id;

  v_override_cfg := v_employee_overrides -> p_service_id::text;

  -- "Ofrece este servicio" (Configuración → Equipo) — sin configuración
  -- guardada = lo ofrece, igual criterio que isServiceOfferedByEmployee en
  -- service-pricing.ts (solo un enabled:false explícito lo saca).
  v_enabled := coalesce((v_override_cfg ->> 'enabled')::boolean, true);

  -- Precio propio del profesional: useStandardPrice explícitamente false +
  -- valor numérico propio > 0 — mismo criterio que resolveServicePricing.
  if v_override_cfg is not null
     and (v_override_cfg ->> 'useStandardPrice') = 'false'
     and (v_override_cfg ->> 'price') ~ '^[0-9]+(\.[0-9]+)?$'
  then
    v_override_price := (v_override_cfg ->> 'price')::numeric;
    if v_override_price is not null and v_override_price > 0 then
      v_price := v_override_price;
    end if;
  end if;

  -- Duración propia del profesional: mismo criterio — esto es lo que
  -- create_public_booking_public_v5 dejó de hacer, causa real del bug de
  -- "turnos de 40 min para profesionales configurados en 60".
  if v_override_cfg is not null
     and (v_override_cfg ->> 'useStandardDuration') = 'false'
     and (v_override_cfg ->> 'duration_min') ~ '^[0-9]+$'
  then
    v_override_duration := (v_override_cfg ->> 'duration_min')::int;
    if v_override_duration is not null and v_override_duration > 0 then
      v_duration := v_override_duration;
    end if;
  end if;

  return query select v_name, v_price, v_duration, v_enabled;
end;
$$;

grant execute on function public.resolve_employee_service_pricing(uuid, uuid, uuid, uuid) to anon, authenticated;

-- ── 2. create_public_booking_public_v5: vuelve a resolver por profesional ──
create or replace function public.create_public_booking_public_v5(
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
set search_path = public
as $$
declare
  v_service_id uuid;
  v_service_ids uuid[];
  v_service_names text[] := '{}';
  v_total_price numeric := 0;
  v_total_duration int := 0;
  v_resolved record;
  v_client_id uuid;
  v_ends_at timestamptz;
  v_conflict_id uuid;
  v_appointment_id uuid;
  v_phone text := nullif(trim(coalesce(p_client_phone, '')), '');
  v_phone_digits text := regexp_replace(coalesce(p_client_phone, ''), '\D', '', 'g');
  v_email text := nullif(lower(trim(coalesce(p_client_email, ''))), '');
  v_name text := nullif(trim(coalesce(p_client_name, '')), '');
  v_has_employee boolean := false;
  v_closed boolean := false;
  v_employee_visibility_map jsonb;
  v_employee_online boolean;
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

  -- Cierre de sucursal/negocio — sin cambios respecto a v5.
  select exists(
    select 1
    from public.public_booking_closures c
    where c.business_id = p_business_id
      and c.branch_id is not distinct from p_branch_id
      and p_starts_at::date between c.start_date and c.end_date
  ) into v_closed;

  if v_closed then
    raise exception 'El negocio está cerrado en esa fecha. Elegí otro día.' using errcode = 'P0001';
  end if;

  -- Validación de sucursal del profesional — sin cambios respecto a v5.
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

  -- "Acepta reservas en línea" (Configuración → Equipo) — restaurado, se
  -- había perdido en v4/v5 igual que los overrides de abajo. Sin
  -- configuración guardada = acepta, mismo criterio que la Página Pública.
  select coalesce(
           jsonb_extract_path(bs.schedule, '_publicVisibility', 'employees'),
           jsonb_extract_path(bs.schedule, '_employeeOnline'),
           '{}'::jsonb
         )
    into v_employee_visibility_map
  from public.business_settings bs
  where bs.business_id = p_business_id;

  v_employee_online := coalesce(
    jsonb_extract_path_text(v_employee_visibility_map, p_employee_id::text)::boolean,
    true
  );

  if not v_employee_online then
    raise exception 'El profesional seleccionado no acepta reservas en línea.' using errcode = 'P0001';
  end if;

  -- Precio/duración/"ofrece este servicio" — una sola fuente de verdad
  -- (resolve_employee_service_pricing), nunca más reimplementado acá.
  foreach v_service_id in array v_service_ids loop
    select * into v_resolved
    from public.resolve_employee_service_pricing(p_business_id, p_employee_id, v_service_id, p_branch_id);

    if v_resolved.service_name is null then
      raise exception 'El servicio seleccionado no existe, está desactivado o no pertenece a este negocio.' using errcode = 'P0001';
    end if;

    if not coalesce(v_resolved.enabled, true) then
      raise exception 'El profesional seleccionado no ofrece uno de los servicios elegidos.' using errcode = 'P0001';
    end if;

    v_service_names := array_append(v_service_names, v_resolved.service_name);
    v_total_price := v_total_price + coalesce(v_resolved.price, 0);
    v_total_duration := v_total_duration + greatest(coalesce(v_resolved.duration_min, 30), 1);
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
  -- existe), teléfono como respaldo (comparado por dígitos, sin espacios/
  -- signos/código de país) — mismo criterio exacto que v4 en producción.
  -- Nunca duplicar si ya se puede identificar por cualquiera de los dos.
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
        -- que quedar al día. Si quedó identificado por teléfono, este ya
        -- es ese mismo valor (no-op). Mismo criterio que v4.
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
$$;

grant execute on function public.create_public_booking_public_v5(
  uuid, text, uuid, timestamptz, text, text, text, date, text, text, text, uuid
) to anon, authenticated;

NOTIFY pgrst, 'reload schema';
