-- ============================================================================
-- Multi-sucursal — fundación (tabla branches + branch_id + backfill)
-- ============================================================================
-- Hoy business_id es la única unidad de cuenta: un negocio = implícitamente
-- una sola sucursal. Esta migración agrega el concepto real de sucursal
-- SIN romper nada existente: branch_id es nullable en todos lados, y el
-- backfill de abajo deja a cada negocio ya existente con exactamente UNA
-- sucursal ("Sucursal principal"), así ningún dato queda huérfano ni
-- ninguna pantalla actual deja de andar.
--
-- Genérica a propósito (no hay nada hardcodeado de un negocio puntual):
-- pensada para correr tal cual en cualquier proyecto Supabase que tenga
-- este mismo esquema base (primero acá, en clippr-dev — de prueba —, y
-- más adelante en producción, cuando el usuario lo indique explícitamente,
-- sin tener que reescribir nada).
--
-- Alcance de esta fase: branch_id es un filtro de APLICACIÓN, no un nuevo
-- límite de seguridad — las RLS policies de cada tabla siguen exactamente
-- como están (business_id sigue siendo el único límite real de RLS). Un
-- endurecimiento futuro (ej. que un admin_local de RLS solo vea su propia
-- sucursal) queda fuera de esta migración a propósito.
--
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase del proyecto
-- de PRUEBA (clippr-dev) y ejecutar. Idempotente, seguro re-ejecutar.
-- NO correr todavía en el proyecto de producción (velos-app / myclippr.com).
-- ============================================================================

-- ── 1. public.branches ──────────────────────────────────────────────────────
create table if not exists public.branches (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  name        text not null,
  address     text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists idx_branches_business
  on public.branches (business_id);

comment on table public.branches is
  'Sucursales de un negocio. Todo negocio existente queda con exactamente
   una ("Sucursal principal") después del backfill de esta migración —
   branch_id en el resto de las tablas es nullable, nunca bloqueante.';

alter table public.branches enable row level security;

drop policy if exists branches_select on public.branches;
create policy branches_select on public.branches
  for select
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
  );

drop policy if exists branches_write on public.branches;
create policy branches_write on public.branches
  for all
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  )
  with check (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  );

-- ── 2. branch_id en las tablas operativas (nullable, sin default) ──────────
alter table public.employees      add column if not exists branch_id uuid references public.branches(id);
alter table public.appointments   add column if not exists branch_id uuid references public.branches(id);
alter table public.clients        add column if not exists branch_id uuid references public.branches(id);
alter table public.price_catalog  add column if not exists branch_id uuid references public.branches(id);
alter table public.payments       add column if not exists branch_id uuid references public.branches(id);
alter table public.expenses       add column if not exists branch_id uuid references public.branches(id);
alter table public.cash_sessions  add column if not exists branch_id uuid references public.branches(id);

create index if not exists idx_employees_branch     on public.employees (branch_id);
create index if not exists idx_appointments_branch  on public.appointments (branch_id);
create index if not exists idx_clients_branch       on public.clients (branch_id);
create index if not exists idx_price_catalog_branch on public.price_catalog (branch_id);
create index if not exists idx_payments_branch      on public.payments (branch_id);
create index if not exists idx_expenses_branch      on public.expenses (branch_id);
create index if not exists idx_cash_sessions_branch on public.cash_sessions (branch_id);

-- team_members.branch_id ya existe (agregado antes, sin FK ni uso real) —
-- solo le sumamos la constraint ahora que branches existe de verdad.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'team_members_branch_id_fkey'
  ) then
    alter table public.team_members
      add constraint team_members_branch_id_fkey
      foreign key (branch_id) references public.branches(id);
  end if;
end $$;

create index if not exists idx_team_members_branch on public.team_members (branch_id);

-- ── 3. Backfill genérico: una sucursal por negocio existente ───────────────
-- Recorre todo business_id que ya tenga al menos un empleado (universal a
-- cualquier negocio real) y, si todavía no tiene ninguna fila en branches,
-- le crea "Sucursal principal" y reasigna ahí todo lo que esté sin branch_id
-- en las 8 tablas de arriba. Vuelve a correrse sin problema: un negocio que
-- ya tiene sucursal(es) queda intacto (no crea una segunda "principal").
do $$
declare
  v_business_id uuid;
  v_branch_id   uuid;
begin
  for v_business_id in
    select distinct business_id from public.employees
  loop
    select id into v_branch_id
      from public.branches
      where business_id = v_business_id
      order by created_at
      limit 1;

    if v_branch_id is null then
      insert into public.branches (business_id, name)
      values (v_business_id, 'Sucursal principal')
      returning id into v_branch_id;
    end if;

    update public.employees     set branch_id = v_branch_id where business_id = v_business_id and branch_id is null;
    update public.appointments  set branch_id = v_branch_id where business_id = v_business_id and branch_id is null;
    update public.clients       set branch_id = v_branch_id where business_id = v_business_id and branch_id is null;
    update public.price_catalog set branch_id = v_branch_id where business_id = v_business_id and branch_id is null;
    update public.payments      set branch_id = v_branch_id where business_id = v_business_id and branch_id is null;
    update public.expenses      set branch_id = v_branch_id where business_id = v_business_id and branch_id is null;
    update public.cash_sessions set branch_id = v_branch_id where business_id = v_business_id and branch_id is null;
    update public.team_members  set branch_id = v_branch_id where business_id = v_business_id and branch_id is null;
  end loop;
end $$;

NOTIFY pgrst, 'reload schema';
