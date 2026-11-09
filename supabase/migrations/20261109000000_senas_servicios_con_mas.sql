-- Señas: el servicio del turno se buscaba partiendo el nombre por " + ", así que un servicio cuyo
-- nombre ya lleva " + " ("Mechas + Corte", "Global + Corte") nunca coincidía con el catálogo y no
-- se pedía seña aunque estuviera en la regla. Ahora se compara por tramos completos.
-- Solo reemplaza la función; no toca tablas ni datos.

create or replace function public.ensure_public_deposit_v1(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  a record;
  d record;
  cl record;
  v_ids uuid[];
  v_req jsonb;
  v_hold int;
begin
  select ap.id, ap.business_id, ap.branch_id, ap.client_id, ap.service_name, ap.service_price,
         ap.status::text as status, ap.created_at
    into a
  from public.appointments ap
  where ap.manage_token = p_token;

  if a.id is null then
    return jsonb_build_object('ok', false, 'error', 'Turno no encontrado');
  end if;

  select * into d from public.appointment_deposits where appointment_id = a.id;
  if d.id is not null then
    return jsonb_build_object('ok', true, 'required', true,
      'deposit', jsonb_build_object('id', d.id, 'status', d.status, 'amount', d.amount, 'paid_amount', d.paid_amount, 'expires_at', d.expires_at),
      'instructions', public._deposit_instructions(a.business_id));
  end if;

  if a.status not in ('pending', 'confirmed') or a.created_at < now() - interval '30 minutes' then
    return jsonb_build_object('ok', true, 'required', false);
  end if;

  select phone, email into cl from public.clients where id = a.client_id;

  select coalesce(array_agg(p.id), '{}') into v_ids
  from public.price_catalog p
  where p.business_id = a.business_id
    -- Los nombres de servicio pueden llevar " + " (ej. "Mechas + Corte"): se busca cada nombre del
    -- catálogo como un tramo completo dentro de la lista de servicios del turno.
    and position(' + ' || p.name || ' + ' in ' + ' || a.service_name || ' + ') > 0;

  v_req := public._deposit_requirement(a.business_id, v_ids, a.service_price, cl.phone, cl.email);
  if not coalesce((v_req ->> 'required')::boolean, false) then
    return jsonb_build_object('ok', true, 'required', false);
  end if;

  v_hold := coalesce(nullif(public._senas_config(a.business_id) ->> 'hold_minutes', '')::int, 120);

  insert into public.appointment_deposits (business_id, branch_id, appointment_id, amount, expires_at, events)
  values (a.business_id, a.branch_id, a.id, (v_req ->> 'amount')::numeric, now() + make_interval(mins => v_hold),
          jsonb_build_array(jsonb_build_object('at', now(), 'action', 'requested', 'by', 'cliente', 'note', v_req -> 'reasons')))
  on conflict (appointment_id) do nothing
  returning * into d;

  if d.id is null then
    select * into d from public.appointment_deposits where appointment_id = a.id;
  end if;

  return jsonb_build_object('ok', true, 'required', true,
    'deposit', jsonb_build_object('id', d.id, 'status', d.status, 'amount', d.amount, 'paid_amount', d.paid_amount, 'expires_at', d.expires_at),
    'instructions', public._deposit_instructions(a.business_id));
end;
$$;
