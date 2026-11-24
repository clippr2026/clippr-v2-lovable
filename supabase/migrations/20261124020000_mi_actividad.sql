-- "Mi actividad" del profesional: todo lo recibido, enviado y aceptado en un solo lugar.
--
-- my_activity(): una fila por cada invitación recibida, postulación u pedido de alquiler del profesional, con el
-- perfil del local, el motivo (Oferta laboral / Alquiler de puesto / Invitación profesional) y el estado:
--   recibida : un local lo invitó y todavía no respondió (join_requests 'invited').
--   enviada  : él pidió y espera respuesta (join_requests 'pending' iniciada por él; rental_requests 'pending').
--   contacto : alguna de las partes aceptó (join_requests 'pending' iniciada por el local = aceptó la invitación, o
--              'accepted'; rental_requests 'accepted'). Solo en este estado se entrega el WhatsApp e Instagram del local.
-- Aceptar no confirma contratación ni alquiler: solo habilita el contacto.
--
-- cancel_my_request(): el profesional cancela una solicitud suya que sigue pendiente (borra esa fila).
--
-- Solo agrega dos funciones; no toca tablas ni datos. Reversión:
--   drop function public.my_activity();
--   drop function public.cancel_my_request(text, uuid);

create or replace function public.my_activity()
returns table (
  id uuid, source text, motive text, state text, posting_title text, created_at timestamptz,
  slug text, name text, logo_url text, cover_url text, address text,
  business_start_date date, reviews_avg numeric, reviews_count integer, hours jsonb,
  whatsapp text, instagram text
)
language sql
stable
security definer
set search_path = public
as $$
  with acts as (
    select r.id, 'join'::text as source,
           case when r.initiated_by = 'business' then 'invitacion' else 'oferta' end as motive,
           case
             when r.status = 'invited' then 'recibida'
             when r.status = 'accepted' then 'contacto'
             when r.status = 'pending' and r.initiated_by = 'business' then 'contacto'
             else 'enviada'
           end as state,
           null::text as posting_title, r.created_at, r.business_id
    from public.join_requests r
    where r.user_id = auth.uid() and r.status in ('invited', 'pending', 'accepted')
    union all
    select q.id, 'rental', 'alquiler',
           case when q.status = 'accepted' then 'contacto' else 'enviada' end,
           jp.title, q.created_at, q.business_id
    from public.rental_requests q
    join public.job_postings jp on jp.id = q.posting_id
    where q.user_id = auth.uid() and q.status in ('pending', 'accepted')
  )
  select a.id, a.source, a.motive, a.state, a.posting_title, a.created_at,
         b.slug, b.name,
         coalesce(nullif(trim(b.logo_url), ''), nullif(trim(b.avatar_url), '')),
         nullif(trim(b.cover_url), ''), nullif(trim(b.address), ''),
         b.business_start_date, rv.avg_rating, coalesce(rv.cnt, 0)::integer,
         (
           select jsonb_object_agg(d, jsonb_build_object('s', bs.schedule -> d ->> 'start', 'e', bs.schedule -> d ->> 'end'))
           from public.business_settings bs
           cross join unnest(array['mon','tue','wed','thu','fri','sat','sun']) as d
           where bs.business_id = b.id and coalesce((bs.schedule -> d ->> 'enabled')::boolean, false)
         ),
         case when a.state = 'contacto' then nullif(trim(b.phone), '') end,
         case when a.state = 'contacto' then nullif(trim(b.instagram), '') end
  from acts a
  join public.businesses b on b.id = a.business_id
  left join lateral (
    select round(avg(rw.rating), 1) as avg_rating, count(*) as cnt
    from public.reviews rw where rw.business_id = b.id and rw.status = 'published'
  ) rv on true
  order by a.created_at desc
$$;

revoke all on function public.my_activity() from public;
grant execute on function public.my_activity() to authenticated;

create or replace function public.cancel_my_request(p_source text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_source = 'join' then
    delete from public.join_requests
      where id = p_id and user_id = auth.uid() and initiated_by = 'professional' and status = 'pending';
  elsif p_source = 'rental' then
    delete from public.rental_requests where id = p_id and user_id = auth.uid() and status = 'pending';
  else
    raise exception 'accion_invalida';
  end if;
  if not found then raise exception 'solicitud_invalida'; end if;
end;
$$;

revoke all on function public.cancel_my_request(text, uuid) from public;
grant execute on function public.cancel_my_request(text, uuid) to authenticated;

-- Referencias del profesional para el negocio: ahora también cuando el profesional aceptó una invitación del
-- negocio (join_requests 'pending' iniciada por el negocio) o cuando el negocio aceptó un pedido de alquiler.
-- Siempre exige que ambas partes hayan aceptado. Reversión: volver a la versión de 20261124010000.
create or replace function public.accepted_pro_references(p_business uuid, p_user uuid)
returns table (id uuid, place_name text, locality text, from_date date, to_date date, instagram text, whatsapp text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.bolsa_is_admin(p_business) then raise exception 'sin_permiso'; end if;
  if not (
    exists (
      select 1 from public.join_requests j
      where j.business_id = p_business and j.user_id = p_user
        and (j.status = 'accepted' or (j.status = 'pending' and j.initiated_by = 'business'))
    )
    or exists (
      select 1 from public.rental_requests q
      where q.business_id = p_business and q.user_id = p_user and q.status = 'accepted'
    )
  ) then
    return;
  end if;
  return query
    select r.id, r.place_name, r.locality, r.from_date, r.to_date, r.instagram, r.whatsapp
    from public.professional_references r
    where r.user_id = p_user
    order by r.from_date desc nulls last, r.created_at desc;
end;
$$;
