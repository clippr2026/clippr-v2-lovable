-- Avisos "Busco barbero" (bolsa de trabajo, etapa 2).
--
-- Cada negocio puede publicar avisos de trabajo. Esta migración SOLO agrega una tabla nueva; no toca
-- ninguna tabla, función ni dato existente.
--
-- Quién ve qué:
--   · Los avisos activos los puede leer cualquier usuario con sesión iniciada (los profesionales los
--     verán en la etapa 3). El aviso solo contiene lo que el dueño decide mostrar.
--   · Crear, editar y borrar: únicamente quien administra ese negocio (dueño, admin general, admin
--     local o socio). Un recepcionista o barbero no publica.
--
-- Reversión: drop table public.job_postings;

create table public.job_postings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  business_name text not null,
  title text not null,
  zone text,
  job_type text not null default 'tiempo_completo'
    check (job_type in ('tiempo_completo', 'medio_tiempo', 'por_turnos')),
  description text,
  contact text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index job_postings_business_idx on public.job_postings (business_id);
create index job_postings_active_idx on public.job_postings (created_at desc) where is_active;

create or replace function public.job_postings_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger job_postings_touch
  before update on public.job_postings
  for each row execute function public.job_postings_touch();

alter table public.job_postings enable row level security;

create policy "job_postings_select_active"
  on public.job_postings for select to authenticated
  using (is_active);

create policy "job_postings_select_own_business"
  on public.job_postings for select to authenticated
  using (
    business_id in (select p.business_id from public.profiles p where p.id = auth.uid())
  );

create policy "job_postings_insert_admin"
  on public.job_postings for insert to authenticated
  with check (
    business_id in (
      select p.business_id from public.profiles p
      where p.id = auth.uid() and coalesce(p.role, 'owner') in ('owner', 'admin_general', 'admin_local', 'socio')
    )
  );

create policy "job_postings_update_admin"
  on public.job_postings for update to authenticated
  using (
    business_id in (
      select p.business_id from public.profiles p
      where p.id = auth.uid() and coalesce(p.role, 'owner') in ('owner', 'admin_general', 'admin_local', 'socio')
    )
  )
  with check (
    business_id in (
      select p.business_id from public.profiles p
      where p.id = auth.uid() and coalesce(p.role, 'owner') in ('owner', 'admin_general', 'admin_local', 'socio')
    )
  );

create policy "job_postings_delete_admin"
  on public.job_postings for delete to authenticated
  using (
    business_id in (
      select p.business_id from public.profiles p
      where p.id = auth.uid() and coalesce(p.role, 'owner') in ('owner', 'admin_general', 'admin_local', 'socio')
    )
  );
