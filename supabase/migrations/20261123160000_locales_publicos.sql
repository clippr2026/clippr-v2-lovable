-- Pantalla principal pública: lista de locales de Clippr (etapa 14).
--
-- public_businesses() devuelve los negocios ACTIVOS con página de reservas (slug), para que cualquier visitante
-- los vea y reserve. Solo trae lo que el propio negocio ya muestra en su página pública: nombre, logo, portada,
-- dirección, Instagram, antigüedad y las estrellas de sus reseñas publicadas. NO incluye correo, teléfono ni
-- datos internos. Solo agrega una función de lectura; no toca tablas ni datos.
-- Reversión: drop function public.public_businesses();

create or replace function public.public_businesses()
returns table (
  slug text, name text, logo_url text, cover_url text, address text, instagram text,
  business_start_date date, reviews_avg numeric, reviews_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select b.slug, b.name,
         coalesce(nullif(trim(b.logo_url), ''), nullif(trim(b.avatar_url), '')),
         nullif(trim(b.cover_url), ''), nullif(trim(b.address), ''), nullif(trim(b.instagram), ''),
         b.business_start_date, rv.avg_rating, coalesce(rv.cnt, 0)::integer
  from public.businesses b
  left join lateral (
    select round(avg(rw.rating), 1) as avg_rating, count(*) as cnt
    from public.reviews rw
    where rw.business_id = b.id and rw.status = 'published'
  ) rv on true
  where coalesce(b.is_active, true) and nullif(trim(b.slug), '') is not null
  order by b.name
  limit 300
$$;

revoke all on function public.public_businesses() from public;
grant execute on function public.public_businesses() to anon, authenticated;
