-- ============================================================================
-- Clientes que se fueron sin atender
-- ============================================================================
-- Tabla `clientes_no_atendidos`: una fila por cada cliente que entró al local,
-- quiso atenderse y se fue porque estaban todos ocupados. Se carga con un botón
-- en la Agenda; sirve para contar a fin de mes cuántos se perdieron, con día y
-- horario.
--
-- Solo agrega una tabla nueva. No modifica tablas ni filas existentes.
--
-- Cómo revertirlo: drop table public.clientes_no_atendidos;
-- ============================================================================

create table if not exists public.clientes_no_atendidos (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_clientes_no_atendidos_business_branch_at
  on public.clientes_no_atendidos (business_id, branch_id, occurred_at);

alter table public.clientes_no_atendidos enable row level security;

drop policy if exists clientes_no_atendidos_select on public.clientes_no_atendidos;
create policy clientes_no_atendidos_select on public.clientes_no_atendidos for select
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
  );

-- Lo carga quien esté en el local en ese momento: cualquier miembro del negocio.
drop policy if exists clientes_no_atendidos_insert on public.clientes_no_atendidos;
create policy clientes_no_atendidos_insert on public.clientes_no_atendidos for insert
  with check (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
  );

-- Borrar (cargado por error): quien lo cargó, o cualquiera que no sea acceso "profesional".
drop policy if exists clientes_no_atendidos_delete on public.clientes_no_atendidos;
create policy clientes_no_atendidos_delete on public.clientes_no_atendidos for delete
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (
      created_by = auth.uid()
      or (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
    )
  );

revoke all on public.clientes_no_atendidos from public, anon;
grant select, insert, delete on public.clientes_no_atendidos to authenticated;
