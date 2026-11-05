-- ============================================================================
-- Fichaje con selfie + (QR o ubicación)
-- ============================================================================
-- Paso 1 de 2 — SOLO suma: columnas nuevas (nullable), un bucket privado y una
-- función nueva. No modifica ni borra datos existentes, y el fichaje actual
-- sigue funcionando igual hasta que se aplique el paso 2
-- (20261106110000_fichaje_exigir_evidencia.sql).
--
--   branches        + latitude / longitude / checkin_radius_m (radio, 150 m)
--   work_sessions   + método, selfie y ubicación de la entrada y de la salida
--   storage         + bucket privado "fichaje-selfies" (solo no-profesionales leen)
--   fichar_con_evidencia() — valida presencia (QR del día o distancia a la
--                    sucursal) y guarda la jornada con su evidencia, del lado
--                    del servidor.
--
-- Reversión (todo es aditivo):
--   drop function public.fichar_con_evidencia(...);
--   alter table public.work_sessions drop column <las columnas nuevas>;
--   alter table public.branches drop column latitude, longitude, checkin_radius_m;
--   delete from storage.buckets where id = 'fichaje-selfies';  (vacío)
-- ============================================================================

-- ── 1. Ubicación de la sucursal ─────────────────────────────────────────────
alter table public.branches
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists checkin_radius_m integer not null default 150;

-- ── 2. Evidencia del fichaje ────────────────────────────────────────────────
alter table public.work_sessions
  add column if not exists clock_in_method text,
  add column if not exists clock_out_method text,
  add column if not exists clock_in_selfie_path text,
  add column if not exists clock_out_selfie_path text,
  add column if not exists clock_in_lat double precision,
  add column if not exists clock_in_lng double precision,
  add column if not exists clock_in_accuracy_m real,
  add column if not exists clock_out_lat double precision,
  add column if not exists clock_out_lng double precision,
  add column if not exists clock_out_accuracy_m real;

alter table public.work_sessions
  drop constraint if exists work_sessions_clock_in_method_check,
  drop constraint if exists work_sessions_clock_out_method_check;
alter table public.work_sessions
  add constraint work_sessions_clock_in_method_check
    check (clock_in_method is null or clock_in_method in ('qr', 'location', 'admin')),
  add constraint work_sessions_clock_out_method_check
    check (clock_out_method is null or clock_out_method in ('qr', 'location', 'admin'));

-- ── 3. Bucket privado para las selfies ──────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('fichaje-selfies', 'fichaje-selfies', false)
on conflict (id) do nothing;

-- Ruta: <business_id>/<employee_id>/<archivo>. Cualquier miembro del negocio
-- puede subir a la carpeta de SU negocio; leer, solo quien no es profesional.
drop policy if exists fichaje_selfies_insert on storage.objects;
create policy fichaje_selfies_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fichaje-selfies'
    and (storage.foldername(name))[1] = (select p.business_id::text from public.profiles p where p.id = auth.uid())
  );

drop policy if exists fichaje_selfies_select on storage.objects;
create policy fichaje_selfies_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fichaje-selfies'
    and (storage.foldername(name))[1] = (select p.business_id::text from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  );

-- ── 4. Fichar con evidencia (servidor) ──────────────────────────────────────
create or replace function public.fichar_con_evidencia(
  p_action            text,              -- 'in' | 'out'
  p_branch_id         uuid,
  p_employee_id       uuid,
  p_method            text,              -- 'qr' | 'location'
  p_code              text,              -- código del día (método qr)
  p_lat               double precision,  -- ubicación del celular (método location)
  p_lng               double precision,
  p_accuracy_m        real,
  p_selfie_path       text,
  p_expected_start_at timestamptz,       -- solo entrada, igual que antes (lo calcula la app)
  p_late_minutes      integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid         uuid := auth.uid();
  v_business    uuid;
  v_branch      record;
  v_today       date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_day_start   timestamptz := date_trunc('day', now() at time zone 'America/Argentina/Buenos_Aires') at time zone 'America/Argentina/Buenos_Aires';
  v_dist        double precision;
  v_session     uuid;
  v_ok_code     boolean;
begin
  if v_uid is null then
    raise exception 'Sesión inválida';
  end if;
  if p_action not in ('in', 'out') then
    raise exception 'Acción de fichaje inválida';
  end if;
  if p_method not in ('qr', 'location') then
    raise exception 'Método de fichaje inválido';
  end if;

  select p.business_id into v_business from public.profiles p where p.id = v_uid;
  if v_business is null then
    raise exception 'Tu usuario no pertenece a ningún negocio';
  end if;

  select b.id, b.business_id, b.latitude, b.longitude, b.checkin_radius_m
    into v_branch
    from public.branches b
   where b.id = p_branch_id and b.business_id = v_business;
  if not found then
    raise exception 'Sucursal inválida';
  end if;

  -- Solo el propio profesional puede fichar por esta vía.
  if not exists (
    select 1
      from public.employees e
     where e.id = p_employee_id
       and e.business_id = v_business
       and (
         exists (select 1 from public.profiles p where p.id = v_uid and p.employee_id = e.id)
         or exists (select 1 from public.team_members tm where tm.auth_user_id = v_uid and tm.professional_id = e.id)
       )
  ) then
    raise exception 'No podés fichar por otra persona';
  end if;

  if p_selfie_path is null
     or p_selfie_path not like v_business::text || '/' || p_employee_id::text || '/%' then
    raise exception 'Falta la selfie del fichaje';
  end if;

  -- Presencia: QR del día o ubicación dentro del radio de la sucursal.
  if p_method = 'qr' then
    select exists (
      select 1 from public.branch_checkin_codes c
       where c.branch_id = p_branch_id
         and c.date = v_today
         and upper(c.code) = upper(coalesce(p_code, ''))
    ) into v_ok_code;
    if not v_ok_code then
      raise exception 'Ese código ya no es válido. Pedí el código de hoy en Inicio.';
    end if;
  else
    if v_branch.latitude is null or v_branch.longitude is null then
      raise exception 'Esta sucursal todavía no tiene su ubicación cargada. Usá el QR o pedile al administrador que la configure.';
    end if;
    if p_lat is null or p_lng is null or p_accuracy_m is null then
      raise exception 'No se pudo leer tu ubicación';
    end if;
    if p_accuracy_m > 150 then
      raise exception 'Tu ubicación es muy imprecisa. Probá afuera o usá el QR.';
    end if;
    v_dist := 2 * 6371000 * asin(sqrt(
      power(sin(radians(p_lat - v_branch.latitude) / 2), 2)
      + cos(radians(v_branch.latitude)) * cos(radians(p_lat))
        * power(sin(radians(p_lng - v_branch.longitude) / 2), 2)
    ));
    if v_dist > v_branch.checkin_radius_m then
      raise exception 'Tenés que estar en el local para fichar. Estás a % m.', round(v_dist);
    end if;
  end if;

  -- Marca la transacción para que el trigger de exigir evidencia (paso 2) la deje pasar.
  perform set_config('app.fichaje_evidencia', '1', true);

  if p_action = 'in' then
    if exists (
      select 1 from public.work_sessions s
       where s.employee_id = p_employee_id and s.clock_out_at is null and s.clock_in_at >= v_day_start
    ) then
      raise exception 'Ya tenés una jornada abierta';
    end if;
    insert into public.work_sessions (
      business_id, branch_id, employee_id, clock_in_at, expected_start_at, late_minutes, source,
      clock_in_method, clock_in_selfie_path, clock_in_lat, clock_in_lng, clock_in_accuracy_m
    ) values (
      v_business, p_branch_id, p_employee_id, now(), p_expected_start_at, greatest(coalesce(p_late_minutes, 0), 0), 'kiosk',
      p_method, p_selfie_path, p_lat, p_lng, p_accuracy_m
    ) returning id into v_session;
  else
    update public.work_sessions s
       set clock_out_at = now(),
           clock_out_method = p_method,
           clock_out_selfie_path = p_selfie_path,
           clock_out_lat = p_lat,
           clock_out_lng = p_lng,
           clock_out_accuracy_m = p_accuracy_m
     where s.id = (
       select s2.id from public.work_sessions s2
        where s2.employee_id = p_employee_id and s2.clock_out_at is null and s2.clock_in_at >= v_day_start
        order by s2.clock_in_at desc limit 1
     )
    returning s.id into v_session;
    if v_session is null then
      raise exception 'No se encontró la jornada abierta';
    end if;
  end if;

  return v_session;
end;
$$;

revoke all on function public.fichar_con_evidencia(text, uuid, uuid, text, text, double precision, double precision, real, text, timestamptz, integer) from public;
grant execute on function public.fichar_con_evidencia(text, uuid, uuid, text, text, double precision, double precision, real, text, timestamptz, integer) to authenticated;
