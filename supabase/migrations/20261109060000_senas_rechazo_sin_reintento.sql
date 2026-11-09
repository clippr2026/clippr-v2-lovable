-- Señas: un comprobante rechazado ya no se puede volver a subir; el cliente se comunica con el local.
--  - submit_deposit_proof_public_v1: solo acepta comprobantes de señas pendientes o en revisión.
--  - Las señas rechazadas no se cancelan solas por vencimiento: las resuelve el local (registrar la
--    seña recibida o cancelar el turno).
--  - El turno con comprobante rechazado sigue figurando como "seña pendiente" en la Agenda.
-- Solo reemplaza funciones; no toca datos.

create or replace function public.submit_deposit_proof_public_v1(
  p_token uuid,
  p_proof_path text,
  p_method text default 'transfer',
  p_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d record;
  v_mode text;
  v_method text := case when p_method in ('transfer','mercadopago') then p_method else 'transfer' end;
begin
  select dp.* into d
  from public.appointment_deposits dp
  join public.appointments ap on ap.id = dp.appointment_id
  where ap.manage_token = p_token
  for update of dp;

  if d.id is null then
    return jsonb_build_object('ok', false, 'error', 'Este turno no tiene seña');
  end if;
  if d.status not in ('pending', 'review') then
    return jsonb_build_object('ok', false, 'code', 'not_pending', 'error', 'La seña ya fue procesada');
  end if;
  if nullif(trim(coalesce(p_proof_path, '')), '') is null then
    return jsonb_build_object('ok', false, 'error', 'Falta el comprobante');
  end if;

  v_mode := coalesce(public._senas_config(d.business_id) ->> 'proof_mode', 'review');

  if v_mode = 'auto' then
    update public.appointment_deposits
    set status = 'paid', paid_amount = amount, method = v_method,
        proof_path = p_proof_path, proof_reference = p_reference, proof_uploaded_at = now(),
        approved_at = now(),
        events = events || jsonb_build_object('at', now(), 'action', 'paid_auto', 'by', 'cliente')
    where id = d.id;
    return jsonb_build_object('ok', true, 'status', 'paid');
  end if;

  update public.appointment_deposits
  set status = 'review', method = v_method,
      proof_path = p_proof_path, proof_reference = p_reference, proof_uploaded_at = now(),
      events = events || jsonb_build_object('at', now(), 'action', 'proof_sent', 'by', 'cliente')
  where id = d.id;
  return jsonb_build_object('ok', true, 'status', 'review');
end;
$$;

create or replace function public._expire_deposit_core(p_appointment_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d record;
  a record;
begin
  select * into d from public.appointment_deposits where appointment_id = p_appointment_id for update;
  if d.id is null or d.status <> 'pending' or d.expires_at is null or d.expires_at > now() then
    return false;
  end if;

  select * into a from public.appointments where id = p_appointment_id for update;
  if a.id is null or a.status not in ('pending', 'confirmed') then
    return false;
  end if;

  update public.appointments
  set status = 'cancelled',
      cancelled_at = now(),
      cancel_reason = 'No se pagó la seña a tiempo',
      cancelled_by_name = 'Sistema',
      cancelled_by_role = 'system',
      updated_at = now()
  where id = a.id;

  -- El trigger de turnos pasa 'pending' a 'expired'; 'rejected' lo hacemos acá.
  update public.appointment_deposits
  set status = 'expired',
      updated_at = now(),
      events = events || jsonb_build_object('at', now(), 'action', 'expired', 'by', 'system', 'note', 'plazo vencido')
  where id = d.id and status <> 'expired';

  return true;
end;
$$;

create or replace function public.expire_unpaid_deposits_v1()
returns table (appointment_id uuid, business_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
begin
  for r in
    select dp.appointment_id as aid, dp.business_id as bid
    from public.appointment_deposits dp
    where dp.status = 'pending' and dp.expires_at <= now()
  loop
    if public._expire_deposit_core(r.aid) then
      appointment_id := r.aid;
      business_id := r.bid;
      return next;
    end if;
  end loop;
end;
$$;

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
        when 'rejected' then 'pending'
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

revoke all on function public._expire_deposit_core(uuid) from public, anon, authenticated;
revoke all on function public.expire_unpaid_deposits_v1() from public, anon, authenticated;
grant execute on function public.expire_unpaid_deposits_v1() to service_role;
revoke all on function public._deposit_after_write() from public, anon, authenticated;
revoke all on function public.submit_deposit_proof_public_v1(uuid, text, text, text) from public;
grant execute on function public.submit_deposit_proof_public_v1(uuid, text, text, text) to anon, authenticated;
