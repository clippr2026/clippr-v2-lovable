-- ============================================================================
-- Movimiento #N — RPCs que asignan el numero (pago batch + adelanto)
-- ============================================================================
-- Complementa 20260731010000_business_movements.sql (que solo creo el
-- esquema, sin que nada lo usara todavia).
--
-- 1. register_settlement_run_payment_batch reemplaza a
--    register_settlement_run_payment: en vez de que el frontend llame al
--    RPC una vez por cada metodo de un pago multiple (loop secuencial hoy
--    en cash-register.tsx, con riesgo conocido de fallo parcial a mitad de
--    loop), recibe TODOS los splits de una sola accion de "Pagar" en un
--    array jsonb y los inserta en una sola transaccion, todo o nada, con
--    un unico movement_number compartido entre todas las filas que genera.
--
-- 2. register_professional_advance se redefine (misma firma, no rompe el
--    call-site actual) para pedir su propio movement_number despues de
--    insertar el adelanto.
--
-- Como correrlo: pegar completo en el SQL Editor de Supabase (proyecto
-- pypduwtioxudgepwjvom, el de myclippr.com) y ejecutar. Requiere que
-- 20260731010000_business_movements.sql ya haya corrido. Idempotente.
-- ============================================================================

-- 1. register_settlement_run_payment_batch
create or replace function public.register_settlement_run_payment_batch(
  p_settlement_run_id uuid,
  p_splits jsonb,
  p_note text,
  p_paid_by uuid,
  p_paid_by_name text
)
returns table (movement_number int, run public.settlement_runs)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_caller_business uuid;
  v_run public.settlement_runs;
  v_remaining_before numeric;
  v_remaining_after numeric;
  v_total_amount numeric := 0;
  v_split jsonb;
  v_split_amount numeric;
  v_split_method text;
  v_balance_before numeric;
  v_balance_after numeric;
  v_first boolean := true;
  v_movement public.business_movements;
  v_movement_type text;
  v_apply_remaining numeric;
  v_rec record;
  v_apply numeric;
begin
  if p_splits is null or jsonb_array_length(p_splits) = 0 then
    raise exception 'Debe indicarse al menos un pago';
  end if;

  if p_paid_by is distinct from auth.uid() then
    raise exception 'paid_by debe ser el usuario autenticado';
  end if;

  select * into v_run from public.settlement_runs where id = p_settlement_run_id for update;
  if not found then
    raise exception 'Liquidacion no encontrada';
  end if;

  select p.role, p.business_id into v_role, v_caller_business
  from public.profiles p where p.id = auth.uid();

  if v_caller_business is distinct from v_run.business_id then
    raise exception 'No tenes permiso sobre este negocio';
  end if;

  if v_role = 'profesional' then
    raise exception 'Un profesional no puede registrar sus propios pagos';
  end if;

  for v_split in select * from jsonb_array_elements(p_splits)
  loop
    v_split_amount := coalesce((v_split->>'amount')::numeric, 0);
    if v_split_amount <= 0 then
      raise exception 'Cada pago debe tener un importe mayor a cero';
    end if;
    v_total_amount := v_total_amount + v_split_amount;
  end loop;

  v_remaining_before := v_run.total_to_settle - v_run.amount_paid;
  if v_total_amount > v_remaining_before then
    raise exception 'El monto a pagar (%) supera el saldo de esta liquidacion (%)', v_total_amount, v_remaining_before;
  end if;

  v_remaining_after := v_remaining_before - v_total_amount;
  v_movement_type := case when v_remaining_after <= 0 then 'pago_total' else 'pago_parcial' end;

  select * into v_movement from public.next_business_movement_number(
    v_run.business_id, v_movement_type, v_run.professional_id, v_total_amount, now()
  );

  v_balance_before := v_remaining_before;
  for v_split in select * from jsonb_array_elements(p_splits)
  loop
    v_split_amount := (v_split->>'amount')::numeric;
    v_split_method := v_split->>'method';
    v_balance_after := v_balance_before - v_split_amount;

    insert into public.settlement_payments (
      settlement_run_id, business_id, professional_id, amount, payment_method, note,
      balance_before, balance_after, paid_by, paid_by_name,
      movement_number, movement_id
    ) values (
      v_run.id, v_run.business_id, v_run.professional_id, v_split_amount, v_split_method,
      case when v_first then nullif(trim(coalesce(p_note, '')), '') else null end,
      v_balance_before, v_balance_after, p_paid_by, p_paid_by_name,
      v_movement.movement_number, v_movement.id
    );

    v_balance_before := v_balance_after;
    v_first := false;
  end loop;

  update public.settlement_runs
    set amount_paid = amount_paid + v_total_amount,
        status = case when amount_paid + v_total_amount >= total_to_settle then 'pagada' else 'parcial' end
    where id = v_run.id
    returning * into v_run;

  v_apply_remaining := v_total_amount;
  for v_rec in
    select id, pending_amount
    from public.commission_records
    where settlement_run_id = v_run.id
      and status in ('pending', 'partially_paid')
    order by sale_date asc, created_at asc
    for update
  loop
    exit when v_apply_remaining <= 0;
    v_apply := least(v_apply_remaining, v_rec.pending_amount);
    continue when v_apply <= 0;

    update public.commission_records
      set paid_amount = paid_amount + v_apply,
          status = case when paid_amount + v_apply >= amount then 'paid' else 'partially_paid' end
      where id = v_rec.id;

    v_apply_remaining := v_apply_remaining - v_apply;
  end loop;

  return query select v_movement.movement_number, v_run;
end;
$$;

grant execute on function public.register_settlement_run_payment_batch(
  uuid, jsonb, text, uuid, text
) to authenticated;

-- 2. register_professional_advance: agrega movement_number
create or replace function public.register_professional_advance(
  p_business_id uuid,
  p_professional_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_note text,
  p_advanced_at timestamptz,
  p_registered_by uuid,
  p_registered_by_name text
)
returns public.professional_advances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_caller_business uuid;
  v_advance public.professional_advances;
  v_movement public.business_movements;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto del adelanto debe ser mayor a cero';
  end if;

  if p_registered_by is distinct from auth.uid() then
    raise exception 'registered_by debe ser el usuario autenticado';
  end if;

  select p.role, p.business_id into v_role, v_caller_business
  from public.profiles p where p.id = auth.uid();

  if v_caller_business is distinct from p_business_id then
    raise exception 'No tenes permiso sobre este negocio';
  end if;

  if v_role = 'profesional' then
    raise exception 'Un profesional no puede registrarse adelantos a si mismo';
  end if;

  select * into v_movement from public.next_business_movement_number(
    p_business_id, 'adelanto', p_professional_id, p_amount, coalesce(p_advanced_at, now())
  );

  insert into public.professional_advances (
    business_id, professional_id, amount, payment_method, note,
    advanced_at, registered_by, registered_by_name,
    movement_number, movement_id
  ) values (
    p_business_id, p_professional_id, p_amount, nullif(trim(coalesce(p_payment_method, '')), ''),
    nullif(trim(coalesce(p_note, '')), ''),
    coalesce(p_advanced_at, now()), p_registered_by, p_registered_by_name,
    v_movement.movement_number, v_movement.id
  ) returning * into v_advance;

  return v_advance;
end;
$$;

grant execute on function public.register_professional_advance(
  uuid, uuid, numeric, text, text, timestamptz, uuid, text
) to authenticated;

NOTIFY pgrst, 'reload schema';
