-- ============================================================================
-- Liquidaciones — backfill real (ejecutar completo, en una sola consulta,
-- después de revisar 20260721070000_liquidaciones_backfill_preview.sql)
-- ============================================================================
-- Todo corre dentro de una transacción explícita (begin/commit): si
-- cualquier paso falla, Postgres descarta automáticamente todo lo hecho
-- hasta ese punto — no hace falta decidir "commit o rollback" a mano.
--
-- No modifica payments, professional_payouts ni ninguna venta/cobro
-- original — solo crea filas nuevas en commission_records y actualiza
-- paid_amount/status de esas mismas filas nuevas.
--
-- Idempotente: se puede volver a pegar y correr sin duplicar nada
-- (paso 1 usa ON CONFLICT sobre sale_id; paso 2 se auto-omite si ya
-- corrió antes, ver el chequeo v_already_run).
-- ============================================================================
begin;

-- ── Paso 1: crear commission_records para ventas históricas que todavía
--    no tengan una. Usa el % de comisión ACTUAL de cada profesional — no
--    hay registro de qué % regía en cada venta pasada.
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

-- ── Paso 2: aplicar los pagos históricos de professional_payouts contra
--    las comisiones pendientes, empezando por las más viejas. Se omite
--    solo si ya corrió antes (chequea si ya hay alguna comisión marcada
--    pagada/parcial antes de tocar nada).
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

commit;

-- ── Paso 3: validación final — totales por profesional después del
--    backfill (esto ya corre COMMITEADO; es para que confirmes que los
--    números finales coinciden con lo que esperabas ver en la app).
select
  e.id as professional_id,
  e.full_name as professional_name,
  coalesce(sum(cr.amount), 0) as comision_total,
  coalesce(sum(cr.paid_amount), 0) as pagado_total,
  coalesce(sum(cr.pending_amount), 0) as pendiente_final
from public.employees e
left join public.commission_records cr on cr.professional_id = e.id
group by e.id, e.full_name
order by pendiente_final desc;
