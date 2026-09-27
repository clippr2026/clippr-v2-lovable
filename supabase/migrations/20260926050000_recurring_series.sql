-- ============================================================================
-- Turnos recurrentes — "Repetir turno" real
-- ============================================================================
-- Hasta ahora "Repetir turno" generaba varias filas en `appointments` sin
-- ningún vínculo entre ellas: no había forma de editar "este y los
-- siguientes", finalizar la recurrencia, ni verla desde la ficha del
-- cliente. Esta tabla es la "serie" que agrupa esas reservas.
--
-- No inserta nada por sí sola — el código (appointment-dialog.tsx) es el
-- que crea la serie y las reservas vinculadas. last_generated_until se usa
-- solo para el modo "sin fecha de finalización" (end_mode='none'): marca
-- hasta cuándo ya se generaron turnos, para poder completar la ventana
-- automáticamente sin volver a generar todo de cero ni crear años de
-- reservas de una sola vez.
-- ============================================================================
create table if not exists public.recurring_series (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null,
  client_id         uuid,
  client_name       text not null,
  employee_id       uuid,
  service_name      text not null,
  service_price     numeric,
  duration_min      integer not null default 30,
  weekdays          integer[] not null,   -- 0=domingo .. 6=sábado
  every_weeks       integer not null default 1,
  start_time        text not null,        -- "HH:MM", hora fija de la serie
  end_mode          text not null check (end_mode in ('count', 'until', 'none')),
  end_count         integer,
  end_until         date,
  status            text not null default 'active' check (status in ('active', 'finished')),
  last_generated_until date,
  created_by_name   text,
  created_by_role   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_recurring_series_business
  on public.recurring_series (business_id);
create index if not exists idx_recurring_series_client
  on public.recurring_series (client_id);
create index if not exists idx_recurring_series_active_none
  on public.recurring_series (business_id, status, end_mode, last_generated_until)
  where status = 'active' and end_mode = 'none';

-- GRANT de tabla: sin esto, Postgres rechaza el acceso con "permission
-- denied" ANTES de evaluar las policies de abajo, sin importar cuán
-- permisivas sean (mismo bug ya documentado en
-- 20260721080000_liquidaciones_grants.sql para commission_records).
grant select, insert, update, delete
  on table public.recurring_series
  to authenticated;

alter table public.recurring_series enable row level security;

-- Mismo patrón que commission_records/business_movements: cualquier rol
-- que no sea "profesional" (admin, socio, recepción) ve/edita todas las
-- series del negocio; un profesional solo las suyas (employee_id propio).
drop policy if exists recurring_series_select on public.recurring_series;
create policy recurring_series_select on public.recurring_series
  for select
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (
      (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
      or employee_id = (select p.employee_id from public.profiles p where p.id = auth.uid())
    )
  );

drop policy if exists recurring_series_write on public.recurring_series;
create policy recurring_series_write on public.recurring_series
  for all
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (
      (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
      or employee_id = (select p.employee_id from public.profiles p where p.id = auth.uid())
    )
  )
  with check (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (
      (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
      or employee_id = (select p.employee_id from public.profiles p where p.id = auth.uid())
    )
  );

-- on delete set null (no cascade): si alguna vez se borra una serie, nunca
-- se arrastra el borrado de turnos reales/históricos ya generados.
alter table public.appointments
  add column if not exists recurring_series_id uuid references public.recurring_series(id) on delete set null;

create index if not exists idx_appointments_recurring_series
  on public.appointments (recurring_series_id)
  where recurring_series_id is not null;
