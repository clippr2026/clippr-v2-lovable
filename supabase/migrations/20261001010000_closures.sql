-- ============================================================================
-- Fase 5 — Cierres en Agenda
-- ============================================================================
-- Tabla `closures`: rangos de fechas en los que una sucursal (o el negocio
-- completo, si branch_id es null — caso sin sucursales configuradas) no
-- acepta turnos NUEVOS. Nunca cancela automáticamente los turnos que ya
-- existan dentro del rango — eso se avisa en la UI antes de confirmar, pero
-- la decisión de cancelarlos o no queda siempre en manos del usuario.
--
-- Genérica, re-ejecutable. Solo clippr-dev — NO tocar producción todavía.
-- ============================================================================

create table if not exists public.closures (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  created_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_closures_business_branch_dates
  on public.closures (business_id, branch_id, start_date, end_date);

alter table public.closures enable row level security;

drop policy if exists closures_select on public.closures;
create policy closures_select on public.closures for select
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
  );

-- Gestionar cierres es una acción administrativa — mismo criterio que el
-- resto de la configuración (Sucursales, Promociones, reglas de tardanza):
-- cualquier miembro del negocio excepto un acceso "profesional".
drop policy if exists closures_write on public.closures;
create policy closures_write on public.closures for all
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  )
  with check (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  );

-- Espejo público de solo lectura — la página de reservas (sin sesión) y el
-- RPC de booking público necesitan poder chequear cierres antes de crear un
-- turno. Mismo patrón que el resto de las vistas public_booking_*.
create or replace view public.public_booking_closures as
select business_id, branch_id, start_date, end_date
from public.closures;

grant select on public.public_booking_closures to anon, authenticated;

-- ── create_public_booking_public_v5: v4 + chequeo de cierres ───────────────
-- Copia exacta de v4 (que a su vez era copia de v3) + un chequeo de
-- `closures` antes de insertar el turno. v4 queda intacta, sin usar, por
-- compatibilidad/rollback fácil — mismo criterio que las versiones previas.
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
  v_closed boolean := false;
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

  -- Cierre de sucursal/negocio — mismo criterio exacto que el resto de la
  -- fundación multi-sucursal (branch_id null = cierre general; si no, tiene
  -- que coincidir exactamente con la sucursal de la reserva, nunca "se
  -- filtra" a otras sucursales).
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

  select c.id
    into v_client_id
  from public.clients c
  where c.business_id = p_business_id
    and (
      (v_phone_digits <> '' and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = v_phone_digits)
      or (v_email is not null and lower(coalesce(c.email, '')) = v_email)
    )
  order by c.created_at asc nulls last
  limit 1;

  if v_client_id is null then
    insert into public.clients (
      business_id, branch_id, full_name, phone, email, birth_date, notes,
      acquisition_source, acquisition_source_custom, acquisition_captured_at
    )
    values (
      p_business_id, p_branch_id, v_name, v_phone, v_email, p_client_birth_date, nullif(p_notes, ''),
      p_acquisition_source, p_acquisition_source_custom,
      case when p_acquisition_source is not null then now() else null end
    )
    returning id into v_client_id;
  else
    update public.clients
      set full_name = case when nullif(full_name, '') is null then v_name else full_name end,
          phone = case when nullif(phone, '') is null then v_phone else phone end,
          email = case when nullif(email, '') is null then v_email else email end,
          birth_date = coalesce(birth_date, p_client_birth_date),
          notes = coalesce(notes, nullif(p_notes, '')),
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

grant execute on function public.create_public_booking_public_v5(
  uuid, text, uuid, timestamp with time zone, text, text, text, date, text, text, text, uuid
) to anon, authenticated;

NOTIFY pgrst, 'reload schema';
