-- Anular venta devuelve el turno a "confirmado" cuando no queda ninguna venta vigente, y
-- Restablecer lo vuelve a "cobrado". Antes el turno quedaba "cobrado" con la venta anulada y no
-- se podía volver a cobrar ("Este turno ya fue cobrado o actualizado").

CREATE OR REPLACE FUNCTION public.void_payment_authorized(p_payment_id uuid, p_business_id uuid, p_password text, p_reason text, p_authorized_by_name text DEFAULT NULL::text, p_performed_by_name text DEFAULT NULL::text)
 RETURNS TABLE(new_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_business uuid;
  v_caller_name text;
  v_payment public.payments;
  v_employee_name text;
  v_commission public.commission_records;
  v_commission_found boolean;
  v_impact_note text;
  v_sale_date date;
  v_is_closed boolean;
  v_cash_method text;
  v_cash_amount numeric;
  v_log_id uuid;
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

  perform public._verify_caja_authorization_password(p_business_id, 'void', p_password);

  select * into v_payment
  from public.payments
  where id = p_payment_id and business_id = p_business_id
  for update;

  if not found then
    raise exception 'Cobro no encontrado';
  end if;

  if v_payment.status in ('anulado', 'reembolsado') then
    raise exception 'Esta venta ya está anulada';
  end if;

  select e.full_name into v_employee_name
  from public.employees e where e.id = v_payment.employee_id;

  update public.payments
    set status = 'anulado'
    where id = p_payment_id;

  -- Sin ninguna venta vigente el turno deja de estar cobrado: vuelve a "confirmado" para poder
  -- cobrarlo de nuevo (el cobro exige turno pendiente/confirmado).
  if v_payment.appointment_id is not null then
    update public.appointments
      set status = 'confirmed'
      where id = v_payment.appointment_id
        and business_id = p_business_id
        and status = 'charged'
        and not exists (
          select 1 from public.payments pm
          where pm.appointment_id = v_payment.appointment_id
            and pm.status not in ('anulado', 'reembolsado')
        );
  end if;

  v_sale_date := (v_payment.created_at at time zone 'America/Argentina/Buenos_Aires')::date;

  select exists(
    select 1 from public.caja_cierres
    where business_id = p_business_id
      and branch_id is not distinct from v_payment.branch_id
      and fecha = v_sale_date
      and estado in ('cerrada', 'reabierta')
  ) into v_is_closed;

  if v_is_closed then
    v_cash_amount := coalesce(v_payment.total, v_payment.amount, 0) + coalesce(v_payment.tip_amount, 0);
    v_cash_method := case
      when lower(trim(coalesce(v_payment.method, v_payment.payment_method, ''))) in ('', 'cash', 'efectivo') then 'efectivo'
      else 'cuenta'
    end;
    if v_cash_amount > 0 then
      insert into public.cash_movements (
        business_id, branch_id, type, amount, method, note, created_by, sale_id
      ) values (
        p_business_id, v_payment.branch_id, 'retiro', v_cash_amount, v_cash_method,
        '[AJUSTE-ANULACION] Anulación de venta del ' || to_char(v_sale_date, 'DD/MM/YYYY') || ' (día ya cerrado) — ' || trim(p_reason),
        v_caller_name, p_payment_id
      );
    end if;
  end if;

  select * into v_commission
  from public.commission_records
  where sale_id = p_payment_id and business_id = p_business_id;
  v_commission_found := found;

  if v_commission_found and v_commission.settlement_run_id is not null and v_commission.amount > 0 then
    v_impact_note := 'Comisión ya liquidada — se registró una deducción pendiente de $' || to_char(v_commission.amount, 'FM999G999G999') || ' para la próxima liquidación del profesional.';
  elsif v_commission_found and v_commission.amount > 0 then
    v_impact_note := 'Comisión y propina liberadas (la venta todavía no estaba liquidada).';
  else
    v_impact_note := 'Venta sin comisión asociada.';
  end if;

  if v_is_closed then
    v_impact_note := v_impact_note || ' El día de esta venta ya estaba cerrado — el cierre guardado no se tocó; se registró un retiro de $'
      || to_char(coalesce(v_payment.total, v_payment.amount, 0) + coalesce(v_payment.tip_amount, 0), 'FM999G999G999') || ' visible hoy en Movimientos de caja.';
  end if;

  insert into public.payment_authorization_log (
    business_id, payment_id, action_type, reason, performed_by, performed_by_name,
    authorized_by_name, impact_note, before_snapshot, after_snapshot
  ) values (
    p_business_id, p_payment_id, 'void', trim(p_reason), auth.uid(), v_caller_name,
    nullif(trim(coalesce(p_authorized_by_name, '')), ''), v_impact_note,
    jsonb_build_object(
      'status', v_payment.status, 'total', coalesce(v_payment.total, v_payment.amount),
      'client_name', v_payment.client_name, 'service_name', v_payment.service_name,
      'employee_id', v_payment.employee_id, 'employee_name', v_employee_name,
      'method', coalesce(v_payment.method, v_payment.payment_method)
    ),
    jsonb_build_object('status', 'anulado', 'day_was_closed', v_is_closed)
  ) returning id into v_log_id;

  if v_commission_found and v_commission.settlement_run_id is not null and v_commission.amount > 0 then
    insert into public.commission_adjustment_queue (
      business_id, professional_id, sale_id, commission_amount, reason, authorization_log_id, kind
    ) values (
      p_business_id, v_commission.professional_id, p_payment_id, v_commission.amount,
      'Venta anulada (ya liquidada) — ' || trim(p_reason), v_log_id, 'deduccion'
    );
  end if;

  return query select 'anulado'::text;
end;
$function$;

CREATE OR REPLACE FUNCTION public.restore_payment_authorized(p_payment_id uuid, p_business_id uuid, p_password text, p_reason text, p_authorized_by_name text DEFAULT NULL::text, p_performed_by_name text DEFAULT NULL::text)
 RETURNS TABLE(new_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_business uuid;
  v_caller_name text;
  v_payment public.payments;
  v_employee_name text;
  v_commission public.commission_records;
  v_tip public.tip_records;
  v_impact_note text;
  v_commission_locked boolean := false;
  v_tip_locked boolean := false;
  v_reversed_count int := 0;
  v_reversed_amount numeric := 0;
  v_net_credito numeric := 0;
  v_sale_date date;
  v_is_closed boolean;
  v_cash_method text;
  v_net_retirado numeric;
  v_log_id uuid;
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

  perform public._verify_caja_authorization_password(p_business_id, 'void', p_password);

  select * into v_payment
  from public.payments
  where id = p_payment_id and business_id = p_business_id
  for update;

  if not found then
    raise exception 'Cobro no encontrado';
  end if;

  if v_payment.status not in ('anulado', 'reembolsado') then
    raise exception 'Esta venta no está anulada';
  end if;

  select e.full_name into v_employee_name
  from public.employees e where e.id = v_payment.employee_id;

  update public.payments
    set status = 'cobrado'
    where id = p_payment_id;

  -- Deshace lo de anular: si el turno quedó libre vuelve a "cobrado". Si ya cambió (se cobró otra
  -- vez, se canceló), no se toca.
  if v_payment.appointment_id is not null then
    update public.appointments
      set status = 'charged'
      where id = v_payment.appointment_id
        and business_id = p_business_id
        and status in ('pending', 'confirmed');
  end if;

  select * into v_commission
  from public.commission_records
  where sale_id = p_payment_id and business_id = p_business_id;

  select * into v_tip
  from public.tip_records
  where sale_id = p_payment_id and business_id = p_business_id;

  if v_commission.id is not null and v_commission.status = 'voided' then
    if v_commission.settlement_run_id is null then
      update public.commission_records
        set status = 'pending', paid_amount = 0
        where id = v_commission.id;
    else
      v_commission_locked := true;
    end if;
  end if;

  if v_tip.id is not null and v_tip.status = 'voided' then
    if v_tip.settlement_run_id is null then
      update public.tip_records
        set status = 'pending', paid_amount = 0
        where id = v_tip.id;
    else
      v_tip_locked := true;
    end if;
  end if;

  -- Caso 2 del pedido: deducción pendiente (todavía no compensada) — se
  -- cancela sin más (borra la fila), nunca genera un crédito (nunca se
  -- descontó de verdad). Filtra por kind='deduccion' a propósito: nunca
  -- borra un crédito pendiente por error, aunque hoy no debería existir
  -- uno sin aplicar en este punto del flujo.
  select count(*), coalesce(sum(commission_amount), 0)
    into v_reversed_count, v_reversed_amount
    from public.commission_adjustment_queue
    where sale_id = p_payment_id and kind = 'deduccion' and applied_settlement_run_id is null;

  if v_reversed_count > 0 then
    delete from public.commission_adjustment_queue
      where sale_id = p_payment_id and kind = 'deduccion' and applied_settlement_run_id is null;
  end if;

  -- Caso 3 del pedido: deducción YA compensada (aplicada a una liquidación
  -- ya creada, por ende intocable) — se encola el crédito contrario, por
  -- el NETO sin revertir todavía (deducciones aplicadas menos créditos ya
  -- encolados para esta venta, pendientes o no) — nunca un segundo crédito
  -- por la misma deducción, ni aunque este restore se repitiera. Si el
  -- neto da 0 (ya se emitió el crédito completo en un ciclo anterior),
  -- no se inserta nada.
  select coalesce(sum(
    case
      when kind = 'deduccion' and applied_settlement_run_id is not null then commission_amount
      when kind = 'credito' then -commission_amount
      else 0
    end
  ), 0)
    into v_net_credito
    from public.commission_adjustment_queue
    where sale_id = p_payment_id;

  -- Retiro de caja del día cerrado (ver void_payment_authorized): si queda
  -- un neto sin revertir ligado a esta venta por sale_id, se crea el
  -- ingreso contrario por exactamente ese neto. Nunca se borra ni modifica
  -- el movimiento anterior ni el cierre histórico.
  v_sale_date := (v_payment.created_at at time zone 'America/Argentina/Buenos_Aires')::date;

  select exists(
    select 1 from public.caja_cierres
    where business_id = p_business_id
      and branch_id is not distinct from v_payment.branch_id
      and fecha = v_sale_date
      and estado in ('cerrada', 'reabierta')
  ) into v_is_closed;

  select coalesce(sum(case when type = 'retiro' then amount else -amount end), 0)
    into v_net_retirado
    from public.cash_movements
    where sale_id = p_payment_id;

  if v_is_closed and v_net_retirado > 0 then
    v_cash_method := case
      when lower(trim(coalesce(v_payment.method, v_payment.payment_method, ''))) in ('', 'cash', 'efectivo') then 'efectivo'
      else 'cuenta'
    end;
    insert into public.cash_movements (
      business_id, branch_id, type, amount, method, note, created_by, sale_id
    ) values (
      p_business_id, v_payment.branch_id, 'ingreso', v_net_retirado, v_cash_method,
      '[AJUSTE-RESTABLECIMIENTO] Restablecimiento de venta del ' || to_char(v_sale_date, 'DD/MM/YYYY') || ' (día ya cerrado) — ' || trim(p_reason),
      v_caller_name, p_payment_id
    );
  end if;

  if v_commission_locked or v_tip_locked then
    v_impact_note := 'Venta restablecida. Su comisión/propina ya estaba dentro de una liquidación cerrada — no se reactivó sola, revisarla a mano si corresponde pagarla.';
  elsif v_commission.id is not null or v_tip.id is not null then
    v_impact_note := 'Venta restablecida — comisión/propina vueltas a pendiente de cobro.';
  else
    v_impact_note := 'Venta restablecida. Sin comisión/propina asociada.';
  end if;

  if v_reversed_count > 0 then
    v_impact_note := v_impact_note || ' Se anuló la deducción pendiente de $'
      || to_char(v_reversed_amount, 'FM999G999G999') || ' que había quedado encolada de la anulación anterior — no se le va a descontar nada al profesional por esta venta.';
  end if;

  if v_net_credito > 0 then
    v_impact_note := v_impact_note || ' Esa deducción ya se había compensado en una liquidación cerrada — se encoló un crédito a favor del profesional de $'
      || to_char(v_net_credito, 'FM999G999G999') || ' para la próxima liquidación (la liquidación ya cerrada no se tocó).';
  end if;

  if v_is_closed and v_net_retirado > 0 then
    v_impact_note := v_impact_note || ' El día de esta venta ya estaba cerrado — el cierre guardado no se tocó; se registró un ingreso de $'
      || to_char(v_net_retirado, 'FM999G999G999') || ' visible hoy en Movimientos de caja, revirtiendo el retiro de la anulación anterior.';
  end if;

  insert into public.payment_authorization_log (
    business_id, payment_id, action_type, reason, performed_by, performed_by_name,
    authorized_by_name, impact_note, before_snapshot, after_snapshot
  ) values (
    p_business_id, p_payment_id, 'restoration', trim(p_reason), auth.uid(), v_caller_name,
    nullif(trim(coalesce(p_authorized_by_name, '')), ''), v_impact_note,
    jsonb_build_object(
      'status', v_payment.status, 'total', coalesce(v_payment.total, v_payment.amount),
      'client_name', v_payment.client_name, 'service_name', v_payment.service_name,
      'employee_id', v_payment.employee_id, 'employee_name', v_employee_name,
      'method', coalesce(v_payment.method, v_payment.payment_method)
    ),
    jsonb_build_object(
      'status', 'cobrado',
      'reversed_adjustment_count', v_reversed_count,
      'reversed_adjustment_amount', v_reversed_amount,
      'credito_encolado', v_net_credito,
      'day_was_closed', v_is_closed
    )
  ) returning id into v_log_id;

  if v_net_credito > 0 and v_commission.id is not null then
    insert into public.commission_adjustment_queue (
      business_id, professional_id, sale_id, commission_amount, reason, authorization_log_id, kind
    ) values (
      p_business_id, v_commission.professional_id, p_payment_id, v_net_credito,
      'Venta restablecida (su deducción ya estaba compensada) — ' || trim(p_reason), v_log_id, 'credito'
    );
  end if;

  return query select 'cobrado'::text;
end;
$function$;

NOTIFY pgrst, 'reload schema';
