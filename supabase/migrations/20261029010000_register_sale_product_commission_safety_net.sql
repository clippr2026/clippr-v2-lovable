-- Red de seguridad server-side para comisión de PRODUCTOS en register_sale.
--
-- Caso real que la disparó: Alan Repila compró "Pomada Ambush" ($29.000,
-- transferencia, 20/10/2026) a Alejandro, que tiene un override activo de
-- 10% configurado para ese producto — pero la venta nunca generó fila en
-- commission_records. La resolución de "¿tiene este profesional comisión
-- configurada para este producto?" era 100% responsabilidad del cliente
-- (computeCommissionAmount, src/lib/service-pricing.ts): si CUALQUIER
-- flujo de cobro (recepción, profesional, turno manual, etc.) no armaba o
-- mandaba bien ese cálculo, la venta quedaba sin comisión para siempre,
-- sin ningún resguardo — ni un error, ni un aviso.
--
-- Esta migración agrega un parámetro nuevo opcional, p_product_commission_lines
-- (jsonb, default null — ningún llamador viejo se rompe), con un array de
-- {id, net_amount} por cada ítem de catálogo de la venta (net_amount = line
-- bruta menos su descuento ya atribuido). register_sale usa eso para
-- recalcular del lado del servidor, contra la configuración REAL
-- (business_settings.schedule._employeeCommissions), cuánto debería valer
-- la comisión de productos — y si eso es MÁS que lo que el cliente mandó
-- (p_commission_amount_products, incluido el caso "nada"), suma la
-- diferencia. Nunca resta nada de lo que el cliente ya calculó bien, nunca
-- inventa un % para un producto sin override activo, y las comisiones de
-- SERVICIOS siguen siendo 100% responsabilidad del cliente, sin cambios.
--
-- El guard de inserción (antes `coalesce(p_commission_amount,0) > 0`) pasa
-- a usar el monto final ya topeado — así una venta que el cliente mandó con
-- comisión $0 pero que sí tiene override activo de producto, ahora SÍ
-- genera su fila en commission_records. La proporción de un cobro parcial
-- (v_commission_increment) también pasa a usar el monto final, para que un
-- pago en cuotas reparta bien la comisión ya corregida.
--
-- Cambia únicamente register_sale. No toca computeCommissionAmount, ningún
-- dato histórico, ninguna liquidación ni cierre ya existente.

drop function if exists public.register_sale(
  uuid, uuid, uuid, uuid, text, text, numeric, numeric, numeric, jsonb, text, jsonb,
  uuid, text, text, text, uuid, text, uuid, text, text, numeric, numeric, numeric,
  numeric, numeric, uuid, timestamp with time zone, text, numeric, numeric, numeric
);

CREATE OR REPLACE FUNCTION public.register_sale(p_business_id uuid, p_branch_id uuid, p_employee_id uuid, p_client_id uuid, p_client_name text, p_service_name text, p_amount numeric, p_total numeric, p_tip_amount numeric, p_items jsonb, p_method text, p_splits jsonb, p_appointment_id uuid, p_appointment_notes text, p_charge_type text, p_status text, p_session_id uuid, p_notes text, p_promotion_id uuid, p_promotion_name text, p_discount_type text, p_discount_value numeric, p_discount numeric, p_original_amount numeric, p_commission_amount numeric, p_commission_pct numeric, p_charged_by uuid, p_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_idempotency_key text DEFAULT NULL::text, p_collected_amount numeric DEFAULT NULL::numeric, p_commission_amount_services numeric DEFAULT NULL::numeric, p_commission_amount_products numeric DEFAULT NULL::numeric, p_product_commission_lines jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(payment_id uuid, commission_record_id uuid, tip_record_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Red de seguridad server-side para comisión de PRODUCTOS (ver migración
  -- 20261029010000_register_sale_product_commission_safety_net): un
  -- producto de catálogo solo comisiona si el profesional tiene un
  -- override activo configurado en Equipo → Comisiones → Catálogo
  -- (business_settings.schedule._employeeCommissions) — nunca el % general
  -- de servicios. Hasta ahora esa resolución era 100% responsabilidad del
  -- cliente (computeCommissionAmount) y, si algún flujo de cobro no la
  -- aplicaba bien (venta de Alan Repila/Alejandro, 20/10/2026), la venta
  -- quedaba sin comisión para siempre, sin ningún resguardo. Esto NUNCA
  -- resta nada de lo que ya envía el cliente — solo completa la diferencia
  -- si el override activo implica más comisión de productos que la que el
  -- cliente contempló (incluyendo "nada", cuando no manda este parámetro).
  -- Las comisiones de SERVICIOS siguen siendo 100% responsabilidad del
  -- cliente, sin cambios.
  v_commissions_map jsonb;
  v_server_product_commission numeric := 0;
  v_amount_products numeric;
  v_amount_services numeric;
  v_final_commission_amount numeric;
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

  -- Recálculo server-side de la comisión de PRODUCTOS a partir de la
  -- configuración REAL (business_settings), nunca inventada: cada línea en
  -- p_product_commission_lines (solo ítems de catálogo, {id, net_amount})
  -- se contrasta contra el override de ESE profesional para ESE producto.
  -- Sin override activo (o sin value > 0) para un id puntual, esa línea
  -- aporta $0 — igual que hoy, nunca cae a ningún % general.
  if p_employee_id is not null and p_product_commission_lines is not null
     and jsonb_array_length(p_product_commission_lines) > 0 then
    select schedule -> '_employeeCommissions' -> p_employee_id::text
      into v_commissions_map
      from public.business_settings
      where business_id = p_business_id;

    select coalesce(sum(
      case
        when v_commissions_map -> (line ->> 'id') is null then 0
        when coalesce((v_commissions_map -> (line ->> 'id') ->> 'enabled')::boolean, true) = false then 0
        when (v_commissions_map -> (line ->> 'id') ->> 'mode') = 'fixed'
          then coalesce((v_commissions_map -> (line ->> 'id') ->> 'value')::numeric, 0)
        else
          round(
            coalesce((v_commissions_map -> (line ->> 'id') ->> 'value')::numeric, 0) / 100.0
              * coalesce((line ->> 'net_amount')::numeric, 0)
          )
      end
    ), 0)
    into v_server_product_commission
    from jsonb_array_elements(p_product_commission_lines) as line;
  end if;

  -- v_final_commission_amount nunca es MENOR que p_commission_amount (lo
  -- que ya traía el cliente) — solo suma la diferencia si el override
  -- activo de productos vale más de lo que el cliente contempló (incluido
  -- el caso "nada", p_commission_amount_products null/0). Si el cliente ya
  -- lo calculó bien (caso de hoy, sin cambios), el resultado es IDÉNTICO
  -- al de siempre.
  v_amount_products := greatest(coalesce(p_commission_amount_products, 0), v_server_product_commission);
  v_final_commission_amount := coalesce(p_commission_amount, 0)
    + greatest(0, v_server_product_commission - coalesce(p_commission_amount_products, 0));
  v_amount_services := v_final_commission_amount - v_amount_products;

  -- commission_records.amount sigue siendo el potencial COMPLETO de la
  -- venta, cobrada o no — nunca cambia por esto. Lo que varía con un pago
  -- pendiente/parcial es paid_amount (abajo), nunca amount.
  if p_employee_id is not null and v_commission_enabled and v_final_commission_amount > 0 then
    insert into public.commission_records (
      business_id, professional_id, sale_id, amount, amount_services, amount_products,
      sale_date, created_at, commission_pct
    ) values (
      p_business_id, p_employee_id, v_payment_id, v_final_commission_amount,
      v_amount_services, v_amount_products,
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
      v_commission_increment := round(v_final_commission_amount * v_collected_amount / p_total, 2);
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
$function$;

NOTIFY pgrst, 'reload schema';
