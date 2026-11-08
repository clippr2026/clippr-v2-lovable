-- Señas, etapa 4a: reflejo en Caja.
--
-- Usa los movimientos manuales de caja (cash_movements, ya incluidos en el
-- "efectivo / cuenta esperados" del cierre) sin tocar el cálculo del cierre:
--   - seña recibida  -> ingreso en efectivo (si se pagó en efectivo) o en cuenta
--   - seña devuelta  -> retiro por el mismo medio
-- Una seña retenida no mueve plata (ya estaba en caja); su reparto queda en
-- appointment_deposits (retained_prof_amount / retained_local_amount).
-- Cada movimiento queda enlazado a su seña (deposit_id + deposit_event, único),
-- así nunca se duplica aunque la seña cambie de estado varias veces.

alter table public.cash_movements
  add column if not exists deposit_id uuid references public.appointment_deposits(id) on delete set null,
  add column if not exists deposit_event text check (deposit_event in ('received', 'refund'));

create unique index if not exists cash_movements_deposit_event_uidx
  on public.cash_movements (deposit_id, deposit_event)
  where deposit_id is not null;

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
    insert into public.cash_movements (business_id, branch_id, type, amount, note, created_by, method, deposit_id, deposit_event)
    values (new.business_id, new.branch_id, 'ingreso', new.paid_amount, v_label, 'Sistema · Seña', v_method, new.id, 'received')
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

drop trigger if exists trg_deposit_cash_movements on public.appointment_deposits;
create trigger trg_deposit_cash_movements
  after insert or update of status on public.appointment_deposits
  for each row execute function public._deposit_cash_movements();
