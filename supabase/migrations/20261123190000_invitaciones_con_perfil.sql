-- Invitaciones de un local a un profesional, con el perfil del local y contacto que se desbloquea (etapa 17).
--
-- my_invitations(): para el profesional, las solicitudes que le envió un local (initiated_by = 'business') con el
-- perfil del local (nombre, logo, portada, dirección, horarios, antigüedad, estrellas y su página).
-- El WhatsApp y el Instagram del local se entregan SOLO cuando el profesional aceptó (estado 'pending' o
-- 'accepted'); mientras la invitación está sin responder ('invited') vienen vacíos. El WhatsApp del profesional ya
-- se le entrega al local desde que acepta (business_join_requests). Solo agrega una función de lectura.
-- Reversión: drop function public.my_invitations();

create or replace function public.my_invitations()
returns table (
  id uuid, status text, slug text, name text, logo_url text, cover_url text, address text,
  business_start_date date, reviews_avg numeric, reviews_count integer, hours jsonb,
  whatsapp text, instagram text
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.status, b.slug, b.name,
         coalesce(nullif(trim(b.logo_url), ''), nullif(trim(b.avatar_url), '')),
         nullif(trim(b.cover_url), ''), nullif(trim(b.address), ''),
         b.business_start_date, rv.avg_rating, coalesce(rv.cnt, 0)::integer,
         (
           select jsonb_object_agg(d, jsonb_build_object('s', bs.schedule -> d ->> 'start', 'e', bs.schedule -> d ->> 'end'))
           from public.business_settings bs
           cross join unnest(array['mon','tue','wed','thu','fri','sat','sun']) as d
           where bs.business_id = b.id and coalesce((bs.schedule -> d ->> 'enabled')::boolean, false)
         ),
         case when r.status in ('pending', 'accepted') then nullif(trim(b.phone), '') end,
         case when r.status in ('pending', 'accepted') then nullif(trim(b.instagram), '') end
  from public.join_requests r
  join public.businesses b on b.id = r.business_id
  left join lateral (
    select round(avg(rw.rating), 1) as avg_rating, count(*) as cnt
    from public.reviews rw where rw.business_id = b.id and rw.status = 'published'
  ) rv on true
  where r.user_id = auth.uid() and r.initiated_by = 'business' and r.status in ('invited', 'pending', 'accepted')
  order by r.created_at desc
$$;

revoke all on function public.my_invitations() from public;
grant execute on function public.my_invitations() to authenticated;
