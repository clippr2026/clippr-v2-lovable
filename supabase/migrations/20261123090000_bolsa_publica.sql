-- Bolsa de trabajo pública (etapa 7): cualquiera puede MIRAR, sin cuenta; publicar o solicitar exige sesión.
--
-- Dos funciones de solo lectura accesibles también para visitantes sin sesión (rol anon). Devuelven solo
-- lo que la persona o el negocio decidieron mostrar:
--   · public_job_postings(): avisos activos. NO incluye el contacto del negocio (lo ven solo usuarios con sesión).
--   · public_bolsa_profiles(): perfiles con is_listed = true. NO incluye el id de usuario, ni WhatsApp, ni
--     fecha de nacimiento, ni correo. Sí: nombre, foto, zona, años en el rubro, especialidades, "sobre mí",
--     nacionalidad, Instagram, fotos de trabajos y reseñas.
-- No cambia ninguna tabla ni dato. Reversión:
--   drop function public.public_job_postings(), public.public_bolsa_profiles();

create or replace function public.public_job_postings()
returns table (
  id uuid, business_name text, title text, zone text, job_type text, description text, created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select jp.id, jp.business_name, jp.title, jp.zone, jp.job_type, jp.description, jp.created_at
  from public.job_postings jp
  where jp.is_active
  order by jp.created_at desc
  limit 200
$$;

create or replace function public.public_bolsa_profiles()
returns table (
  full_name text, avatar_url text, zone text, experience_since date, specialties text[], bio text,
  instagram text, nationality text, photos text[], reviews_count integer, reviews_avg numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select pp.full_name, pp.avatar_url, pp.zone, pp.experience_since, pp.specialties, pp.bio,
         pp.instagram, pp.nationality, pp.photos,
         coalesce(rv.cnt, 0)::integer, rv.avg_rating
  from public.professional_profiles pp
  left join lateral (
    select count(*) as cnt, round(avg(rw.rating), 1) as avg_rating
    from public.reviews rw
    join public.employees e on e.id = rw.professional_id
    where e.user_id = pp.user_id and rw.status = 'published'
  ) rv on true
  where pp.is_listed
  order by pp.updated_at desc
  limit 200
$$;

revoke all on function public.public_job_postings() from public;
revoke all on function public.public_bolsa_profiles() from public;
grant execute on function public.public_job_postings() to anon, authenticated;
grant execute on function public.public_bolsa_profiles() to anon, authenticated;
