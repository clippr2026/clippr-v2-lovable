-- ============================================================================
-- reverse_payment_collection — revertir un cobro, con auditoría, sin reabrir
-- liquidaciones históricas
-- ============================================================================
-- Nunca borra ni edita el renglón original: lo marca (reversed_at/
-- reversed_by/reversal_reason) e inserta un renglón NUEVO con importe
-- negativo (reverses_id → el original) — la suma de payment_collections
-- por payment_id sigue siendo, en todo momento, el saldo real.
--
-- Lo mismo para la comisión/propina que ese cobro había habilitado: se
-- inserta un evento NUEVO negativo, sin settlement_run_id (nunca se tocan
-- los eventos ya bloqueados a una liquidación cerrada). Si la liquidación
-- que incluyó el cobro original ya se preparó, ese evento negativo queda
-- sin liquidar y lo recoge automáticamente la PRÓXIMA vez que se prepare
-- una liquidación para ese profesional (aparece como un recuperado
-- negativo en "Pagos pendientes recuperados", con fecha de hoy) — la
-- liquidación vieja no se reabre ni se recalcula.
--
-- Solo roles no-profesional (mismo criterio que el resto de los RPCs de
-- dinero) — un profesional no puede revertir sus propios cobros.
--
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase (primero en
-- desarrollo, después en producción) y ejecutar. Idempotente.
-- ============================================================================
begin;

create or replace function public.reverse_payment_collection(
  p_business_id uuid,
  p_payment_collection_id uuid,
  p_reason text,
  p_reversed_by uuid,
  p_reversed_by_name text default null
)
returns table (
  reversal_id uuid,
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
  v_original public.payment_collections;
  v_payment public.payments;
  v_reversal_id uuid;
  v_new_collected numeric;
  v_new_status text;
  v_total numeric;
  v_cce record;
  v_tce record;
begin
  if p_reversed_by is distinct from auth.uid() then
    raise exception 'reversed_by debe ser el usuario autenticado';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Una reversión necesita un motivo';
  end if;

  select p.business_id, p.role into v_caller_business, v_caller_role
    from public.profiles p where p.id = auth.uid();

  if v_caller_business is null or v_caller_business is distinct from p_business_id then
    raise exception 'No autorizado para revertir cobros en este negocio';
  end if;

  if v_caller_role = 'profesional' then
    raise exception 'Un profesional no puede revertir cobros';
  end if;

  select * into v_original
    from public.payment_collections
    where id = p_payment_collection_id and business_id = p_business_id
    for update;

  if v_original.id is null then
    raise exception 'El cobro indicado no existe en este negocio';
  end if;
  if v_original.reverses_id is not null then
    raise exception 'No se puede revertir una reversión';
  end if;
  if v_original.reversed_at is not null then
    raise exception 'Este cobro ya fue revertido';
  end if;
  if v_original.amount <= 0 then
    raise exception 'Solo se pueden revertir cobros (importe positivo)';
  end if;

  select * into v_payment
    from public.payments
    where id = v_original.payment_id
    for update;

  v_total := coalesce(v_payment.total, v_payment.amount, 0);
  v_new_collected := greatest(0, v_payment.collected_amount - v_original.amount);
  v_new_status := case
    when v_new_collected <= 0.004 then 'pendiente'
    when v_new_collected < v_total - 0.004 then 'parcial'
    else 'cobrado'
  end;

  update public.payments
    set collected_amount = v_new_collected,
        status = v_new_status
    where id = v_payment.id;

  update public.payment_collections
    set reversed_at = now(),
        reversed_by = p_reversed_by,
        reversal_reason = p_reason
    where id = v_original.id;

  insert into public.payment_collections (
    business_id, branch_id, payment_id, amount, method, collected_by, collected_by_name,
    collected_at, reverses_id, reversal_reason
  ) values (
    p_business_id, v_original.branch_id, v_original.payment_id, -v_original.amount, v_original.method,
    p_reversed_by, p_reversed_by_name, now(), v_original.id, p_reason
  ) returning id into v_reversal_id;

  -- Cada evento de comisión/propina que este cobro había habilitado se
  -- compensa con uno nuevo, negativo, sin settlement_run_id — si el
  -- original ya estaba bloqueado a una liquidación, esa liquidación queda
  -- intacta (nunca se le toca settlement_run_id ni su importe).
  for v_cce in
    select * from public.commission_collection_events where payment_collection_id = v_original.id
  loop
    insert into public.commission_collection_events (
      business_id, commission_record_id, payment_collection_id, amount, collected_at
    ) values (
      p_business_id, v_cce.commission_record_id, v_reversal_id, -v_cce.amount, now()
    );
    update public.commission_records
      set paid_amount = greatest(0, paid_amount - v_cce.amount),
          status = case when greatest(0, paid_amount - v_cce.amount) <= 0.004 then 'pending'
                        when greatest(0, paid_amount - v_cce.amount) < amount - 0.004 then 'partially_paid'
                        else status end
      where id = v_cce.commission_record_id;
  end loop;

  for v_tce in
    select * from public.tip_collection_events where payment_collection_id = v_original.id
  loop
    insert into public.tip_collection_events (
      business_id, tip_record_id, payment_collection_id, amount, collected_at
    ) values (
      p_business_id, v_tce.tip_record_id, v_reversal_id, -v_tce.amount, now()
    );
    update public.tip_records
      set paid_amount = greatest(0, paid_amount - v_tce.amount),
          status = case when greatest(0, paid_amount - v_tce.amount) <= 0.004 then 'pending'
                        when greatest(0, paid_amount - v_tce.amount) < amount - 0.004 then 'partially_paid'
                        else status end
      where id = v_tce.tip_record_id;
  end loop;

  return query select v_reversal_id, v_payment.id, v_new_status, v_new_collected, v_total - v_new_collected;
end;
$$;

revoke all on function public.reverse_payment_collection(uuid, uuid, text, uuid, text) from public;
grant execute on function public.reverse_payment_collection(uuid, uuid, text, uuid, text) to authenticated;

NOTIFY pgrst, 'reload schema';

commit;
