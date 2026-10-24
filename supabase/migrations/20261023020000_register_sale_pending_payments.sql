-- ============================================================================
-- register_sale — soporta "Pago pendiente" (cobro parcial o nulo al vender)
-- ============================================================================
-- Agrega p_collected_amount (default null = se asume cobrado el total, CERO
-- cambio de comportamiento para todo llamador existente que no lo manda) y
-- p_commission_amount_services/p_commission_amount_products (desglose
-- opcional para Liquidaciones, ver 20261023010000).
--
-- Si p_collected_amount queda entre $0 y el total (sin llegar a cualquiera
-- de los dos extremos), la venta nace con payments.status='parcial' y se
-- inserta, en la MISMA transacción, el primer renglón de
-- payment_collections + su porción proporcional de
-- commission_collection_events/tip_collection_events — el resto de la
-- comisión/propina queda pendiente de cobro (commission_records.amount no
-- cambia: sigue siendo el potencial completo de la venta).
--
-- Si p_collected_amount es exactamente 0, la venta nace 'pendiente' sin
-- ningún renglón en payment_collections (no hay nada que registrar como
-- cobro todavía) — el primer cobro real llega después, por
-- collect_pending_payment (ver próxima migración).
--
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase (primero en
-- desarrollo, después en producción) y ejecutar. Idempotente.
-- ============================================================================
begin;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'register_sale'
  loop
    execute format('drop function %s', r.sig);
  end loop;
end $$;

create function public.register_sale(
  p_business_id uuid,
  p_branch_id uuid,
  p_employee_id uuid,
  p_client_id uuid,
  p_client_name text,
  p_service_name text,
  p_amount numeric,
  p_total numeric,
  p_tip_amount numeric,
  p_items jsonb,
  p_method text,
  p_splits jsonb,
  p_appointment_id uuid,
  p_appointment_notes text,
  p_charge_type text,
  p_status text,
  p_session_id uuid,
  p_notes text,
  p_promotion_id uuid,
  p_promotion_name text,
  p_discount_type text,
  p_discount_value numeric,
  p_discount numeric,
  p_original_amount numeric,
  p_commission_amount numeric,
  p_commission_pct numeric,
  p_charged_by uuid,
  p_created_at timestamptz default null,
  p_idempotency_key text default null,
  p_collected_amount numeric default null,
  p_commission_amount_services numeric default null,
  p_commission_amount_products numeric default null
)
returns table (payment_id uuid, commission_record_id uuid, tip_record_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_business uuid;
  v_caller_role text;
  v_caller_employee_id uuid;
  v_created_at timestamptz := coalesce(p_created_at, now());
  v_charged_appt_id uuid;
  v_appt_promotion_id uuid;
  v_appt_promotion_name text;
  v_final_promotion_id uuid := p_promotion_id;
  v_final_promotion_name text := p_promotion_name;
  v_payment_id uuid;
  v_commission_id uuid;
  v_tip_id uuid;
  v_commission_enabled boolean := true;
  v_collected_amount numeric;
  v_status text;
  v_collection_id uuid;
  v_commission_increment numeric;
  v_tip_increment numeric;
begin
  select p.business_id, p.role, p.employee_id
    into v_caller_business, v_caller_role, v_caller_employee_id
    from public.profiles p
    where p.id = auth.uid();

  if v_caller_business is null or v_caller_business is distinct from p_business_id then
    raise exception 'No autorizado para registrar ventas en este negocio';
  end if;

  if v_caller_role = 'profesional' and p_employee_id is not null
     and v_caller_employee_id is distinct from p_employee_id then
    raise exception 'Un profesional solo puede registrar su propia venta';
  end if;

  if p_total is null or p_total < 0 then
    raise exception 'Total de la venta inválido';
  end if;
  if p_commission_amount is not null and p_commission_amount < 0 then
    raise exception 'Monto de comisión inválido';
  end if;
  if p_commission_amount is not null and p_commission_amount > p_total then
    raise exception 'El monto de comisión no puede superar el total cobrado en la venta';
  end if;
  if p_commission_pct is not null and (p_commission_pct < 0 or p_commission_pct > 100) then
    raise exception 'Porcentaje de comisión fuera de rango';
  end if;
  if p_tip_amount is not null and p_tip_amount < 0 then
    raise exception 'Monto de propina inválido';
  end if;

  -- p_collected_amount null = comportamiento de siempre (venta cobrada
  -- completa en el momento) — ningún llamador existente manda este
  -- parámetro, así que ninguna venta actual cambia de status ni gana una
  -- fila en payment_collections.
  v_collected_amount := coalesce(p_collected_amount, p_total);
  if v_collected_amount < 0 or v_collected_amount > p_total + 0.01 then
    raise exception 'Importe cobrado inválido (no puede ser negativo ni superar el total)';
  end if;

  if coalesce(p_status, '') in ('anulado', 'reembolsado') then
    v_status := p_status;
  elsif v_collected_amount >= p_total - 0.004 then
    v_status := 'cobrado';
    v_collected_amount := p_total;
  elsif v_collected_amount <= 0.004 then
    v_status := 'pendiente';
    v_collected_amount := 0;
  else
    v_status := 'parcial';
  end if;

  if p_idempotency_key is not null then
    select id into v_payment_id
      from public.payments
      where business_id = p_business_id and idempotency_key = p_idempotency_key;

    if v_payment_id is not null then
      select cr.id into v_commission_id from public.commission_records cr where cr.sale_id = v_payment_id;
      select tr.id into v_tip_id from public.tip_records tr where tr.sale_id = v_payment_id;
      return query select v_payment_id, v_commission_id, v_tip_id;
      return;
    end if;
  end if;

  if p_appointment_id is not null then
    update public.appointments
      set status = 'charged',
          notes = coalesce(p_appointment_notes, notes)
      where id = p_appointment_id
        and business_id = p_business_id
        and status in ('pending', 'confirmed', 'in_service')
      returning id, promotion_id, promotion_snapshot ->> 'name'
      into v_charged_appt_id, v_appt_promotion_id, v_appt_promotion_name;

    if v_charged_appt_id is null then
      raise exception 'Este turno ya fue cobrado o actualizado — recargá la agenda.';
    end if;

    if v_appt_promotion_id is not null then
      v_final_promotion_id := v_appt_promotion_id;
      v_final_promotion_name := coalesce(v_appt_promotion_name, p_promotion_name);
    end if;
  end if;

  insert into public.payments (
    business_id, branch_id, employee_id, client_id, client_name, service_name,
    amount, total, tip_amount, items, method, payment_method, appointment_id,
    charge_type, status, collected_amount, charged_at, created_at, session_id, charged_by,
    observations, promotion_id, promotion_name, discount_type, discount_value,
    discount, original_amount, splits, idempotency_key
  ) values (
    p_business_id, p_branch_id, p_employee_id, p_client_id,
    case when p_client_name is null then null
         else coalesce(nullif(trim(p_client_name), ''), 'Cliente del mostrador') end,
    p_service_name,
    p_total, p_total, coalesce(p_tip_amount, 0), p_items, p_method, p_method, p_appointment_id,
    coalesce(p_charge_type, 'caja'), v_status, v_collected_amount, v_created_at, v_created_at,
    p_session_id, p_charged_by, nullif(trim(coalesce(p_notes, '')), ''),
    v_final_promotion_id, v_final_promotion_name, p_discount_type, p_discount_value,
    coalesce(p_discount, 0), p_original_amount, p_splits, p_idempotency_key
  )
  on conflict (business_id, idempotency_key) where idempotency_key is not null do nothing
  returning id into v_payment_id;

  if v_payment_id is null then
    select id into v_payment_id
      from public.payments
      where business_id = p_business_id and idempotency_key = p_idempotency_key;
    select cr.id into v_commission_id from public.commission_records cr where cr.sale_id = v_payment_id;
    select tr.id into v_tip_id from public.tip_records tr where tr.sale_id = v_payment_id;
    return query select v_payment_id, v_commission_id, v_tip_id;
    return;
  end if;

  -- Guardrail server-side: aunque el cliente mande un p_commission_amount
  -- > 0 (versión vieja cacheada, o cualquier otro origen), un profesional
  -- con commission_enabled = false nunca termina con una fila en
  -- commission_records. Única fuente de verdad de este flag: employees,
  -- nunca se vuelve a calcular el monto acá (sigue siendo responsabilidad
  -- de computeCommissionAmount en el cliente).
  if p_employee_id is not null then
    select coalesce(e.commission_enabled, true) into v_commission_enabled
      from public.employees e
      where e.id = p_employee_id;
  end if;

  -- commission_records.amount sigue siendo el potencial COMPLETO de la
  -- venta, cobrada o no — nunca cambia por esto. Lo que varía con un pago
  -- pendiente/parcial es paid_amount (abajo), nunca amount.
  if p_employee_id is not null and v_commission_enabled and coalesce(p_commission_amount, 0) > 0 then
    insert into public.commission_records (
      business_id, professional_id, sale_id, amount, amount_services, amount_products,
      sale_date, created_at, commission_pct
    ) values (
      p_business_id, p_employee_id, v_payment_id, p_commission_amount,
      p_commission_amount_services, p_commission_amount_products,
      v_created_at::date, v_created_at, p_commission_pct
    )
    on conflict (sale_id) do nothing
    returning id into v_commission_id;
  end if;

  if p_employee_id is not null and coalesce(p_tip_amount, 0) > 0 then
    insert into public.tip_records (
      business_id, professional_id, sale_id, amount, sale_date, created_at
    ) values (
      p_business_id, p_employee_id, v_payment_id, p_tip_amount, v_created_at::date, v_created_at
    )
    on conflict (sale_id) do nothing
    returning id into v_tip_id;
  end if;

  -- Cobro parcial AL MOMENTO DE VENDER (0 < cobrado < total): registra el
  -- primer renglón de payment_collections + la porción de comisión/propina
  -- que ese cobro puntual habilita, con la MISMA fórmula de "target
  -- acumulado" que usa collect_pending_payment (ver próxima migración) —
  -- así que un cobro total hecho directamente acá o uno hecho después via
  -- collect_pending_payment llegan exactamente al mismo resultado. Un
  -- cobro de $0 (venta 100% pendiente) no inserta nada todavía: no hay
  -- ningún cobro real que registrar.
  if v_status = 'parcial' and v_collected_amount > 0 then
    insert into public.payment_collections (
      business_id, branch_id, payment_id, amount, method, collected_by, collected_at
    ) values (
      p_business_id, p_branch_id, v_payment_id, v_collected_amount, p_method, p_charged_by, v_created_at
    ) returning id into v_collection_id;

    if v_commission_id is not null then
      v_commission_increment := round(p_commission_amount * v_collected_amount / p_total, 2);
      if v_commission_increment > 0 then
        insert into public.commission_collection_events (
          business_id, commission_record_id, payment_collection_id, amount, collected_at
        ) values (
          p_business_id, v_commission_id, v_collection_id, v_commission_increment, v_created_at
        );
        update public.commission_records set paid_amount = v_commission_increment where id = v_commission_id;
      end if;
    end if;

    if v_tip_id is not null then
      v_tip_increment := round(coalesce(p_tip_amount, 0) * v_collected_amount / p_total, 2);
      if v_tip_increment > 0 then
        insert into public.tip_collection_events (
          business_id, tip_record_id, payment_collection_id, amount, collected_at
        ) values (
          p_business_id, v_tip_id, v_collection_id, v_tip_increment, v_created_at
        );
        update public.tip_records set paid_amount = v_tip_increment where id = v_tip_id;
      end if;
    end if;
  end if;

  return query select v_payment_id, v_commission_id, v_tip_id;
end;
$$;

revoke all on function public.register_sale(
  uuid, uuid, uuid, uuid, text, text, numeric, numeric, numeric, jsonb, text, jsonb,
  uuid, text, text, text, uuid, text, uuid, text, text, numeric, numeric, numeric,
  numeric, numeric, uuid, timestamptz, text, numeric, numeric, numeric
) from public;
grant execute on function public.register_sale(
  uuid, uuid, uuid, uuid, text, text, numeric, numeric, numeric, jsonb, text, jsonb,
  uuid, text, text, text, uuid, text, uuid, text, text, numeric, numeric, numeric,
  numeric, numeric, uuid, timestamptz, text, numeric, numeric, numeric
) to authenticated;

NOTIFY pgrst, 'reload schema';

commit;
