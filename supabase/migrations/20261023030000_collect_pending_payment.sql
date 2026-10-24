-- ============================================================================
-- collect_pending_payment — Caja → Ingresar dinero → Cobrar pendiente
-- ============================================================================
-- Registra un cobro (total o parcial) contra una venta con saldo pendiente.
-- Nunca crea una venta nueva — todo pasa dentro de la MISMA transacción
-- contra el payments.id original:
--   1) bloquea la fila de payments (`for update`) — dos usuarios cobrando
--      el mismo pendiente al mismo tiempo (escenario de prueba #10) quedan
--      serializados por Postgres, nunca pueden hacer que el saldo quede
--      negativo.
--   2) valida 0 < importe <= saldo pendiente.
--   3) inserta el renglón en payment_collections, con la fecha/hora REAL
--      del cobro (collected_at).
--   4) habilita la porción de comisión/propina que ese cobro puntual
--      cubre, con una fórmula de "target acumulado" (nunca una suma de
--      redondeos independientes): v_target = round(comisión_total *
--      cobrado_acumulado / total_venta, 2); el incremento de este cobro es
--      v_target - lo_ya_habilitado_antes. Esto garantiza que la suma de
--      todos los cobros de una venta llega EXACTO a la comisión total
--      (el último cobro, cuando cobrado_acumulado == total, redondea a
--      amount exacto — sin arrastrar centavos de más ni de menos) y que
--      nunca se puede habilitar más de lo que corresponde.
--   5) actualiza payments.status/collected_amount.
--
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase (primero en
-- desarrollo, después en producción) y ejecutar. Idempotente.
-- ============================================================================
begin;

create or replace function public.collect_pending_payment(
  p_business_id uuid,
  p_payment_id uuid,
  p_amount numeric,
  p_method text,
  p_collected_by uuid,
  p_branch_id uuid default null,
  p_receipt_path text default null,
  p_observations text default null,
  p_collected_by_name text default null,
  p_collected_at timestamptz default null,
  p_idempotency_key text default null
)
returns table (
  payment_collection_id uuid,
  payment_id uuid,
  new_status text,
  new_collected_amount numeric,
  new_pending_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_business uuid;
  v_caller_role text;
  v_payment public.payments;
  v_collected_at timestamptz := coalesce(p_collected_at, now());
  v_saldo numeric;
  v_new_collected numeric;
  v_new_status text;
  v_collection_id uuid;
  v_commission public.commission_records;
  v_commission_target numeric;
  v_commission_increment numeric;
  v_tip public.tip_records;
  v_tip_target numeric;
  v_tip_increment numeric;
begin
  if p_collected_by is distinct from auth.uid() then
    raise exception 'collected_by debe ser el usuario autenticado';
  end if;

  select p.business_id, p.role into v_caller_business, v_caller_role
    from public.profiles p where p.id = auth.uid();

  if v_caller_business is null or v_caller_business is distinct from p_business_id then
    raise exception 'No autorizado para registrar cobros en este negocio';
  end if;

  if v_caller_role = 'profesional' then
    raise exception 'Un profesional no puede registrar cobros de pendientes';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'El importe a cobrar tiene que ser mayor a $0';
  end if;

  if p_idempotency_key is not null then
    declare
      v_existing_collection public.payment_collections;
    begin
      select * into v_existing_collection
        from public.payment_collections
        where business_id = p_business_id and idempotency_key = p_idempotency_key;

      if found then
        select * into v_payment from public.payments where id = v_existing_collection.payment_id;
        return query select
          v_existing_collection.id, v_payment.id, v_payment.status, v_payment.collected_amount,
          coalesce(v_payment.total, v_payment.amount, 0) - v_payment.collected_amount;
        return;
      end if;
    end;
  end if;

  select * into v_payment
    from public.payments
    where id = p_payment_id and business_id = p_business_id
    for update;

  if v_payment.id is null then
    raise exception 'La venta indicada no existe en este negocio';
  end if;

  if v_payment.status not in ('pendiente', 'parcial') then
    raise exception 'Esta venta no tiene saldo pendiente para cobrar (estado: %)', v_payment.status;
  end if;

  v_saldo := coalesce(v_payment.total, v_payment.amount, 0) - v_payment.collected_amount;
  if p_amount > v_saldo + 0.01 then
    raise exception 'El importe a cobrar ($%) no puede superar el saldo pendiente ($%)', p_amount, v_saldo;
  end if;

  insert into public.payment_collections (
    business_id, branch_id, payment_id, amount, method, receipt_path, observations,
    collected_by, collected_by_name, collected_at, idempotency_key
  ) values (
    p_business_id, coalesce(p_branch_id, v_payment.branch_id), p_payment_id, p_amount, p_method,
    p_receipt_path, nullif(trim(coalesce(p_observations, '')), ''),
    p_collected_by, p_collected_by_name, v_collected_at, p_idempotency_key
  ) returning id into v_collection_id;

  v_new_collected := v_payment.collected_amount + p_amount;
  v_new_status := case when v_new_collected >= coalesce(v_payment.total, v_payment.amount, 0) - 0.004
                        then 'cobrado' else 'parcial' end;

  update public.payments
    set collected_amount = v_new_collected,
        status = v_new_status
    where id = p_payment_id;

  -- Habilita la porción de comisión que corresponde a este cobro — nunca
  -- toca commission_records.amount (sigue siendo el potencial total de la
  -- venta), solo paid_amount (pending_amount es columna generada).
  select * into v_commission from public.commission_records where sale_id = p_payment_id;
  if v_commission.id is not null and coalesce(v_payment.total, v_payment.amount, 0) > 0 then
    v_commission_target := round(v_commission.amount * v_new_collected / coalesce(v_payment.total, v_payment.amount, 0), 2);
    v_commission_increment := v_commission_target - v_commission.paid_amount;
    if v_commission_increment > 0 then
      insert into public.commission_collection_events (
        business_id, commission_record_id, payment_collection_id, amount, collected_at
      ) values (
        p_business_id, v_commission.id, v_collection_id, v_commission_increment, v_collected_at
      );
      update public.commission_records
        set paid_amount = v_commission_target,
            status = case when v_commission_target >= v_commission.amount - 0.004 then 'paid'
                          when v_commission_target > 0 then 'partially_paid'
                          else status end
        where id = v_commission.id;
    end if;
  end if;

  select * into v_tip from public.tip_records where sale_id = p_payment_id;
  if v_tip.id is not null and coalesce(v_payment.total, v_payment.amount, 0) > 0 then
    v_tip_target := round(v_tip.amount * v_new_collected / coalesce(v_payment.total, v_payment.amount, 0), 2);
    v_tip_increment := v_tip_target - v_tip.paid_amount;
    if v_tip_increment > 0 then
      insert into public.tip_collection_events (
        business_id, tip_record_id, payment_collection_id, amount, collected_at
      ) values (
        p_business_id, v_tip.id, v_collection_id, v_tip_increment, v_collected_at
      );
      update public.tip_records
        set paid_amount = v_tip_target,
            status = case when v_tip_target >= v_tip.amount - 0.004 then 'paid'
                          when v_tip_target > 0 then 'partially_paid'
                          else status end
        where id = v_tip.id;
    end if;
  end if;

  return query select
    v_collection_id, p_payment_id, v_new_status, v_new_collected,
    coalesce(v_payment.total, v_payment.amount, 0) - v_new_collected;
end;
$$;

revoke all on function public.collect_pending_payment(
  uuid, uuid, numeric, text, uuid, uuid, text, text, text, timestamptz, text
) from public;
grant execute on function public.collect_pending_payment(
  uuid, uuid, numeric, text, uuid, uuid, text, text, text, timestamptz, text
) to authenticated;

NOTIFY pgrst, 'reload schema';

commit;
