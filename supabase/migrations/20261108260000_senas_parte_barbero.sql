-- Señas: pago de la parte del barbero de una seña retenida.
--
-- La liquidación de profesionales está atada a ventas (cada comisión/crédito cuelga de un
-- cobro), y una seña retenida no tiene venta. Por eso la parte del barbero se paga directo:
-- un retiro de caja por el mismo medio (efectivo o cuenta) y queda registrado en la seña
-- (quién, cuándo, por qué medio). Una sola vez por seña.

alter table public.appointment_deposits
  add column if not exists prof_share_paid_at timestamptz,
  add column if not exists prof_share_paid_by uuid,
  add column if not exists prof_share_method text check (prof_share_method in ('cash', 'transfer'));

alter table public.cash_movements drop constraint if exists cash_movements_deposit_event_check;
alter table public.cash_movements
  add constraint cash_movements_deposit_event_check
  check (deposit_event in ('received', 'refund', 'prof_share'));

create or replace function public.pay_deposit_prof_share_v1(p_deposit_id uuid, p_method text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d record;
  v_label text;
  v_emp text;
  v_method text := case when p_method = 'cash' then 'efectivo' else 'cuenta' end;
begin
  select * into d from public.appointment_deposits where id = p_deposit_id for update;
  if d.id is null then
    return jsonb_build_object('ok', false, 'error', 'Seña no encontrada');
  end if;
  if auth.uid() is null or not public.user_is_business_member(d.business_id) then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'error', 'Sin permiso');
  end if;
  if d.status <> 'retained' or d.retained_prof_amount <= 0 then
    return jsonb_build_object('ok', false, 'code', 'bad_state', 'error', 'Esta seña no tiene una parte para el barbero');
  end if;
  if d.prof_share_paid_at is not null then
    return jsonb_build_object('ok', false, 'code', 'already_paid', 'error', 'La parte del barbero ya fue pagada');
  end if;
  if p_method not in ('cash', 'transfer') then
    return jsonb_build_object('ok', false, 'error', 'Elegí efectivo o transferencia');
  end if;

  select 'Seña – ' || coalesce(a.client_name, 'cliente') || ' – ' || coalesce(a.service_name, ''), e.full_name
    into v_label, v_emp
  from public.appointments a
  left join public.employees e on e.id = a.employee_id
  where a.id = d.appointment_id;

  insert into public.cash_movements (business_id, branch_id, type, amount, note, created_by, method, deposit_id, deposit_event)
  values (d.business_id, d.branch_id, 'retiro', d.retained_prof_amount,
          'Parte del barbero (' || coalesce(v_emp, 'profesional') || ') de ' || v_label,
          'Sistema · Seña', v_method, d.id, 'prof_share');

  update public.appointment_deposits
  set prof_share_paid_at = now(), prof_share_paid_by = auth.uid(), prof_share_method = p_method,
      events = events || jsonb_build_object('at', now(), 'action', 'prof_share_paid', 'by', auth.uid(),
                                            'amount', d.retained_prof_amount, 'method', p_method)
  where id = d.id;

  return jsonb_build_object('ok', true, 'amount', d.retained_prof_amount, 'method', p_method);
end;
$$;

revoke all on function public.pay_deposit_prof_share_v1(uuid, text) from public;
grant execute on function public.pay_deposit_prof_share_v1(uuid, text) to authenticated;
