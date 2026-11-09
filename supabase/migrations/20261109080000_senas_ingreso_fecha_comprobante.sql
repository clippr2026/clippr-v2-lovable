-- Señas: el dinero de la seña cuenta en el día en que el cliente subió el comprobante (no el día en que
-- se aprueba). Ej.: comprobante el domingo, aprobado el lunes → el ingreso queda fechado el domingo.
-- Si ese día ya tiene cierre de caja, el ingreso se fecha al aprobar (no se toca un día cerrado).
-- Las señas registradas a mano en el local siguen fechándose en el momento. Solo reemplaza la función.

create or replace function public._deposit_cash_movements()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_method text := case when new.method = 'cash' then 'efectivo' else 'cuenta' end;
  v_label text;
  v_tz text;
  v_when timestamptz := now();
  v_proof_day date;
begin
  select 'Seña – ' || coalesce(a.client_name, 'cliente') || ' – ' || coalesce(a.service_name, '')
    into v_label
  from public.appointments a
  where a.id = new.appointment_id;

  if new.status = 'paid' and new.paid_amount > 0
     and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    -- Fecha del ingreso: el día del comprobante, salvo que esa fecha ya esté cerrada o sea futura.
    if new.proof_uploaded_at is not null and new.proof_uploaded_at <= now() then
      select coalesce(timezone, 'America/Argentina/Buenos_Aires') into v_tz
      from public.businesses where id = new.business_id;
      v_tz := coalesce(v_tz, 'America/Argentina/Buenos_Aires');
      v_proof_day := (new.proof_uploaded_at at time zone v_tz)::date;
      if not exists (
        select 1 from public.caja_cierres c
        where c.business_id = new.business_id
          and c.fecha = v_proof_day
          and lower(coalesce(c.estado, '')) = 'cerrada'
          and (c.branch_id is null or new.branch_id is null or c.branch_id = new.branch_id)
      ) then
        v_when := new.proof_uploaded_at;
      end if;
    end if;

    insert into public.cash_movements (business_id, branch_id, type, amount, note, created_by, method, deposit_id, deposit_event, created_at)
    values (new.business_id, new.branch_id, 'ingreso', new.paid_amount, v_label, 'Sistema · Seña', v_method, new.id, 'received', v_when)
    on conflict (deposit_id, deposit_event) where deposit_id is not null do nothing;
  end if;

  if tg_op = 'UPDATE' and new.status = 'returned' and old.status is distinct from 'returned' and new.refund_amount > 0 then
    insert into public.cash_movements (business_id, branch_id, type, amount, note, created_by, method, deposit_id, deposit_event)
    values (new.business_id, new.branch_id, 'retiro', new.refund_amount, 'Devolución de ' || v_label, 'Sistema · Seña', v_method, new.id, 'refund')
    on conflict (deposit_id, deposit_event) where deposit_id is not null do nothing;
  end if;

  return null;
end;
$$;

revoke all on function public._deposit_cash_movements() from public, anon, authenticated;
