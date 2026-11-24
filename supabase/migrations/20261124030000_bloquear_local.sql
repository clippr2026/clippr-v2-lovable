-- El profesional puede bloquear a un local desde "Actividad".
--
-- Bloquear = el local ya no lo ve en su lista de profesionales de la bolsa y no puede invitarlo; además se cancela la
-- solicitud pendiente. El profesional lo puede desbloquear cuando quiera. Es independiente del bloqueo que hace el
-- local sobre una persona (join_requests.status = 'blocked').
--
-- Crea la tabla professional_blocks y funciones nuevas; reemplaza list_bolsa_profiles e invite_professional para que
-- respeten el bloqueo (mismo contenido que antes más la condición nueva). No toca datos existentes.
-- Reversión:
--   drop function public.block_business(text, uuid), public.unblock_business(uuid), public.my_blocked_businesses();
--   volver a las versiones de 20261123070000_bolsa_invites.sql de list_bolsa_profiles e invite_professional;
--   drop table public.professional_blocks;

create table public.professional_blocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, business_id)
);
alter table public.professional_blocks enable row level security;
create policy "professional_blocks_select_own" on public.professional_blocks for select to authenticated using (user_id = auth.uid());
grant select on public.professional_blocks to authenticated;

-- Profesional: bloquea al local de una solicitud suya y cancela esa solicitud si sigue pendiente.
create or replace function public.block_business(p_source text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_biz uuid;
begin
  if p_source = 'join' then
    select business_id into v_biz from public.join_requests where id = p_id and user_id = auth.uid();
  elsif p_source = 'rental' then
    select business_id into v_biz from public.rental_requests where id = p_id and user_id = auth.uid();
  else
    raise exception 'accion_invalida';
  end if;
  if v_biz is null then raise exception 'solicitud_invalida'; end if;

  insert into public.professional_blocks (user_id, business_id) values (auth.uid(), v_biz) on conflict do nothing;

  if p_source = 'join' then
    delete from public.join_requests where id = p_id and initiated_by = 'professional' and status = 'pending';
    update public.join_requests set status = 'rejected', decided_at = now() where id = p_id and status = 'invited';
  else
    delete from public.rental_requests where id = p_id and status = 'pending';
  end if;
end;
$$;

create or replace function public.unblock_business(p_business uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.professional_blocks where user_id = auth.uid() and business_id = p_business
$$;

create or replace function public.my_blocked_businesses()
returns table (business_id uuid, name text, logo_url text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.name, coalesce(nullif(trim(b.logo_url), ''), nullif(trim(b.avatar_url), '')), k.created_at
  from public.professional_blocks k
  join public.businesses b on b.id = k.business_id
  where k.user_id = auth.uid()
  order by k.created_at desc
$$;

revoke all on function public.block_business(text, uuid), public.unblock_business(uuid), public.my_blocked_businesses() from public;
grant execute on function public.block_business(text, uuid), public.unblock_business(uuid), public.my_blocked_businesses() to authenticated;

-- Negocio: perfiles de la bolsa, sin los que ya tienen relación con el negocio ni los que lo bloquearon.
create or replace function public.list_bolsa_profiles(p_business uuid)
returns table (
  user_id uuid, full_name text, avatar_url text, zone text, experience_since date, specialties text[],
  bio text, instagram text, nationality text, photos text[], reviews_count integer, reviews_avg numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.bolsa_is_admin(p_business) then raise exception 'sin_permiso'; end if;
  return query
    select pp.user_id, pp.full_name, pp.avatar_url, pp.zone, pp.experience_since, pp.specialties,
           pp.bio, pp.instagram, pp.nationality, pp.photos,
           coalesce(rv.cnt, 0)::integer, rv.avg_rating
    from public.professional_profiles pp
    left join lateral (
      select count(*) as cnt, round(avg(rw.rating), 1) as avg_rating
      from public.reviews rw
      join public.employees e on e.id = rw.professional_id
      where e.user_id = pp.user_id and rw.status = 'published'
    ) rv on true
    where pp.is_listed
      and not exists (
        select 1 from public.join_requests r
        where r.business_id = p_business and r.user_id = pp.user_id and r.status in ('invited', 'pending', 'accepted', 'blocked')
      )
      and not exists (
        select 1 from public.professional_blocks k where k.business_id = p_business and k.user_id = pp.user_id
      )
    order by pp.updated_at desc;
end;
$$;

create or replace function public.invite_professional(p_business uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
begin
  if not public.bolsa_is_admin(p_business) then raise exception 'sin_permiso'; end if;
  if not exists (select 1 from public.professional_profiles where user_id = p_user and is_listed) then
    raise exception 'perfil_no_disponible';
  end if;
  if exists (select 1 from public.professional_blocks where business_id = p_business and user_id = p_user) then
    raise exception 'perfil_no_disponible';
  end if;
  select * into v_req from public.join_requests where business_id = p_business and user_id = p_user;
  if found then
    if v_req.status in ('invited', 'pending') then return; end if;
    if v_req.status in ('accepted', 'blocked') then raise exception 'perfil_no_disponible'; end if;
    update public.join_requests
      set status = 'invited', initiated_by = 'business', decided_at = null, employee_id = null, created_at = now()
      where id = v_req.id;
  else
    insert into public.join_requests (business_id, user_id, initiated_by, status)
    values (p_business, p_user, 'business', 'invited');
  end if;
end;
$$;
