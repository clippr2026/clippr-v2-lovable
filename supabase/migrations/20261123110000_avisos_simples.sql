-- Avisos de la bolsa de trabajo, más simples (etapa 9).
--
-- · job_postings.schedule: el horario que busca el negocio (texto libre, hasta 80 caracteres).
-- · El WhatsApp, el Instagram y la dirección ya no se cargan en cada aviso: se toman en vivo de los datos del
--   negocio (businesses.phone, instagram y address), así siempre están al día. Los campos contact y zone del
--   aviso quedan como respaldo si el negocio no los completó.
-- · public_job_postings() y list_job_postings() devuelven schedule, instagram y address.
--
-- Cambios: una columna nueva opcional y dos funciones reemplazadas. No toca datos existentes.
-- Reversión: restaurar las funciones de 20261123100000 y 20261123080000; alter table public.job_postings drop column schedule;

alter table public.job_postings add column schedule text check (schedule is null or char_length(schedule) <= 80);

drop function if exists public.list_job_postings();
create function public.list_job_postings()
returns table (
  id uuid, business_id uuid, business_name text, title text, zone text, job_type text,
  description text, contact text, created_at timestamptz, request_status text,
  schedule text, instagram text
)
language sql
stable
security definer
set search_path = public
as $$
  select jp.id, jp.business_id, jp.business_name, jp.title,
         coalesce(nullif(trim(b.address), ''), jp.zone), jp.job_type,
         jp.description, coalesce(nullif(trim(b.phone), ''), jp.contact), jp.created_at,
         (select r.status from public.join_requests r where r.business_id = jp.business_id and r.user_id = auth.uid()),
         jp.schedule, nullif(trim(b.instagram), '')
  from public.job_postings jp
  join public.businesses b on b.id = jp.business_id
  where jp.is_active and jp.kind = 'empleo' and auth.uid() is not null
  order by jp.created_at desc
$$;

drop function if exists public.public_job_postings();
create function public.public_job_postings()
returns table (
  id uuid, business_name text, title text, zone text, job_type text, description text, created_at timestamptz,
  contact text, kind text, price text, request_status text, schedule text, instagram text, address text
)
language sql
stable
security definer
set search_path = public
as $$
  select jp.id, jp.business_name, jp.title, coalesce(nullif(trim(b.address), ''), jp.zone), jp.job_type,
         jp.description, jp.created_at, coalesce(nullif(trim(b.phone), ''), jp.contact), jp.kind, jp.price,
         (select r.status from public.join_requests r where auth.uid() is not null and r.business_id = jp.business_id and r.user_id = auth.uid()),
         jp.schedule, nullif(trim(b.instagram), ''), nullif(trim(b.address), '')
  from public.job_postings jp
  join public.businesses b on b.id = jp.business_id
  where jp.is_active
  order by jp.created_at desc
  limit 200
$$;

revoke all on function public.list_job_postings() from public;
revoke all on function public.public_job_postings() from public;
grant execute on function public.list_job_postings() to authenticated;
grant execute on function public.public_job_postings() to anon, authenticated;
