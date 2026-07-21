-- ============================================================================
-- Liquidaciones — confirmar/observar (Panel del profesional, fase 2)
-- ============================================================================
-- El profesional NO tiene UPDATE directo de tabla sobre settlement_runs
-- (ver 20260721090000_settlement_runs.sql) porque RLS no puede restringir
-- a nivel de columna — sin esto, podría tocar total_to_settle,
-- amount_paid, etc. de su propia liquidación. Estos dos RPCs son el único
-- camino: cada uno solo puede tocar las columnas de confirmación/
-- observación, nunca montos.
--
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase y ejecutar.
-- Seguro re-ejecutar (create or replace en todo).
-- ============================================================================

create or replace function public.confirm_settlement_run(p_settlement_run_id uuid)
returns public.settlement_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.settlement_runs;
  v_my_employee_id uuid;
  v_my_business_id uuid;
begin
  select p.employee_id, p.business_id into v_my_employee_id, v_my_business_id
  from public.profiles p where p.id = auth.uid();

  select * into v_run from public.settlement_runs where id = p_settlement_run_id;
  if not found then
    raise exception 'Liquidación no encontrada';
  end if;

  if v_run.business_id is distinct from v_my_business_id
     or v_run.professional_id is distinct from v_my_employee_id then
    raise exception 'No tenés permiso sobre esta liquidación';
  end if;

  update public.settlement_runs
    set professional_confirmed_at = now(),
        professional_confirmed_by = auth.uid()
    where id = p_settlement_run_id
    returning * into v_run;

  return v_run;
end;
$$;

grant execute on function public.confirm_settlement_run(uuid) to authenticated;

create or replace function public.observe_settlement_run(
  p_settlement_run_id uuid,
  p_observation text
)
returns public.settlement_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.settlement_runs;
  v_my_employee_id uuid;
  v_my_business_id uuid;
begin
  if p_observation is null or trim(p_observation) = '' then
    raise exception 'La observación no puede estar vacía';
  end if;

  select p.employee_id, p.business_id into v_my_employee_id, v_my_business_id
  from public.profiles p where p.id = auth.uid();

  select * into v_run from public.settlement_runs where id = p_settlement_run_id;
  if not found then
    raise exception 'Liquidación no encontrada';
  end if;

  if v_run.business_id is distinct from v_my_business_id
     or v_run.professional_id is distinct from v_my_employee_id then
    raise exception 'No tenés permiso sobre esta liquidación';
  end if;

  update public.settlement_runs
    set status = 'observada',
        professional_observation = trim(p_observation),
        professional_observed_at = now()
    where id = p_settlement_run_id
    returning * into v_run;

  return v_run;
end;
$$;

grant execute on function public.observe_settlement_run(uuid, text) to authenticated;
