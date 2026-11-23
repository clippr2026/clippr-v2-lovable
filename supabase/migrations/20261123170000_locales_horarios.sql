-- Pantalla principal: horario de atención de cada local (etapa 15).
--
-- public_businesses() devuelve además "hours": los días abiertos con su hora de apertura y cierre, tomados de los
-- Horarios del negocio (business_settings.schedule). Es lo que el negocio ya muestra en su página pública. Solo
-- reemplaza una función de lectura; no toca tablas ni datos.
-- Reversión: restaurar la función de 20261123160000_locales_publicos.sql.

drop function if exists public.public_businesses();
create function public.public_businesses()
returns table (
  slug text, name text, logo_url text, cover_url text, address text, instagram text,
  business_start_date date, reviews_avg numeric, reviews_count integer, hours jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select b.slug, b.name,
         coalesce(nullif(trim(b.logo_url), ''), nullif(trim(b.avatar_url), '')),
         nullif(trim(b.cover_url), ''), nullif(trim(b.address), ''), nullif(trim(b.instagram), ''),
         b.business_start_date, rv.avg_rating, coalesce(rv.cnt, 0)::integer,
         (
           select jsonb_object_agg(d, jsonb_build_object('s', bs.schedule -> d ->> 'start', 'e', bs.schedule -> d ->> 'end'))
           from public.business_settings bs
           cross join unnest(array['mon','tue','wed','thu','fri','sat','sun']) as d
           where bs.business_id = b.id and coalesce((bs.schedule -> d ->> 'enabled')::boolean, false)
         )
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
