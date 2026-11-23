-- ============================================================================
-- ROLLBACK B (eliminar los objetos de la migración). Se NIEGA a correr si ya hay datos que se perderían.
-- Ejecutar primero ROLLBACK_A. Si ya existe un solo ajuste, fuera de jornada, reversión contable o
-- aprobación re-hecha, este script aborta SIN cambiar nada: ese historial financiero no se borra.
-- ============================================================================
begin;

do $$
declare
  v_aj bigint;
  v_cm bigint;
begin
  select count(*) into v_aj from public.caja_ajustes_posteriores;
  select count(*) into v_cm from public.cash_movements where contable or deposit_event = 'reversed' or deposit_ciclo > 1;
  if v_aj > 0 or v_cm > 0 then
    raise exception 'ROLLBACK B abortado: hay % ajustes/reversiones y % movimientos contables o de ciclos > 1. No se borra historial financiero.', v_aj, v_cm;
  end if;
end $$;

drop view if exists public.senas_ingresos_por_fecha_bancaria;
drop function if exists public.senas_conciliacion_bancaria_v1(uuid, uuid, date, date);
drop function if exists public.caja_total_ajustado_v1(uuid, uuid, date);
drop function if exists public.reverse_deposit_approval_v1(uuid, text, text);
drop function if exists public._caja_autorizacion_check_v1(uuid, text, text);
drop function if exists public._caja_dia_con_actividad(uuid, uuid, date);
drop function if exists public._caja_dia_cerrado(uuid, uuid, date);
drop table public.caja_ajustes_posteriores;
drop function if exists public._caja_ajustes_inalterable();

-- El índice único vuelve a su forma original (el trigger de ROLLBACK_A ya no depende del ciclo: se reemplaza acá).
drop index if exists public.cash_movements_una_reversion_uidx;
drop index if exists public.cash_movements_deposit_event_uidx;
create unique index cash_movements_deposit_event_uidx on public.cash_movements (deposit_id, deposit_event) where deposit_id is not null;
alter table public.cash_movements drop constraint if exists cash_movements_deposit_event_check;
alter table public.cash_movements add constraint cash_movements_deposit_event_check
  check (deposit_event = any (array['received'::text, 'refund'::text, 'prof_share'::text]));
alter table public.cash_movements
  drop column if exists deposit_ciclo, drop column if exists contable, drop column if exists revierte_id,
  drop column if exists motivo, drop column if exists usuario_id, drop column if exists registrado_en;

-- Trigger de la regla anterior (20261111010000) tal cual, con su índice original.
create or replace function public._deposit_cash_movements()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_method text := case when new.method = 'cash' then 'efectivo' else 'cuenta' end;
  v_label text;
  v_created timestamptz;
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_transferida boolean;
  v_base date;
  v_dia date;
begin
  if new.status = 'paid' and new.paid_amount > 0
     and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    select 'Seña – ' || coalesce(a.client_name, 'cliente') || ' – ' || coalesce(a.service_name, '')
      into v_label from public.appointments a where a.id = new.appointment_id;
    v_transferida := v_method = 'cuenta' and new.credited_at is not null and new.credited_at < now();
    v_base := case when v_transferida then (new.credited_at at time zone 'America/Argentina/Buenos_Aires')::date else v_hoy end;
    v_dia := v_base;
    for i in 1..31 loop
      exit when public._caja_dia_abierto(new.business_id, new.branch_id, v_dia);
      v_dia := v_dia + 1;
    end loop;
    v_created := case
      when v_dia = v_base and v_transferida then new.credited_at
      when v_dia = v_hoy then now()
      else (v_dia::timestamp + interval '1 second') at time zone 'America/Argentina/Buenos_Aires'
    end;
    insert into public.cash_movements (business_id, branch_id, type, amount, note, created_by, method, deposit_id,
                                       deposit_event, credited_at, created_at, extension_pendiente)
    values (new.business_id, new.branch_id, 'ingreso', new.paid_amount, v_label, 'Sistema · Seña', v_method, new.id,
            'received', new.credited_at, v_created, false)
    on conflict (deposit_id, deposit_event) where deposit_id is not null do nothing;
  end if;
  return null;
end;
$$;
revoke all on function public._deposit_cash_movements() from public, anon, authenticated;

commit;
