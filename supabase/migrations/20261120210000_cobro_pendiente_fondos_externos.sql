-- Cobrar pendiente: el cobro puede entrar a la CAJA o a FONDOS EXTERNOS. Un cobro de fondos
-- externos cuenta como venta (facturación, comisión, propina) pero no suma al efectivo ni al dinero
-- en cuenta de la caja. Los cobros existentes quedan como 'caja'. La reversión hereda el origen.
alter table public.payment_collections
  add column if not exists funds_source text not null default 'caja';
alter table public.payment_collections drop constraint if exists payment_collections_funds_source_check;
alter table public.payment_collections
  add constraint payment_collections_funds_source_check check (funds_source in ('caja', 'externo'));

drop function if exists public.collect_pending_payment(uuid, uuid, numeric, text, uuid, uuid, text, text, text, timestamptz, text);

CREATE OR REPLACE FUNCTION public.collect_pending_payment(p_business_id uuid, p_payment_id uuid, p_amount numeric, p_method text, p_collected_by uuid, p_branch_id uuid DEFAULT NULL::uuid, p_receipt_path text DEFAULT NULL::text, p_observations text DEFAULT NULL::text, p_collected_by_name text DEFAULT NULL::text, p_collected_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_idempotency_key text DEFAULT NULL::text, p_funds_source text DEFAULT 'caja'::text)
 RETURNS TABLE(payment_collection_id uuid, payment_id uuid, new_status text, new_collected_amount numeric, new_pending_amount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  if coalesce(p_funds_source, 'caja') not in ('caja', 'externo') then
    raise exception 'Origen del cobro inválido (caja o externo)';
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
    collected_by, collected_by_name, collected_at, idempotency_key, funds_source
  ) values (
    p_business_id, coalesce(p_branch_id, v_payment.branch_id), p_payment_id, p_amount, p_method,
    p_receipt_path, nullif(trim(coalesce(p_observations, '')), ''),
    p_collected_by, p_collected_by_name, v_collected_at, p_idempotency_key,
    coalesce(p_funds_source, 'caja')
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
$function$;

CREATE OR REPLACE FUNCTION public.reverse_payment_collection(p_business_id uuid, p_payment_collection_id uuid, p_reason text, p_reversed_by uuid, p_reversed_by_name text DEFAULT NULL::text)
 RETURNS TABLE(reversal_id uuid, payment_id uuid, new_status text, new_collected_amount numeric, new_pending_amount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    collected_at, reverses_id, reversal_reason, funds_source
  ) values (
    p_business_id, v_original.branch_id, v_original.payment_id, -v_original.amount, v_original.method,
    p_reversed_by, p_reversed_by_name, now(), v_original.id, p_reason, v_original.funds_source
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
$function$;

NOTIFY pgrst, 'reload schema';
