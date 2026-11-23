-- ============================================================================
-- ROLLBACK A (seguro, NO borra datos): dejar de usar la regla nueva de señas.
-- ============================================================================
-- Qué hace:
--   1) Vuelve a la regla anterior ("primera caja abierta desde el día de la transferencia", migración 20261111010000),
--      conservando el "ciclo" de aprobación para que una seña revertida y re-aprobada no pierda su ingreso.
--   2) Quita a la app el permiso de revertir aprobaciones y de usar los totales nuevos.
-- Qué NO hace (a propósito): no borra ni edita ningún ajuste, fuera de jornada, reversión ni columna. Esos registros
-- son historial financiero y quedan intactos. Los ajustes / fuera de jornada ya creados NO están en ninguna caja:
-- tras este rollback hay que decidir caso por caso si se llevan a una caja (el script lista cuáles son).
-- ============================================================================
begin;

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
  v_ciclo integer;
begin
  if new.status = 'paid' and new.paid_amount > 0
     and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    select 'Seña – ' || coalesce(a.client_name, 'cliente') || ' – ' || coalesce(a.service_name, '')
      into v_label
    from public.appointments a
    where a.id = new.appointment_id;

    v_ciclo := 1
      + (select count(*) from public.cash_movements m where m.deposit_id = new.id and m.deposit_event = 'reversed')
      + (select count(*) from public.caja_ajustes_posteriores r where r.deposit_id = new.id and r.tipo = 'reversion');

    v_transferida := v_method = 'cuenta' and new.credited_at is not null and new.credited_at < now();
    v_base := case
      when v_transferida then (new.credited_at at time zone 'America/Argentina/Buenos_Aires')::date
      else v_hoy
    end;

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
                                       deposit_event, deposit_ciclo, credited_at, created_at, extension_pendiente)
    values (new.business_id, new.branch_id, 'ingreso', new.paid_amount, v_label, 'Sistema · Seña', v_method, new.id,
            'received', v_ciclo, new.credited_at, v_created, false)
    on conflict (deposit_id, deposit_event, deposit_ciclo) where deposit_id is not null do nothing;
  end if;
  return null;
end;
$$;
revoke all on function public._deposit_cash_movements() from public, anon, authenticated;

revoke execute on function public.reverse_deposit_approval_v1(uuid, text, text) from authenticated;
revoke execute on function public.caja_total_ajustado_v1(uuid, uuid, date) from authenticated;
revoke execute on function public.senas_conciliacion_bancaria_v1(uuid, uuid, date, date) from authenticated;

-- Informe de lo que queda fuera de toda caja (para decidir qué hacer con cada uno).
select tipo, fecha_bancaria, metodo, monto, cliente, approved_at, deposit_id
from public.caja_ajustes_posteriores
where tipo in ('ajuste_posterior', 'fuera_de_jornada')
  and not exists (select 1 from public.caja_ajustes_posteriores x where x.revierte_id = caja_ajustes_posteriores.id)
order by fecha_bancaria;

commit;
