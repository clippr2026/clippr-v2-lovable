-- Bolsa de trabajo: el negocio busca profesionales y los solicita (etapa 5).
--
-- Una barbería ve los perfiles que cada profesional decidió mostrar (is_listed) y puede "solicitarlos".
-- La solicitud queda en estado 'invited' hasta que la persona acepta (pasa a 'pending' y entra a la lista
-- de Solicitudes del negocio, que la termina con el alta de barbero de siempre) o la rechaza.
--
-- Solo agrega funciones y un valor permitido ('invited') en la restricción de estado. No cambia datos.
-- El WhatsApp, la fecha de nacimiento y el correo siguen sin mostrarse en la bolsa: el negocio los ve
-- recién cuando la persona aceptó la solicitud.
--
-- Reversión: drop function public.list_bolsa_profiles(uuid), public.invite_professional(uuid, uuid),
--   public.respond_join_invite(uuid, boolean); restaurar business_join_requests de 20261123060000 y la
--   restricción join_requests_status_check sin 'invited'.

alter table public.join_requests drop constraint if exists join_requests_status_check;
alter table public.join_requests
  add constraint join_requests_status_check
  check (status in ('pending', 'accepted', 'rejected', 'blocked', 'unlinked', 'invited'));

-- Negocio: perfiles que decidieron mostrarse, sin los que ya tienen relación con el negocio.
create or replace function public.list_bolsa_profiles(p_business uuid)
returns table (
  user_id uuid, full_name text, avatar_url text, zone text, experience_since date, specialties text[],
  bio text, instagram text, nationality text, photos text[], reviews_count integer, reviews_avg numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.bolsa_is_admin(p_business) then raise exception 'sin_permiso'; end if;
  return query
    select pp.user_id, pp.full_name, pp.avatar_url, pp.zone, pp.experience_since, pp.specialties,
           pp.bio, pp.instagram, pp.nationality, pp.photos,
           coalesce(rv.cnt, 0)::integer, rv.avg_rating
    from public.professional_profiles pp
    left join lateral (
      select count(*) as cnt, round(avg(rw.rating), 1) as avg_rating
      from public.reviews rw
      join public.employees e on e.id = rw.professional_id
      where e.user_id = pp.user_id and rw.status = 'published'
    ) rv on true
    where pp.is_listed
      and not exists (
        select 1 from public.join_requests r
        where r.business_id = p_business and r.user_id = pp.user_id and r.status in ('invited', 'pending', 'accepted', 'blocked')
      )
    order by pp.updated_at desc;
end;
$$;

-- Negocio: solicita a un profesional de la bolsa.
create or replace function public.invite_professional(p_business uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
begin
  if not public.bolsa_is_admin(p_business) then raise exception 'sin_permiso'; end if;
  if not exists (select 1 from public.professional_profiles where user_id = p_user and is_listed) then
    raise exception 'perfil_no_disponible';
  end if;
  select * into v_req from public.join_requests where business_id = p_business and user_id = p_user;
  if found then
    if v_req.status in ('invited', 'pending') then return; end if;
    if v_req.status in ('accepted', 'blocked') then raise exception 'perfil_no_disponible'; end if;
    update public.join_requests
      set status = 'invited', initiated_by = 'business', decided_at = null, employee_id = null, created_at = now()
      where id = v_req.id;
  else
    insert into public.join_requests (business_id, user_id, initiated_by, status)
    values (p_business, p_user, 'business', 'invited');
  end if;
end;
$$;

-- Profesional: responde a una solicitud de una barbería.
create or replace function public.respond_join_invite(p_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.join_requests
    set status = case when p_accept then 'pending' else 'rejected' end, decided_at = now()
    where id = p_id and user_id = auth.uid() and status = 'invited';
  if not found then raise exception 'solicitud_invalida'; end if;
end;
$$;

-- El negocio ve también las solicitudes enviadas que esperan respuesta ('invited').
drop function if exists public.business_join_requests(uuid);
create function public.business_join_requests(p_business uuid)
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
           case when r.status = 'invited' then null else pr.whatsapp end,
           case when r.status = 'invited' then null else pr.birth_date end,
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
    where r.business_id = p_business and r.status in ('pending', 'blocked', 'invited')
    order by r.created_at desc;
end;
$$;

revoke all on function public.list_bolsa_profiles(uuid) from public;
revoke all on function public.invite_professional(uuid, uuid) from public;
revoke all on function public.respond_join_invite(uuid, boolean) from public;
revoke all on function public.business_join_requests(uuid) from public;
grant execute on function public.list_bolsa_profiles(uuid) to authenticated;
grant execute on function public.invite_professional(uuid, uuid) to authenticated;
grant execute on function public.respond_join_invite(uuid, boolean) to authenticated;
grant execute on function public.business_join_requests(uuid) to authenticated;
