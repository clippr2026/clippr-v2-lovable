-- ============================================================================
-- Liquidaciones — períodos consecutivos + saldo anterior explícito
-- ============================================================================
-- Hasta acá, prepare_settlement_run() solo filtraba "sale_date <= corte",
-- sin piso — no double-contaba nada gracias al bloqueo por
-- settlement_run_id, pero tampoco había un período real que mostrar
-- ("del 2 al 15 de julio") ni nada que impidiera preparar una liquidación
-- con una fecha de corte anterior o igual a la última.
--
-- Esta migración agrega:
--   1. period_start / previous_settlement_run_id en settlement_runs, para
--      que "saldo anterior" quede referenciado a una liquidación concreta
--      en vez de ser solo un número.
--   2. Un lock por profesional dentro de prepare_settlement_run (cierra la
--      ventana de carrera donde dos preparaciones concurrentes podían leer
--      el mismo "último run" y perder el saldo de una de las dos).
--   3. El guard de "no superponer períodos": el nuevo corte tiene que ser
--      posterior al último.
--   4. Backfill de period_start/previous_settlement_run_id para los runs
--      que ya existan.
--   5. FIX de bug en producción: "comisiones nuevas" sumaba
--      commission_records.amount (comisión bruta) en vez de
--      pending_amount (deuda real). Para profesionales con pagos
--      históricos ya aplicados desde antes de este sistema, eso mostraba
--      "total a liquidar" muy por encima del saldo pendiente real. Ahora
--      suma pending_amount y filtra pending_amount > 0.
--
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase y ejecutar.
-- Seguro re-ejecutar (add column if not exists / create or replace / el
-- backfill solo toca filas con period_start todavía null).
-- ============================================================================

-- ── 1. Columnas nuevas ───────────────────────────────────────────────────
alter table public.settlement_runs
  add column if not exists period_start date,
  add column if not exists previous_settlement_run_id uuid references public.settlement_runs(id);

comment on column public.settlement_runs.period_start is
  'Día posterior al corte de la liquidación anterior (null = primera
   liquidación del profesional, sin piso). Junto con cutoff_date define el
   período mostrado en el detalle y el comprobante.';
comment on column public.settlement_runs.previous_settlement_run_id is
  'Liquidación de la que se arrastró previous_balance, para poder mostrar
   "Liquidación anterior #N" en vez de solo un monto.';

-- ── 2. prepare_settlement_run: lock + período + guard de superposición ───
create or replace function public.prepare_settlement_run(
  p_business_id uuid,
  p_professional_id uuid,
  p_cutoff_date date,
  p_adjustments numeric,
  p_deductions numeric,
  p_prepared_by uuid,
  p_prepared_by_name text
)
returns public.settlement_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_caller_business uuid;
  v_previous_run public.settlement_runs;
  v_period_start date;
  v_previous_balance numeric := 0;
  v_new_commissions numeric := 0;
  v_service_count int := 0;
  v_total_sold numeric := 0;
  v_adjustments numeric := coalesce(p_adjustments, 0);
  v_deductions numeric := coalesce(p_deductions, 0);
  v_total numeric;
  v_run_number int;
  v_run public.settlement_runs;
begin
  if p_cutoff_date is null or p_cutoff_date > current_date then
    raise exception 'La fecha de corte no puede ser futura';
  end if;

  if p_prepared_by is distinct from auth.uid() then
    raise exception 'prepared_by debe ser el usuario autenticado';
  end if;

  select p.role, p.business_id into v_role, v_caller_business
  from public.profiles p where p.id = auth.uid();

  if v_caller_business is distinct from p_business_id then
    raise exception 'No tenés permiso sobre este negocio';
  end if;

  if v_role = 'profesional' then
    raise exception 'Un profesional no puede preparar sus propias liquidaciones';
  end if;

  -- Serializa preparaciones concurrentes para el mismo profesional: sin
  -- esto, dos llamadas simultáneas podrían leer el mismo "último run" como
  -- previous_run y las dos arrastrarían el mismo saldo, perdiéndolo de una.
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || p_professional_id::text, 0));

  -- Saldo anterior: lo que quedó pendiente del último run (si lo hay),
  -- congelado en ese momento — nunca se recalcula desde cero. El período
  -- nuevo arranca al día siguiente de ese corte.
  select * into v_previous_run
  from public.settlement_runs
  where business_id = p_business_id and professional_id = p_professional_id
  order by cutoff_date desc, created_at desc
  limit 1;

  if found then
    if p_cutoff_date <= v_previous_run.cutoff_date then
      raise exception 'La fecha de corte debe ser posterior a la última liquidación (%)',
        to_char(v_previous_run.cutoff_date, 'DD/MM/YYYY');
    end if;
    v_previous_balance := greatest(v_previous_run.total_to_settle - v_previous_run.amount_paid, 0);
    v_period_start := v_previous_run.cutoff_date + 1;
  end if;

  -- Comisiones nuevas: SOLO la deuda real pendiente (pending_amount, no
  -- amount) de comisiones dentro del período (desde el día posterior al
  -- último corte, o desde siempre si es la primera liquidación) y
  -- todavía sin asignar a ningún run. Usar "amount" acá en vez de
  -- "pending_amount" fue el bug reportado en producción: un profesional
  -- con pagos históricos ya aplicados (de antes de este sistema) mostraba
  -- la comisión bruta completa como "nueva" aunque una parte ya estuviera
  -- cobrada — el total a liquidar terminaba superando la deuda real
  -- (commission_records.pending_amount sumado en toda la tabla). Filtrar
  -- pending_amount > 0 además evita arrastrar filas ya saldadas que no
  -- aportan deuda pero sí inflarían el conteo de servicios.
  select coalesce(count(*), 0), coalesce(sum(pending_amount), 0)
    into v_service_count, v_new_commissions
  from public.commission_records
  where business_id = p_business_id
    and professional_id = p_professional_id
    and settlement_run_id is null
    and sale_date <= p_cutoff_date
    and (v_period_start is null or sale_date >= v_period_start)
    and pending_amount > 0;

  select coalesce(sum(coalesce(pm.total, pm.amount, 0)), 0)
    into v_total_sold
  from public.commission_records cr
  join public.payments pm on pm.id = cr.sale_id
  where cr.business_id = p_business_id
    and cr.professional_id = p_professional_id
    and cr.settlement_run_id is null
    and cr.sale_date <= p_cutoff_date
    and (v_period_start is null or cr.sale_date >= v_period_start);

  v_total := v_previous_balance + v_new_commissions + v_adjustments - v_deductions;
  if v_total < 0 then
    raise exception 'El total a liquidar no puede ser negativo (revisá ajustes/deducciones)';
  end if;

  select coalesce(max(run_number), 0) + 1 into v_run_number
  from public.settlement_runs
  where business_id = p_business_id and professional_id = p_professional_id;

  insert into public.settlement_runs (
    business_id, professional_id, run_number, cutoff_date, period_start,
    previous_settlement_run_id,
    previous_balance, new_commissions, adjustments, deductions, total_to_settle,
    service_count, total_sold, status, prepared_by, prepared_by_name
  ) values (
    p_business_id, p_professional_id, v_run_number, p_cutoff_date, v_period_start,
    v_previous_run.id,
    v_previous_balance, v_new_commissions, v_adjustments, v_deductions, v_total,
    v_service_count, v_total_sold, 'pendiente', p_prepared_by, p_prepared_by_name
  ) returning * into v_run;

  -- Bloquea las comisiones incluidas: ya no pueden entrar en otro run.
  update public.commission_records
    set settlement_run_id = v_run.id
    where business_id = p_business_id
      and professional_id = p_professional_id
      and settlement_run_id is null
      and sale_date <= p_cutoff_date
      and (v_period_start is null or sale_date >= v_period_start);

  return v_run;
end;
$$;

grant execute on function public.prepare_settlement_run(
  uuid, uuid, date, numeric, numeric, uuid, text
) to authenticated;

-- ── 3. Backfill de runs existentes ──────────────────────────────────────
do $$
declare
  v_key record;
  v_run record;
  v_prev_id uuid;
  v_prev_cutoff date;
begin
  for v_key in
    select distinct business_id, professional_id from public.settlement_runs
  loop
    v_prev_id := null;
    v_prev_cutoff := null;
    for v_run in
      select id, cutoff_date
      from public.settlement_runs
      where business_id = v_key.business_id
        and professional_id = v_key.professional_id
        and period_start is null
      order by cutoff_date asc, created_at asc
    loop
      update public.settlement_runs
        set period_start = case when v_prev_cutoff is null then null else v_prev_cutoff + 1 end,
            previous_settlement_run_id = v_prev_id
        where id = v_run.id;
      v_prev_id := v_run.id;
      v_prev_cutoff := v_run.cutoff_date;
    end loop;
  end loop;
end $$;
