-- ============================================================================
-- Liquidaciones — RPC transaccional para el botón "Pagar" + columna faltante
-- ============================================================================
-- Complementa 20260719215606_liquidaciones_system.sql. Agrega:
--   1. La columna `note` en professional_settlements (el spec original de
--      la tabla no la incluía, pero el flujo de pago sí necesita una nota
--      opcional por pago).
--   2. La función register_settlement_payment: aplica un pago contra las
--      comisiones pendientes más viejas primero, actualiza cada
--      commission_record tocada, y crea UNA fila en professional_settlements
--      con los snapshots — todo en una sola transacción de base de datos
--      (no varios requests sueltos desde el cliente), para que nunca pueda
--      quedar a medio hacer.
--
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase y ejecutar.
-- Seguro re-ejecutar (create or replace / add column if not exists).
-- ============================================================================

alter table public.professional_settlements
  add column if not exists note text;

create or replace function public.register_settlement_payment(
  p_business_id uuid,
  p_professional_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_note text,
  p_paid_by uuid,
  p_paid_by_name text
)
returns public.professional_settlements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_caller_business uuid;
  v_commission_total numeric;
  v_already_paid_before numeric;
  v_total_pending numeric;
  v_remaining numeric;
  v_range_from date;
  v_range_to date;
  v_settlement public.professional_settlements;
  v_rec record;
  v_apply numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto a pagar debe ser mayor a cero';
  end if;

  if p_paid_by is distinct from auth.uid() then
    raise exception 'paid_by debe ser el usuario autenticado';
  end if;

  select p.role, p.business_id into v_role, v_caller_business
  from public.profiles p where p.id = auth.uid();

  if v_caller_business is distinct from p_business_id then
    raise exception 'No tenés permiso sobre este negocio';
  end if;

  if v_role = 'profesional' then
    raise exception 'Un profesional no puede registrar sus propios pagos';
  end if;

  -- Saldo real: comisión total generada vs. ya pagada, sin importar rango
  -- de fechas (a nivel de comisión individual, ver commission_records).
  select coalesce(sum(amount), 0), coalesce(sum(paid_amount), 0), coalesce(sum(pending_amount), 0)
    into v_commission_total, v_already_paid_before, v_total_pending
  from public.commission_records
  where business_id = p_business_id and professional_id = p_professional_id;

  if p_amount > v_total_pending then
    raise exception 'El monto a pagar (%) supera el saldo pendiente (%)', p_amount, v_total_pending;
  end if;

  select min(sale_date), max(sale_date) into v_range_from, v_range_to
  from public.commission_records
  where business_id = p_business_id and professional_id = p_professional_id
    and status in ('pending', 'partially_paid');

  if v_range_from is null then
    v_range_from := current_date;
    v_range_to := current_date;
  end if;

  insert into public.professional_settlements (
    business_id, professional_id, range_from, range_to,
    commission_total_in_range, already_paid_before, amount_paid, pending_after,
    payment_method, note, paid_by, paid_by_name
  ) values (
    p_business_id, p_professional_id, v_range_from, v_range_to,
    v_commission_total, v_already_paid_before, p_amount, v_total_pending - p_amount,
    p_payment_method, nullif(trim(coalesce(p_note, '')), ''), p_paid_by, p_paid_by_name
  ) returning * into v_settlement;

  v_remaining := p_amount;
  for v_rec in
    select id, pending_amount
    from public.commission_records
    where business_id = p_business_id and professional_id = p_professional_id
      and status in ('pending', 'partially_paid')
    order by sale_date asc, created_at asc
    for update
  loop
    exit when v_remaining <= 0;
    v_apply := least(v_remaining, v_rec.pending_amount);
    continue when v_apply <= 0;

    insert into public.settlement_commission_links (settlement_id, commission_record_id, amount_applied)
    values (v_settlement.id, v_rec.id, v_apply);

    update public.commission_records
      set paid_amount = paid_amount + v_apply,
          status = case when paid_amount + v_apply >= amount then 'paid' else 'partially_paid' end
      where id = v_rec.id;

    v_remaining := v_remaining - v_apply;
  end loop;

  return v_settlement;
end;
$$;

grant execute on function public.register_settlement_payment(
  uuid, uuid, numeric, text, text, uuid, text
) to authenticated;
