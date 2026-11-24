-- Pedidos de alquiler de puesto con el mismo perfil que una postulación.
--
-- business_rental_requests() ahora también devuelve nacionalidad, fecha de nacimiento, especialidades, "Sobre mí" y
-- fotos de trabajos de quien pidió el puesto, para mostrar la misma tarjeta que en "Quiere trabajar". Mismo permiso
-- (solo administradores del negocio) y mismo filtro que antes. No toca datos.
-- Reversión: borrar y recrear la función con la definición de 20261123180000_solicitudes_alquiler.sql.

drop function if exists public.business_rental_requests(uuid);
create function public.business_rental_requests(p_business uuid)
returns table (
  id uuid, posting_title text, status text, created_at timestamptz, user_id uuid, full_name text, avatar_url text,
  zone text, experience_since date, instagram text, whatsapp text, reviews_count integer, reviews_avg numeric,
  nationality text, birth_date date, specialties text[], bio text, photos text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.bolsa_is_admin(p_business) then raise exception 'sin_permiso'; end if;
  return query
    select r.id, jp.title, r.status, r.created_at, r.user_id, pp.full_name, pp.avatar_url,
           pp.zone, pp.experience_since, pp.instagram, pr.whatsapp,
           coalesce(rv.cnt, 0)::integer, rv.avg_rating,
           pp.nationality, pr.birth_date, pp.specialties, pp.bio, pp.photos
    from public.rental_requests r
    join public.job_postings jp on jp.id = r.posting_id
    join public.professional_profiles pp on pp.user_id = r.user_id
    left join public.professional_private pr on pr.user_id = r.user_id
    left join lateral (
      select count(*) as cnt, round(avg(rw.rating), 1) as avg_rating
      from public.reviews rw join public.employees e on e.id = rw.professional_id
      where e.user_id = r.user_id and rw.status = 'published'
    ) rv on true
    where r.business_id = p_business and r.status in ('pending', 'accepted')
    order by r.created_at desc;
end;
$$;

revoke all on function public.business_rental_requests(uuid) from public;
grant execute on function public.business_rental_requests(uuid) to authenticated;
