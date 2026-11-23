-- ############################################################################
-- #  BORRADOR — NO APLICADO EN NINGÚN ENTORNO (se aplica solo con autorización)#
-- ############################################################################
-- ============================================================================
-- Corregir un cobro de un día TODAVÍA ABIERTO: bajar el monto fallaba con
--   new row for relation "payments" violates check constraint
--   "payments_collected_amount_range"
-- porque la corrección directa actualizaba total/amount pero dejaba
-- collected_amount con el valor viejo (mayor que el nuevo total).
-- Caso real 01/11/2026: venta de Franco González del 31/10, cargada como
-- transferencia de $25.000 y en realidad efectivo de $23.000.
--
-- Único cambio respecto de la versión vigente (20261025110000): el UPDATE de la
-- rama "día abierto" también ajusta collected_amount. No toca la rama de día
-- cerrado (tiene su propio problema conocido, ver memoria del proyecto), ni
-- ningún dato existente: solo reemplaza la definición de la función.
--
-- Cómo revertirlo: volver a aplicar la definición de correct_payment_authorized
-- de 20261025110000_performed_by_name_and_restore.sql.
-- Antes de aplicar en producción (CLAUDE.md): respaldo verificado y autorización.
-- ============================================================================

create or replace function public.correct_payment_authorized(
  p_payment_id uuid,
  p_business_id uuid,
  p_password text,
  p_reason text,
  p_new_total numeric default null,
  p_new_discount numeric default null,
  p_new_tip numeric default null,
  p_new_method text default null,
  p_new_commission_amount numeric default null,
  p_authorized_by_name text default null,
  p_performed_by_name text default null
)
returns table (adjustment_payment_id uuid, was_closed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_business uuid;
  v_caller_name text;
  v_payment public.payments;
  v_employee_name text;
  v_commission public.commission_records;
  v_tip public.tip_records;
  v_sale_date date;
  v_is_closed boolean;
  v_final_total numeric;
  v_final_discount numeric;
  v_final_tip numeric;
  v_final_method text;
  v_adjustment_id uuid;
  v_delta_total numeric;
  v_delta_tip numeric;
  v_delta_commission numeric;
  v_impact_note text;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'El motivo es obligatorio';
  end if;
  if length(p_reason) > 50 then
    raise exception 'El motivo no puede superar los 50 caracteres';
  end if;
  if p_authorized_by_name is not null and length(trim(p_authorized_by_name)) > 20 then
    raise exception 'El nombre de quien autorizó no puede superar los 20 caracteres';
  end if;
  if p_performed_by_name is not null and length(trim(p_performed_by_name)) > 20 then
    raise exception 'El nombre de quien hizo el cambio no puede superar los 20 caracteres';
  end if;

  select p.business_id into v_caller_business
  from public.profiles p where p.id = auth.uid();

  if v_caller_business is distinct from p_business_id then
    raise exception 'No tenés permiso sobre este negocio';
  end if;

  select coalesce(
    nullif(trim(p_performed_by_name), ''),
    nullif(trim(e.full_name), ''),
    nullif(trim(p.full_name), ''),
    'Usuario'
  ) into v_caller_name
  from public.profiles p
  left join public.employees e on e.id = p.employee_id
  where p.id = auth.uid();

  perform public._verify_caja_authorization_password(p_business_id, 'correction', p_password);

  select * into v_payment
  from public.payments
  where id = p_payment_id and business_id = p_business_id
  for update;

  if not found then
    raise exception 'Cobro no encontrado';
  end if;

  if v_payment.status in ('anulado', 'reembolsado') then
    raise exception 'Esta venta está anulada — no se puede corregir';
  end if;

  if v_payment.adjustment_of_payment_id is not null then
    raise exception 'Esto ya es un ajuste de otra venta — corregí la venta original';
  end if;

  select e.full_name into v_employee_name
  from public.employees e where e.id = v_payment.employee_id;

  v_final_total := coalesce(p_new_total, v_payment.total, v_payment.amount, 0);
  v_final_discount := coalesce(p_new_discount, v_payment.discount, 0);
  v_final_tip := coalesce(p_new_tip, v_payment.tip_amount, 0);
  v_final_method := coalesce(p_new_method, v_payment.method, v_payment.payment_method);

  if v_final_total < 0 then
    raise exception 'El monto no puede ser negativo';
  end if;
  if v_final_tip < 0 then
    raise exception 'La propina no puede ser negativa';
  end if;

  v_sale_date := (v_payment.created_at at time zone 'America/Argentina/Buenos_Aires')::date;

  select exists(
    select 1 from public.caja_cierres
    where business_id = p_business_id
      and branch_id is not distinct from v_payment.branch_id
      and fecha = v_sale_date
      and estado in ('cerrada', 'reabierta')
  ) into v_is_closed;

  select * into v_commission from public.commission_records where sale_id = p_payment_id;
  select * into v_tip from public.tip_records where sale_id = p_payment_id;

  if not v_is_closed then
    if v_commission.id is not null and v_commission.settlement_run_id is not null then
      raise exception 'Esta venta ya fue liquidada — no se puede corregir directamente. Anulá la venta y cargá una nueva si hace falta.';
    end if;
    if v_tip.id is not null and v_tip.settlement_run_id is not null then
      raise exception 'La propina de esta venta ya fue liquidada — no se puede corregir directamente.';
    end if;

    -- collected_amount acompaña al total: un cobro 'cobrado' se cobró completo,
    -- así que queda igual al nuevo total (antes se dejaba el viejo y, al BAJAR
    -- el monto, violaba payments_collected_amount_range). Un pago pendiente o
    -- parcial nunca puede tener cobrado más que el nuevo total.
    update public.payments
      set total = v_final_total,
          amount = v_final_total,
          discount = v_final_discount,
          tip_amount = v_final_tip,
          method = v_final_method,
          payment_method = v_final_method,
          collected_amount = case
            when status = 'cobrado' then v_final_total
            else least(coalesce(collected_amount, 0), v_final_total)
          end
      where id = p_payment_id;

    if p_new_commission_amount is not null then
      if p_new_commission_amount < 0 then
        raise exception 'La comisión no puede ser negativa';
      end if;
      if v_commission.id is not null then
        update public.commission_records
          set amount = p_new_commission_amount,
              paid_amount = least(paid_amount, p_new_commission_amount)
          where id = v_commission.id;
      elsif p_new_commission_amount > 0 and v_payment.employee_id is not null then
        insert into public.commission_records (
          business_id, professional_id, sale_id, amount, sale_date, created_at
        ) values (
          p_business_id, v_payment.employee_id, p_payment_id, p_new_commission_amount,
          v_sale_date, v_payment.created_at
        );
      end if;
    end if;

    if p_new_tip is not null then
      if v_tip.id is not null then
        update public.tip_records
          set amount = v_final_tip,
              paid_amount = least(paid_amount, v_final_tip)
          where id = v_tip.id;
      elsif v_final_tip > 0 and v_payment.employee_id is not null then
        insert into public.tip_records (
          business_id, professional_id, sale_id, amount, sale_date, created_at
        ) values (
          p_business_id, v_payment.employee_id, p_payment_id, v_final_tip,
          v_sale_date, v_payment.created_at
        );
      end if;
    end if;

    v_impact_note := 'Venta todavía abierta — se actualizó directo (monto/comisión/propina ya reflejados en caja).';

    insert into public.payment_authorization_log (
      business_id, payment_id, action_type, reason, performed_by, performed_by_name,
      authorized_by_name, impact_note, before_snapshot, after_snapshot
    ) values (
      p_business_id, p_payment_id, 'correction', trim(p_reason), auth.uid(), v_caller_name,
      nullif(trim(coalesce(p_authorized_by_name, '')), ''), v_impact_note,
      jsonb_build_object(
        'total', coalesce(v_payment.total, v_payment.amount), 'discount', v_payment.discount,
        'tip_amount', v_payment.tip_amount, 'method', coalesce(v_payment.method, v_payment.payment_method),
        'commission_amount', v_commission.amount,
        'client_name', v_payment.client_name, 'service_name', v_payment.service_name,
        'employee_id', v_payment.employee_id, 'employee_name', v_employee_name
      ),
      jsonb_build_object(
        'total', v_final_total, 'discount', v_final_discount, 'tip_amount', v_final_tip,
        'method', v_final_method, 'commission_amount', p_new_commission_amount
      )
    );

    return query select null::uuid, false;
  else
    v_delta_total := v_final_total - coalesce(v_payment.total, v_payment.amount, 0);
    v_delta_tip := v_final_tip - coalesce(v_payment.tip_amount, 0);
    v_delta_commission := case
      when p_new_commission_amount is null then null
      else p_new_commission_amount - coalesce(v_commission.amount, 0)
    end;

    insert into public.payments (
      business_id, branch_id, employee_id, client_id, client_name, service_name,
      amount, total, tip_amount, method, payment_method, charge_type, status,
      collected_amount, charged_at, created_at, charged_by, observations,
      adjustment_of_payment_id
    ) values (
      p_business_id, v_payment.branch_id, v_payment.employee_id, v_payment.client_id, v_payment.client_name,
      'Ajuste — ' || coalesce(v_payment.service_name, 'venta'),
      v_delta_total, v_delta_total, v_delta_tip, v_final_method, v_final_method,
      coalesce(v_payment.charge_type, 'caja'), 'cobrado',
      v_delta_total, now(), now(), auth.uid(),
      '[AJUSTE] Corrección de venta del ' || to_char(v_sale_date, 'DD/MM/YYYY') || ' — ' || trim(p_reason),
      p_payment_id
    ) returning id into v_adjustment_id;

    if v_delta_commission is not null and v_delta_commission <> 0 and v_payment.employee_id is not null then
      if v_delta_commission > 0 then
        insert into public.commission_records (
          business_id, professional_id, sale_id, amount, sale_date, created_at
        ) values (
          p_business_id, v_payment.employee_id, v_adjustment_id, v_delta_commission, now()::date, now()
        );
      else
        insert into public.commission_adjustment_queue (
          business_id, professional_id, sale_id, commission_amount, reason
        ) values (
          p_business_id, v_payment.employee_id, p_payment_id, abs(v_delta_commission),
          'Corrección de venta de día cerrado (baja la comisión) — ' || trim(p_reason)
        );
      end if;
    end if;

    v_impact_note := 'Día ya cerrado — no se tocó el cierre original. Se registró un ajuste de $'
      || to_char(v_delta_total, 'FM999G999G999') || ' visible hoy en Movimientos de caja.'
      || case when v_delta_commission is not null and v_delta_commission < 0
           then ' La baja de comisión ($' || to_char(abs(v_delta_commission), 'FM999G999G999') || ') queda pendiente de aplicar en la próxima liquidación.'
           else '' end;

    insert into public.payment_authorization_log (
      business_id, payment_id, action_type, reason, performed_by, performed_by_name,
      authorized_by_name, impact_note, before_snapshot, after_snapshot, adjustment_payment_id
    ) values (
      p_business_id, p_payment_id, 'correction', trim(p_reason), auth.uid(), v_caller_name,
      nullif(trim(coalesce(p_authorized_by_name, '')), ''), v_impact_note,
      jsonb_build_object(
        'total', coalesce(v_payment.total, v_payment.amount), 'tip_amount', v_payment.tip_amount,
        'method', coalesce(v_payment.method, v_payment.payment_method), 'commission_amount', v_commission.amount,
        'client_name', v_payment.client_name, 'service_name', v_payment.service_name,
        'employee_id', v_payment.employee_id, 'employee_name', v_employee_name
      ),
      jsonb_build_object(
        'delta_total', v_delta_total, 'delta_tip', v_delta_tip, 'delta_commission', v_delta_commission,
        'new_method', v_final_method
      ),
      v_adjustment_id
    );

    return query select v_adjustment_id, true;
  end if;
end;
$$;
