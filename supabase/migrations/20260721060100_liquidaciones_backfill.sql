-- ============================================================================
-- Liquidaciones — backfill de datos históricos
-- ============================================================================
-- Corré esto DESPUÉS de 20260719215606_liquidaciones_system.sql y
-- 20260721060000_liquidaciones_rpc.sql.
--
-- Qué hace:
--   1. Crea una fila en commission_records por cada venta histórica en
--      `payments` que todavía no tenga una (usa el % de comisión ACTUAL de
--      cada profesional — no hay registro de qué % regía en cada venta
--      pasada, así que si cambió con el tiempo, el monto reconstruido no
--      va a ser exacto). Es un INSERT idempotente (ON CONFLICT DO NOTHING
--      sobre sale_id) — se puede correr más de una vez sin duplicar.
--   2. Aplica el total históricamente pagado en `professional_payouts`
--      (agrupado por profesional) contra esas comisiones recién creadas,
--      empezando por las más viejas — así el saldo pendiente arranca
--      correcto desde hoy. Guardado para no reaplicar dos veces.
--   3. NO crea filas sintéticas en professional_settlements para pagos
--      viejos (inventar quién los registró sería adivinar datos que no
--      existen). La tabla `professional_payouts` NO se toca ni se borra —
--      sigue siendo la fuente real de esos pagos históricos. El historial
--      que muestra la app combina professional_settlements (pagos nuevos)
--      + professional_payouts (pagos de antes de este backfill).
--
-- Antes de correr el paso 2, mirá el resultado del SELECT del paso 0 — si
-- algún profesional tiene "diferencia_negativa", quiere decir que se le
-- pagó históricamente más de lo que la comisión reconstruida con el %
-- ACTUAL explica (típicamente porque el % cambió en el medio). Para esos
-- casos el saldo pendiente puede arrancar en $0 en vez de reflejar un
-- eventual pago de más — no hay forma de reconstruirlo con exactitud sin
-- el historial real de porcentajes.
-- ============================================================================

-- ── Paso 0: reporte previo (solo lectura, no cambia nada) ──────────────────
select
  e.id as professional_id,
  e.full_name as professional_name,
  coalesce((select sum(po.amount) from public.professional_payouts po where po.employee_id = e.id), 0) as total_historico_pagado,
  coalesce((
    select round(sum(coalesce(p.total, p.amount, 0) * coalesce(e.commission_pct, 0) / 100.0))
    from public.payments p
    where p.employee_id = e.id
  ), 0) as comision_reconstruida_pct_actual,
  coalesce((select sum(po.amount) from public.professional_payouts po where po.employee_id = e.id), 0)
    - coalesce((
        select round(sum(coalesce(p.total, p.amount, 0) * coalesce(e.commission_pct, 0) / 100.0))
        from public.payments p
        where p.employee_id = e.id
      ), 0) as diferencia_negativa_si_positivo
from public.employees e
order by diferencia_negativa_si_positivo desc;

-- ── Paso 1: backfill de commission_records desde payments ──────────────────
insert into public.commission_records (business_id, professional_id, sale_id, amount, sale_date)
select
  p.business_id,
  p.employee_id,
  p.id,
  round(coalesce(p.total, p.amount, 0) * coalesce(e.commission_pct, 0) / 100.0),
  coalesce(p.created_at::date, current_date)
from public.payments p
join public.employees e on e.id = p.employee_id
where p.employee_id is not null
  and coalesce(e.commission_pct, 0) > 0
  and not exists (select 1 from public.commission_records cr where cr.sale_id = p.id)
on conflict (sale_id) do nothing;

-- ── Paso 2: reconciliar pagos históricos de professional_payouts ───────────
do $$
declare
  v_already_run boolean;
  v_prof record;
  v_remaining numeric;
  v_commission record;
  v_apply numeric;
begin
  select exists(
    select 1 from public.commission_records where status <> 'pending'
  ) into v_already_run;

  if v_already_run then
    raise notice 'Ya hay comisiones marcadas como pagadas — se omite la reconciliación (se asume que este backfill ya corrió antes).';
    return;
  end if;

  for v_prof in
    select business_id, employee_id, sum(amount) as total_paid
    from public.professional_payouts
    where employee_id is not null and amount > 0
    group by business_id, employee_id
  loop
    v_remaining := v_prof.total_paid;

    for v_commission in
      select id, pending_amount from public.commission_records
      where professional_id = v_prof.employee_id and business_id = v_prof.business_id
        and status in ('pending', 'partially_paid')
      order by sale_date asc, created_at asc
      for update
    loop
      exit when v_remaining <= 0;
      v_apply := least(v_remaining, v_commission.pending_amount);
      continue when v_apply <= 0;

      update public.commission_records
        set paid_amount = paid_amount + v_apply,
            status = case when paid_amount + v_apply >= amount then 'paid' else 'partially_paid' end
        where id = v_commission.id;

      v_remaining := v_remaining - v_apply;
    end loop;
  end loop;
end $$;
