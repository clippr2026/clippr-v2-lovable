-- Señas: vencimiento automático.
-- Un turno con seña pendiente (o con comprobante rechazado) ocupa el horario
-- hasta que vence el plazo de pago (expires_at). Pasado ese plazo sin pagar,
-- el turno se cancela y el horario queda libre. Un comprobante en revisión
-- ('review') o una seña ya pagada NUNCA vencen.
--
-- - expire_unpaid_deposits_v1(): lo llama el programador (send-reminders,
--   service_role). Devuelve los turnos cancelados para avisar por correo.
-- - expire_deposit_public_v1(token): lo llama la página del cliente cuando el
--   contador llega a cero; valida el plazo del lado del servidor.

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
  if d.id is null or d.status not in ('pending', 'rejected') or d.expires_at is null or d.expires_at > now() then
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
    where dp.status in ('pending', 'rejected') and dp.expires_at <= now()
  loop
    if public._expire_deposit_core(r.aid) then
      appointment_id := r.aid;
      business_id := r.bid;
      return next;
    end if;
  end loop;
end;
$$;

create or replace function public.expire_deposit_public_v1(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.appointments where manage_token = p_token;
  if v_id is null then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true, 'expired', public._expire_deposit_core(v_id));
end;
$$;

revoke all on function public._expire_deposit_core(uuid) from public, anon, authenticated;
revoke all on function public.expire_unpaid_deposits_v1() from public, anon, authenticated;
revoke all on function public.expire_deposit_public_v1(uuid) from public;
grant execute on function public.expire_unpaid_deposits_v1() to service_role;
grant execute on function public.expire_deposit_public_v1(uuid) to anon, authenticated;
