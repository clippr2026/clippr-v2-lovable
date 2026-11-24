-- Los profesionales que bloquearon a un local dejan de aparecerle en la lista pública "Profesionales".
--
-- public_bolsa_profiles() (la lista de la bolsa pública) ahora omite a quien bloqueó algún negocio del cual la persona
-- que mira es administradora. Misma firma y mismas columnas que antes; solo suma la condición. Para quien no está
-- iniciado en sesión o no administra ningún negocio, no cambia nada. No toca datos.
-- Reversión: volver a la versión de 20261123100000_bolsa_alquileres.sql de public_bolsa_profiles.

create or replace function public.public_bolsa_profiles()
returns table (
  user_id uuid, full_name text, avatar_url text, zone text, experience_since date, specialties text[], bio text,
  instagram text, nationality text, photos text[], reviews_count integer, reviews_avg numeric, whatsapp text
)
language sql
stable
security definer
set search_path = public
as $$
  select case when auth.uid() is not null then pp.user_id end,
         pp.full_name, pp.avatar_url, pp.zone, pp.experience_since, pp.specialties, pp.bio,
         pp.instagram, pp.nationality, pp.photos,
         coalesce(rv.cnt, 0)::integer, rv.avg_rating, pr.whatsapp
  from public.professional_profiles pp
  left join public.professional_private pr on pr.user_id = pp.user_id
  left join lateral (
    select count(*) as cnt, round(avg(rw.rating), 1) as avg_rating
    from public.reviews rw
    join public.employees e on e.id = rw.professional_id
    where e.user_id = pp.user_id and rw.status = 'published'
  ) rv on true
  where pp.is_listed
    and not exists (
      select 1 from public.professional_blocks k
      where k.user_id = pp.user_id and public.bolsa_is_admin(k.business_id)
    )
  order by pp.updated_at desc
  limit 200
$$;
