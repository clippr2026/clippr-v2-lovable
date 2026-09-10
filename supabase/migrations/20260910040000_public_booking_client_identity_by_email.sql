-- create_public_booking_public_v3 identificaba al cliente por teléfono O
-- email (lo que matcheara primero, ver v_phone_digits/v_email en el where),
-- lo que fusionaba en la misma ficha a dos personas distintas que compartían
-- teléfono (ej. dos hermanos con el mismo celular de contacto) aunque cada
-- una hubiera reservado con su propio email.
--
-- Nueva regla, pedida explícitamente: el email es el único identificador de
-- cliente en la reserva pública.
--   - Mismo email  -> mismo cliente (se actualiza nombre/teléfono a lo más
--     reciente, sin tocar los turnos ya creados: appointments.client_name
--     ya queda congelado por turno, no se re-lee de clients).
--   - Email distinto (o sin email) -> cliente distinto, aunque el teléfono
--     ya esté usado por otra ficha. No hay advertencia ni bloqueo: nunca lo
--     hubo acá, este flujo no tenía UI de conflicto, solo el matcheo interno
--     que se está corrigiendo.
--   - El teléfono deja de usarse para identificar/fusionar: queda solo como
--     dato de contacto de la ficha.
--
-- Nota: si el negocio tiene deshabilitado el campo "Email" (Configuración →
-- Clientes → Campos del formulario), p_client_email llega null en cada
-- reserva y, sin identificador, cada reserva de esa persona crea una ficha
-- de cliente nueva (ya no se agrupa por teléfono). Es la consecuencia
-- directa de "el email es el único identificador" — se deja así a propósito,
-- no se agrega un identificador alternativo por fuera de lo pedido.

CREATE OR REPLACE FUNCTION public.create_public_booking_public_v3(p_business_id uuid, p_service_ids text, p_employee_id uuid, p_starts_at timestamp with time zone, p_client_name text, p_client_phone text, p_client_email text, p_client_birth_date date, p_notes text, p_acquisition_source text DEFAULT NULL::text, p_acquisition_source_custom text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_email text := nullif(lower(trim(coalesce(p_client_email, ''))), '');
  v_name text := nullif(trim(coalesce(p_client_name, '')), '');
  v_has_employee boolean := false;
  v_employee_overrides jsonb;
  v_service_enabled boolean;
  v_employee_visibility_map jsonb;
  v_employee_online boolean;
  v_override_cfg jsonb;
  v_override_price numeric;
  v_override_duration int;
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

  select exists(
    select 1
    from public.public_booking_employees e
    where e.id = p_employee_id
      and e.business_id = p_business_id
      and coalesce(e.is_active, true) = true
  ) into v_has_employee;

  if not coalesce(v_has_employee, false) then
    raise exception 'El profesional seleccionado no está disponible.' using errcode = 'P0001';
  end if;

  -- Switch "Acepta reservas en línea" del perfil (Configuración → Equipo).
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

  -- Switch "Ofrece este servicio" + precio/duración por profesional
  -- (Configuración → Equipo). Ausencia de configuración (negocio sin
  -- overrides o profesional sin entrada guardada) = todos sus servicios
  -- habilitados por default, con precio/duración estándar.
  select jsonb_extract_path(bs.schedule, '_employeeServiceOverrides', p_employee_id::text)
    into v_employee_overrides
  from public.business_settings bs
  where bs.business_id = p_business_id;

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
    limit 1;

    if v_service_name is null then
      raise exception 'El servicio seleccionado no existe, está desactivado o no pertenece a este negocio.' using errcode = 'P0001';
    end if;

    v_override_cfg := v_employee_overrides -> v_service_id::text;

    v_service_enabled := coalesce(
      (v_override_cfg ->> 'enabled')::boolean,
      true
    );

    if not v_service_enabled then
      raise exception 'El profesional seleccionado no ofrece uno de los servicios elegidos.' using errcode = 'P0001';
    end if;

    -- Precio propio del profesional para este servicio: mismo criterio que
    -- resolveServicePricing (src/lib/service-pricing.ts) — useStandardPrice
    -- explícitamente false + valor numérico propio > 0.
    if v_override_cfg is not null
       and (v_override_cfg ->> 'useStandardPrice') = 'false'
       and (v_override_cfg ->> 'price') ~ '^[0-9]+(\.[0-9]+)?$'
    then
      v_override_price := (v_override_cfg ->> 'price')::numeric;
      if v_override_price is not null and v_override_price > 0 then
        v_service_price := v_override_price;
      end if;
    end if;

    -- Duración propia del profesional para este servicio: mismo criterio.
    if v_override_cfg is not null
       and (v_override_cfg ->> 'useStandardDuration') = 'false'
       and (v_override_cfg ->> 'duration_min') ~ '^[0-9]+$'
    then
      v_override_duration := (v_override_cfg ->> 'duration_min')::int;
      if v_override_duration is not null and v_override_duration > 0 then
        v_service_duration := v_override_duration;
      end if;
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

  -- Identidad del cliente = email únicamente. Sin email no hay forma de
  -- identificar a un cliente que repite, así que cada reserva sin email crea
  -- una ficha nueva (ver nota arriba).
  if v_email is not null then
    select c.id
      into v_client_id
    from public.clients c
    where c.business_id = p_business_id
      and lower(coalesce(c.email, '')) = v_email
    order by c.created_at asc nulls last
    limit 1;
  end if;

  if v_client_id is null then
    insert into public.clients (
      business_id, full_name, phone, email, birth_date,
      acquisition_source, acquisition_source_custom, acquisition_captured_at
    )
    values (
      p_business_id, v_name, v_phone, v_email, p_client_birth_date,
      p_acquisition_source, p_acquisition_source_custom,
      case when p_acquisition_source is not null then now() else null end
    )
    returning id into v_client_id;
  else
    -- Mismo email = mismo cliente: nombre y teléfono se actualizan a los más
    -- recientes con los que reservó (no solo se completan si estaban
    -- vacíos). Esto no toca los turnos ya creados: cada appointment guarda
    -- su propio client_name congelado en el momento de la reserva.
    update public.clients
      set full_name = v_name,
          phone = v_phone,
          birth_date = coalesce(birth_date, p_client_birth_date),
          acquisition_source = case
            when acquisition_source is null and p_acquisition_source is not null then p_acquisition_source
            else acquisition_source
          end,
          acquisition_source_custom = case
            when acquisition_source is null and p_acquisition_source is not null then p_acquisition_source_custom
            else acquisition_source_custom
          end,
          acquisition_captured_at = case
            when acquisition_source is null and p_acquisition_source is not null then now()
            else acquisition_captured_at
          end
    where id = v_client_id;
  end if;

  insert into public.appointments (
    business_id,
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
