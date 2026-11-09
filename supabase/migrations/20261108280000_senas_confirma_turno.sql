-- Señas: al quedar pagada la seña, el turno que estaba "Por confirmar" pasa a
-- "Confirmado" (la seña pagada es la confirmación). Solo en la transición a
-- 'paid'; no toca turnos ya confirmados, cancelados, cobrados ni nada más.
create or replace function public._deposit_after_write()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.appointments
  set deposit_amount = new.amount,
      deposit_paid = case when new.status in ('paid','applied','to_decide','retained','returned') then new.paid_amount else 0 end,
      deposit_status = case new.status
        when 'paid' then 'paid'
        when 'applied' then 'paid'
        when 'to_decide' then 'paid'
        when 'returned' then 'returned'
        when 'retained' then 'lost'
        when 'pending' then 'pending'
        when 'review' then 'pending'
        else 'none'
      end,
      status = case
        when new.status = 'paid' and (tg_op = 'INSERT' or old.status is distinct from 'paid') and status = 'pending'
          then 'confirmed'
        else status
      end
  where id = new.appointment_id;
  return null;
end;
$$;
