-- ============================================================================
-- register_commission — RPC security definer para insertar commission_records
-- ============================================================================
-- Causa real encontrada: commission_records_write (ver 20260721080000_
-- liquidaciones_grants.sql) bloquea CUALQUIER insert/update si
-- profiles.role = 'profesional' — correcto para impedir que un profesional
-- edite comisiones a mano, pero register-payment.ts hacía el insert
-- DIRECTO desde el cliente (misma sesión restringida), así que cuando un
-- profesional cobraba su PROPIA venta (Nueva Venta o Cobrar Turno, mismo
-- código), el insert de su comisión quedaba bloqueado por RLS — el pago se
-- guardaba igual (payments no tiene esta restricción), pero la comisión
-- nunca se creaba. El error quedaba atrapado en un console.warn, sin
-- avisar a nadie. Mismo patrón que este archivo ya resolvió una vez para
-- professional_settlements/register_settlement_payment (ver comentario
-- original en liquidaciones_grants.sql) — ahora se aplica acá.
--
-- La policy commission_records_write NO se toca: un profesional sigue sin
-- poder insertar/editar comisiones directo contra la tabla. Este RPC corre
-- con privilegios del dueño de la función (security definer), pero valida
-- todo internamente antes de insertar — no es un bypass abierto.
-- ============================================================================

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
begin
  -- Identidad de quien llama — nunca se confía en nada que mande el
  -- frontend sobre "quién soy", siempre se resuelve server-side desde
  -- auth.uid() (igual que ya hacen las policies de esta misma tabla).
  select p.business_id, p.role, p.employee_id
    into v_caller_business_id, v_caller_role, v_caller_employee_id
    from public.profiles p
    where p.id = auth.uid();

  if v_caller_business_id is null or v_caller_business_id is distinct from p_business_id then
    raise exception 'No autorizado para registrar comisión en este negocio';
  end if;

  -- Un profesional solo puede disparar el registro de SU PROPIA comisión
  -- (misma regla que ya expresa commission_records_select para lectura) —
  -- cualquier otro rol (admin, socio, recepcionista) puede hacerlo para
  -- cualquier profesional de su negocio, igual que hoy.
  if v_caller_role = 'profesional' and v_caller_employee_id is distinct from p_professional_id then
    raise exception 'Un profesional solo puede registrar su propia comisión';
  end if;

  -- La venta tiene que existir, ser de este negocio, y pertenecer
  -- efectivamente a ese profesional — nunca se inserta una comisión para
  -- una venta ajena o inexistente, sin importar qué mande el frontend.
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

  -- Cota de sanidad sobre el monto: nunca negativo, nunca mayor al total
  -- realmente cobrado en esa venta. El CÁLCULO real de cuánto corresponde
  -- sigue siendo responsabilidad exclusiva de computeCommissionAmount en
  -- el cliente (única fuente de verdad, ver service-pricing.ts) — acá NO
  -- se reimplementa esa fórmula, solo se descarta un monto imposible.
  if p_amount is null or p_amount < 0 then
    raise exception 'Monto de comisión inválido';
  end if;
  if p_amount > v_sale_total then
    raise exception 'El monto de comisión no puede superar el total cobrado en la venta';
  end if;
  if p_commission_pct is not null and (p_commission_pct < 0 or p_commission_pct > 100) then
    raise exception 'Porcentaje de comisión fuera de rango';
  end if;

  -- Evitar duplicados de forma atómica: ON CONFLICT sobre
  -- commission_records_sale_unique, no un "select primero, insert después"
  -- (esa secuencia tiene una ventana de carrera real si dos llamadas para
  -- la misma venta llegan casi al mismo tiempo — ej. doble click, o el
  -- cobro reintentado por una respuesta lenta). Con ON CONFLICT DO NOTHING,
  -- como mucho una de las dos inserta; la base decide, no el orden de
  -- ejecución de este código.
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

  -- Conflicto: ya existía una fila para esta venta (llamada duplicada) —
  -- se devuelve la existente, idempotente, sin insertar una segunda.
  select cr.id into v_record_id
    from public.commission_records cr
    where cr.sale_id = p_sale_id;

  return query select v_record_id, false;
end;
$$;

revoke all on function public.register_commission(uuid, uuid, uuid, numeric, date, timestamptz, numeric) from public;
grant execute on function public.register_commission(uuid, uuid, uuid, numeric, date, timestamptz, numeric) to authenticated;
