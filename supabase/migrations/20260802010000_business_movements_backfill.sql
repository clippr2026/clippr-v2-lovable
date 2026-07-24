-- ============================================================================
-- Movimiento #N — backfill de lo historico
-- ============================================================================
-- Numera TODO settlement_payments/professional_advances que todavia no
-- tenga movement_number, intercalando ambas tablas cronologicamente por
-- negocio (mismo criterio que ya uso 20260730010000 para run_number:
-- row_number() sobre la fecha, arrancando en 100) y crea la fila
-- correspondiente en business_movements para cada uno.
--
-- Limitacion conocida y aceptada: los pagos multiples que ya existen no
-- tienen forma de saber que filas de settlement_payments pertenecian a la
-- misma accion de "Pagar" (ese dato no se registro en su momento) — cada
-- fila historica recibe su PROPIO movement_number individual, sin intentar
-- reagruparla con sus hermanas del mismo run. Solo los pagos multiples
-- registrados de aca en adelante (via register_settlement_run_payment_batch,
-- ver 20260801010000) comparten numero entre sus splits.
--
-- Idempotente y seguro de re-correr: solo toca filas con movement_number
-- IS NULL, asi que si hay pagos/adelantos registrados por el frontend viejo
-- en la ventana entre pegar esta tanda de migraciones y deployar el
-- frontend nuevo, alcanza con volver a correr este archivo despues del
-- deploy para numerarlos tambien (el offset se calcula desde el maximo
-- movement_number ya usado en business_movements, no vuelve a arrancar
-- en 100).
--
-- Como correrlo: pegar completo en el SQL Editor de Supabase (proyecto
-- pypduwtioxudgepwjvom, el de myclippr.com) y ejecutar. Requiere que
-- 20260731010000 y 20260801010000 ya hayan corrido.
-- ============================================================================

with all_events as (
  select
    'pago'::text as kind,
    sp.id,
    sp.business_id,
    sp.professional_id,
    sp.amount,
    sp.paid_at as occurred_at,
    case when sp.balance_after <= 0 then 'pago_total' else 'pago_parcial' end as movement_type
  from public.settlement_payments sp
  where sp.movement_number is null

  union all

  select
    'adelanto'::text as kind,
    pa.id,
    pa.business_id,
    pa.professional_id,
    pa.amount,
    pa.advanced_at as occurred_at,
    'adelanto'::text as movement_type
  from public.professional_advances pa
  where pa.movement_number is null
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
      + row_number() over (partition by ae.business_id order by ae.occurred_at asc, ae.id asc)
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
upd_payments as (
  update public.settlement_payments sp
    set movement_number = im.movement_number, movement_id = im.id
    from inserted_movements im
    join numbered n on n.business_id = im.business_id and n.new_number = im.movement_number
    where sp.id = n.id and n.kind = 'pago'
    returning sp.id
),
upd_advances as (
  update public.professional_advances pa
    set movement_number = im.movement_number, movement_id = im.id
    from inserted_movements im
    join numbered n on n.business_id = im.business_id and n.new_number = im.movement_number
    where pa.id = n.id and n.kind = 'adelanto'
    returning pa.id
)
select
  (select count(*) from upd_payments) as pagos_numerados,
  (select count(*) from upd_advances) as adelantos_numerados;
