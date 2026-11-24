-- Referencias laborales del profesional (bolsa de trabajo).
--
-- Cada profesional puede cargar hasta 10 lugares donde trabajó: nombre, localidad, desde/hasta cuándo,
-- Instagram y WhatsApp de contacto. Son PRIVADAS: solo la propia persona las lee y edita. El dueño de
-- un negocio las ve únicamente cuando ya hay unión aceptada por ambas partes (join_requests.status =
-- 'accepted'), mediante la función accepted_pro_references, nunca por lectura directa.
--
-- Solo crea una tabla y una función nuevas; no toca datos existentes.
-- Reversión:
--   drop function public.accepted_pro_references(uuid, uuid);
--   drop table public.professional_references;

create table public.professional_references (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  place_name text not null check (char_length(place_name) between 1 and 60),
  locality text check (locality is null or char_length(locality) <= 60),
  from_date date,
  to_date date,            -- null = sigue trabajando ahí
  instagram text check (instagram is null or char_length(instagram) <= 30),
  whatsapp text check (whatsapp is null or char_length(whatsapp) <= 20),
  created_at timestamptz not null default now()
);

create index professional_references_user_idx on public.professional_references (user_id);

create or replace function public.professional_references_limit()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.professional_references where user_id = new.user_id) >= 10 then
    raise exception 'maximo_10_referencias';
  end if;
  return new;
end;
$$;

create trigger professional_references_limit
  before insert on public.professional_references
  for each row execute function public.professional_references_limit();

alter table public.professional_references enable row level security;

create policy "professional_references_select_own"
  on public.professional_references for select to authenticated
  using (user_id = auth.uid());
create policy "professional_references_insert_own"
  on public.professional_references for insert to authenticated
  with check (user_id = auth.uid());
create policy "professional_references_update_own"
  on public.professional_references for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "professional_references_delete_own"
  on public.professional_references for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.professional_references to authenticated;

-- Negocio: referencias de una persona, solo si la unión ya fue aceptada por ambos.
create or replace function public.accepted_pro_references(p_business uuid, p_user uuid)
returns table (id uuid, place_name text, locality text, from_date date, to_date date, instagram text, whatsapp text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.bolsa_is_admin(p_business) then raise exception 'sin_permiso'; end if;
  if not exists (
    select 1 from public.join_requests where business_id = p_business and user_id = p_user and status = 'accepted'
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

grant execute on function public.accepted_pro_references(uuid, uuid) to authenticated;
