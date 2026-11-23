-- Avisos de la bolsa: estrellas de la barbería (etapa 12).
--
-- public_job_postings() devuelve además reviews_avg y reviews_count: el puntaje promedio y la cantidad de
-- reseñas PUBLICADAS del negocio (las mismas que ya se ven en su página de reservas). Solo reemplaza una función
-- de lectura; no toca tablas ni datos.
-- Reversión: restaurar la función de 20261123130000_avisos_logo_portada.sql.

drop function if exists public.public_job_postings();
create function public.public_job_postings()
returns table (
  id uuid, business_name text, title text, zone text, job_type text, description text, created_at timestamptz,
  contact text, kind text, price text, request_status text, schedule text, instagram text, address text,
  logo_url text, cover_url text, reviews_avg numeric, reviews_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select jp.id, jp.business_name, jp.title, coalesce(nullif(trim(b.address), ''), jp.zone), jp.job_type,
         jp.description, jp.created_at, coalesce(nullif(trim(b.phone), ''), jp.contact), jp.kind, jp.price,
         (select r.status from public.join_requests r where auth.uid() is not null and r.business_id = jp.business_id and r.user_id = auth.uid()),
         jp.schedule, nullif(trim(b.instagram), ''), nullif(trim(b.address), ''),
         coalesce(nullif(trim(b.logo_url), ''), nullif(trim(b.avatar_url), '')), nullif(trim(b.cover_url), ''),
         rv.avg_rating, coalesce(rv.cnt, 0)::integer
  from public.job_postings jp
  join public.businesses b on b.id = jp.business_id
  left join lateral (
    select round(avg(rw.rating), 1) as avg_rating, count(*) as cnt
    from public.reviews rw
    where rw.business_id = jp.business_id and rw.status = 'published'
  ) rv on true
  where jp.is_active
  order by jp.created_at desc
  limit 200
$$;

revoke all on function public.public_job_postings() from public;
grant execute on function public.public_job_postings() to anon, authenticated;
