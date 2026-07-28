-- ============================================================================
-- Movimiento #N — backfill de Ajuste/Deduccion en liquidaciones existentes
-- ============================================================================
-- Numera los ajustes/deducciones de settlement_runs que ya existian antes
-- de 20260803010000 y todavia no tienen movement_number, intercalados
-- cronologicamente (por prepared_at) con TODO lo que ya haya en
-- business_movements (pagos/adelantos ya numerados) -- nunca reinicia la
-- secuencia, nunca duplica.
--
-- Un mismo run puede necesitar los dos (ajuste Y deduccion) -- se resuelven
-- en un unico UPDATE por fila (ver "moves" mas abajo) para evitar que dos
-- CTEs de escritura intenten tocar la misma fila de settlement_runs en el
-- mismo comando (Postgres lo rechaza con "tuple already modified").
--
-- Idempotente y seguro de re-correr: solo toca runs con
-- adjustment_movement_number/deduction_movement_number IS NULL.
--
-- Como correrlo: pegar completo en el SQL Editor de Supabase (proyecto
-- pypduwtioxudgepwjvom, el de myclippr.com) y ejecutar. Requiere que
-- 20260803010000_ajuste_deduccion_movements.sql ya haya corrido.
-- ============================================================================

with all_events as (
  select
    'ajuste'::text as kind,
    sr.id,
    sr.business_id,
    sr.professional_id,
    sr.adjustments as amount,
    sr.prepared_at as occurred_at,
    'ajuste'::text as movement_type
  from public.settlement_runs sr
  where sr.adjustments > 0 and sr.adjustment_movement_number is null

  union all

  select
    'deduccion'::text as kind,
    sr.id,
    sr.business_id,
    sr.professional_id,
    sr.deductions as amount,
    sr.prepared_at as occurred_at,
    'deduccion'::text as movement_type
  from public.settlement_runs sr
  where sr.deductions > 0 and sr.deduction_movement_number is null
),
offsets as (
  select business_id, coalesce(max(movement_number), 99) as base_number
  from public.business_movements
  group by business_id
),
numbered as (
  select
    ae.*,
    coalesce(o.base_number, 99)
      + row_number() over (partition by ae.business_id order by ae.occurred_at asc, ae.id asc, ae.kind asc)
      as new_number
  from all_events ae
  left join offsets o on o.business_id = ae.business_id
),
inserted_movements as (
  insert into public.business_movements (business_id, movement_number, movement_type, professional_id, amount, occurred_at)
  select business_id, new_number, movement_type, professional_id, amount, occurred_at
  from numbered
  returning id, business_id, movement_number
),
adj_moves as (
  select n.id as run_id, im.movement_number as adj_num, im.id as adj_id
  from numbered n
  join inserted_movements im on im.business_id = n.business_id and im.movement_number = n.new_number
  where n.kind = 'ajuste'
),
ded_moves as (
  select n.id as run_id, im.movement_number as ded_num, im.id as ded_id
  from numbered n
  join inserted_movements im on im.business_id = n.business_id and im.movement_number = n.new_number
  where n.kind = 'deduccion'
),
moves as (
  select coalesce(a.run_id, d.run_id) as run_id, a.adj_num, a.adj_id, d.ded_num, d.ded_id
  from adj_moves a
  full outer join ded_moves d on a.run_id = d.run_id
),
upd_runs as (
  update public.settlement_runs sr
    set adjustment_movement_number = coalesce(moves.adj_num, sr.adjustment_movement_number),
        adjustment_movement_id = coalesce(moves.adj_id, sr.adjustment_movement_id),
        deduction_movement_number = coalesce(moves.ded_num, sr.deduction_movement_number),
        deduction_movement_id = coalesce(moves.ded_id, sr.deduction_movement_id)
    from moves
    where sr.id = moves.run_id
    returning sr.id
)
select (select count(*) from upd_runs) as runs_actualizados;
