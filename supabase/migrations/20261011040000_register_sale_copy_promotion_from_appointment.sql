-- ============================================================================
-- register_sale — copiar siempre promotion_id/promotion_name desde el turno
-- ============================================================================
-- Causa real encontrada (auditoría Promo UADE, 11/10/2026): el turno
-- (appointments.promotion_id + promotion_snapshot) puede tener una promo
-- real asociada, pero el payment se arma a partir de `selectedPromotion`
-- (estado de la UI al momento de cobrar) — si quien cobra no vuelve a
-- elegir la promo en el modal de "Cobrar turno" (o la pierde de cualquier
-- otra forma), el payment queda sin promotion_id/promotion_name aunque el
-- turno sí la tuviera. 16 de 38 turnos con Promo UADE terminaron así, 12
-- de ellos cobrados como "Descuento manual" por el mismo monto exacto de
-- la promo.
--
-- Fix: cuando la venta viene de un turno (`p_appointment_id` no nulo) y
-- ese turno tiene una promoción, ESA es la fuente de verdad —
-- `register_sale` la lee en la misma transacción (en el mismo UPDATE que
-- ya hace la transición a 'charged', sin una consulta extra) y la usa
-- para `payments.promotion_id`/`promotion_name`, sin importar qué haya
-- mandado el cliente. Si el turno no tiene promoción, se sigue usando lo
-- que mande el cliente (venta directa con promo elegida en Caja, sin
-- turno de por medio).
--
-- No toca discount/discount_type/discount_value/el monto cobrado — eso
-- sigue siendo responsabilidad exclusiva del cliente (computeCommission
-- Amount/el carrito de Caja), esto solo corrige QUÉ promoción queda
-- identificada en el payment, nunca cuánto se cobró.
--
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase (proyecto de
-- myclippr.com) y ejecutar. Seguro re-ejecutar (create or replace).
-- ============================================================================

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
  p_created_at timestamptz default null
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
begin
  -- Identidad de quien llama — nunca se confía en nada que mande el
  -- frontend sobre "quién soy", siempre se resuelve server-side desde
  -- auth.uid() (mismo criterio que register_commission/
  -- prepare_settlement_run).
  select p.business_id, p.role, p.employee_id
    into v_caller_business, v_caller_role, v_caller_employee_id
    from public.profiles p
    where p.id = auth.uid();

  if v_caller_business is null or v_caller_business is distinct from p_business_id then
    raise exception 'No autorizado para registrar ventas en este negocio';
  end if;

  -- Un profesional solo puede registrar SU PROPIA venta (si va asignada a
  -- alguien) — cualquier otro rol (admin, socio, recepcionista) puede
  -- cobrar para cualquier profesional de su negocio. Antes esto no se
  -- validaba en ningún lado server-side: registerPayment() insertaba
  -- directo contra payments confiando en lo que mandara el cliente.
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

  -- Turno de Agenda: la transición a 'charged' pasa a vivir DENTRO de esta
  -- misma transacción — antes era un UPDATE aparte, ANTES de llamar a
  -- registerPayment(); si el payment fallaba después, el turno quedaba
  -- marcado "cobrado" sin ningún payment real (3 casos así en producción).
  -- Mismo guard exacto que ya usaba el cliente: si el turno ya no está en
  -- un estado "cobrable", aborta TODO (ni el payment se llega a insertar).
  --
  -- Mismo UPDATE trae de regalo promotion_id/promotion_snapshot del turno
  -- (sin una consulta aparte) — es la fuente de verdad para la promo de
  -- este payment cuando la venta viene de un turno, ver más abajo.
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

    -- El turno es la fuente de verdad cuando tiene una promo: pisa lo que
    -- haya mandado el cliente (nunca al revés). Si el turno no tiene
    -- promoción, se respeta lo que mandó el cliente tal cual (venta
    -- directa con promo elegida en Caja, o sin promo en absoluto).
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
    discount, original_amount, splits
  ) values (
    p_business_id, p_branch_id, p_employee_id, p_client_id,
    -- Mismo criterio que registerPayment(): null EXPLÍCITO (no "" ni
    -- undefined) = sin cliente real, nunca defaultear a "Cliente del
    -- mostrador" — caso de un profesional que retira/compra stock para sí
    -- mismo (Inventario → Retirar stock).
    case when p_client_name is null then null
         else coalesce(nullif(trim(p_client_name), ''), 'Cliente del mostrador') end,
    p_service_name,
    p_total, p_total, coalesce(p_tip_amount, 0), p_items, p_method, p_method, p_appointment_id,
    coalesce(p_charge_type, 'caja'), coalesce(p_status, 'cobrado'), v_created_at, v_created_at,
    p_session_id, p_charged_by, nullif(trim(coalesce(p_notes, '')), ''),
    v_final_promotion_id, v_final_promotion_name, p_discount_type, p_discount_value,
    coalesce(p_discount, 0), p_original_amount, p_splits
  ) returning id into v_payment_id;

  if p_employee_id is not null and coalesce(p_commission_amount, 0) > 0 then
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

NOTIFY pgrst, 'reload schema';
