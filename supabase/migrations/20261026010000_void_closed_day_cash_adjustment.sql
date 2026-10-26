-- ============================================================================
-- Anular/restablecer una venta de un día YA CERRADO (caja_cierres guardado)
-- no dejaba ningún rastro en Caja de hoy — el cierre histórico (correcto)
-- seguía reflejando el total cobrado ese día, pero la plata "desaparecía"
-- sin que quedara ningún movimiento visible compensándola.
--
-- Primer intento (descartado): representar el ajuste como un pago más en
-- `payments` con total negativo, como ya hace correct_payment_authorized
-- para su propio caso de día cerrado. Se descartó porque viola 2 check
-- constraints reales de la tabla al insertar: payments_tip_amount_check
-- (tip_amount >= 0) y payments_collected_amount_range (collected_amount
-- entre 0 y total+0.01 — imposible de cumplir con total negativo). Dato
-- aparte: esto significa que correct_payment_authorized YA tiene este
-- mismo bug latente si alguna vez corrige una venta de un día cerrado
-- BAJANDO el total — no se toca acá, es un problema preexistente y
-- separado, no introducido por este trabajo. Documentado en memoria.
--
-- Diseño final: cash_movements (type 'ingreso'/'retiro', amount siempre
-- positivo, method 'efectivo'/'cuenta') — ya es un parámetro real de
-- computeExpectedCashAndDigital y ya se muestra en el historial unificado
-- de Caja (kind "movimiento", rojo/verde según type) sin necesitar ningún
-- cambio de frontend. Se le agrega `sale_id` (nullable, no rompe nada
-- existente) para trazabilidad real, en vez de solo texto libre.
--
-- void_payment_authorized: si el día de la venta ya tiene un cierre
-- guardado, inserta un 'retiro' por total+propina, method según el medio
-- de la venta, con sale_id=p_payment_id — aparece hoy en Movimientos de
-- caja, en rojo, restando de Dinero en cuenta de hoy.
--
-- restore_payment_authorized: si queda un neto de 'retiro' sin revertir
-- para esta venta (suma de retiros menos suma de ingresos > 0, ambos
-- ligados por sale_id), inserta el 'ingreso' contrario por ese neto
-- exacto. Nunca borra ni modifica el movimiento anterior ni el cierre.
-- Anular/restablecer varias veces seguidas siempre netea a cero, nunca
-- duplica egresos.
--
-- Ninguno de los dos toca caja_cierres.total_cobrado ni ninguna otra
-- columna de un cierre ya guardado.
-- ============================================================================
-- Cómo correrlo: SQL Editor de Supabase, primero en desarrollo si existe,
-- después en producción. Requiere 20261025110000 ya corrida. Idempotente.
-- ============================================================================
begin;

alter table public.cash_movements
  add column if not exists sale_id uuid references public.payments(id);

create index if not exists idx_cash_movements_sale_id
  on public.cash_movements (sale_id)
  where sale_id is not null;

-- ── void_payment_authorized: ajuste de caja si el día ya está cerrado ──────
drop function if exists public.void_payment_authorized(uuid, uuid, text, text, text, text);

create or replace function public.void_payment_authorized(
  p_payment_id uuid,
  p_business_id uuid,
  p_password text,
  p_reason text,
  p_authorized_by_name text default null,
  p_performed_by_name text default null
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
  v_employee_name text;
  v_commission public.commission_records;
  v_impact_note text;
  v_sale_date date;
  v_is_closed boolean;
  v_cash_method text;
  v_cash_amount numeric;
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

  if found and v_commission.settlement_run_id is not null and v_commission.amount > 0 then
    insert into public.commission_adjustment_queue (
      business_id, professional_id, sale_id, commission_amount, reason
    ) values (
      p_business_id, v_commission.professional_id, p_payment_id, v_commission.amount,
      'Venta anulada (ya liquidada) — ' || trim(p_reason)
    );
    v_impact_note := 'Comisión ya liquidada — se registró una deducción pendiente de $' || to_char(v_commission.amount, 'FM999G999G999') || ' para la próxima liquidación del profesional.';
  elsif found and v_commission.amount > 0 then
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
  );

  return query select 'anulado'::text;
end;
$$;

-- ── restore_payment_authorized: revierte el retiro si corresponde ─────────
drop function if exists public.restore_payment_authorized(uuid, uuid, text, text, text, text);

create or replace function public.restore_payment_authorized(
  p_payment_id uuid,
  p_business_id uuid,
  p_password text,
  p_reason text,
  p_authorized_by_name text default null,
  p_performed_by_name text default null
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
  v_employee_name text;
  v_commission public.commission_records;
  v_tip public.tip_records;
  v_impact_note text;
  v_commission_locked boolean := false;
  v_tip_locked boolean := false;
  v_reversed_count int := 0;
  v_reversed_amount numeric := 0;
  v_queue_applied_count int := 0;
  v_sale_date date;
  v_is_closed boolean;
  v_cash_method text;
  v_net_retirado numeric;
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

  select count(*), coalesce(sum(commission_amount), 0)
    into v_reversed_count, v_reversed_amount
    from public.commission_adjustment_queue
    where sale_id = p_payment_id and applied_settlement_run_id is null;

  if v_reversed_count > 0 then
    delete from public.commission_adjustment_queue
      where sale_id = p_payment_id and applied_settlement_run_id is null;
  end if;

  select count(*) into v_queue_applied_count
    from public.commission_adjustment_queue
    where sale_id = p_payment_id and applied_settlement_run_id is not null;

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

  if v_queue_applied_count > 0 then
    v_impact_note := v_impact_note || ' Atención: ya existe una deducción de una anulación anterior de esta venta que se aplicó en una liquidación posterior — no se revirtió automáticamente (no se modifican liquidaciones cerradas), revisarla a mano con el profesional.';
  end if;

  if v_is_closed and v_net_retirado > 0 then
    v_impact_note := v_impact_note || ' El día de esta venta ya estaba cerrado — el cierre guardado no se tocó; se registró un ingreso de $'
      || to_char(v_net_retirado, 'FM999G999G999') || ' visible hoy en Movimientos de caja, revirtiendo el retiro de la anulación anterior.';
  end if;

  insert into public.payment_authorization_log (
    business_id, payment_id, action_type, reason, performed_by, performed_by_name,
    authorized_by_name, impact_note, before_snapshot, after_snapshot
  ) values (
    p_business_id, p_payment_id, 'correction', 'Restablecimiento — ' || trim(p_reason), auth.uid(), v_caller_name,
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
      'applied_adjustment_pending_review', v_queue_applied_count,
      'day_was_closed', v_is_closed
    )
  );

  return query select 'cobrado'::text;
end;
$$;

NOTIFY pgrst, 'reload schema';

commit;
