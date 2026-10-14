-- Causa raíz: create_public_booking_public_v5 no tiene ningún parámetro ni
-- lógica de promoción. El cliente intentaba corregir el precio con un
-- update posterior desde el navegador, pero appointments no tiene política
-- RLS para el rol anon — ese update (y el incremento de uso de la promo)
-- fallaban siempre en silencio. Resultado: el 100% de las reservas
-- públicas con promoción perdían promotion_id/promotion_snapshot (y la
-- promo nunca consumía cupo).
--
-- create_public_booking_public_v6 resuelve y valida la promoción del lado
-- del servidor (misma fuente que el editor: branch_settings.schedule.
-- _promotions) y persiste todo (precio con descuento, promotion_id,
-- promotion_snapshot, incremento de uso) en un solo paso atómico, sin
-- depender de ningún update posterior desde el cliente.
create or replace function public.create_public_booking_public_v6(
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
  p_branch_id uuid default null,
  p_promotion_id uuid default null
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
  -- Promoción (resuelta y validada del lado del servidor).
  v_promo jsonb;
  v_promo_valid boolean := false;
  v_discount_type text;
  v_discount_value numeric;
  v_service_category text;
  v_service_applies boolean;
  v_service_price numeric;
  v_any_discount boolean := false;
  v_client_key_phone text;
  v_client_key_email text;
  v_per_client_limit int;
  v_per_client_used int;
  v_business_tz text;
  v_local_ts timestamp;
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

  -- "Acepta reservas en línea" — sin cambios respecto a v5.
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

  -- Resuelve y valida la promoción (si se mandó una) contra branch_settings
  -- — misma fuente que Configuración → Promociones y el editor. Cualquier
  -- chequeo que no pase deja v_promo_valid en false y la reserva sigue
  -- igual, sin el descuento (nunca bloquea el turno por esto).
  if p_promotion_id is not null and p_branch_id is not null then
    select elem
      into v_promo
    from public.branch_settings bs,
         jsonb_array_elements(coalesce(bs.schedule -> '_promotions', '[]'::jsonb)) elem
    where bs.business_id = p_business_id
      and bs.branch_id = p_branch_id
      and elem ->> 'id' = p_promotion_id::text
    limit 1;

    if v_promo is not null then
      v_promo_valid := coalesce((v_promo ->> 'active')::boolean, false);
    end if;

    -- Cupo total.
    if v_promo_valid and (v_promo ->> 'maxUsesTotal') is not null then
      if coalesce((v_promo ->> 'usageCount')::int, 0) >= (v_promo ->> 'maxUsesTotal')::int then
        v_promo_valid := false;
      end if;
    end if;

    -- Vigencia: fecha/día/hora — solo si hasVigencia está activado (igual
    -- criterio que isPromotionCurrentlyValid en service-pricing.ts).
    -- Siempre en el huso horario del negocio (businesses.timezone) — la
    -- sesión de Postgres corre en UTC, y comparar día/hora en UTC
    -- desalinearía el límite varias horas respecto a lo que ve el cliente.
    if v_promo_valid and coalesce((v_promo ->> 'hasVigencia')::boolean, false) then
      select coalesce(b.timezone, 'America/Argentina/Buenos_Aires')
        into v_business_tz
      from public.businesses b
      where b.id = p_business_id;

      v_local_ts := p_starts_at at time zone coalesce(v_business_tz, 'America/Argentina/Buenos_Aires');

      if nullif(v_promo ->> 'startDate', '') is not null
         and v_local_ts < (v_promo ->> 'startDate')::date
      then
        v_promo_valid := false;
      end if;
      if v_promo_valid
         and nullif(v_promo ->> 'endDate', '') is not null
         and v_local_ts::date > (v_promo ->> 'endDate')::date
      then
        v_promo_valid := false;
      end if;
      if v_promo_valid then
        declare
          v_day_key text := (array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from v_local_ts)::int + 1];
          v_day jsonb := v_promo -> 'days' -> v_day_key;
          v_hhmm text := to_char(v_local_ts, 'HH24:MI');
        begin
          if v_day is null or coalesce((v_day ->> 'enabled')::boolean, false) = false then
            v_promo_valid := false;
          elsif nullif(v_day ->> 'start', '') is not null and nullif(v_day ->> 'end', '') is not null then
            if v_hhmm < (v_day ->> 'start') or v_hhmm > (v_day ->> 'end') then
              v_promo_valid := false;
            end if;
          end if;
        end;
      end if;
    end if;

    -- Claves de cliente (igual formato que normalizeClientKeys en
    -- service-pricing.ts) — se calculan siempre que haya promo, no solo si
    -- hay límite por cliente configurado, para que usedByClient quede
    -- completo igual si más adelante se agrega un límite.
    if v_promo is not null then
      v_client_key_phone := case when v_phone_digits <> '' then 'phone:' || v_phone_digits else null end;
      v_client_key_email := case when v_email is not null then 'email:' || v_email else null end;
    end if;

    -- Límite por cliente.
    if v_promo_valid then
      v_per_client_limit := (v_promo ->> 'maxUsesPerClient')::int;
      if v_per_client_limit is not null then
        v_per_client_used := greatest(
          coalesce((v_promo -> 'usedByClient' ->> coalesce(v_client_key_phone, '')), '0')::int,
          coalesce((v_promo -> 'usedByClient' ->> coalesce(v_client_key_email, '')), '0')::int
        );
        if v_per_client_used >= v_per_client_limit then
          v_promo_valid := false;
        end if;
      end if;
    end if;

    if v_promo_valid then
      v_discount_type := v_promo ->> 'discountType';
      v_discount_value := coalesce((v_promo ->> 'discountValue')::numeric, 0);
    end if;
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
    v_service_price := coalesce(v_resolved.price, 0);

    -- Aplicabilidad por servicio/categoría + profesional — mismo criterio
    -- que isPromotionApplicable en service-pricing.ts.
    v_service_applies := false;
    if v_promo_valid then
      select p.category into v_service_category
      from public.price_catalog p
      where p.id = v_service_id;

      v_service_applies :=
        (v_promo -> 'serviceIds' ? v_service_id::text)
        or (v_service_category is not null and (v_promo -> 'categoryNames' ? v_service_category));

      if v_service_applies and not (v_promo -> 'employeeIds' ? p_employee_id::text) then
        v_service_applies := false;
      end if;
    end if;

    -- IMPORTANTE: appointments.service_price SIEMPRE guarda el precio de
    -- LISTA completo, nunca el ya descontado por la promo — exactamente la
    -- misma convención que usa el resto de la app (Agenda interna, Caja):
    -- el descuento de la promo se calcula UNA sola vez, recién al mostrar
    -- el turno o al cobrarlo, a partir de promotion_snapshot. Si acá se
    -- guardara el precio ya descontado, esas pantallas volverían a
    -- restarle el descuento una segunda vez (precio final equivocado).
    if v_service_applies then
      v_any_discount := true;
    end if;

    v_total_price := v_total_price + v_service_price;
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

  -- Identificación de cliente — sin cambios respecto a v5.
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
        phone = v_phone,
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
    promotion_id,
    promotion_snapshot,
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
    case when v_any_discount then p_promotion_id else null end,
    case when v_any_discount then jsonb_build_object(
      'name', v_promo ->> 'name',
      'discountType', v_discount_type,
      'discountValue', v_promo ->> 'discountValue'
    ) else null end,
    now()
  ) returning id into v_appointment_id;

  -- Incremento de uso de la promo — atómico, en el mismo paso que crea el
  -- turno (reemplaza el incrementPromotionUsage desde el cliente, que para
  -- un visitante anónimo siempre fallaba por RLS en branch_settings).
  if v_any_discount then
    update public.branch_settings bs
    set schedule = jsonb_set(
      bs.schedule,
      '{_promotions}',
      (
        select jsonb_agg(
          case
            when elem ->> 'id' = p_promotion_id::text then
              elem
              || jsonb_build_object('usageCount', coalesce((elem ->> 'usageCount')::int, 0) + 1)
              || jsonb_build_object(
                   'usedByClient',
                   coalesce(elem -> 'usedByClient', '{}'::jsonb)
                   || coalesce((
                     select jsonb_object_agg(k, coalesce((elem -> 'usedByClient' ->> k)::int, 0) + 1)
                     from unnest(array_remove(array[v_client_key_phone, v_client_key_email], null)) as k
                   ), '{}'::jsonb)
                 )
            else elem
          end
        )
        from jsonb_array_elements(bs.schedule -> '_promotions') elem
      )
    )
    where bs.business_id = p_business_id
      and bs.branch_id = p_branch_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'appointment_id', v_appointment_id,
    'client_id', v_client_id,
    'starts_at', p_starts_at,
    'ends_at', v_ends_at,
    'duration_min', v_total_duration,
    'service_name', array_to_string(v_service_names, ' + '),
    'service_price', v_total_price,
    'promotion_applied', v_any_discount
  );
end;
$function$;

grant execute on function public.create_public_booking_public_v6(
  uuid, text, uuid, timestamp with time zone, text, text, text, date, text, text, text, uuid, uuid
) to anon, authenticated;
