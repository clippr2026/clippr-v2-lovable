-- Unirse a un negocio con un código (bolsa de trabajo, etapa 4).
--
-- · Cada negocio tiene un código corto (businesses.join_code) que se muestra en Equipo y se puede
--   regenerar. El profesional lo escribe y se crea una solicitud pendiente.
-- · El negocio ve las solicitudes con el perfil público de la persona y puede aceptar (se hace desde
--   el alta de barbero de siempre, que luego llama a link_join_request), eliminar o bloquear.
-- · Ninguna tabla se modifica por escritura directa: todo pasa por funciones SECURITY DEFINER que
--   validan quién llama. El negocio ve el WhatsApp, la fecha de nacimiento y las reseñas de quien pidió
--   unirse (la persona los carga sabiendo que se comparten con las barberías a las que se postula);
--   nadie más puede leerlos.
-- · employees.user_id ata a cada barbero con la cuenta de la persona: así sus reseñas y su perfil la
--   siguen aunque se desvincule.
-- · professional_profiles.is_listed: la persona decide si su perfil aparece en la bolsa de trabajo.
--
-- Cambios sobre tablas existentes: columnas NUEVAS y NULLABLE (businesses.join_code,
-- employees.user_id, professional_profiles.is_listed). No se toca ningún dato existente salvo cargar
-- el código de los negocios actuales.
--
-- Reversión: ver el final del archivo.

create or replace function public.gen_join_code()
returns text
language sql
volatile
as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 6)
$$;

alter table public.businesses add column join_code text;
update public.businesses set join_code = public.gen_join_code() where join_code is null;
alter table public.businesses alter column join_code set default public.gen_join_code();
create unique index businesses_join_code_key on public.businesses (join_code);

alter table public.employees add column user_id uuid references auth.users(id) on delete set null;
create index employees_user_id_idx on public.employees (user_id) where user_id is not null;

alter table public.professional_profiles add column is_listed boolean not null default false;

create table public.join_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  initiated_by text not null check (initiated_by in ('professional', 'business')),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'blocked', 'unlinked')),
  employee_id uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (business_id, user_id)
);

create index join_requests_business_idx on public.join_requests (business_id, status);

alter table public.join_requests enable row level security;

-- Cada persona ve solo sus solicitudes. Los negocios las leen mediante business_join_requests().
create policy "join_requests_select_own"
  on public.join_requests for select to authenticated
  using (user_id = auth.uid());

grant select on public.join_requests to authenticated;

-- ¿Quien llama administra este negocio?
create or replace function public.bolsa_is_admin(p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.business_id = p_business
      and coalesce(p.role, 'owner') in ('owner', 'admin_general', 'admin_local', 'socio')
  )
$$;

-- Profesional: pide unirse con el código de un negocio.
create or replace function public.request_join_by_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_biz record;
  v_req record;
begin
  if v_uid is null then raise exception 'no_autenticado'; end if;
  if not exists (select 1 from public.professional_profiles where user_id = v_uid) then
    raise exception 'perfil_incompleto';
  end if;

  select id, name into v_biz from public.businesses where join_code = upper(trim(p_code));
  -- Código inexistente: mismo mensaje que un bloqueo, para no revelar nada.
  if v_biz.id is null then raise exception 'codigo_invalido'; end if;

  select * into v_req from public.join_requests where business_id = v_biz.id and user_id = v_uid;
  if found then
    if v_req.status = 'blocked' then raise exception 'codigo_invalido'; end if;
    if v_req.status = 'accepted' then raise exception 'ya_sos_parte'; end if;
    if v_req.status = 'pending' then
      return jsonb_build_object('business_name', v_biz.name, 'status', 'pending');
    end if;
    update public.join_requests
      set status = 'pending', initiated_by = 'professional', decided_at = null, employee_id = null, created_at = now()
      where id = v_req.id;
  else
    insert into public.join_requests (business_id, user_id, initiated_by) values (v_biz.id, v_uid, 'professional');
  end if;
  return jsonb_build_object('business_name', v_biz.name, 'status', 'pending');
end;
$$;

-- Profesional: sus solicitudes (con el nombre del negocio, que él no puede leer directamente).
create or replace function public.my_join_requests()
returns table (id uuid, business_name text, initiated_by text, status text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, b.name, r.initiated_by, r.status, r.created_at
  from public.join_requests r
  join public.businesses b on b.id = r.business_id
  where r.user_id = auth.uid() and r.status <> 'blocked'
  order by r.created_at desc
$$;

-- Negocio: solicitudes pendientes con el perfil público de cada persona.
create or replace function public.business_join_requests(p_business uuid)
returns table (
  id uuid, user_id uuid, initiated_by text, status text, created_at timestamptz,
  full_name text, avatar_url text, zone text, experience_since date, specialties text[],
  bio text, instagram text, nationality text, photos text[],
  whatsapp text, birth_date date, reviews_count integer, reviews_avg numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.bolsa_is_admin(p_business) then raise exception 'sin_permiso'; end if;
  return query
    select r.id, r.user_id, r.initiated_by, r.status, r.created_at,
           pp.full_name, pp.avatar_url, pp.zone, pp.experience_since, pp.specialties,
           pp.bio, pp.instagram, pp.nationality, pp.photos,
           pr.whatsapp, pr.birth_date,
           coalesce(rv.cnt, 0)::integer, rv.avg_rating
    from public.join_requests r
    join public.professional_profiles pp on pp.user_id = r.user_id
    left join public.professional_private pr on pr.user_id = r.user_id
    left join lateral (
      select count(*) as cnt, round(avg(rw.rating), 1) as avg_rating
      from public.reviews rw
      join public.employees e on e.id = rw.professional_id
      where e.user_id = r.user_id and rw.status = 'published'
    ) rv on true
    where r.business_id = p_business and r.status in ('pending', 'blocked')
    order by r.created_at desc;
end;
$$;

-- Profesional: promedio y cantidad de sus reseñas publicadas, de todas las barberías donde trabajó.
create or replace function public.my_review_stats()
returns table (reviews_count integer, reviews_avg numeric)
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer, round(avg(rw.rating), 1)
  from public.reviews rw
  join public.employees e on e.id = rw.professional_id
  where e.user_id = auth.uid() and rw.status = 'published'
$$;

-- Negocio: rechazar o bloquear una solicitud.
create or replace function public.decide_join_request(p_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
begin
  select * into v_req from public.join_requests where id = p_id;
  if not found or not public.bolsa_is_admin(v_req.business_id) then raise exception 'sin_permiso'; end if;
  if p_action = 'reject' then
    update public.join_requests set status = 'rejected', decided_at = now() where id = p_id;
  elsif p_action = 'block' then
    update public.join_requests set status = 'blocked', decided_at = now() where id = p_id;
  elsif p_action = 'unblock' then
    update public.join_requests set status = 'rejected', decided_at = now() where id = p_id and status = 'blocked';
  else
    raise exception 'accion_invalida';
  end if;
end;
$$;

-- Negocio: la solicitud se aceptó y el barbero ya fue creado; los ata.
create or replace function public.link_join_request(p_id uuid, p_employee uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
begin
  select * into v_req from public.join_requests where id = p_id;
  if not found or not public.bolsa_is_admin(v_req.business_id) then raise exception 'sin_permiso'; end if;
  if not exists (select 1 from public.employees where id = p_employee and business_id = v_req.business_id) then
    raise exception 'empleado_invalido';
  end if;
  update public.employees set user_id = v_req.user_id where id = p_employee;
  update public.join_requests set status = 'accepted', employee_id = p_employee, decided_at = now() where id = p_id;
end;
$$;

-- Negocio: desvincula a un barbero. Su perfil, su cuenta y sus reseñas se conservan en la persona.
create or replace function public.unlink_join_request(p_employee uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_biz uuid;
begin
  select business_id into v_biz from public.employees where id = p_employee;
  if v_biz is null or not public.bolsa_is_admin(v_biz) then raise exception 'sin_permiso'; end if;
  update public.join_requests set status = 'unlinked', decided_at = now()
    where employee_id = p_employee and business_id = v_biz and status = 'accepted';
end;
$$;

-- Negocio: WhatsApp y fecha de nacimiento de una persona, solo si ya la aceptó.
create or replace function public.accepted_pro_private(p_business uuid, p_user uuid)
returns table (whatsapp text, birth_date date)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.bolsa_is_admin(p_business) then raise exception 'sin_permiso'; end if;
  if not exists (
    select 1 from public.join_requests where business_id = p_business and user_id = p_user and status = 'accepted'
  ) then
    return;
  end if;
  return query select pr.whatsapp, pr.birth_date from public.professional_private pr where pr.user_id = p_user;
end;
$$;

-- Negocio: correo de quien pidió unirse, para crear su acceso al aceptar (solo administradores del negocio).
create or replace function public.join_request_email(p_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_req record;
  v_email text;
begin
  select * into v_req from public.join_requests where id = p_id;
  if not found or not public.bolsa_is_admin(v_req.business_id) then raise exception 'sin_permiso'; end if;
  select u.email into v_email from auth.users u where u.id = v_req.user_id;
  return v_email;
end;
$$;

-- Negocio: código actual y regeneración.
create or replace function public.regenerate_join_code(p_business uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if not public.bolsa_is_admin(p_business) then raise exception 'sin_permiso'; end if;
  loop
    v_code := public.gen_join_code();
    begin
      update public.businesses set join_code = v_code where id = p_business;
      return v_code;
    exception when unique_violation then
      null;
    end;
  end loop;
end;
$$;

revoke all on function public.bolsa_is_admin(uuid) from public;
revoke all on function public.request_join_by_code(text) from public;
revoke all on function public.my_join_requests() from public;
revoke all on function public.my_review_stats() from public;
revoke all on function public.business_join_requests(uuid) from public;
revoke all on function public.decide_join_request(uuid, text) from public;
revoke all on function public.link_join_request(uuid, uuid) from public;
revoke all on function public.unlink_join_request(uuid) from public;
revoke all on function public.accepted_pro_private(uuid, uuid) from public;
revoke all on function public.regenerate_join_code(uuid) from public;
revoke all on function public.join_request_email(uuid) from public;
grant execute on function public.bolsa_is_admin(uuid) to authenticated;
grant execute on function public.request_join_by_code(text) to authenticated;
grant execute on function public.my_join_requests() to authenticated;
grant execute on function public.my_review_stats() to authenticated;
grant execute on function public.business_join_requests(uuid) to authenticated;
grant execute on function public.decide_join_request(uuid, text) to authenticated;
grant execute on function public.link_join_request(uuid, uuid) to authenticated;
grant execute on function public.unlink_join_request(uuid) to authenticated;
grant execute on function public.accepted_pro_private(uuid, uuid) to authenticated;
grant execute on function public.regenerate_join_code(uuid) to authenticated;
grant execute on function public.join_request_email(uuid) to authenticated;

-- Reversión:
--   drop function public.my_review_stats(), public.join_request_email(uuid), public.regenerate_join_code(uuid), public.accepted_pro_private(uuid, uuid),
--     public.unlink_join_request(uuid), public.link_join_request(uuid, uuid),
--     public.decide_join_request(uuid, text), public.business_join_requests(uuid),
--     public.my_join_requests(), public.request_join_by_code(text), public.bolsa_is_admin(uuid),
--     public.gen_join_code();
--   drop table public.join_requests;
--   alter table public.professional_profiles drop column is_listed;
--   alter table public.employees drop column user_id;
--   alter table public.businesses alter column join_code drop default;
--   drop index public.businesses_join_code_key; alter table public.businesses drop column join_code;
