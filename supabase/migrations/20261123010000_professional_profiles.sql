-- Perfil permanente del profesional (bolsa de trabajo, etapa 1).
--
-- Cada profesional tiene UNA ficha propia, ligada a su usuario y no a ninguna barbería: si deja de
-- trabajar en un negocio, la ficha se conserva. Esta migración SOLO agrega una tabla nueva y un
-- bucket nuevo de fotos; no toca ninguna tabla, función ni dato existente.
--
-- Visibilidad: cada persona ve y edita únicamente su ficha. Las fichas marcadas is_public se pueden
-- leer desde una sesión iniciada (los dueños las van a ver al revisar postulaciones, etapa 3).
-- No se guarda teléfono: el contacto es el Instagram que la persona elija mostrar.
--
-- Reversión: drop table public.professional_profiles; y borrar el bucket "perfiles-profesionales".

create table public.professional_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  avatar_url text,
  zone text,
  experience_since date,
  specialties text[] not null default '{}',
  bio text,
  instagram text,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.professional_profiles_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger professional_profiles_touch
  before update on public.professional_profiles
  for each row execute function public.professional_profiles_touch();

alter table public.professional_profiles enable row level security;

create policy "professional_profiles_select_own"
  on public.professional_profiles for select to authenticated
  using (user_id = auth.uid());

create policy "professional_profiles_select_public"
  on public.professional_profiles for select to authenticated
  using (is_public);

create policy "professional_profiles_insert_own"
  on public.professional_profiles for insert to authenticated
  with check (user_id = auth.uid());

create policy "professional_profiles_update_own"
  on public.professional_profiles for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "professional_profiles_delete_own"
  on public.professional_profiles for delete to authenticated
  using (user_id = auth.uid());

-- Fotos: bucket público de lectura; cada persona sube solo dentro de su carpeta (<user_id>/...).
insert into storage.buckets (id, name, public)
values ('perfiles-profesionales', 'perfiles-profesionales', true)
on conflict (id) do nothing;

create policy "perfiles_profesionales_insert_own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'perfiles-profesionales' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "perfiles_profesionales_update_own"
  on storage.objects for update to authenticated
  using (bucket_id = 'perfiles-profesionales' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'perfiles-profesionales' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "perfiles_profesionales_delete_own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'perfiles-profesionales' and (storage.foldername(name))[1] = auth.uid()::text);
