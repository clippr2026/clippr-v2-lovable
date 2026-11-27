-- Comprobante adjuntado por el local a una seña ya recibida (turno creado desde la Agenda o Mi Panel).
-- Solo agrega una función. No cambia estado, montos, fechas de acreditación ni movimientos de Caja.
create or replace function public.attach_deposit_proof_v1(
  p_deposit_id uuid,
  p_mime text,
  p_data text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d record;
  v_proof uuid := gen_random_uuid();
begin
  select * into d from public.appointment_deposits where id = p_deposit_id for update;
  if d.id is null then
    return jsonb_build_object('ok', false, 'error', 'Seña no encontrada');
  end if;
  if auth.uid() is null or not coalesce(public.user_is_business_member(d.business_id), false) then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'error', 'Sin permiso');
  end if;
  if d.status <> 'paid' then
    return jsonb_build_object('ok', false, 'code', 'bad_state', 'error', 'Solo se puede adjuntar a una seña recibida');
  end if;
  if d.proof_path is not null then
    return jsonb_build_object('ok', false, 'code', 'has_proof', 'error', 'La seña ya tiene un comprobante');
  end if;
  if p_mime is null or p_mime not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then
    return jsonb_build_object('ok', false, 'error', 'Formato no permitido. Subí una foto (JPG, PNG) o un PDF.');
  end if;
  if p_data is null or length(p_data) < 100 then
    return jsonb_build_object('ok', false, 'error', 'Falta el comprobante');
  end if;
  if length(p_data) > 1500000 then
    return jsonb_build_object('ok', false, 'error', 'El archivo es muy pesado. Probá con una captura más chica.');
  end if;

  insert into public.appointment_deposit_proofs (id, deposit_id, business_id, mime, data, size_bytes)
  values (v_proof, d.id, d.business_id, p_mime, p_data, length(p_data));

  -- La fecha del comprobante queda igual a la de recepción: si la aprobación se revierte y se vuelve a
  -- aprobar, la seña no cambia de día en el banco.
  update public.appointment_deposits
  set proof_path = 'db:' || v_proof::text,
      proof_uploaded_at = coalesce(d.approved_at, now()),
      events = events || jsonb_build_object('at', now(), 'action', 'proof_attached', 'by', auth.uid())
  where id = d.id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.attach_deposit_proof_v1(uuid, text, text) from public, anon;
grant execute on function public.attach_deposit_proof_v1(uuid, text, text) to authenticated;
