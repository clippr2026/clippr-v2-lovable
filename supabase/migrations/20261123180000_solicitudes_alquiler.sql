-- Solicitudes de alquiler de puesto (etapa 16).
--
-- Quien ve un aviso de "Alquilo un puesto" puede enviar una solicitud al local (antes solo abría WhatsApp). El local
-- la ve en Configuración → Bolsa de trabajo → Postulaciones y la acepta o rechaza. Es una tabla aparte de
-- join_requests porque alquilar un puesto no es sumarse al equipo.
--
-- · rental_requests: una fila por aviso y persona. Solo se escribe mediante funciones que validan quién llama.
-- · El WhatsApp de la persona se entrega al local junto con la solicitud (la persona lo cargó sabiendo que se
--   comparte con quien contacta). Fecha de nacimiento y correo no se entregan.
-- · public_job_postings() pasa a informar el estado de la solicitud de alquiler del que consulta.
--
-- Tabla nueva y funciones; no toca datos existentes.
-- Reversión: restaurar public_job_postings de 20261123150000; drop function public.apply_to_rental(uuid),
--   public.business_rental_requests(uuid), public.decide_rental_request(uuid, text); drop table public.rental_requests;

create table public.rental_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  posting_id uuid not null references public.job_postings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (posting_id, user_id)
);
create index rental_requests_business_idx on public.rental_requests (business_id, status);
alter table public.rental_requests enable row level security;
create policy "rental_requests_select_own" on public.rental_requests for select to authenticated using (user_id = auth.uid());
grant select on public.rental_requests to authenticated;

create or replace function public.apply_to_rental(p_posting uuid)
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
  if not exists (select 1 from public.professional_profiles where user_id = v_uid) then raise exception 'perfil_incompleto'; end if;
  select business_id into v_biz from public.job_postings where id = p_posting and is_active and kind = 'alquiler';
  if v_biz is null then raise exception 'aviso_invalido'; end if;
  select * into v_req from public.rental_requests where posting_id = p_posting and user_id = v_uid;
  if found then
    if v_req.status in ('pending', 'accepted') then return; end if;
    update public.rental_requests set status = 'pending', decided_at = null, created_at = now() where id = v_req.id;
  else
    insert into public.rental_requests (business_id, posting_id, user_id) values (v_biz, p_posting, v_uid);
  end if;
end;
$$;

create or replace function public.business_rental_requests(p_business uuid)
returns table (
  id uuid, posting_title text, status text, created_at timestamptz, user_id uuid, full_name text, avatar_url text,
  zone text, experience_since date, instagram text, whatsapp text, reviews_count integer, reviews_avg numeric
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
           coalesce(rv.cnt, 0)::integer, rv.avg_rating
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

create or replace function public.decide_rental_request(p_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
begin
  select * into v_req from public.rental_requests where id = p_id;
  if not found or not public.bolsa_is_admin(v_req.business_id) then raise exception 'sin_permiso'; end if;
  if p_action = 'accept' then
    update public.rental_requests set status = 'accepted', decided_at = now() where id = p_id;
  elsif p_action = 'reject' then
    update public.rental_requests set status = 'rejected', decided_at = now() where id = p_id;
  else
    raise exception 'accion_invalida';
  end if;
end;
$$;

drop function if exists public.public_job_postings();
create function public.public_job_postings()
returns table (
  id uuid, business_name text, title text, zone text, job_type text, description text, created_at timestamptz,
  contact text, kind text, price text, request_status text, schedule text, instagram text, address text,
  logo_url text, cover_url text, reviews_avg numeric, reviews_count integer, business_start_date date
)
language sql
stable
security definer
set search_path = public
as $$
  select jp.id, jp.business_name, jp.title, coalesce(nullif(trim(b.address), ''), jp.zone), jp.job_type,
         jp.description, jp.created_at, coalesce(nullif(trim(b.phone), ''), jp.contact), jp.kind, jp.price,
         case when jp.kind = 'alquiler'
           then (select r.status from public.rental_requests r where auth.uid() is not null and r.posting_id = jp.id and r.user_id = auth.uid())
           else (select r.status from public.join_requests r where auth.uid() is not null and r.business_id = jp.business_id and r.user_id = auth.uid())
         end,
         jp.schedule, nullif(trim(b.instagram), ''), nullif(trim(b.address), ''),
         coalesce(nullif(trim(b.logo_url), ''), nullif(trim(b.avatar_url), '')), nullif(trim(b.cover_url), ''),
         rv.avg_rating, coalesce(rv.cnt, 0)::integer, b.business_start_date
  from public.job_postings jp
  join public.businesses b on b.id = jp.business_id
  left join lateral (
    select round(avg(rw.rating), 1) as avg_rating, count(*) as cnt
    from public.reviews rw where rw.business_id = jp.business_id and rw.status = 'published'
  ) rv on true
  where jp.is_active
  order by jp.created_at desc
  limit 200
$$;

revoke all on function public.apply_to_rental(uuid) from public;
revoke all on function public.business_rental_requests(uuid) from public;
revoke all on function public.decide_rental_request(uuid, text) from public;
revoke all on function public.public_job_postings() from public;
grant execute on function public.apply_to_rental(uuid) to authenticated;
grant execute on function public.business_rental_requests(uuid) to authenticated;
grant execute on function public.decide_rental_request(uuid, text) to authenticated;
grant execute on function public.public_job_postings() to anon, authenticated;
