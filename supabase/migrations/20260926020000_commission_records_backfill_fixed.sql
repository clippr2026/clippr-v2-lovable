-- ============================================================================
-- Liquidaciones — backfill de ventas históricas de profesionales con
-- comisión FIJA ($ por venta), que nunca generaban fila en
-- commission_records.
-- ============================================================================
-- Causa: el código que registra el cobro (registerPayment) solo miraba
-- employees.commission_pct para decidir si insertar una fila en
-- commission_records — un profesional configurado con comisión fija
-- (employees.commission_fixed, sin % cargado) nunca generaba esa fila, así
-- que Caja > Liquidaciones le mostraba siempre "Comisiones generadas: $0",
-- sin importar el rango de fechas elegido. El código ya se corrigió para
-- las ventas nuevas (ver register-payment.ts); esta migración completa el
-- historial existente.
--
-- Mismo patrón que 20260721070100_liquidaciones_backfill_apply.sql (que
-- cubrió el caso de comisión por %): una fila por venta cobrada, usando la
-- comisión fija ACTUAL de cada profesional (no hay registro de qué monto
-- regía en cada venta pasada).
--
-- Idempotente: NOT EXISTS + ON CONFLICT (sale_id) — se puede volver a
-- correr sin duplicar nada. No modifica payments ni ninguna venta/cobro
-- original, solo crea filas nuevas en commission_records.
-- ============================================================================
begin;

insert into public.commission_records (business_id, professional_id, sale_id, amount, sale_date, created_at, commission_pct)
select
  p.business_id,
  p.employee_id,
  p.id,
  round(coalesce(e.commission_fixed, 0)),
  coalesce(p.created_at::date, current_date),
  coalesce(p.created_at, now()),
  null
from public.payments p
join public.employees e on e.id = p.employee_id
where p.employee_id is not null
  and coalesce(e.commission_fixed, 0) > 0
  and coalesce(p.status, 'cobrado') = 'cobrado'
  and not exists (select 1 from public.commission_records cr where cr.sale_id = p.id)
on conflict (sale_id) do nothing;

commit;

-- ── Validación final — totales por profesional con comisión fija después
--    del backfill (corre ya commiteado, para confirmar los números).
select
  e.id as professional_id,
  e.full_name as professional_name,
  e.commission_fixed,
  coalesce(sum(cr.amount), 0) as comision_total,
  coalesce(sum(cr.paid_amount), 0) as pagado_total,
  coalesce(sum(cr.pending_amount), 0) as pendiente_final
from public.employees e
left join public.commission_records cr on cr.professional_id = e.id
where coalesce(e.commission_fixed, 0) > 0
group by e.id, e.full_name, e.commission_fixed
order by pendiente_final desc;
