-- ============================================================================
-- APLICADO EN PRODUCCIÓN el 16/11/2026 — Señas: devolución de dinero
-- ============================================================================
-- Devolución = salida REAL de dinero, separada del ingreso de la seña (que no se toca ni se cancela).
--   · Solo con el turno cancelado o "No asistió" (seña en estado "a decidir"). Siempre por el total pagado.
--   · Sin contraseña de administrador. Motivo obligatorio. Queda quién la hizo, cuándo, importe, origen y medio.
--   · Roles: admin_general (y owner), socio, admin_local y recepcionista. El profesional no puede (se valida acá).
--   · Origen "caja" (Caja del día): hay que elegir Efectivo o Dinero en cuenta; sale como gasto de HOY
--     (fecha real de la devolución), nunca de la fecha original de la seña.
--     Si la caja de hoy ya está cerrada, se rechaza (code 'caja_cerrada'): no hay salida retroactiva ni silenciosa.
--   · Origen "otros" (Fondos externos): se registra la devolución sin afectar la caja.
--   · Sin duplicados: fila de la seña bloqueada, estado validado, importe > 0 y un solo gasto por seña (índice único).
-- La contraseña de administrador queda SOLO para revertir una aprobación hecha por error (reverse_deposit_approval_v1).
-- No modifica filas existentes. Rollback: supabase/borradores/20261116150000_senas_devolucion_ROLLBACK.sql
-- ============================================================================

create or replace function public.refund_deposit_v1(
  p_deposit_id uuid,
  p_reason text,
  p_funds_source text,
  p_method text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d record;
  a record;
  v_prof record;
  v_src text := lower(coalesce(nullif(trim(p_funds_source), ''), ''));
  v_medio text := lower(coalesce(nullif(trim(p_method), ''), ''));
  v_motivo text := trim(coalesce(p_reason, ''));
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_monto numeric;
begin
  select * into d from public.appointment_deposits where id = p_deposit_id for update; -- serializa dos devoluciones a la vez
  if d.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'error', 'Seña no encontrada');
  end if;

  select p.business_id, p.role, coalesce(nullif(trim(p.full_name), ''), 'Caja') as nombre
    into v_prof from public.profiles p where p.id = auth.uid();
  if auth.uid() is null
     or v_prof.business_id is distinct from d.business_id
     or not public.user_is_business_member(d.business_id)
     or coalesce(v_prof.role, '') not in ('admin_general', 'owner', 'socio', 'admin_local', 'recepcionista') then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'error', 'No tenés permiso para devolver señas');
  end if;

  if d.status = 'returned' or coalesce(d.refund_amount, 0) > 0
     or exists (select 1 from public.expenses e where e.deposit_id = d.id) then
    return jsonb_build_object('ok', false, 'code', 'already_refunded', 'error', 'Esta seña ya fue devuelta');
  end if;
  if d.status <> 'to_decide' then
    return jsonb_build_object('ok', false, 'code', 'bad_state',
      'error', 'Solo se puede devolver la seña de un turno cancelado o marcado como No asistió');
  end if;
  select ap.status::text as status, ap.client_name, ap.service_name into a
  from public.appointments ap where ap.id = d.appointment_id;
  if coalesce(a.status, '') not in ('cancelled', 'no_show') then
    return jsonb_build_object('ok', false, 'code', 'bad_state',
      'error', 'Solo se puede devolver la seña de un turno cancelado o marcado como No asistió');
  end if;

  if v_motivo = '' then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'error', 'El motivo de la devolución es obligatorio');
  end if;
  if length(v_motivo) > 200 then
    return jsonb_build_object('ok', false, 'code', 'reason_too_long', 'error', 'El motivo no puede superar los 200 caracteres');
  end if;
  if v_src not in ('caja', 'otros') then
    return jsonb_build_object('ok', false, 'code', 'source_required', 'error', 'Elegí de dónde sale el dinero: Caja del día o Fondos externos');
  end if;

  v_monto := coalesce(d.paid_amount, 0);
  if v_monto <= 0 then
    return jsonb_build_object('ok', false, 'code', 'nothing_to_refund', 'error', 'Esta seña no tiene dinero recibido para devolver');
  end if;

  if v_src = 'caja' then
    if v_medio not in ('efectivo', 'cuenta') then
      return jsonb_build_object('ok', false, 'code', 'method_required', 'error', 'Elegí si sale de Efectivo o de Dinero en cuenta');
    end if;
    -- Caja de hoy cerrada: no se toca el cierre ni se registra una salida retroactiva.
    if public._caja_dia_cerrado(d.business_id, d.branch_id, v_hoy) then
      return jsonb_build_object('ok', false, 'code', 'caja_cerrada',
        'error', 'La caja de hoy ya está cerrada. Elegí Fondos externos, o reabrí la caja de hoy para descontarlo de ahí.');
    end if;
  else
    -- Fondos externos: no mueve la caja. El medio es informativo (si no se indica, el de la seña).
    if v_medio not in ('efectivo', 'cuenta') then
      v_medio := case when d.method = 'cash' then 'efectivo' else 'cuenta' end;
    end if;
  end if;

  -- La salida real: un gasto de HOY, separado del ingreso de la seña (que queda intacto).
  insert into public.expenses (business_id, branch_id, name, amount, type, payment_method, funds_source, date, note,
                               user_id, user_name, created_by, deposit_id)
  values (d.business_id, d.branch_id, 'Reembolso de seña', v_monto, 'ocasional',
          case when v_medio = 'efectivo' then 'efectivo' else 'transferencia' end,
          v_src, v_hoy,
          coalesce(a.client_name, 'cliente') || ' – ' || coalesce(a.service_name, '') || ' – ' || v_motivo,
          auth.uid(), v_prof.nombre, v_prof.nombre, d.id);

  update public.appointment_deposits
  set status = 'returned',
      refund_amount = v_monto,
      decided_by = auth.uid(), decided_at = now(), decision_note = v_motivo,
      events = events || jsonb_build_object('at', now(), 'action', 'refunded', 'by', auth.uid(), 'by_name', v_prof.nombre,
                                            'note', v_motivo, 'amount', v_monto, 'funds_source', v_src, 'method', v_medio)
  where id = d.id;

  return jsonb_build_object('ok', true, 'status', 'returned', 'refund_amount', v_monto, 'funds_source', v_src,
                            'method', v_medio, 'fecha', v_hoy);
end;
$$;
revoke all on function public.refund_deposit_v1(uuid, text, text, text) from public, anon;
grant execute on function public.refund_deposit_v1(uuid, text, text, text) to authenticated;

-- decide_deposit_v1: "retener" queda igual; "reembolsar" pasa por refund_deposit_v1 (mismas validaciones en todos lados).
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
    -- La devolución tiene una sola puerta: refund_deposit_v1 (motivo, rol, origen, medio y caja cerrada).
    -- Una app sin actualizar (no manda el medio) usa el de la seña, como hasta ahora.
    return public.refund_deposit_v1(d.id, p_note, v_src,
                                    case when v_src = 'caja' then case when d.method = 'cash' then 'efectivo' else 'cuenta' end end);
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

-- Reportes: las devoluciones aparecen como una clase aparte (fecha = día real de la devolución).
create or replace view public.senas_ingresos_por_fecha_bancaria
with (security_invoker = true) as
  select m.business_id,
         m.branch_id,
         (coalesce(m.credited_at, m.created_at) at time zone 'America/Argentina/Buenos_Aires')::date as fecha_bancaria,
         case when m.deposit_event = 'reversed' then 'reversion' else 'ingreso_en_caja' end as clase,
         case when m.type = 'ingreso' then m.amount else -m.amount end as monto,
         m.method as metodo,
         case when m.method = 'efectivo' then 'efectivo_fisico' else 'banco' end as medio,
         m.deposit_id,
         coalesce(m.registrado_en, m.created_at) as registrado_en,
         null::uuid as cierre_id,
         false as requiere_conciliacion
  from public.cash_movements m
  where m.deposit_id is not null and m.deposit_event in ('received', 'reversed')
    and m.business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  union all
  select r.business_id,
         r.branch_id,
         r.fecha_bancaria,
         r.tipo as clase,
         r.monto,
         r.metodo,
         case when r.metodo = 'efectivo' then 'efectivo_fisico' else 'banco' end as medio,
         r.deposit_id,
         r.created_at as registrado_en,
         r.cierre_id,
         r.requiere_conciliacion
  from public.caja_ajustes_posteriores r
  where r.business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  union all
  select e.business_id,
         e.branch_id,
         e.date as fecha_bancaria,
         'devolucion' as clase,
         -e.amount as monto,
         case when lower(coalesce(e.payment_method, '')) = 'efectivo' then 'efectivo' else 'cuenta' end as metodo,
         case when e.funds_source = 'otros' then 'fondos_externos'
              when lower(coalesce(e.payment_method, '')) = 'efectivo' then 'efectivo_fisico'
              else 'banco' end as medio,
         e.deposit_id,
         e.created_at as registrado_en,
         null::uuid as cierre_id,
         false as requiere_conciliacion
  from public.expenses e
  where e.deposit_id is not null
    and e.business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional';
revoke all on public.senas_ingresos_por_fecha_bancaria from public, anon;
grant select on public.senas_ingresos_por_fecha_bancaria to authenticated;

notify pgrst, 'reload schema';
