-- Señas: guardar SIEMPRE la fecha real de acreditación (credited_at) y la fecha de aprobación (approved_at),
-- para conciliación bancaria y para separar "dinero en cuenta" (día de acreditación) de "ingresos" (día de
-- aprobación). El movimiento de caja de una seña queda en el día de aprobación (nunca se fecha en un día
-- anterior, así no se reabre ni modifica una caja cerrada) y lleva credited_at para que los cálculos de
-- dinero en cuenta distingan las señas acreditadas en otro día.
-- No toca montos ni movimientos existentes: solo agrega columnas, las completa y ajusta dos funciones.

alter table public.appointment_deposits add column if not exists credited_at timestamptz;
alter table public.cash_movements add column if not exists credited_at timestamptz;

-- Seña aprobada: acreditada el día del comprobante (transferencia) o en el momento (efectivo / registrada a mano).
update public.appointment_deposits
set credited_at = coalesce(case when coalesce(method, 'transfer') <> 'cash' then proof_uploaded_at end, approved_at, updated_at),
    approved_at = coalesce(approved_at, updated_at)
where status in ('paid', 'applied', 'to_decide', 'retained', 'returned')
  and credited_at is null;

update public.cash_movements m
set credited_at = d.credited_at
from public.appointment_deposits d
where m.deposit_id = d.id and m.credited_at is null;

create or replace function public._deposit_set_dates()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    new.approved_at := coalesce(new.approved_at, now());
    if new.credited_at is null then
      new.credited_at := case
        when coalesce(new.method, 'transfer') <> 'cash' and new.proof_uploaded_at is not null and new.proof_uploaded_at <= now()
          then new.proof_uploaded_at
        else now()
      end;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_deposit_set_dates on public.appointment_deposits;
create trigger trg_deposit_set_dates
  before insert or update of status on public.appointment_deposits
  for each row execute function public._deposit_set_dates();

create or replace function public._deposit_cash_movements()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_method text := case when new.method = 'cash' then 'efectivo' else 'cuenta' end;
  v_label text;
begin
  select 'Seña – ' || coalesce(a.client_name, 'cliente') || ' – ' || coalesce(a.service_name, '')
    into v_label
  from public.appointments a
  where a.id = new.appointment_id;

  if new.status = 'paid' and new.paid_amount > 0
     and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    insert into public.cash_movements (business_id, branch_id, type, amount, note, created_by, method, deposit_id, deposit_event, credited_at)
    values (new.business_id, new.branch_id, 'ingreso', new.paid_amount, v_label, 'Sistema · Seña', v_method, new.id, 'received', new.credited_at)
    on conflict (deposit_id, deposit_event) where deposit_id is not null do nothing;
  end if;

  if tg_op = 'UPDATE' and new.status = 'returned' and old.status is distinct from 'returned' and new.refund_amount > 0 then
    insert into public.cash_movements (business_id, branch_id, type, amount, note, created_by, method, deposit_id, deposit_event, credited_at)
    values (new.business_id, new.branch_id, 'retiro', new.refund_amount, 'Devolución de ' || v_label, 'Sistema · Seña', v_method, new.id, 'refund', now())
    on conflict (deposit_id, deposit_event) where deposit_id is not null do nothing;
  end if;

  return null;
end;
$$;

revoke all on function public._deposit_cash_movements() from public, anon, authenticated;
revoke all on function public._deposit_set_dates() from public, anon, authenticated;
