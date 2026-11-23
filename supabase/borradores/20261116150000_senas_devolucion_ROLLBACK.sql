-- ROLLBACK de 20261116150000_senas_devolucion.sql — vuelve a la devolución anterior. No borra ningún dato:
-- las devoluciones ya hechas (gastos "Reembolso de seña" y señas "Devuelta") quedan como están.
begin;
CREATE OR REPLACE FUNCTION public.decide_deposit_v1(p_deposit_id uuid, p_action text, p_prof_pct numeric DEFAULT NULL::numeric, p_local_pct numeric DEFAULT NULL::numeric, p_note text DEFAULT NULL::text, p_funds_source text DEFAULT 'caja'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d record;
  c jsonb;
  v_dist text;
  v_prof numeric;
  v_local numeric;
  v_label text;
  v_user text;
  v_src text := coalesce(nullif(trim(p_funds_source), ''), 'caja');
begin
  select * into d from public.appointment_deposits where id = p_deposit_id for update;
  if d.id is null then
    return jsonb_build_object('ok', false, 'error', 'Seña no encontrada');
  end if;
  if auth.uid() is null or not public.user_is_business_member(d.business_id) then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'error', 'Sin permiso');
  end if;
  if d.status <> 'to_decide' then
    return jsonb_build_object('ok', false, 'code', 'bad_state', 'error', 'Esta seña no está pendiente de decisión');
  end if;
  if p_action not in ('retain', 'refund') then
    return jsonb_build_object('ok', false, 'error', 'Acción inválida');
  end if;
  if v_src not in ('caja', 'otros') then
    return jsonb_build_object('ok', false, 'error', 'Origen del dinero inválido');
  end if;

  if p_action = 'refund' then
    update public.appointment_deposits
    set status = 'returned', refund_amount = paid_amount,
        decided_by = auth.uid(), decided_at = now(), decision_note = p_note,
        events = events || jsonb_build_object('at', now(), 'action', 'refunded', 'by', auth.uid(), 'note', p_note)
    where id = d.id;
    -- El reembolso es un gasto del día (no un movimiento de caja): origen Caja o Fondos externos.
    if coalesce(d.paid_amount, 0) > 0 then
      select coalesce(a.client_name, 'cliente') || ' – ' || coalesce(a.service_name, '')
        into v_label
      from public.appointments a where a.id = d.appointment_id;
      select coalesce(nullif(trim(p.full_name), ''), 'Caja') into v_user from public.profiles p where p.id = auth.uid();
      insert into public.expenses (business_id, branch_id, name, amount, type, payment_method, funds_source, date, note,
                                   user_id, user_name, created_by, deposit_id)
      values (d.business_id, d.branch_id, 'Reembolso de seña', d.paid_amount, 'ocasional',
              case when d.method = 'cash' then 'efectivo' else 'transferencia' end,
              v_src, (now() at time zone 'America/Argentina/Buenos_Aires')::date,
              coalesce(v_label, 'cliente') || coalesce(' – ' || nullif(trim(p_note), ''), ''),
              auth.uid(), coalesce(v_user, 'Caja'), coalesce(v_user, 'Caja'), d.id)
      on conflict (deposit_id) where deposit_id is not null do nothing;
    end if;
    return jsonb_build_object('ok', true, 'status', 'returned', 'refund_amount', d.paid_amount, 'funds_source', v_src);
  end if;

  -- Retener: reparto indicado, o el configurado (local / profesional / mitad y mitad / custom).
  if p_prof_pct is null and p_local_pct is null then
    c := public._senas_config(d.business_id);
    v_dist := coalesce(c ->> 'lost_dist', 'local');
    v_prof := case v_dist
      when 'professional' then 100
      when 'split' then 50
      when 'custom' then coalesce(nullif(c ->> 'lost_prof', '')::numeric, 0)
      else 0 end;
    v_local := 100 - v_prof;
  else
    v_prof := coalesce(p_prof_pct, 100 - coalesce(p_local_pct, 0));
    v_local := coalesce(p_local_pct, 100 - v_prof);
  end if;

  if v_prof < 0 or v_local < 0 or abs(v_prof + v_local - 100) > 0.001 then
    return jsonb_build_object('ok', false, 'error', 'El reparto debe sumar 100%');
  end if;

  update public.appointment_deposits
  set status = 'retained',
      retained_prof_amount = round(paid_amount * v_prof / 100, 2),
      retained_local_amount = paid_amount - round(paid_amount * v_prof / 100, 2),
      decided_by = auth.uid(), decided_at = now(), decision_note = p_note,
      events = events || jsonb_build_object('at', now(), 'action', 'retained', 'by', auth.uid(),
                                            'note', p_note, 'prof_pct', v_prof, 'local_pct', v_local)
  where id = d.id;

  return jsonb_build_object('ok', true, 'status', 'retained', 'prof_pct', v_prof, 'local_pct', v_local,
    'prof_amount', round(d.paid_amount * v_prof / 100, 2),
    'local_amount', d.paid_amount - round(d.paid_amount * v_prof / 100, 2));
end;
$function$;
revoke all on function public.decide_deposit_v1(uuid, text, numeric, numeric, text, text) from public, anon;
grant execute on function public.decide_deposit_v1(uuid, text, numeric, numeric, text, text) to authenticated;
drop function if exists public.refund_deposit_v1(uuid, text, text, text);
drop view public.senas_ingresos_por_fecha_bancaria;
create view public.senas_ingresos_por_fecha_bancaria with (security_invoker = true) as
 SELECT m.business_id,
    m.branch_id,
    (COALESCE(m.credited_at, m.created_at) AT TIME ZONE 'America/Argentina/Buenos_Aires'::text)::date AS fecha_bancaria,
        CASE
            WHEN m.deposit_event = 'reversed'::text THEN 'reversion'::text
            ELSE 'ingreso_en_caja'::text
        END AS clase,
        CASE
            WHEN m.type = 'ingreso'::text THEN m.amount
            ELSE - m.amount
        END AS monto,
    m.method AS metodo,
        CASE
            WHEN m.method = 'efectivo'::text THEN 'efectivo_fisico'::text
            ELSE 'banco'::text
        END AS medio,
    m.deposit_id,
    COALESCE(m.registrado_en, m.created_at) AS registrado_en,
    NULL::uuid AS cierre_id,
    false AS requiere_conciliacion
   FROM cash_movements m
  WHERE m.deposit_id IS NOT NULL AND (m.deposit_event = ANY (ARRAY['received'::text, 'reversed'::text])) AND m.business_id = (( SELECT p.business_id
           FROM profiles p
          WHERE p.id = auth.uid())) AND (( SELECT p.role
           FROM profiles p
          WHERE p.id = auth.uid())) IS DISTINCT FROM 'profesional'::text
UNION ALL
 SELECT r.business_id,
    r.branch_id,
    r.fecha_bancaria,
    r.tipo AS clase,
    r.monto,
    r.metodo,
        CASE
            WHEN r.metodo = 'efectivo'::text THEN 'efectivo_fisico'::text
            ELSE 'banco'::text
        END AS medio,
    r.deposit_id,
    r.created_at AS registrado_en,
    r.cierre_id,
    r.requiere_conciliacion
   FROM caja_ajustes_posteriores r
  WHERE r.business_id = (( SELECT p.business_id
           FROM profiles p
          WHERE p.id = auth.uid())) AND (( SELECT p.role
           FROM profiles p
          WHERE p.id = auth.uid())) IS DISTINCT FROM 'profesional'::text;
revoke all on public.senas_ingresos_por_fecha_bancaria from public, anon;
grant select on public.senas_ingresos_por_fecha_bancaria to authenticated;
notify pgrst, 'reload schema';
commit;
