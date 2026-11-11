-- ============================================================================
-- Señas: la seña entra en la primera caja abierta desde el día de la transferencia
-- ============================================================================
-- Reemplaza la regla de "extensión de la caja cerrada" (20261110030000):
--   · Si la caja del día de la transferencia sigue sin cerrar, la seña queda en ese día.
--   · Si ese día ya está cerrado, o el local no abrió (día no laborable / cierre de Agenda),
--     la seña pasa al siguiente día con caja abierta (ej. seña del domingo → lunes;
--     seña aprobada después de cerrar el lunes → martes).
--   · credited_at conserva el día real de la transferencia: la app avisa "seña del domingo".
--
-- No modifica filas existentes. extension_pendiente / caja_cierre_extensiones quedan sin uso
-- nuevo (las señas ya no se marcan como extensión).
--
-- Cómo revertirlo: volver a crear _deposit_cash_movements desde 20261110030000 y borrar
-- _caja_dia_abierto.
-- ============================================================================

-- ¿La caja de ese día puede recibir una seña? No está cerrada y el local abre ese día
-- (horario semanal + cierres de Agenda), o igual hubo cobros ese día.
create or replace function public._caja_dia_abierto(p_business_id uuid, p_branch_id uuid, p_dia date)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    not exists (
      select 1 from public.caja_cierres c
      where c.business_id = p_business_id
        and c.branch_id is not distinct from p_branch_id
        and c.fecha = p_dia
        and c.estado = 'cerrada'
    )
    and (
      (
        coalesce((
          select (bs.schedule -> lower(to_char(p_dia, 'dy')) ->> 'enabled')::boolean
          from public.branch_settings bs
          where bs.business_id = p_business_id and bs.branch_id = p_branch_id
        ), true)
        and not exists (
          select 1 from public.closures cl
          where cl.business_id = p_business_id
            and (cl.branch_id is null or cl.branch_id = p_branch_id)
            and p_dia between cl.start_date and cl.end_date
        )
      )
      or exists (
        select 1 from public.payments p
        where p.business_id = p_business_id
          and p.branch_id is not distinct from p_branch_id
          and p.created_at >= (p_dia::timestamp at time zone 'America/Argentina/Buenos_Aires')
          and p.created_at < ((p_dia + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
          and coalesce(p.status, '') not in ('anulado', 'reembolsado')
      )
    );
$$;

revoke all on function public._caja_dia_abierto(uuid, uuid, date) from public, anon, authenticated;

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
      into v_label
    from public.appointments a
    where a.id = new.appointment_id;

    -- Transferencia: el día base es el de la transferencia. Efectivo / a mano: hoy.
    v_transferida := v_method = 'cuenta' and new.credited_at is not null and new.credited_at < now();
    v_base := case
      when v_transferida then (new.credited_at at time zone 'America/Argentina/Buenos_Aires')::date
      else v_hoy
    end;

    -- Primera caja abierta desde el día base (tope de 31 días por seguridad).
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

  -- El reembolso no genera un retiro: lo registra decide_deposit_v1 como gasto del día.
  return null;
end;
$$;

revoke all on function public._deposit_cash_movements() from public, anon, authenticated;
