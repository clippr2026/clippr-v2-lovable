-- ============================================================================
-- Adelantos: "Origen del adelanto" (Caja del negocio / Fondos externos)
-- ============================================================================
-- Hasta hoy todo adelanto se trata como plata que sale de la caja: el cierre
-- lo resta del efectivo (o del dinero en cuenta) esperado. Si el dueño lo paga
-- de su bolsillo o de otra cuenta, el cierre espera menos de lo que hay y
-- aparece un sobrante falso. Esta migración agrega el origen:
--   · 'caja'    — sale de los fondos del negocio: descuenta del efectivo o de
--                 la cuenta (según el medio), es un egreso de Caja y entra en
--                 el cierre.
--   · 'externo' — sale de otro lado (bolsillo del dueño, otra cuenta): no toca
--                 Efectivo del día, Dinero en cuenta del día ni el cierre. El
--                 medio de pago queda como información.
-- En AMBOS casos el adelanto baja el "Total a pagar" del profesional una sola
-- vez (prepare_settlement_run suma todos los adelantos sin liquidar, sin mirar
-- origen ni medio: no se toca).
--
-- HISTÓRICOS: los adelantos que ya existen quedan con funds_source = NULL y se
-- siguen tratando EXACTAMENTE como hasta hoy (caja). No se reclasifican ni se
-- modifica ningún importe. El valor por defecto 'caja' solo rige para filas
-- NUEVAS (ALTER COLUMN ... SET DEFAULT no toca las existentes).
--
-- Validación en backend (no solo en pantalla):
--   · CHECK de la tabla: origen 'caja' o 'externo'; un adelanto de 'caja'
--     necesita medio de pago. Vale también para inserts directos (los clientes
--     tienen INSERT sobre la tabla, protegido por RLS).
--   · Trigger: el origen no se puede cambiar después de creado el adelanto
--     (ni "reclasificar" uno histórico): evita descuentos duplicados y deja la
--     trazabilidad intacta.
--   · register_professional_advance recibe p_funds_source y valida origen y
--     medio. Compatibilidad con la versión anterior de la app (que no manda el
--     origen): sin origen y con medio -> 'caja' (como hoy); sin origen y SIN
--     medio (el retiro de stock a cuenta de adelanto, que no mueve plata) ->
--     'externo'.
--
-- Cómo revertirlo:
--   drop trigger trg_professional_advances_funds_source_immutable on public.professional_advances;
--   drop function public.professional_advances_funds_source_immutable();
--   alter table public.professional_advances drop constraint professional_advances_funds_source_check,
--                                            drop constraint professional_advances_caja_needs_method;
--   (y volver a aplicar la definición anterior de register_professional_advance,
--    migración 20260801010000_business_movements_rpcs.sql)
--   La columna funds_source puede quedar: sin la app nueva no se usa.
-- ============================================================================

-- ── 1. Columna y restricciones ──────────────────────────────────────────────
alter table public.professional_advances
  add column if not exists funds_source text;

-- Solo filas NUEVAS: las existentes quedan en NULL (histórico, sin reclasificar).
alter table public.professional_advances
  alter column funds_source set default 'caja';

alter table public.professional_advances
  drop constraint if exists professional_advances_funds_source_check;
alter table public.professional_advances
  add constraint professional_advances_funds_source_check
  check (funds_source is null or funds_source in ('caja', 'externo'));

alter table public.professional_advances
  drop constraint if exists professional_advances_caja_needs_method;
alter table public.professional_advances
  add constraint professional_advances_caja_needs_method
  check (funds_source is distinct from 'caja' or nullif(trim(payment_method), '') is not null);

comment on column public.professional_advances.funds_source is
  'Origen del adelanto: caja (fondos del negocio, entra en el cierre) | externo (otro bolsillo/cuenta, no toca la caja). NULL = histórico, tratado como caja.';

-- ── 2. El origen no se puede cambiar una vez registrado ─────────────────────
create or replace function public.professional_advances_funds_source_immutable()
returns trigger language plpgsql as $$
begin
  if new.funds_source is distinct from old.funds_source then
    raise exception 'El origen de un adelanto no se puede cambiar una vez registrado';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_professional_advances_funds_source_immutable on public.professional_advances;
create trigger trg_professional_advances_funds_source_immutable
  before update on public.professional_advances
  for each row execute function public.professional_advances_funds_source_immutable();

-- ── 3. RPC con origen (misma lógica de siempre + validación) ────────────────
-- Se reemplaza la firma de 8 parámetros por una de 9 (el último, opcional): así
-- la app anterior, que no manda el origen, sigue funcionando.
drop function if exists public.register_professional_advance(
  uuid, uuid, numeric, text, text, timestamptz, uuid, text
);

create or replace function public.register_professional_advance(
  p_business_id uuid,
  p_professional_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_note text,
  p_advanced_at timestamptz,
  p_registered_by uuid,
  p_registered_by_name text,
  p_funds_source text default null
)
returns public.professional_advances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_caller_business uuid;
  v_advance public.professional_advances;
  v_movement public.business_movements;
  v_method text := nullif(trim(coalesce(p_payment_method, '')), '');
  v_source text := nullif(trim(coalesce(p_funds_source, '')), '');
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto del adelanto debe ser mayor a cero';
  end if;

  if p_registered_by is distinct from auth.uid() then
    raise exception 'registered_by debe ser el usuario autenticado';
  end if;

  select p.role, p.business_id into v_role, v_caller_business
  from public.profiles p where p.id = auth.uid();

  if v_caller_business is distinct from p_business_id then
    raise exception 'No tenes permiso sobre este negocio';
  end if;

  if v_role = 'profesional' then
    raise exception 'Un profesional no puede registrarse adelantos a si mismo';
  end if;

  -- Origen: sin dato (app anterior) -> caja si hay medio de pago, externo si no
  -- hay medio (retiro de stock a cuenta de adelanto: no mueve plata).
  if v_source is null then
    v_source := case when v_method is null then 'externo' else 'caja' end;
  end if;
  if v_source not in ('caja', 'externo') then
    raise exception 'Origen del adelanto inválido: tiene que ser caja o externo';
  end if;
  if v_method is not null and lower(v_method) not in ('efectivo', 'transferencia', 'debito') then
    raise exception 'Medio de pago inválido: tiene que ser efectivo o transferencia';
  end if;
  if v_source = 'caja' and v_method is null then
    raise exception 'Elegí el medio de pago del adelanto (efectivo o transferencia)';
  end if;

  select * into v_movement from public.next_business_movement_number(
    p_business_id, 'adelanto', p_professional_id, p_amount, coalesce(p_advanced_at, now())
  );

  insert into public.professional_advances (
    business_id, professional_id, amount, payment_method, note,
    advanced_at, registered_by, registered_by_name,
    movement_number, movement_id, funds_source
  ) values (
    p_business_id, p_professional_id, p_amount, v_method,
    nullif(trim(coalesce(p_note, '')), ''),
    coalesce(p_advanced_at, now()), p_registered_by, p_registered_by_name,
    v_movement.movement_number, v_movement.id, v_source
  ) returning * into v_advance;

  return v_advance;
end;
$$;

grant execute on function public.register_professional_advance(
  uuid, uuid, numeric, text, text, timestamptz, uuid, text, text
) to authenticated;

notify pgrst, 'reload schema';
