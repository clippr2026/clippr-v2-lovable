-- ============================================================================
-- employees.commission_enabled — toggle explícito por profesional
-- ============================================================================
-- Causa real (reporte de Alan, 22/10/2026): el dueño del negocio también
-- realiza servicios (se asigna a ventas como cualquier profesional), pero
-- no debería generar comisión sobre sus propias ventas — no existía ninguna
-- forma de desactivar esto: computeCommissionAmount (service-pricing.ts)
-- siempre cae al % general del profesional si no hay override por servicio,
-- sin importar el rol de la cuenta. No hay ningún `employees.role` tipo
-- 'admin'/'dueño' del que depender (el "rol" visible en Equipo es un
-- título de texto libre, guardado aparte en business_settings) — se agrega
-- una columna explícita en vez de inferir nada por rol.
--
-- Default true: ningún profesional existente cambia de comportamiento al
-- correr esta migración. Las propinas (tip_records) no se tocan — son
-- plata del profesional, nunca dependen de esto.
--
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase (primero en
-- desarrollo, después en producción) y ejecutar. Idempotente.
-- ============================================================================
begin;

alter table public.employees
  add column if not exists commission_enabled boolean not null default true;

-- ── register_sale: fuerza comisión $0 server-side si el profesional tiene
-- commission_enabled = false, sin importar lo que mande el cliente. Mismo
-- signature que la versión vigente (20261019040000_payments_idempotency_key.sql,
-- 29 parámetros) — create or replace alcanza, no hace falta drop.
create or replace function public.register_sale(
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
  p_idempotency_key text default null
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
    charge_type, status, charged_at, created_at, session_id, charged_by,
    observations, promotion_id, promotion_name, discount_type, discount_value,
    discount, original_amount, splits, idempotency_key
  ) values (
    p_business_id, p_branch_id, p_employee_id, p_client_id,
    case when p_client_name is null then null
         else coalesce(nullif(trim(p_client_name), ''), 'Cliente del mostrador') end,
    p_service_name,
    p_total, p_total, coalesce(p_tip_amount, 0), p_items, p_method, p_method, p_appointment_id,
    coalesce(p_charge_type, 'caja'), coalesce(p_status, 'cobrado'), v_created_at, v_created_at,
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

  if p_employee_id is not null and v_commission_enabled and coalesce(p_commission_amount, 0) > 0 then
    insert into public.commission_records (
      business_id, professional_id, sale_id, amount, sale_date, created_at, commission_pct
    ) values (
      p_business_id, p_employee_id, v_payment_id, p_commission_amount,
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

  return query select v_payment_id, v_commission_id, v_tip_id;
end;
$$;

revoke all on function public.register_sale(
  uuid, uuid, uuid, uuid, text, text, numeric, numeric, numeric, jsonb, text, jsonb,
  uuid, text, text, text, uuid, text, uuid, text, text, numeric, numeric, numeric,
  numeric, numeric, uuid, timestamptz, text
) from public;
grant execute on function public.register_sale(
  uuid, uuid, uuid, uuid, text, text, numeric, numeric, numeric, jsonb, text, jsonb,
  uuid, text, text, text, uuid, text, uuid, text, text, numeric, numeric, numeric,
  numeric, numeric, uuid, timestamptz, text
) to authenticated;

-- ── register_commission: mismo guardrail. RPC legado (superseded por
-- register_sale, ver 20261008010000_register_commission_rpc.sql), ya no lo
-- llama ningún código del frontend, pero sigue con permiso de ejecución
-- otorgado — se protege igual por las dudas.
create or replace function public.register_commission(
  p_business_id uuid,
  p_professional_id uuid,
  p_sale_id uuid,
  p_amount numeric,
  p_sale_date date,
  p_created_at timestamptz,
  p_commission_pct numeric default null
)
returns table (id uuid, inserted boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_business_id uuid;
  v_caller_role text;
  v_caller_employee_id uuid;
  v_sale_business_id uuid;
  v_sale_employee_id uuid;
  v_sale_total numeric;
  v_record_id uuid;
  v_commission_enabled boolean := true;
begin
  select p.business_id, p.role, p.employee_id
    into v_caller_business_id, v_caller_role, v_caller_employee_id
    from public.profiles p
    where p.id = auth.uid();

  if v_caller_business_id is null or v_caller_business_id is distinct from p_business_id then
    raise exception 'No autorizado para registrar comisión en este negocio';
  end if;

  if v_caller_role = 'profesional' and v_caller_employee_id is distinct from p_professional_id then
    raise exception 'Un profesional solo puede registrar su propia comisión';
  end if;

  select p.business_id, p.employee_id, coalesce(p.total, p.amount, 0)
    into v_sale_business_id, v_sale_employee_id, v_sale_total
    from public.payments p
    where p.id = p_sale_id;

  if v_sale_business_id is null then
    raise exception 'La venta indicada no existe';
  end if;
  if v_sale_business_id is distinct from p_business_id then
    raise exception 'La venta no pertenece a este negocio';
  end if;
  if v_sale_employee_id is distinct from p_professional_id then
    raise exception 'La venta no corresponde a ese profesional';
  end if;

  if p_amount is null or p_amount < 0 then
    raise exception 'Monto de comisión inválido';
  end if;
  if p_amount > v_sale_total then
    raise exception 'El monto de comisión no puede superar el total cobrado en la venta';
  end if;
  if p_commission_pct is not null and (p_commission_pct < 0 or p_commission_pct > 100) then
    raise exception 'Porcentaje de comisión fuera de rango';
  end if;

  select coalesce(e.commission_enabled, true) into v_commission_enabled
    from public.employees e
    where e.id = p_professional_id;

  if not v_commission_enabled then
    return query select null::uuid, false;
    return;
  end if;

  insert into public.commission_records (
    business_id, professional_id, sale_id, amount, sale_date, created_at, commission_pct
  ) values (
    p_business_id, p_professional_id, p_sale_id, p_amount, p_sale_date, p_created_at, p_commission_pct
  )
  on conflict (sale_id) do nothing
  returning commission_records.id into v_record_id;

  if v_record_id is not null then
    return query select v_record_id, true;
    return;
  end if;

  select cr.id into v_record_id
    from public.commission_records cr
    where cr.sale_id = p_sale_id;

  return query select v_record_id, false;
end;
$$;

revoke all on function public.register_commission(uuid, uuid, uuid, numeric, date, timestamptz, numeric) from public;
grant execute on function public.register_commission(uuid, uuid, uuid, numeric, date, timestamptz, numeric) to authenticated;

NOTIFY pgrst, 'reload schema';

commit;
