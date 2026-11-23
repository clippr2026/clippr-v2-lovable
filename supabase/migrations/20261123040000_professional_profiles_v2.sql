-- Perfil del profesional, ampliación (bolsa de trabajo, etapa 1b).
--
-- Agrega nacionalidad y hasta 3 fotos de trabajos a la ficha, y topes de largo a los textos.
-- Los datos personales (fecha de nacimiento y WhatsApp) van en una tabla APARTE y privada: la ficha
-- se puede leer desde cualquier sesión iniciada (is_public), así que esos dos datos no pueden vivir
-- ahí. Solo la propia persona los lee y edita; más adelante se compartirán con el negocio al que se
-- postule, mediante una función, nunca por lectura directa.
--
-- Solo modifica la tabla professional_profiles (vacía al momento de escribir esto) y crea una tabla
-- nueva. Reversión:
--   drop table public.professional_private;
--   alter table public.professional_profiles drop column nationality, drop column photos;
--   (y quitar las restricciones professional_profiles_*_len / *_max)

alter table public.professional_profiles
  add column nationality text,
  add column photos text[] not null default '{}';

alter table public.professional_profiles
  add constraint professional_profiles_name_len check (char_length(full_name) <= 60),
  add constraint professional_profiles_zone_len check (zone is null or char_length(zone) <= 60),
  add constraint professional_profiles_bio_len check (bio is null or char_length(bio) <= 300),
  add constraint professional_profiles_instagram_len check (instagram is null or char_length(instagram) <= 30),
  add constraint professional_profiles_nationality_len check (nationality is null or char_length(nationality) <= 40),
  add constraint professional_profiles_specialties_max check (cardinality(specialties) <= 8),
  add constraint professional_profiles_photos_max check (cardinality(photos) <= 3);

create table public.professional_private (
  user_id uuid primary key references auth.users(id) on delete cascade,
  birth_date date,
  whatsapp text check (whatsapp is null or char_length(whatsapp) <= 20),
  updated_at timestamptz not null default now()
);

create or replace function public.professional_private_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger professional_private_touch
  before update on public.professional_private
  for each row execute function public.professional_private_touch();

alter table public.professional_private enable row level security;

create policy "professional_private_select_own"
  on public.professional_private for select to authenticated
  using (user_id = auth.uid());

create policy "professional_private_insert_own"
  on public.professional_private for insert to authenticated
  with check (user_id = auth.uid());

create policy "professional_private_update_own"
  on public.professional_private for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "professional_private_delete_own"
  on public.professional_private for delete to authenticated
  using (user_id = auth.uid());
