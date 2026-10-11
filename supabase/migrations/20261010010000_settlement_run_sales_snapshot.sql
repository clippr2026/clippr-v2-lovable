-- ============================================================================
-- Historial de liquidaciones — snapshot completo de ventas hacia adelante
-- ============================================================================
-- Gap real: commission_records solo existe para ventas que generan comisión
-- (servicio con %, o catálogo con override activo). Una venta de catálogo
-- SIN comisión activa (0 a propósito) nunca generó fila ahí, así que nunca
-- quedó enlazada a ningún settlement_run — al liquidar, esa venta
-- desaparecía del historial reconstruible. Los retiros de stock pagados
-- tienen el mismo problema (comisión siempre 0 por diseño). Además,
-- commission_records.snapshot_* (ver 20260727010000) solo congela 4 campos
-- (cliente/servicio/total/método) — nunca copió discount/original_amount/
-- promotion_id/promotion_name/tip_amount, así que ni para las ventas QUE SÍ
-- tienen comisión se puede reconstruir el "Descuento en efectivo"/promo/
-- propina de una liquidación ya cerrada.
--
-- settlement_run_sales es la fuente nueva: UNA fila por cada payments.* de
-- este profesional dentro del período exacto que cubre la liquidación (
-- mismo criterio de ventana que ya usa prepare_settlement_run para
-- comisiones/propinas/adelantos), sin importar si generó comisión o no.
-- Copia los mismos nombres de columna que usa <VentaRow> (unified-row.tsx)
-- para leer de `sale.*` en vivo — así el componente la puede consumir sin
-- ninguna lógica nueva, ni de promo/descuento ni de "retiro de stock"
-- (sigue siendo el mismo marcador en `observations`).
--
-- Adelantos y ajustes/deducciones NO se duplican acá: professional_advances
-- ya se bloquea con settlement_run_id (inmutable desde que se creó) y
-- settlement_runs.adjustment_items/deduction_items ya guarda el detalle
-- itemizado desde que existe — ambos ya son 100% reconstruibles, no hace
-- falta una copia nueva de algo que ya está fijo.
--
-- No es retroactivo: liquidaciones preparadas ANTES de esta migración no
-- tienen filas acá (el dato ya no existe en payments de la forma necesaria
-- para reconstruirlo con certeza) — Historial debe mostrar esas con lo que
-- ya hay (commission_records.snapshot_*), nunca inventar lo que falta.
--
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase y ejecutar.
-- Seguro re-ejecutar (create table if not exists / create or replace).
-- ============================================================================

-- ── 1. settlement_run_sales ──────────────────────────────────────────────────
create table if not exists public.settlement_run_sales (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null,
  settlement_run_id  uuid not null references public.settlement_runs(id) on delete cascade,
  professional_id    uuid not null references public.employees(id) on delete cascade,
  sale_id            uuid references public.payments(id) on delete set null,
  occurred_at        timestamptz not null,
  client_name        text,
  service_name       text,
  total              numeric(12,2) not null default 0,
  method             text,
  discount           numeric(12,2),
  original_amount    numeric(12,2),
  promotion_id       uuid,
  promotion_name     text,
  tip_amount         numeric(12,2),
  commission_amount  numeric(12,2) not null default 0,
  observations       text,
  created_at         timestamptz not null default now()
);

create index if not exists idx_settlement_run_sales_run
  on public.settlement_run_sales (settlement_run_id);
create index if not exists idx_settlement_run_sales_professional
  on public.settlement_run_sales (professional_id, occurred_at desc);

comment on table public.settlement_run_sales is
  'Snapshot inmutable de CADA venta (servicio o catálogo, con o sin
   comisión) incluida en una liquidación, tomado en el momento exacto en
   que prepare_settlement_run la bloquea — nunca se vuelve a leer de
   payments después. Mismos nombres de columna que lee <VentaRow> de
   `sale.*` en vivo, para reusar esa misma lógica de tachado/promo/
   descuento en efectivo sin reimplementarla acá. Solo existe para
   liquidaciones preparadas desde esta migración en adelante.';

alter table public.settlement_run_sales enable row level security;

grant usage on schema public to authenticated;
grant select on table public.settlement_run_sales to authenticated;

-- Mismo criterio que commission_records: un profesional ve sus propias
-- filas; cualquier rol no-profesional del negocio ve todas. Solo lectura —
-- la única escritora es prepare_settlement_run (security definer).
drop policy if exists settlement_run_sales_select on public.settlement_run_sales;
create policy settlement_run_sales_select on public.settlement_run_sales
  for select
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (
      (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
      or professional_id = (select p.employee_id from public.profiles p where p.id = auth.uid())
    )
  );

-- ── 2. prepare_settlement_run: agrega el snapshot de ventas ────────────────
-- MISMA firma y MISMO cuerpo que la versión vigente (20260927010000_tips_
-- system.sql) — el único cambio real es el INSERT nuevo antes del `return`,
-- que congela en settlement_run_sales TODAS las ventas de payments en la
-- misma ventana [period_start_at, cutoff_at] que ya usan comisiones/
-- propinas/adelantos, sin filtrar por si generaron comisión o no.
create or replace function public.prepare_settlement_run(
  p_business_id uuid,
  p_professional_id uuid,
  p_adjustment_items jsonb,
  p_deduction_items jsonb,
  p_prepared_by uuid,
  p_prepared_by_name text,
  p_cutoff_at timestamptz default null
)
returns public.settlement_runs
language plpgsql
security definer
set search_path = public
as $run$
declare
  v_role text;
  v_caller_business uuid;
  v_previous_run public.settlement_runs;
  v_cutoff_at timestamptz := coalesce(p_cutoff_at, now());
  v_cutoff_date date := coalesce(p_cutoff_at, now())::date;
  v_period_start date;
  v_period_start_at timestamptz;
  v_previous_balance numeric := 0;
  v_new_commissions numeric := 0;
  v_new_tips numeric := 0;
  v_service_count int := 0;
  v_total_sold numeric := 0;
  v_adjustment_items jsonb := coalesce(p_adjustment_items, '[]'::jsonb);
  v_deduction_items jsonb := coalesce(p_deduction_items, '[]'::jsonb);
  v_adjustments numeric := 0;
  v_deductions numeric := 0;
  v_advances numeric := 0;
  v_item jsonb;
  v_item_amount numeric;
  v_total numeric;
  v_run_number int;
  v_run public.settlement_runs;
  v_professional_name text;
  v_adjustment_movement public.business_movements;
  v_deduction_movement public.business_movements;
begin
  if p_prepared_by is distinct from auth.uid() then
    raise exception 'prepared_by debe ser el usuario autenticado';
  end if;

  if v_cutoff_at > now() then
    raise exception 'La fecha de corte no puede ser futura';
  end if;

  select p.role, p.business_id into v_role, v_caller_business
  from public.profiles p where p.id = auth.uid();

  if v_caller_business is distinct from p_business_id then
    raise exception 'No tenés permiso sobre este negocio';
  end if;

  if v_role = 'profesional' then
    raise exception 'Un profesional no puede preparar sus propias liquidaciones';
  end if;

  select e.full_name into v_professional_name
  from public.employees e where e.id = p_professional_id;

  for v_item in select * from jsonb_array_elements(v_adjustment_items)
  loop
    v_item_amount := coalesce((v_item->>'amount')::numeric, 0);
    if v_item_amount < 0 then
      raise exception 'El importe de un ajuste no puede ser negativo';
    end if;
    if v_item_amount > 0 and coalesce(trim(v_item->>'reason'), '') = '' then
      raise exception 'Cada ajuste con importe mayor a $0 necesita un motivo';
    end if;
    v_adjustments := v_adjustments + v_item_amount;
  end loop;

  for v_item in select * from jsonb_array_elements(v_deduction_items)
  loop
    v_item_amount := coalesce((v_item->>'amount')::numeric, 0);
    if v_item_amount < 0 then
      raise exception 'El importe de una deducción no puede ser negativo';
    end if;
    if v_item_amount > 0 and coalesce(trim(v_item->>'reason'), '') = '' then
      raise exception 'Cada deducción con importe mayor a $0 necesita un motivo';
    end if;
    v_deductions := v_deductions + v_item_amount;
  end loop;

  -- Serializa a nivel negocio (no por profesional): el número de
  -- liquidación es un recurso compartido por todos sus profesionales.
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));

  select * into v_previous_run
  from public.settlement_runs
  where business_id = p_business_id and professional_id = p_professional_id
  order by cutoff_date desc, created_at desc
  limit 1;

  if found then
    if v_cutoff_at <= v_previous_run.prepared_at then
      raise exception 'La fecha de corte no puede ser anterior al inicio del período actual';
    end if;
    v_previous_balance := greatest(v_previous_run.total_to_settle - v_previous_run.amount_paid, 0);
    v_period_start_at := v_previous_run.prepared_at;
    v_period_start := v_period_start_at::date;
  end if;

  select coalesce(count(*), 0), coalesce(sum(pending_amount), 0)
    into v_service_count, v_new_commissions
  from public.commission_records
  where business_id = p_business_id
    and professional_id = p_professional_id
    and settlement_run_id is null
    and (v_period_start_at is null or created_at > v_period_start_at)
    and created_at <= v_cutoff_at
    and pending_amount > 0;

  -- Propinas pendientes del mismo período/corte — misma ventana exacta que
  -- las comisiones de arriba, pero sumada aparte (v_new_tips nunca se
  -- mezcla con v_new_commissions salvo al calcular v_total).
  select coalesce(sum(pending_amount), 0)
    into v_new_tips
  from public.tip_records
  where business_id = p_business_id
    and professional_id = p_professional_id
    and settlement_run_id is null
    and (v_period_start_at is null or created_at > v_period_start_at)
    and created_at <= v_cutoff_at
    and pending_amount > 0;

  select coalesce(sum(coalesce(pm.total, pm.amount, 0)), 0)
    into v_total_sold
  from public.commission_records cr
  join public.payments pm on pm.id = cr.sale_id
  where cr.business_id = p_business_id
    and cr.professional_id = p_professional_id
    and cr.settlement_run_id is null
    and (v_period_start_at is null or cr.created_at > v_period_start_at)
    and cr.created_at <= v_cutoff_at;

  -- Adelantos todavía no incluidos en ninguna liquidación, entregados
  -- hasta este corte — se descuentan del total, no importa cuándo se
  -- hayan dado (no están acotados al período, igual que el saldo
  -- anterior: son deuda pendiente hasta que una liquidación los cubre).
  select coalesce(sum(amount), 0) into v_advances
  from public.professional_advances
  where business_id = p_business_id
    and professional_id = p_professional_id
    and settlement_run_id is null
    and advanced_at <= v_cutoff_at;

  v_total := v_previous_balance + v_new_commissions + v_new_tips + v_adjustments - v_deductions - v_advances;
  if v_total < 0 then
    raise exception 'El total a liquidar no puede ser negativo (revisá ajustes/deducciones/adelantos)';
  end if;

  select greatest(coalesce(max(run_number), 0) + 1, 100) into v_run_number
  from public.settlement_runs
  where business_id = p_business_id;

  insert into public.settlement_runs (
    business_id, professional_id, professional_name, run_number, cutoff_date, prepared_at,
    period_start, period_start_at,
    previous_settlement_run_id,
    previous_balance, new_commissions, new_tips,
    adjustments, deductions, adjustment_items, deduction_items, advances,
    total_to_settle,
    service_count, total_sold, status, prepared_by, prepared_by_name
  ) values (
    p_business_id, p_professional_id, v_professional_name, v_run_number, v_cutoff_date, v_cutoff_at,
    v_period_start, v_period_start_at,
    v_previous_run.id,
    v_previous_balance, v_new_commissions, v_new_tips,
    v_adjustments, v_deductions, v_adjustment_items, v_deduction_items, v_advances,
    v_total,
    v_service_count, v_total_sold, 'pendiente', p_prepared_by, p_prepared_by_name
  ) returning * into v_run;

  -- Ajuste y deduccion son movimientos propios, uno cada uno si
  -- corresponde (no comparten numero entre si ni con el pago que
  -- eventualmente liquide este run).
  if v_adjustments > 0 then
    select * into v_adjustment_movement from public.next_business_movement_number(
      p_business_id, 'ajuste', p_professional_id, v_adjustments, v_cutoff_at
    );
    v_run.adjustment_movement_number := v_adjustment_movement.movement_number;
    v_run.adjustment_movement_id := v_adjustment_movement.id;
  end if;

  if v_deductions > 0 then
    select * into v_deduction_movement from public.next_business_movement_number(
      p_business_id, 'deduccion', p_professional_id, v_deductions, v_cutoff_at
    );
    v_run.deduction_movement_number := v_deduction_movement.movement_number;
    v_run.deduction_movement_id := v_deduction_movement.id;
  end if;

  if v_adjustments > 0 or v_deductions > 0 then
    update public.settlement_runs
      set adjustment_movement_number = v_run.adjustment_movement_number,
          adjustment_movement_id = v_run.adjustment_movement_id,
          deduction_movement_number = v_run.deduction_movement_number,
          deduction_movement_id = v_run.deduction_movement_id
      where id = v_run.id;
  end if;

  -- Bloquea cada comisión Y congela, en el mismo momento, todo lo que se
  -- muestra en "Servicios incluidos" — de acá en más esta fila nunca más
  -- se vuelve a leer de payments, así que el comprobante queda fijo para
  -- siempre aunque el cliente/servicio original se edite o se borre.
  update public.commission_records cr
    set settlement_run_id = v_run.id,
        snapshot_client_name = (select pm.client_name from public.payments pm where pm.id = cr.sale_id),
        snapshot_service_name = (select pm.service_name from public.payments pm where pm.id = cr.sale_id),
        snapshot_sale_total = (select coalesce(pm.total, pm.amount) from public.payments pm where pm.id = cr.sale_id),
        snapshot_payment_method = (select coalesce(pm.method, pm.payment_method) from public.payments pm where pm.id = cr.sale_id)
    where cr.business_id = p_business_id
      and cr.professional_id = p_professional_id
      and cr.settlement_run_id is null
      and (v_period_start_at is null or cr.created_at > v_period_start_at)
      and cr.created_at <= v_cutoff_at;

  -- Mismo bloqueo para las propinas del período — tabla separada, mismo
  -- momento exacto de "nace la liquidación".
  update public.tip_records tr
    set settlement_run_id = v_run.id
    where tr.business_id = p_business_id
      and tr.professional_id = p_professional_id
      and tr.settlement_run_id is null
      and (v_period_start_at is null or tr.created_at > v_period_start_at)
      and tr.created_at <= v_cutoff_at;

  update public.professional_advances
    set settlement_run_id = v_run.id
    where business_id = p_business_id
      and professional_id = p_professional_id
      and settlement_run_id is null
      and advanced_at <= v_cutoff_at;

  -- Snapshot completo de TODAS las ventas de este profesional en la misma
  -- ventana — a diferencia del UPDATE de comisiones de arriba (que solo
  -- toca filas de commission_records, o sea solo ventas QUE generaron
  -- comisión), esto lee directo de payments.employee_id y copia cualquier
  -- venta, tenga o no comisión (catálogo con override inactivo = $0, a
  -- propósito) — incluye retiros de stock pagados (misma tabla, se
  -- distinguen por el marcador ya existente en observations, sin columna
  -- nueva). LEFT JOIN a commission_records por sale_id: si no hay fila,
  -- commission_amount queda en 0, correcto.
  insert into public.settlement_run_sales (
    business_id, settlement_run_id, professional_id, sale_id, occurred_at,
    client_name, service_name, total, method,
    discount, original_amount, promotion_id, promotion_name, tip_amount,
    commission_amount, observations
  )
  select
    p_business_id, v_run.id, p_professional_id, pm.id, pm.created_at,
    pm.client_name, pm.service_name, coalesce(pm.total, pm.amount, 0), coalesce(pm.method, pm.payment_method),
    pm.discount, pm.original_amount, pm.promotion_id, pm.promotion_name, pm.tip_amount,
    coalesce(cr.amount, 0), pm.observations
  from public.payments pm
  left join public.commission_records cr on cr.sale_id = pm.id
  where pm.business_id = p_business_id
    and pm.employee_id = p_professional_id
    and (v_period_start_at is null or pm.created_at > v_period_start_at)
    and pm.created_at <= v_cutoff_at;

  return v_run;
end;
$run$;

grant execute on function public.prepare_settlement_run(
  uuid, uuid, jsonb, jsonb, uuid, text, timestamptz
) to authenticated;

-- ── 3. Refresca el schema cache de PostgREST ────────────────────────────────
NOTIFY pgrst, 'reload schema';
