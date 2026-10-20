-- ============================================================================
-- Idempotencia de cobros — payments.idempotency_key + register_sale
-- ============================================================================
-- Causa raíz (auditoría de propinas/cobros, 19-20/10/2026): register_sale ya
-- protege contra una SEGUNDA llamada con el mismo sale_id (ON CONFLICT en
-- commission_records/tip_records), pero eso nunca aplica a un reintento real
-- — cada intento de cobro genera un payments.id (sale_id) nuevo, así que un
-- reintento tras un time-out de red (el cliente no sabe si el primer cobro
-- llegó a guardarse) inserta un SEGUNDO payment completo, con su comisión y
-- su propina duplicadas. El doble click ya está cubierto del lado del
-- cliente (botón deshabilitado mientras `submitting`) — esto cierra el caso
-- que ese guard no cubre.
--
-- Diseño: el cliente genera una clave por intento de cobro (UUID) y la
-- reutiliza SOLO si reintenta el mismo carrito tras un error — nunca para
-- una venta distinta. register_sale la usa para, de forma atómica, devolver
-- el pago ya existente en vez de crear uno nuevo si la key se repite.
--
-- No modifica ningún payment existente (columna nueva, nullable, sin
-- backfill) ni cambia el comportamiento de ningún cobro que no mande la
-- key (sigue funcionando exactamente igual que hoy).
--
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase (recomendado:
-- primero en el proyecto de desarrollo, después en el de producción) y
-- ejecutar. Idempotente — seguro re-ejecutar.
-- ============================================================================

-- Transacción explícita: register_sale queda sin ninguna versión activa
-- entre el DROP de los overloads viejos y el CREATE de la nueva — envolver
-- todo en una sola transacción hace que ese instante nunca sea observable
-- desde afuera (otra sesión que llame al RPC en ese momento espera a que
-- termine el COMMIT, nunca ve "función inexistente") y que un error en
-- cualquier paso deje el estado previo completamente intacto.
begin;

-- ── 1. payments.idempotency_key ─────────────────────────────────────────────
alter table public.payments
  add column if not exists idempotency_key text;

-- Parcial: pagos sin key (todo el historial existente, y cualquier llamada
-- futura que no la mande) nunca colisionan entre sí — el índice ni los
-- considera. Dos pagos del mismo negocio con la MISMA key sí colisionan,
-- que es exactamente lo que arma el replay idempotente de más abajo.
create unique index if not exists idx_payments_idempotency_key
  on public.payments (business_id, idempotency_key)
  where idempotency_key is not null;

-- ── 2. register_sale: + p_idempotency_key ───────────────────────────────────
-- Cambia la cantidad de parámetros respecto de la versión anterior (20261011040000,
-- 28 parámetros) — `create or replace function` con una lista de parámetros
-- distinta NO reemplaza la función existente, crea una SEGUNDA función
-- superpuesta ("overload"), lo que deja a PostgREST con dos register_sale
-- distintos convivendo. Por eso primero se borran TODAS las versiones
-- existentes de register_sale en public (sin asumir a mano cuántos
-- parámetros tiene cada una) y recién después se crea la nueva.
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
  -- cobrar para cualquier profesional de su negocio.
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

  -- Replay idempotente: si ya existe un payment de este negocio con esta
  -- MISMA key, se devuelve tal cual (payment + comisión + propina ya
  -- existentes), sin insertar nada nuevo — y ANTES de tocar `appointments`.
  -- Crítico que esto vaya acá y no después de la transición del turno: si
  -- este check fuera posterior, un reintento legítimo de "Cobrar turno"
  -- fallaría con "este turno ya fue cobrado" en vez de devolver el pago que
  -- ya se había guardado en el primer intento.
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

  -- Turno de Agenda: la transición a 'charged' pasa a vivir DENTRO de esta
  -- misma transacción. Mismo UPDATE trae de regalo promotion_id/
  -- promotion_snapshot del turno (sin una consulta aparte) — es la fuente
  -- de verdad para la promo de este payment cuando la venta viene de un
  -- turno, ver más abajo.
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
    -- Perdió la carrera contra otro intento simultáneo con la MISMA key
    -- (dos pestañas/dispositivos reintentando el mismo cobro a la vez) — el
    -- otro ya ganó e insertó. Se busca y devuelve ESE, nunca se falla ni se
    -- inserta un segundo (mismo patrón que ya usa register_commission para
    -- su propio unique constraint).
    select id into v_payment_id
      from public.payments
      where business_id = p_business_id and idempotency_key = p_idempotency_key;
    select cr.id into v_commission_id from public.commission_records cr where cr.sale_id = v_payment_id;
    select tr.id into v_tip_id from public.tip_records tr where tr.sale_id = v_payment_id;
    return query select v_payment_id, v_commission_id, v_tip_id;
    return;
  end if;

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

NOTIFY pgrst, 'reload schema';

commit;
