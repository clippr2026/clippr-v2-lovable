-- ============================================================================
-- Anular venta — void_payment_authorized
-- ============================================================================
-- Primer caller real de payments.status='anulado' (el trigger
-- trg_void_tip_and_commission_on_payment_status, 20261019030000, estaba
-- preventivo desde esa fecha sin que nada lo disparara). Exige la
-- contraseña de autorización de "void" (_verify_caja_authorization_password,
-- 20261025020000) y un motivo — lanza excepción y NO toca nada si
-- cualquiera de los dos falla.
--
-- Si la comisión de la venta ya estaba liquidada (settlement_run_id no
-- nulo), el trigger existente la deja intacta a propósito — acá se registra
-- la deducción pendiente en commission_adjustment_queue en vez de tocar la
-- liquidación cerrada.
--
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase (primero en
-- desarrollo, después en producción) y ejecutar. Requiere que
-- 20261025010000/20261025020000 ya hayan corrido. Idempotente.
-- ============================================================================
begin;

create or replace function public.void_payment_authorized(
  p_payment_id uuid,
  p_business_id uuid,
  p_password text,
  p_reason text
)
returns table (new_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_business uuid;
  v_caller_name text;
  v_payment public.payments;
  v_commission public.commission_records;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'El motivo es obligatorio';
  end if;

  select p.business_id into v_caller_business
  from public.profiles p where p.id = auth.uid();

  if v_caller_business is distinct from p_business_id then
    raise exception 'No tenés permiso sobre este negocio';
  end if;

  select coalesce(nullif(trim(e.full_name), ''), 'Usuario') into v_caller_name
  from public.profiles p
  left join public.employees e on e.id = p.employee_id
  where p.id = auth.uid();

  -- Lanza excepción y hace rollback de todo si la contraseña es incorrecta/
  -- está bloqueada/no está configurada — ningún efecto parcial.
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

  update public.payments
    set status = 'anulado'
    where id = p_payment_id;
  -- Dispara trg_void_tip_and_commission_on_payment_status: anula
  -- commission_records/tip_records de esta venta SOLO si no están
  -- liquidados todavía (settlement_run_id is null) — no se reimplementa
  -- acá esa lógica.

  select * into v_commission
  from public.commission_records
  where sale_id = p_payment_id and business_id = p_business_id;

  if found and v_commission.settlement_run_id is not null and v_commission.amount > 0 then
    insert into public.commission_adjustment_queue (
      business_id, professional_id, sale_id, commission_amount, reason
    ) values (
      p_business_id, v_commission.professional_id, p_payment_id, v_commission.amount,
      'Venta anulada (ya liquidada) — ' || trim(p_reason)
    );
  end if;

  insert into public.payment_authorization_log (
    business_id, payment_id, action_type, reason, performed_by, performed_by_name,
    before_snapshot, after_snapshot
  ) values (
    p_business_id, p_payment_id, 'void', trim(p_reason), auth.uid(), v_caller_name,
    jsonb_build_object('status', v_payment.status, 'total', coalesce(v_payment.total, v_payment.amount)),
    jsonb_build_object('status', 'anulado')
  );

  return query select 'anulado'::text;
end;
$$;

revoke all on function public.void_payment_authorized(uuid, uuid, text, text) from public;
grant execute on function public.void_payment_authorized(uuid, uuid, text, text) to authenticated;

NOTIFY pgrst, 'reload schema';

commit;
