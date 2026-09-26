-- "Notas" en la ficha del cliente (clients.notes) es exclusivamente para
-- texto escrito a mano por el equipo — nunca datos automáticos del sistema.
-- Antes del 10/09, create_public_booking_public_v3 guardaba el bloque
-- completo de p_notes (Email, fecha de nacimiento, servicios, productos,
-- promoción aplicada, y siempre terminando en la línea literal "Origen:
-- reserva online") tanto en appointments.notes (correcto: es contexto del
-- turno para el equipo) COMO en clients.notes (incorrecto: eso "pisaba" la
-- sección Notas de la ficha con texto que el negocio nunca escribió).
--
-- El fix del lado del insert/update de `clients` ya está aplicado — esta
-- función NO escribe `notes` en ningún lado del bloque que crea/actualiza el
-- cliente (ver más abajo). Se re-emite igual, verbatim, para que quede
-- garantizado sin importar qué versión haya quedado activa antes de esto —
-- CREATE OR REPLACE es idempotente, no cambia nada si ya estaba así.
--
-- Lo que faltaba (y es el motivo real de esta migración) es la LIMPIEZA de
-- clientes que ya tienen ese texto viejo pegado en su nota desde antes del
-- fix. El email sigue estando en la columna `email` del cliente y el canal
-- de adquisición en `acquisition_source`/`acquisition_source_custom` — nada
-- de esa información se pierde, solo se saca la copia duplicada e indebida
-- de la sección Notas (el texto completo sigue intacto en el
-- appointments.notes del turno que lo originó).

create or replace function public.create_public_booking_public_v3(p_business_id uuid, p_service_ids text, p_employee_id uuid, p_starts_at timestamp with time zone, p_client_name text, p_client_phone text, p_client_email text, p_client_birth_date date, p_notes text, p_acquisition_source text DEFAULT NULL::text, p_acquisition_source_custom text DEFAULT NULL::text)
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
  v_timezone text;
  v_biz_schedule jsonb;
  v_local_ts timestamp;
  v_day_key text;
  v_date_key text;
  v_slot_start_min int;
  v_slot_end_min int;
  v_biz_day jsonb;
  v_emp_day jsonb;
  v_emp_special_day jsonb;
  v_emp_weekly_day jsonb;
  v_biz_open int;
  v_biz_close int;
  v_emp_open int;
  v_emp_close int;
  v_open_min int;
  v_close_min int;
  v_break_start int;
  v_break_end int;
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

  select coalesce(
           jsonb_extract_path(bs.schedule, '_publicVisibility', 'employees'),
           jsonb_extract_path(bs.schedule, '_employeeOnline'),
           '{}'::jsonb
         )
    into v_employee_visibility_map
  from public.business_settings bs
  where bs.business_id = p_business_id;

  v_employee_online := coalesce(
    jsonb_extract_path_text(
      v_employee_visibility_map,
      p_employee_id::text
    )::boolean,
    true
  );

  if not v_employee_online then
    raise exception 'El profesional seleccionado no acepta reservas en línea.' using errcode = 'P0001';
  end if;

  select jsonb_extract_path(
           bs.schedule,
           '_employeeServiceOverrides',
           p_employee_id::text
         )
    into v_employee_overrides
  from public.business_settings bs
  where bs.business_id = p_business_id;

  foreach v_service_id in array v_service_ids loop
    v_service_name := null;
    v_service_price := 0;
    v_service_duration := 30;

    select
      s.name,
      coalesce(s.price, 0),
      coalesce(s.duration_min, 30)
      into
        v_service_name,
        v_service_price,
        v_service_duration
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

    if v_override_cfg is not null
       and (v_override_cfg ->> 'useStandardPrice') = 'false'
       and (v_override_cfg ->> 'price') ~ '^[0-9]+(\.[0-9]+)?$'
    then
      v_override_price := (v_override_cfg ->> 'price')::numeric;

      if v_override_price is not null and v_override_price > 0 then
        v_service_price := v_override_price;
      end if;
    end if;

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
    v_total_duration := v_total_duration + greatest(
      coalesce(v_service_duration, 30),
      1
    );
  end loop;

  if v_total_duration <= 0 then
    v_total_duration := 30;
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_total_duration);

  -- Validación de horario: el rango [p_starts_at, v_ends_at) tiene que caer
  -- dentro de la intersección del horario del negocio y del horario propio
  -- del profesional para ese día (mismo criterio que
  -- src/lib/availability.ts resolveDaySchedule), calculado en la zona
  -- horaria real del negocio.
  select coalesce(b.timezone, 'America/Argentina/Buenos_Aires'), bs.schedule
    into v_timezone, v_biz_schedule
  from public.businesses b
  left join public.business_settings bs on bs.business_id = b.id
  where b.id = p_business_id;

  v_local_ts := p_starts_at at time zone coalesce(v_timezone, 'America/Argentina/Buenos_Aires');
  v_day_key := (array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from v_local_ts)::int + 1];
  v_date_key := to_char(v_local_ts, 'YYYY-MM-DD');
  v_slot_start_min := extract(hour from v_local_ts)::int * 60 + extract(minute from v_local_ts)::int;
  v_slot_end_min := v_slot_start_min + v_total_duration;

  v_biz_day := coalesce(
    v_biz_schedule #> array['_specialDates', v_date_key],
    v_biz_schedule -> v_day_key
  );

  if v_biz_day is null or coalesce((v_biz_day ->> 'enabled')::boolean, true) = false then
    raise exception 'Ese horario ya no está disponible. Elegí otro turno.' using errcode = 'P0001';
  end if;

  v_biz_open := public._booking_parse_time_minutes(v_biz_day ->> 'start');
  v_biz_close := public._booking_parse_time_minutes(v_biz_day ->> 'end');

  if v_biz_open is null or v_biz_close is null then
    raise exception 'El horario del negocio no está configurado correctamente para ese día.' using errcode = 'P0001';
  end if;

  v_open_min := v_biz_open;
  v_close_min := v_biz_close;

  v_emp_special_day := v_biz_schedule #> array['_employeeSpecialDates', p_employee_id::text, v_date_key];
  v_emp_weekly_day := v_biz_schedule #> array['_employeeSchedules', p_employee_id::text, v_day_key];
  v_emp_day := coalesce(v_emp_special_day, v_emp_weekly_day);

  if v_emp_day is not null then
    if coalesce((v_emp_day ->> 'enabled')::boolean, true) = false then
      raise exception 'Ese horario ya no está disponible. Elegí otro turno.' using errcode = 'P0001';
    end if;

    v_emp_open := public._booking_parse_time_minutes(v_emp_day ->> 'start');
    v_emp_close := public._booking_parse_time_minutes(v_emp_day ->> 'end');

    if v_emp_open is null or v_emp_close is null then
      raise exception 'El horario del profesional no está configurado correctamente para ese día.' using errcode = 'P0001';
    end if;

    v_open_min := greatest(v_open_min, v_emp_open);
    v_close_min := least(v_close_min, v_emp_close);
  end if;

  if v_open_min >= v_close_min
     or v_slot_start_min < v_open_min
     or v_slot_end_min > v_close_min
  then
    raise exception 'Ese horario ya no está disponible. Elegí otro turno.' using errcode = 'P0001';
  end if;

  if v_emp_day is not null then
    -- El profesional tiene horario propio para este día (especial de la
    -- fecha exacta, si no semanal recurrente): SU descanso —o la ausencia
    -- de descanso— es el único que se valida. Nunca se suma el descanso del
    -- negocio: profesional + día = como máximo un descanso activo.
    v_break_start := public._booking_parse_time_minutes(v_emp_day ->> 'breakStart');
    v_break_end := public._booking_parse_time_minutes(v_emp_day ->> 'breakEnd');
    if v_break_start is not null and v_break_end is not null and v_break_end > v_break_start
       and v_slot_start_min < v_break_end and v_slot_end_min > v_break_start
    then
      raise exception 'Ese horario cae dentro del descanso configurado.' using errcode = 'P0001';
    end if;
  else
    -- Profesional sin horario propio configurado ese día → hereda el
    -- descanso del negocio (si tiene uno).
    v_break_start := public._booking_parse_time_minutes(v_biz_day ->> 'breakStart');
    v_break_end := public._booking_parse_time_minutes(v_biz_day ->> 'breakEnd');
    if v_break_start is not null and v_break_end is not null and v_break_end > v_break_start
       and v_slot_start_min < v_break_end and v_slot_end_min > v_break_start
    then
      raise exception 'Ese horario cae dentro del descanso configurado.' using errcode = 'P0001';
    end if;
  end if;

  select a.id
    into v_conflict_id
  from public.appointments a
  where a.business_id = p_business_id
    and a.employee_id = p_employee_id
    and coalesce(a.status, 'pending') not in ('cancelled', 'canceled')
    and a.starts_at < v_ends_at
    and coalesce(
          a.ends_at,
          a.starts_at + make_interval(
            mins => coalesce(a.duration_min, v_total_duration, 30)
          )
        ) > p_starts_at
  limit 1;

  if v_conflict_id is not null then
    raise exception 'Ese horario ya no está disponible. Elegí otro turno.' using errcode = 'P0001';
  end if;

  if v_email is not null then
    select c.id
      into v_client_id
    from public.clients c
    where c.business_id = p_business_id
      and lower(coalesce(c.email, '')) = v_email
    order by c.created_at asc nulls last
    limit 1;
  end if;

  -- IMPORTANTE: este insert/update de `clients` nunca escribe `notes` — la
  -- sección Notas de la ficha es solo texto manual del equipo. El bloque
  -- completo de p_notes (email, fecha de nacimiento, servicios, productos,
  -- promoción, "Origen: reserva online") va únicamente al turno, más abajo.
  if v_client_id is null then
    insert into public.clients (
      business_id,
      full_name,
      phone,
      email,
      birth_date,
      acquisition_source,
      acquisition_source_custom,
      acquisition_captured_at
    )
    values (
      p_business_id,
      v_name,
      v_phone,
      v_email,
      p_client_birth_date,
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
        phone = v_phone,
        birth_date = coalesce(birth_date, p_client_birth_date),
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
  )
  values (
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
  )
  returning id into v_appointment_id;

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

-- Limpieza de datos: clientes que ya tienen el bloque automático pegado en
-- su nota desde antes del fix. Detección deliberadamente estricta —
-- solo se limpia cuando el texto TERMINA con la línea literal exacta
-- "Origen: reserva online" (siempre la última línea de ese bloque
-- auto-generado, ver publicNotes en src/routes/reservar/$slug.tsx — nunca
-- una frase que el equipo escribiría a mano). Si una nota fue editada o
-- extendida por una persona después de crearse, deja de terminar en esa
-- línea exacta y esta limpieza NO la toca. Nada se pierde: el mismo texto
-- sigue intacto en el appointments.notes del turno que lo originó.
update public.clients
set notes = null
where notes is not null
  and btrim(notes) like '%Origen: reserva online';
