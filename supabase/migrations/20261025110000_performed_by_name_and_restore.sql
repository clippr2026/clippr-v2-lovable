-- ============================================================================
-- 1) "Modificado por" mostraba genérico "Usuario" — porque el login
--    compartido (profiles.id = auth.uid()) no siempre tiene un
--    employees.full_name asociado. Ahora: si el que ejecuta la acción
--    escribe su nombre (p_performed_by_name), se usa ese; si no, cae a
--    employees.full_name y DESPUÉS a profiles.full_name (antes solo
--    miraba employees, por eso caía directo a 'Usuario' tan seguido) antes
--    de llegar al genérico 'Usuario'.
-- 2) Nueva acción "Restablecer venta" (restore_payment_authorized) — el
--    "deshacer" de Anular venta, que hoy no existía. Reutiliza la
--    contraseña de 'void' (mismo nivel de riesgo). Reactiva comisión/
--    propina asociadas SOLO si no están dentro de una liquidación cerrada
--    (settlement_run_id is null) — si ya están liquidadas, avisa en
--    impact_note en vez de tocarlas.
-- ============================================================================
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase (primero en
-- desarrollo, después en producción) y ejecutar. Requiere que
-- 20261025010000 a 20261025100000 ya hayan corrido. Idempotente.
-- ============================================================================
begin;

-- ── void_payment_authorized: +p_performed_by_name ──────────────────────────
drop function if exists public.void_payment_authorized(uuid, uuid, text, text, text);

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
    jsonb_build_object('status', 'anulado')
  );

  return query select 'anulado'::text;
end;
$$;

-- ── restore_payment_authorized: nuevo — deshace una anulación ──────────────
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

  -- Reutiliza la contraseña de 'void' — restablecer es la contracara de
  -- anular, mismo nivel de riesgo, no amerita una tercera contraseña.
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

  if v_commission_locked or v_tip_locked then
    v_impact_note := 'Venta restablecida. Su comisión/propina ya estaba dentro de una liquidación cerrada — no se reactivó sola, revisarla a mano si corresponde pagarla.';
  elsif v_commission.id is not null or v_tip.id is not null then
    v_impact_note := 'Venta restablecida — comisión/propina vueltas a pendiente de cobro.';
  else
    v_impact_note := 'Venta restablecida. Sin comisión/propina asociada.';
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
    jsonb_build_object('status', 'cobrado')
  );

  return query select 'cobrado'::text;
end;
$$;

-- ── delete_payment_authorized: +p_performed_by_name ─────────────────────────
drop function if exists public.delete_payment_authorized(uuid, uuid, text, text, text);

create or replace function public.delete_payment_authorized(
  p_payment_id uuid,
  p_business_id uuid,
  p_password text,
  p_reason text,
  p_authorized_by_name text default null,
  p_performed_by_name text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_business uuid;
  v_caller_name text;
  v_payment public.payments;
  v_employee_name text;
  v_already_settled boolean;
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

  select e.full_name into v_employee_name
  from public.employees e where e.id = v_payment.employee_id;

  select
    exists(select 1 from public.commission_records where sale_id = p_payment_id and settlement_run_id is not null)
    or exists(select 1 from public.tip_records where sale_id = p_payment_id and settlement_run_id is not null)
    or exists(
      select 1 from public.payment_collections pc
      where pc.payment_id = p_payment_id
        and (
          exists(select 1 from public.commission_collection_events e where e.payment_collection_id = pc.id and e.settlement_run_id is not null)
          or exists(select 1 from public.tip_collection_events e where e.payment_collection_id = pc.id and e.settlement_run_id is not null)
        )
    )
  into v_already_settled;

  if v_already_settled then
    raise exception 'Este cobro ya forma parte de una liquidación cerrada — no se puede eliminar desde acá sin perder ese detalle histórico.';
  end if;

  insert into public.payment_authorization_log (
    business_id, payment_id, action_type, reason, performed_by, performed_by_name,
    authorized_by_name, impact_note, before_snapshot, after_snapshot
  ) values (
    p_business_id, p_payment_id, 'void', 'Eliminación completa — ' || trim(p_reason), auth.uid(), v_caller_name,
    nullif(trim(coalesce(p_authorized_by_name, '')), ''),
    'Cobro borrado por completo — se fue de caja junto con su comisión y propina asociadas.',
    jsonb_build_object(
      'total', coalesce(v_payment.total, v_payment.amount), 'client_name', v_payment.client_name,
      'service_name', v_payment.service_name, 'status', v_payment.status,
      'employee_id', v_payment.employee_id, 'employee_name', v_employee_name,
      'method', coalesce(v_payment.method, v_payment.payment_method)
    ),
    jsonb_build_object('deleted', true)
  );

  delete from public.payments where id = p_payment_id and business_id = p_business_id;
end;
$$;

-- ── correct_payment_authorized: +p_performed_by_name ────────────────────────
drop function if exists public.correct_payment_authorized(
  uuid, uuid, text, text, numeric, numeric, numeric, text, numeric, text
);

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

    update public.payments
      set total = v_final_total,
          amount = v_final_total,
          discount = v_final_discount,
          tip_amount = v_final_tip,
          method = v_final_method,
          payment_method = v_final_method
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

NOTIFY pgrst, 'reload schema';

commit;
