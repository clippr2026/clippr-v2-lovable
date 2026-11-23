-- Postulaciones con filtros (etapa 10): el negocio también ve a quienes ya aceptó.
--
-- business_join_requests() devolvía solo pendientes, bloqueadas y enviadas ('pending', 'blocked', 'invited').
-- Ahora suma las aceptadas ('accepted'), para el filtro "Aceptadas". Todo lo demás queda igual: el WhatsApp y
-- la fecha de nacimiento siguen sin mostrarse mientras la solicitud está solo enviada.
--
-- Solo reemplaza una función, no toca tablas ni datos.
-- Reversión: restaurar la función de 20261123070000_bolsa_invites.sql.

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
    where r.business_id = p_business and r.status in ('pending', 'blocked', 'invited', 'accepted')
    order by r.created_at desc;
end;
$$;

revoke all on function public.business_join_requests(uuid) from public;
grant execute on function public.business_join_requests(uuid) to authenticated;
