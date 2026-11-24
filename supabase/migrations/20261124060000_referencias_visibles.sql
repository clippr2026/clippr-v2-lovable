-- Referencias laborales visibles en el perfil público y en las solicitudes recibidas.
--
-- Se ven el nombre del lugar, la localidad y desde/hasta cuándo. El WhatsApp e Instagram de cada referencia siguen
-- siendo privados: solo se entregan con accepted_pro_references cuando ambas partes aceptaron.
--
-- 1) public_bolsa_profiles() suma la columna refs (jsonb: [{n, l, f, t}]) con esas referencias sin datos de contacto.
-- 2) pro_references_preview(p_user): las mismas referencias para quien administra un negocio al que esa persona le
--    envió una solicitud (postulación, alquiler o invitación aceptada), o para cualquiera si el perfil está público.
-- No toca datos. Reversión:
--   drop function public.pro_references_preview(uuid);
--   y volver a la versión de public_bolsa_profiles de 20261124050000_ocultar_bloqueados.sql
--   (hay que borrar y recrear la función por el cambio de columnas).

drop function if exists public.public_bolsa_profiles();
create function public.public_bolsa_profiles()
returns table (
  user_id uuid, full_name text, avatar_url text, zone text, experience_since date, specialties text[], bio text,
  instagram text, nationality text, photos text[], reviews_count integer, reviews_avg numeric, whatsapp text,
  refs jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select case when auth.uid() is not null then pp.user_id end,
         pp.full_name, pp.avatar_url, pp.zone, pp.experience_since, pp.specialties, pp.bio,
         pp.instagram, pp.nationality, pp.photos,
         coalesce(rv.cnt, 0)::integer, rv.avg_rating, pr.whatsapp,
         (
           select coalesce(jsonb_agg(jsonb_build_object('n', x.place_name, 'l', x.locality, 'f', x.from_date, 't', x.to_date)
                                     order by x.from_date desc nulls last, x.created_at desc), '[]'::jsonb)
           from public.professional_references x where x.user_id = pp.user_id
         )
  from public.professional_profiles pp
  left join public.professional_private pr on pr.user_id = pp.user_id
  left join lateral (
    select count(*) as cnt, round(avg(rw.rating), 1) as avg_rating
    from public.reviews rw
    join public.employees e on e.id = rw.professional_id
    where e.user_id = pp.user_id and rw.status = 'published'
  ) rv on true
  where pp.is_listed
    and not exists (
      select 1 from public.professional_blocks k
      where k.user_id = pp.user_id and public.bolsa_is_admin(k.business_id)
    )
  order by pp.updated_at desc
  limit 200
$$;

revoke all on function public.public_bolsa_profiles() from public;
grant execute on function public.public_bolsa_profiles() to anon, authenticated;

create or replace function public.pro_references_preview(p_user uuid)
returns table (id uuid, place_name text, locality text, from_date date, to_date date)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.place_name, r.locality, r.from_date, r.to_date
  from public.professional_references r
  where r.user_id = p_user
    and (
      exists (select 1 from public.professional_profiles pp where pp.user_id = p_user and pp.is_listed)
      or exists (
        select 1 from public.join_requests j
        where j.user_id = p_user and public.bolsa_is_admin(j.business_id)
      )
      or exists (
        select 1 from public.rental_requests q
        where q.user_id = p_user and public.bolsa_is_admin(q.business_id)
      )
    )
  order by r.from_date desc nulls last, r.created_at desc
$$;

revoke all on function public.pro_references_preview(uuid) from public;
grant execute on function public.pro_references_preview(uuid) to authenticated;
