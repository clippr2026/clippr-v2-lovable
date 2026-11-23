-- Bolsa de trabajo: ofertas para el profesional y sus reseñas (etapa 6).
--
-- · list_job_postings(): avisos activos de las barberías, con el estado de la solicitud de quien consulta.
-- · apply_to_posting(): el profesional se postula a un aviso (crea la solicitud pendiente en el negocio).
-- · my_reviews(): las reseñas publicadas de la persona, de todas las barberías donde trabajó.
--
-- Solo agrega funciones; no toca tablas ni datos. Reversión:
--   drop function public.list_job_postings(), public.apply_to_posting(uuid), public.my_reviews();

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
  where jp.is_active and auth.uid() is not null
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
  select business_id into v_biz from public.job_postings where id = p_posting and is_active;
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

create or replace function public.my_reviews()
returns table (id uuid, client_name text, rating smallint, comment text, review_date date, business_name text)
language sql
stable
security definer
set search_path = public
as $$
  select rw.id, rw.client_name, rw.rating, rw.comment, rw.review_date, b.name
  from public.reviews rw
  join public.employees e on e.id = rw.professional_id
  join public.businesses b on b.id = rw.business_id
  where e.user_id = auth.uid() and rw.status = 'published'
  order by rw.review_date desc nulls last, rw.created_at desc
$$;

revoke all on function public.list_job_postings() from public;
revoke all on function public.apply_to_posting(uuid) from public;
revoke all on function public.my_reviews() from public;
grant execute on function public.list_job_postings() to authenticated;
grant execute on function public.apply_to_posting(uuid) to authenticated;
grant execute on function public.my_reviews() to authenticated;
