-- El turno recuerda en qué estado estaba antes de cobrarse (por confirmar / confirmado) para que
-- Anular venta lo devuelva a ese mismo estado. Sin dato (cobrados antes de esta migración) vuelve a
-- "confirmado". La columna la llena un trigger, sin tocar la función de cobro.
alter table public.appointments add column if not exists status_antes_cobro text;

create or replace function public.appointments_guardar_estado_antes_cobro()
returns trigger language plpgsql as $$
begin
  if new.status = 'charged' and old.status in ('pending', 'confirmed') then
    new.status_antes_cobro := old.status;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_appointments_estado_antes_cobro on public.appointments;
create trigger trg_appointments_estado_antes_cobro
  before update of status on public.appointments
  for each row
  when (new.status is distinct from old.status)
  execute function public.appointments_guardar_estado_antes_cobro();

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
      set status = coalesce(status_antes_cobro, 'confirmed')
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

NOTIFY pgrst, 'reload schema';
