-- ============================================================================
-- Caja vencida + movimientos de efectivo (Ingresar/Retirar)
-- ============================================================================
-- caja_cierres (la tabla real detrás de "¿la caja está abierta o cerrada
-- hoy?") no tenía branch_id — queda agregado acá, igual patrón que el
-- resto de esta fundación: nullable, backfill a la primera sucursal de
-- cada negocio, único ahora por (business_id, branch_id, fecha) en vez de
-- (business_id, fecha).
--
-- cash_movements es una tabla nueva y chica para "Ingresar efectivo" /
-- "Retirar efectivo" — movimientos de caja que no son ni una venta
-- (payments) ni un gasto del negocio (expenses), por eso no se mezclan
-- con esas dos tablas.
--
-- Genérica, re-ejecutable. NO tocar producción (velos-app / myclippr.com)
-- todavía — correr solo en clippr-dev.
-- ============================================================================

-- ── 1. branch_id en caja_cierres ────────────────────────────────────────────
alter table public.caja_cierres add column if not exists branch_id uuid references public.branches(id);
create index if not exists idx_caja_cierres_branch on public.caja_cierres (branch_id);

do $$
declare
  v_row             record;
  v_first_branch_id uuid;
begin
  for v_row in
    select distinct business_id from public.caja_cierres where branch_id is null
  loop
    select id into v_first_branch_id
      from public.branches
      where business_id = v_row.business_id
      order by created_at asc
      limit 1;

    if v_first_branch_id is not null then
      update public.caja_cierres
        set branch_id = v_first_branch_id
        where business_id = v_row.business_id and branch_id is null;
    end if;
  end loop;
end $$;

-- ── 2. cash_movements (Ingresar/Retirar efectivo) ──────────────────────────
create table if not exists public.cash_movements (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  branch_id   uuid references public.branches(id),
  type        text not null check (type in ('ingreso', 'retiro')),
  amount      numeric not null check (amount > 0),
  note        text,
  created_by  text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_cash_movements_business on public.cash_movements (business_id);
create index if not exists idx_cash_movements_branch on public.cash_movements (branch_id);

alter table public.cash_movements enable row level security;

drop policy if exists cash_movements_select on public.cash_movements;
create policy cash_movements_select on public.cash_movements
  for select
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
  );

drop policy if exists cash_movements_write on public.cash_movements;
create policy cash_movements_write on public.cash_movements
  for all
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  )
  with check (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  );

NOTIFY pgrst, 'reload schema';
