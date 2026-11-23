-- Bolsa de trabajo: alquiler de puestos de trabajo, WhatsApp visible y datos para postularse (etapa 8).
--
-- · job_postings.kind: 'empleo' (busco barbero) o 'alquiler' (alquilo un puesto/espacio de trabajo), y
--   job_postings.price (texto libre, hasta 40 caracteres, ej: "$150.000 por mes").
-- · public_job_postings() y public_bolsa_profiles() (visibles sin sesión) pasan a incluir el contacto del
--   aviso y el WhatsApp del profesional que decidió mostrar su perfil. Solo para usuarios con sesión
--   devuelven además el id y el estado de su solicitud, para postularse o solicitar desde la misma lista.
--   La fecha de nacimiento y el correo siguen privados.
-- · list_job_postings() y apply_to_posting() se limitan a avisos de empleo: un alquiler no es una postulación
--   al equipo, la persona contacta directo al dueño.
--
-- Cambios: dos columnas con valor por defecto (los avisos existentes quedan como 'empleo') y funciones
-- reemplazadas. Reversión: restaurar las funciones de 20261123070000, 20261123080000 y 20261123090000;
--   alter table public.job_postings drop column kind, drop column price;

alter table public.job_postings
  add column kind text not null default 'empleo' check (kind in ('empleo', 'alquiler')),
  add column price text check (price is null or char_length(price) <= 40);

create or replace function public.list_job_postings()
returns table (
  id uuid, business_id uuid, business_name text, title text, zone text, job_type text,
  description text, contact text, created_at timestamptz, request_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select jp.id, jp.business_id, jp.business_name, jp.title, jp.zone, jp.job_type,
         jp.description, jp.contact, jp.created_at,
         (select r.status from public.join_requests r where r.business_id = jp.business_id and r.user_id = auth.uid())
  from public.job_postings jp
  where jp.is_active and jp.kind = 'empleo' and auth.uid() is not null
  order by jp.created_at desc
$$;

create or replace function public.apply_to_posting(p_posting uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_biz uuid;
  v_req record;
begin
  if v_uid is null then raise exception 'no_autenticado'; end if;
  if not exists (select 1 from public.professional_profiles where user_id = v_uid) then
    raise exception 'perfil_incompleto';
  end if;
  select business_id into v_biz from public.job_postings where id = p_posting and is_active and kind = 'empleo';
  if v_biz is null then raise exception 'aviso_invalido'; end if;
  select * into v_req from public.join_requests where business_id = v_biz and user_id = v_uid;
  if found then
    if v_req.status = 'blocked' then raise exception 'aviso_invalido'; end if;
    if v_req.status in ('pending', 'accepted') then return; end if;
    if v_req.status = 'invited' then
      update public.join_requests set status = 'pending', decided_at = now() where id = v_req.id;
      return;
    end if;
    update public.join_requests
      set status = 'pending', initiated_by = 'professional', decided_at = null, employee_id = null, created_at = now()
      where id = v_req.id;
  else
    insert into public.join_requests (business_id, user_id, initiated_by) values (v_biz, v_uid, 'professional');
  end if;
end;
$$;

drop function if exists public.public_job_postings();
create function public.public_job_postings()
returns table (
  id uuid, business_name text, title text, zone text, job_type text, description text, created_at timestamptz,
  contact text, kind text, price text, request_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select jp.id, jp.business_name, jp.title, jp.zone, jp.job_type, jp.description, jp.created_at,
         jp.contact, jp.kind, jp.price,
         (select r.status from public.join_requests r where auth.uid() is not null and r.business_id = jp.business_id and r.user_id = auth.uid())
  from public.job_postings jp
  where jp.is_active
  order by jp.created_at desc
  limit 200
$$;

drop function if exists public.public_bolsa_profiles();
create function public.public_bolsa_profiles()
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
  order by pp.updated_at desc
  limit 200
$$;

revoke all on function public.list_job_postings() from public;
revoke all on function public.apply_to_posting(uuid) from public;
revoke all on function public.public_job_postings() from public;
revoke all on function public.public_bolsa_profiles() from public;
grant execute on function public.list_job_postings() to authenticated;
grant execute on function public.apply_to_posting(uuid) to authenticated;
grant execute on function public.public_job_postings() to anon, authenticated;
grant execute on function public.public_bolsa_profiles() to anon, authenticated;
