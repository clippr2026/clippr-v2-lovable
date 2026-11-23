-- Bolsa de trabajo: publicaciones de gente SIN Clippr, WhatsApp visible e insignias (etapa 8).
--
-- · external_listings: avisos o perfiles que publica cualquier persona sin cuenta (dueño que busca barbero
--   o profesional que busca trabajo), con nombre, correo y WhatsApp. El correo NO se muestra: queda para
--   contactar o dar de baja. Vencen a los 30 días.
-- · submit_external_listing(): única forma de publicar sin cuenta. Largos limitados, honeypot anti-bots y
--   topes (30 por hora en total, 3 por correo por día) contra el spam.
-- · public_job_postings() y public_bolsa_profiles() pasan a incluir contacto/WhatsApp, un indicador
--   with_clippr (true = usa Clippr, false = publicó sin cuenta) y, solo para usuarios con sesión, el id y
--   el estado de su solicitud, para poder postularse o solicitar desde la misma lista.
-- · El WhatsApp de un profesional con Clippr sale de su ficha privada y se muestra solo si el perfil está
--   visible (is_listed). La fecha de nacimiento y el correo siguen privados.
--
-- Cambios: tabla nueva y dos funciones reemplazadas. No toca datos existentes.
-- Reversión: drop function public.submit_external_listing(...); drop table public.external_listings;
--   y restaurar las dos funciones de 20261123090000_bolsa_publica.sql.

create table public.external_listings (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('oferta', 'profesional')),
  name text not null check (char_length(name) between 2 and 60),
  email text not null check (char_length(email) <= 80),
  whatsapp text not null check (whatsapp ~ '^[0-9]{8,15}$'),
  title text not null check (char_length(title) between 3 and 80),
  zone text check (zone is null or char_length(zone) <= 60),
  description text check (description is null or char_length(description) <= 300),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);
create index external_listings_active_idx on public.external_listings (created_at desc) where is_active;
alter table public.external_listings enable row level security;
-- Sin policies ni permisos de tabla: solo se accede mediante las funciones de abajo.

create or replace function public.submit_external_listing(
  p_kind text, p_name text, p_email text, p_whatsapp text, p_title text, p_zone text, p_description text, p_hp text default ''
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wa text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  -- Campo trampa: los bots lo completan, las personas no lo ven. Se responde "ok" sin guardar nada.
  if coalesce(p_hp, '') <> '' then return; end if;
  if p_kind not in ('oferta', 'profesional') then raise exception 'datos_invalidos'; end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 or char_length(p_name) > 60 then raise exception 'datos_invalidos'; end if;
  if char_length(trim(coalesce(p_title, ''))) < 3 or char_length(p_title) > 80 then raise exception 'datos_invalidos'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 80 then raise exception 'correo_invalido'; end if;
  if v_wa !~ '^[0-9]{8,15}$' then raise exception 'whatsapp_invalido'; end if;
  if char_length(coalesce(p_zone, '')) > 60 or char_length(coalesce(p_description, '')) > 300 then raise exception 'datos_invalidos'; end if;
  if (select count(*) from public.external_listings where created_at > now() - interval '1 hour') >= 30
     or (select count(*) from public.external_listings where email = v_email and created_at > now() - interval '1 day') >= 3 then
    raise exception 'demasiadas_publicaciones';
  end if;
  insert into public.external_listings (kind, name, email, whatsapp, title, zone, description)
  values (p_kind, trim(p_name), v_email, v_wa, trim(p_title), nullif(trim(coalesce(p_zone, '')), ''), nullif(trim(coalesce(p_description, '')), ''));
end;
$$;

drop function if exists public.public_job_postings();
create function public.public_job_postings()
returns table (
  id uuid, business_name text, title text, zone text, job_type text, description text, created_at timestamptz,
  contact text, with_clippr boolean, request_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select * from (
    select jp.id, jp.business_name, jp.title, jp.zone, jp.job_type, jp.description, jp.created_at,
           jp.contact, true as with_clippr,
           (select r.status from public.join_requests r where auth.uid() is not null and r.business_id = jp.business_id and r.user_id = auth.uid()) as request_status
    from public.job_postings jp
    where jp.is_active
    union all
    select el.id, el.name, el.title, el.zone, null::text, el.description, el.created_at,
           el.whatsapp, false, null::text
    from public.external_listings el
    where el.kind = 'oferta' and el.is_active and el.expires_at > now()
  ) x
  order by created_at desc
  limit 200
$$;

drop function if exists public.public_bolsa_profiles();
create function public.public_bolsa_profiles()
returns table (
  user_id uuid, full_name text, avatar_url text, zone text, experience_since date, specialties text[], bio text,
  instagram text, nationality text, photos text[], reviews_count integer, reviews_avg numeric,
  whatsapp text, with_clippr boolean, created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select * from (
    select case when auth.uid() is not null then pp.user_id end as user_id,
           pp.full_name, pp.avatar_url, pp.zone, pp.experience_since, pp.specialties, pp.bio,
           pp.instagram, pp.nationality, pp.photos,
           coalesce(rv.cnt, 0)::integer as reviews_count, rv.avg_rating as reviews_avg,
           pr.whatsapp, true as with_clippr, pp.updated_at as created_at
    from public.professional_profiles pp
    left join public.professional_private pr on pr.user_id = pp.user_id
    left join lateral (
      select count(*) as cnt, round(avg(rw.rating), 1) as avg_rating
      from public.reviews rw
      join public.employees e on e.id = rw.professional_id
      where e.user_id = pp.user_id and rw.status = 'published'
    ) rv on true
    where pp.is_listed
    union all
    select null::uuid, el.name, null::text, el.zone, null::date, array[el.title], el.description,
           null::text, null::text, '{}'::text[], 0, null::numeric, el.whatsapp, false, el.created_at
    from public.external_listings el
    where el.kind = 'profesional' and el.is_active and el.expires_at > now()
  ) x
  order by created_at desc
  limit 200
$$;

revoke all on function public.public_job_postings() from public;
revoke all on function public.public_bolsa_profiles() from public;
revoke all on function public.submit_external_listing(text, text, text, text, text, text, text, text) from public;
grant execute on function public.public_job_postings() to anon, authenticated;
grant execute on function public.public_bolsa_profiles() to anon, authenticated;
grant execute on function public.submit_external_listing(text, text, text, text, text, text, text, text) to anon, authenticated;
