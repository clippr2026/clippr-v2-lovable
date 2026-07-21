-- ============================================================================
-- Liquidaciones — vista previa del backfill (SOLO LECTURA, no escribe nada)
-- ============================================================================
-- Corré esto ANTES de 20260721070100_liquidaciones_backfill_apply.sql.
-- No inserta ni actualiza nada — solo muestra qué pasaría.
--
-- Columnas:
--   comisiones_nuevas_a_insertar        → comisión que se crearía en el paso 1
--                                          (ventas históricas sin commission_record)
--   pendiente_actual_ya_en_commission_records
--                                        → pendiente que YA existe hoy (de ventas
--                                          cobradas después del deploy de este sistema)
--   pendiente_total_despues_del_paso_1  → suma de las dos anteriores
--   pagos_historicos_a_aplicar          → total de professional_payouts de ese
--                                          profesional (dinero que ya se le pagó)
--   pendiente_final_estimado            → lo que quedaría pendiente después de
--                                          aplicar esos pagos históricos
--   diagnostico                         → alerta solo si se pagó MÁS de lo que la
--                                          comisión reconstruida explica (caso raro,
--                                          normalmente por un % que cambió con el
--                                          tiempo). Un pendiente_final_estimado > 0
--                                          es NORMAL, no un error — es la deuda real.
-- ============================================================================
with nuevas_comisiones as (
  select
    p.id as sale_id,
    p.employee_id as professional_id,
    round(coalesce(p.total, p.amount, 0) * coalesce(e.commission_pct, 0) / 100.0) as amount
  from public.payments p
  join public.employees e on e.id = p.employee_id
  where p.employee_id is not null
    and coalesce(e.commission_pct, 0) > 0
    and not exists (select 1 from public.commission_records cr where cr.sale_id = p.id)
)
select
  e.id as professional_id,
  e.full_name as professional_name,
  coalesce((select sum(nc.amount) from nuevas_comisiones nc where nc.professional_id = e.id), 0)
    as comisiones_nuevas_a_insertar,
  coalesce((select sum(cr.pending_amount) from public.commission_records cr where cr.professional_id = e.id), 0)
    as pendiente_actual_ya_en_commission_records,
  coalesce((select sum(nc.amount) from nuevas_comisiones nc where nc.professional_id = e.id), 0)
    + coalesce((select sum(cr.pending_amount) from public.commission_records cr where cr.professional_id = e.id), 0)
    as pendiente_total_despues_del_paso_1,
  coalesce((select sum(po.amount) from public.professional_payouts po where po.employee_id = e.id), 0)
    as pagos_historicos_a_aplicar,
  greatest(
    coalesce((select sum(nc.amount) from nuevas_comisiones nc where nc.professional_id = e.id), 0)
      + coalesce((select sum(cr.pending_amount) from public.commission_records cr where cr.professional_id = e.id), 0)
      - coalesce((select sum(po.amount) from public.professional_payouts po where po.employee_id = e.id), 0),
    0
  ) as pendiente_final_estimado,
  case
    when coalesce((select sum(po.amount) from public.professional_payouts po where po.employee_id = e.id), 0)
      > (
        coalesce((select sum(nc.amount) from nuevas_comisiones nc where nc.professional_id = e.id), 0)
        + coalesce((select sum(cr.pending_amount) from public.commission_records cr where cr.professional_id = e.id), 0)
      )
    then '⚠ se pagó más de lo que la comisión reconstruida explica — revisar a mano antes de aplicar'
    else 'normal: comisión generada ≥ pagos históricos, el pendiente estimado es la deuda real'
  end as diagnostico
from public.employees e
order by pendiente_final_estimado desc;
