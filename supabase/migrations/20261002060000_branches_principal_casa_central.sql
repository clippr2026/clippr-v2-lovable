-- ============================================================================
-- Sucursal principal (is_principal) + Casa Central para negocios sin
-- ninguna sucursal
-- ============================================================================
-- 1. Agrega `is_principal` a `branches`, con protección a nivel de BASE
--    (no solo frontend) para que nunca pueda haber dos principales en el
--    mismo negocio: índice único parcial sobre business_id, filtrado a
--    is_principal = true. Un intento de marcar una segunda sucursal como
--    principal sin desmarcar la anterior primero falla directo en la base.
--
-- 2. Backfill en dos pasos, cada uno idempotente por separado:
--
--    a) Negocios SIN ninguna fila en `branches` todavía: se les crea
--       "Casa Central" — activa, principal, con la dirección que ya tenga
--       cargada `businesses.address` (null si todavía no la cargaron, sin
--       inventar nada) — y se reasigna ahí todo lo que esté sin branch_id
--       en las mismas 8 tablas operativas del backfill anterior
--       (20261002050000, que esta migración reemplaza/generaliza con el
--       nombre correcto — no hace falta correrla aparte). También se
--       copia el schedule actual a branch_settings, igual que siempre.
--       Re-ejecutar no duplica nada: el filtro es "negocios sin ninguna
--       sucursal", así que un negocio que ya tiene una (recién creada acá
--       o de antes) queda afuera del loop en la segunda corrida.
--
--    b) Negocios que YA tenían sucursal(es) (de la migración original
--       20260930010000, con nombre "Sucursal principal", o cargadas a
--       mano) pero ninguna marcada is_principal: se marca la más vieja
--       (por created_at) como principal. NUNCA se renombra ni se toca la
--       dirección de una sucursal existente — "Casa Central" como nombre
--       es exclusivo de sucursales creadas por (a) o por el alta de un
--       negocio nuevo, nunca se le impone a algo que ya existía. Re-
--       ejecutar tampoco duplica: una vez que un negocio tiene una
--       principal, el filtro "sin ninguna principal" lo excluye.
--
-- Nada de esto borra ni pisa una fila existente — todo es ALTER aditivo,
-- INSERT solo cuando no hay nada, o UPDATE acotado a is_principal/branch_id
-- que hoy están en su default (false / null).
-- ============================================================================

-- ── 1. is_principal + protección única ──────────────────────────────────────
alter table public.branches add column if not exists is_principal boolean not null default false;

create unique index if not exists idx_branches_one_principal_per_business
  on public.branches (business_id)
  where is_principal;

-- ── 2a. Negocios sin ninguna sucursal → crear "Casa Central" ───────────────
do $$
declare
  v_business_id      uuid;
  v_business_address text;
  v_branch_id        uuid;
  v_schedule         jsonb;
begin
  for v_business_id in
    select b.id
    from public.businesses b
    where not exists (
      select 1 from public.branches br where br.business_id = b.id
    )
  loop
    select address into v_business_address
      from public.businesses
      where id = v_business_id;

    insert into public.branches (business_id, name, address, is_active, is_principal)
    values (v_business_id, 'Casa Central', v_business_address, true, true)
    returning id into v_branch_id;

    update public.employees     set branch_id = v_branch_id where business_id = v_business_id and branch_id is null;
    update public.appointments  set branch_id = v_branch_id where business_id = v_business_id and branch_id is null;
    update public.clients       set branch_id = v_branch_id where business_id = v_business_id and branch_id is null;
    update public.price_catalog set branch_id = v_branch_id where business_id = v_business_id and branch_id is null;
    update public.payments      set branch_id = v_branch_id where business_id = v_business_id and branch_id is null;
    update public.expenses      set branch_id = v_branch_id where business_id = v_business_id and branch_id is null;
    update public.cash_sessions set branch_id = v_branch_id where business_id = v_business_id and branch_id is null;
    update public.team_members  set branch_id = v_branch_id where business_id = v_business_id and branch_id is null;

    select schedule into v_schedule
      from public.business_settings
      where business_id = v_business_id;

    insert into public.branch_settings (business_id, branch_id, schedule)
    values (v_business_id, v_branch_id, coalesce(v_schedule, '{}'::jsonb))
    on conflict (business_id, branch_id) do nothing;
  end loop;
end $$;

-- ── 2b. Negocios con sucursal(es) pero ninguna principal → marcar la más
--        vieja, sin tocar nombre ni dirección ─────────────────────────────
with first_branch as (
  select distinct on (business_id) id, business_id
  from public.branches
  order by business_id, created_at asc
),
missing_principal as (
  select fb.id
  from first_branch fb
  where not exists (
    select 1
    from public.branches br2
    where br2.business_id = fb.business_id
      and br2.is_principal
  )
)
update public.branches
set is_principal = true
where id in (select id from missing_principal);

NOTIFY pgrst, 'reload schema';
