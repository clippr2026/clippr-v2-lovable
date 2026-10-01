-- ============================================================================
-- Fichaje de jornada (kiosco QR/código por sucursal + tardanza)
-- ============================================================================
-- 4 tablas nuevas, todas con branch_id:
--
--   branch_checkin_codes — el código/QR del día por sucursal (uno solo,
--   sirve para entrada Y salida — se detecta cuál corresponde según si el
--   profesional ya tiene una jornada abierta hoy). Se genera solo, la
--   primera vez que se abre el kiosco ese día.
--
--   work_sessions — la jornada en sí (entrada/salida). edited_*/original_*
--   son el audit trail de "Historial de jornadas": una edición manual
--   nunca pisa el dato real fichado.
--
--   lateness_rules — tramos de tardanza configurables por sucursal (sin
--   superposición, validado en la UI), cada uno con descuento en % o en
--   monto fijo.
--
--   lateness_discounts — registro de cada descuento aplicado (auditoría
--   completa: profesional, fecha, sucursal, horario esperado, hora real,
--   minutos de tardanza, regla aplicada, monto final). discount_amount_applied
--   queda siempre <= commission_available (nunca negativo).
--
-- RLS: a diferencia del resto de las tablas de esta fundación,
-- work_sessions y lateness_discounts permiten INSERT a cualquier miembro
-- del negocio INCLUIDO rol 'profesional' — fichar es una acción del propio
-- profesional, no del dueño/admin. Editar una jornada ya fichada (UPDATE)
-- sigue restringido a no-profesional, igual que el resto de la app.
--
-- Genérica, re-ejecutable. NO tocar producción (velos-app / myclippr.com)
-- todavía — correr solo en clippr-dev.
-- ============================================================================

-- ── 1. branch_checkin_codes ─────────────────────────────────────────────────
create table if not exists public.branch_checkin_codes (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  branch_id   uuid not null references public.branches(id),
  date        date not null,
  code        text not null,
  created_at  timestamptz not null default now()
);

create unique index if not exists idx_branch_checkin_codes_branch_date
  on public.branch_checkin_codes (branch_id, date);

alter table public.branch_checkin_codes enable row level security;

drop policy if exists branch_checkin_codes_select on public.branch_checkin_codes;
create policy branch_checkin_codes_select on public.branch_checkin_codes
  for select
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
  );

drop policy if exists branch_checkin_codes_write on public.branch_checkin_codes;
create policy branch_checkin_codes_write on public.branch_checkin_codes
  for all
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  )
  with check (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  );

-- ── 2. work_sessions ─────────────────────────────────────────────────────────
create table if not exists public.work_sessions (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null,
  branch_id           uuid not null references public.branches(id),
  employee_id         uuid not null,
  clock_in_at         timestamptz not null,
  clock_out_at        timestamptz,
  expected_start_at   timestamptz,
  late_minutes        integer not null default 0,
  source              text not null default 'kiosk',
  created_at          timestamptz not null default now(),
  edited_by           text,
  edited_at           timestamptz,
  edit_reason         text,
  original_clock_in_at  timestamptz,
  original_clock_out_at timestamptz
);

create index if not exists idx_work_sessions_business on public.work_sessions (business_id);
create index if not exists idx_work_sessions_branch on public.work_sessions (branch_id);
create index if not exists idx_work_sessions_employee_date on public.work_sessions (employee_id, clock_in_at);

alter table public.work_sessions enable row level security;

drop policy if exists work_sessions_select on public.work_sessions;
create policy work_sessions_select on public.work_sessions
  for select
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
  );

-- Fichar (crear la jornada) es una acción del propio profesional.
drop policy if exists work_sessions_insert on public.work_sessions;
create policy work_sessions_insert on public.work_sessions
  for insert
  with check (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
  );

-- Editar una jornada ya fichada (Historial de jornadas) es acción de
-- dueño/admin, no del profesional — mismo criterio que el resto de la app.
drop policy if exists work_sessions_update on public.work_sessions;
create policy work_sessions_update on public.work_sessions
  for update
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  )
  with check (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  );

-- ── 3. lateness_rules ────────────────────────────────────────────────────────
create table if not exists public.lateness_rules (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null,
  branch_id       uuid not null references public.branches(id),
  min_minutes     integer not null,
  max_minutes     integer,
  discount_type   text not null check (discount_type in ('percent', 'fixed')),
  discount_value  numeric not null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_lateness_rules_branch on public.lateness_rules (branch_id);

alter table public.lateness_rules enable row level security;

drop policy if exists lateness_rules_select on public.lateness_rules;
create policy lateness_rules_select on public.lateness_rules
  for select
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
  );

drop policy if exists lateness_rules_write on public.lateness_rules;
create policy lateness_rules_write on public.lateness_rules
  for all
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  )
  with check (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  );

-- ── 4. lateness_discounts ─────────────────────────────────────────────────────
create table if not exists public.lateness_discounts (
  id                          uuid primary key default gen_random_uuid(),
  business_id                 uuid not null,
  branch_id                   uuid not null references public.branches(id),
  employee_id                 uuid not null,
  work_session_id             uuid references public.work_sessions(id),
  date                        date not null,
  expected_start_at           timestamptz,
  actual_start_at             timestamptz not null,
  late_minutes                integer not null,
  rule_id                     uuid references public.lateness_rules(id),
  commission_available        numeric not null default 0,
  discount_amount_requested   numeric not null default 0,
  discount_amount_applied     numeric not null default 0,
  created_at                  timestamptz not null default now()
);

create index if not exists idx_lateness_discounts_business on public.lateness_discounts (business_id);
create index if not exists idx_lateness_discounts_employee on public.lateness_discounts (employee_id, date);

alter table public.lateness_discounts enable row level security;

drop policy if exists lateness_discounts_select on public.lateness_discounts;
create policy lateness_discounts_select on public.lateness_discounts
  for select
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
  );

-- El descuento se calcula y graba como efecto directo de que el propio
-- profesional fiche tarde — mismo criterio que work_sessions_insert.
drop policy if exists lateness_discounts_insert on public.lateness_discounts;
create policy lateness_discounts_insert on public.lateness_discounts
  for insert
  with check (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
  );

NOTIFY pgrst, 'reload schema';
