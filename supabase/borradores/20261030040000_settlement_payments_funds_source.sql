-- ############################################################################
-- #  BORRADOR — NO APLICADO EN NINGÚN ENTORNO (se aplica solo con autorización)#
-- ############################################################################
-- ============================================================================
-- Pagar una liquidación: "Origen del pago" (Caja del negocio / Fondos externos)
-- ============================================================================
-- Hoy Pagar una liquidación (register_settlement_run_payment_batch) no mueve
-- la caja: solo baja el saldo de la liquidación y marca las comisiones como
-- pagadas. Esta migración agrega el origen del pago, igual que en adelantos:
--   · 'caja'    — sale de los fondos del negocio: la app lo resta del efectivo
--                 o del dinero en cuenta del día en que se paga (según el
--                 medio de cada split) y entra en el cierre.
--   · 'externo' — sale de otro bolsillo/cuenta: no toca la caja ni el cierre.
-- Esta migración SOLO guarda el origen. El descuento en el efectivo/cuenta
-- esperados lo hace el código de la app (computeExpectedCashAndDigital) leyendo
-- settlement_payments.funds_source — ese cambio de código va aparte y solo se
-- despliega después de aplicar esto.
--
-- HISTÓRICOS: todos los pagos que ya existen quedan con funds_source = NULL y
-- la app los trata como 'externo' (NO tocan la caja). Así ningún cierre ya
-- hecho ni ningún "efectivo esperado" pasado cambia de número. No se modifica
-- ningún importe ni se reescribe ninguna fila existente. (Ojo: es el criterio
-- inverso al de professional_advances, donde NULL = caja.)
--
-- Compatibilidad: se reemplaza la firma de 5 parámetros por una de 6 (el
-- último, opcional). La app anterior, que no manda el origen, sigue
-- funcionando y sus pagos quedan como 'externo' (igual que hasta hoy).
--
-- Validación en backend:
--   · CHECK: origen 'caja' | 'externo' | NULL; un pago de 'caja' necesita medio.
--   · Trigger: el origen no se puede cambiar una vez registrado el pago.
--   · El RPC valida el origen recibido.
-- NO valida en backend (queda en la pantalla): (a) que la caja del día esté
-- abierta, (b) que haya efectivo/cuenta suficiente. Para (a) y (b) en servidor
-- habría que replicar el cálculo del efectivo esperado en SQL — se puede hacer
-- en una migración posterior si se quiere blindaje completo.
--
-- Cómo revertirlo (no destruye datos):
--   drop trigger if exists trg_settlement_payments_funds_source_immutable on public.settlement_payments;
--   drop function if exists public.settlement_payments_funds_source_immutable();
--   alter table public.settlement_payments
--     drop constraint if exists settlement_payments_funds_source_check,
--     drop constraint if exists settlement_payments_caja_needs_method;
--   -- y volver a aplicar la definición anterior de
--   -- register_settlement_run_payment_batch (20260801010000_business_movements_rpcs.sql)
--   -- La columna funds_source puede quedar: sin la app nueva no se usa.
--
-- Antes de aplicar en producción (CLAUDE.md): respaldo pg_dump verificado y con
-- restauración de prueba, y autorización expresa. Probar primero en desarrollo.
-- ============================================================================

-- ── 1. Columna y restricciones ──────────────────────────────────────────────
-- Sin DEFAULT: las filas existentes quedan en NULL (histórico = externo) y las
-- nuevas siempre llegan con un valor explícito desde el RPC.
alter table public.settlement_payments
  add column if not exists funds_source text;

alter table public.settlement_payments
  drop constraint if exists settlement_payments_funds_source_check;
alter table public.settlement_payments
  add constraint settlement_payments_funds_source_check
  check (funds_source is null or funds_source in ('caja', 'externo'));

alter table public.settlement_payments
  drop constraint if exists settlement_payments_caja_needs_method;
alter table public.settlement_payments
  add constraint settlement_payments_caja_needs_method
  check (funds_source is distinct from 'caja' or nullif(trim(payment_method), '') is not null);

comment on column public.settlement_payments.funds_source is
  'Origen del pago de liquidación: caja (fondos del negocio, descuenta del efectivo/cuenta del día del pago) | externo (otro bolsillo/cuenta, no toca la caja). NULL = histórico, tratado como externo.';

-- ── 2. El origen no se puede cambiar una vez registrado ─────────────────────
create or replace function public.settlement_payments_funds_source_immutable()
returns trigger language plpgsql as $$
begin
  if new.funds_source is distinct from old.funds_source then
    raise exception 'El origen de un pago de liquidación no se puede cambiar una vez registrado';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_settlement_payments_funds_source_immutable on public.settlement_payments;
create trigger trg_settlement_payments_funds_source_immutable
  before update on public.settlement_payments
  for each row execute function public.settlement_payments_funds_source_immutable();

-- ── 3. RPC con origen (misma lógica de siempre + origen) ────────────────────
drop function if exists public.register_settlement_run_payment_batch(
  uuid, jsonb, text, uuid, text
);

create or replace function public.register_settlement_run_payment_batch(
  p_settlement_run_id uuid,
  p_splits jsonb,
  p_note text,
  p_paid_by uuid,
  p_paid_by_name text,
  p_funds_source text default null
)
returns table (movement_number int, run public.settlement_runs)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_caller_business uuid;
  v_run public.settlement_runs;
  v_remaining_before numeric;
  v_remaining_after numeric;
  v_total_amount numeric := 0;
  v_split jsonb;
  v_split_amount numeric;
  v_split_method text;
  v_balance_before numeric;
  v_balance_after numeric;
  v_first boolean := true;
  v_movement public.business_movements;
  v_movement_type text;
  v_apply_remaining numeric;
  v_rec record;
  v_apply numeric;
  -- Sin origen (app anterior) -> 'externo': conserva el comportamiento de hoy
  -- (un pago de liquidación no toca la caja).
  v_source text := coalesce(nullif(trim(coalesce(p_funds_source, '')), ''), 'externo');
begin
  if v_source not in ('caja', 'externo') then
    raise exception 'Origen del pago inválido: %', v_source;
  end if;

  if p_splits is null or jsonb_array_length(p_splits) = 0 then
    raise exception 'Debe indicarse al menos un pago';
  end if;

  if p_paid_by is distinct from auth.uid() then
    raise exception 'paid_by debe ser el usuario autenticado';
  end if;

  select * into v_run from public.settlement_runs where id = p_settlement_run_id for update;
  if not found then
    raise exception 'Liquidacion no encontrada';
  end if;

  select p.role, p.business_id into v_role, v_caller_business
  from public.profiles p where p.id = auth.uid();

  if v_caller_business is distinct from v_run.business_id then
    raise exception 'No tenes permiso sobre este negocio';
  end if;

  if v_role = 'profesional' then
    raise exception 'Un profesional no puede registrar sus propios pagos';
  end if;

  for v_split in select * from jsonb_array_elements(p_splits)
  loop
    v_split_amount := coalesce((v_split->>'amount')::numeric, 0);
    if v_split_amount <= 0 then
      raise exception 'Cada pago debe tener un importe mayor a cero';
    end if;
    if v_source = 'caja' and nullif(trim(coalesce(v_split->>'method', '')), '') is null then
      raise exception 'Un pago de la caja necesita medio de pago';
    end if;
    v_total_amount := v_total_amount + v_split_amount;
  end loop;

  v_remaining_before := v_run.total_to_settle - v_run.amount_paid;
  if v_total_amount > v_remaining_before then
    raise exception 'El monto a pagar (%) supera el saldo de esta liquidacion (%)', v_total_amount, v_remaining_before;
  end if;

  v_remaining_after := v_remaining_before - v_total_amount;
  v_movement_type := case when v_remaining_after <= 0 then 'pago_total' else 'pago_parcial' end;

  select * into v_movement from public.next_business_movement_number(
    v_run.business_id, v_movement_type, v_run.professional_id, v_total_amount, now()
  );

  v_balance_before := v_remaining_before;
  for v_split in select * from jsonb_array_elements(p_splits)
  loop
    v_split_amount := (v_split->>'amount')::numeric;
    v_split_method := v_split->>'method';
    v_balance_after := v_balance_before - v_split_amount;

    insert into public.settlement_payments (
      settlement_run_id, business_id, professional_id, amount, payment_method, note,
      balance_before, balance_after, paid_by, paid_by_name,
      movement_number, movement_id, funds_source
    ) values (
      v_run.id, v_run.business_id, v_run.professional_id, v_split_amount, v_split_method,
      case when v_first then nullif(trim(coalesce(p_note, '')), '') else null end,
      v_balance_before, v_balance_after, p_paid_by, p_paid_by_name,
      v_movement.movement_number, v_movement.id, v_source
    );

    v_balance_before := v_balance_after;
    v_first := false;
  end loop;

  update public.settlement_runs
    set amount_paid = amount_paid + v_total_amount,
        status = case when amount_paid + v_total_amount >= total_to_settle then 'pagada' else 'parcial' end
    where id = v_run.id
    returning * into v_run;

  v_apply_remaining := v_total_amount;
  for v_rec in
    select id, pending_amount
    from public.commission_records
    where settlement_run_id = v_run.id
      and status in ('pending', 'partially_paid')
    order by sale_date asc, created_at asc
    for update
  loop
    exit when v_apply_remaining <= 0;
    v_apply := least(v_apply_remaining, v_rec.pending_amount);
    continue when v_apply <= 0;

    update public.commission_records
      set paid_amount = paid_amount + v_apply,
          status = case when paid_amount + v_apply >= amount then 'paid' else 'partially_paid' end
      where id = v_rec.id;

    v_apply_remaining := v_apply_remaining - v_apply;
  end loop;

  return query select v_movement.movement_number, v_run;
end;
$$;

grant execute on function public.register_settlement_run_payment_batch(
  uuid, jsonb, text, uuid, text, text
) to authenticated;

-- ── 4. Verificación posterior (solo lectura) ────────────────────────────────
-- select funds_source, count(*), sum(amount) from public.settlement_payments group by 1;
--   -- esperado justo después de aplicar: todo en NULL (histórico), mismos totales que antes.
