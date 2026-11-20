-- get_pending_cierres_in_period: un gasto de "Otros fondos" (funds_source = 'otros') no mueve la
-- caja, así que no hace que ese día "corresponda cerrar caja". Mismo criterio que
-- findAllPendingCierres en caja-cierre.ts (que ya los ignoraba). Sin esto, cargar un gasto de
-- fondos externos con fecha de un día sin ventas bloqueaba la liquidación con "cajas pendientes".
create or replace function public.get_pending_cierres_in_period(
  p_business_id uuid, p_branch_id uuid, p_from date, p_to date
) returns table (fecha date) language sql stable as $$
  with candidatas as (
    select generate_series(p_from, p_to, interval '1 day')::date as fecha
  ),
  activas as (
    select c.fecha from candidatas c
    where exists (
      select 1 from public.payments pm
      where pm.business_id = p_business_id
        and (p_branch_id is null or pm.branch_id = p_branch_id or pm.branch_id is null)
        and pm.status not in ('anulado', 'reembolsado')
        and (pm.created_at at time zone 'America/Argentina/Buenos_Aires')::date = c.fecha
    ) or exists (
      select 1 from public.expenses ex
      where ex.business_id = p_business_id
        and (p_branch_id is null or ex.branch_id = p_branch_id or ex.branch_id is null)
        and ex.date = c.fecha
        and coalesce(ex.funds_source, 'caja') <> 'otros'
    )
  )
  select fecha from activas
  where not public.is_caja_closed_now(p_business_id, p_branch_id, fecha)
  order by fecha;
$$;

NOTIFY pgrst, 'reload schema';
