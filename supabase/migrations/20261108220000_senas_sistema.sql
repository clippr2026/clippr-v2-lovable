-- Sistema de señas (etapa 1: base de datos).
--
-- Una seña por turno (appointment_deposits) con su estado, comprobante, método,
-- decisión final (retener / devolver) y reparto de la seña retenida entre el
-- local y el profesional. NO escribe en caja ni en comisiones (etapa 3): solo
-- deja registrados los montos que después se reflejarán allí.
--
-- La configuración sigue en business_settings.senas_config (JSON), con estos
-- campos (todos opcionales; sin definir = comportamiento de siempre):
--   enabled            boolean
--   scope              'all' | 'selected'   (selected usa "services")
--   services           uuid[]               servicios que piden seña
--   trigger            'always' | 'conditional'
--   first_time         boolean              (conditional) cliente que viene por primera vez
--   no_show_min        integer              (conditional) cantidad de faltas que activa la seña
--   amount_type        'percent' | 'fixed' | 'full'
--   amount_value       number
--   proof_mode         'review' | 'auto'    review = el local aprueba el comprobante
--   hold_minutes       integer              tiempo para pagar antes de liberar el turno
--   lost_dist          'local' | 'professional' | 'split' | 'custom'
--   lost_prof, lost_local  number (0-100)   usados con 'custom'
--   (más los datos de pago: alias, cbu, titular, mercadopago… los lee la página pública)
--
-- Solo agrega objetos nuevos; no modifica datos ni funciones existentes.

-- 1) Tabla de señas.
create table if not exists public.appointment_deposits (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  branch_id uuid,
  appointment_id uuid not null unique references public.appointments(id) on delete cascade,
  -- pending: esperando pago · review: comprobante enviado, a revisar · paid: seña recibida
  -- applied: descontada del cobro final · to_decide: turno cancelado/no asistió, falta decidir
  -- returned: devuelta · retained: retenida · rejected: comprobante rechazado · expired: no pagó a tiempo
  status text not null default 'pending'
    check (status in ('pending','review','paid','applied','to_decide','returned','retained','rejected','expired')),
  amount numeric not null check (amount >= 0),
  paid_amount numeric not null default 0 check (paid_amount >= 0),
  method text check (method in ('transfer','mercadopago','cash','other')),
  proof_path text,
  proof_reference text,
  proof_uploaded_at timestamptz,
  expires_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  -- Sugerencia al cancelar / no asistir: 'refund' si canceló dentro del plazo, 'retain' si no.
  suggested_action text check (suggested_action in ('refund','retain')),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  refund_amount numeric not null default 0,
  retained_prof_amount numeric not null default 0,
  retained_local_amount numeric not null default 0,
  applied_at timestamptz,
  events jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists appointment_deposits_business_status_idx
  on public.appointment_deposits (business_id, status);

alter table public.appointment_deposits enable row level security;
revoke all on public.appointment_deposits from anon, authenticated;
grant select on public.appointment_deposits to authenticated;

drop policy if exists appointment_deposits_select on public.appointment_deposits;
create policy appointment_deposits_select on public.appointment_deposits
  for select to authenticated
  using (auth.uid() is not null and public.user_is_business_member(business_id));

-- 2) updated_at + resumen en appointments (deposit_amount / deposit_paid / deposit_status)
--    para que la Agenda actual siga mostrando la seña sin cambios.
create or replace function public._deposit_sync_appointment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  new.updated_at := now();
  return new;
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
        else 'none'
      end
  where id = new.appointment_id;
  return null;
end;
$$;

drop trigger if exists trg_deposit_updated_at on public.appointment_deposits;
create trigger trg_deposit_updated_at
  before insert or update on public.appointment_deposits
  for each row execute function public._deposit_sync_appointment();

drop trigger if exists trg_deposit_after_write on public.appointment_deposits;
create trigger trg_deposit_after_write
  after insert or update of status, amount, paid_amount on public.appointment_deposits
  for each row execute function public._deposit_after_write();

-- 3) Cambios de estado del turno → estado de la seña.
create or replace function public._deposit_on_appointment_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d record;
  v_limits jsonb;
  v_suggest text;
begin
  if new.status is not distinct from old.status then
    return null;
  end if;

  select * into d from public.appointment_deposits where appointment_id = new.id;
  if d.id is null then
    return null;
  end if;

  if new.status in ('cancelled', 'no_show') then
    if d.status = 'paid' then
      if new.status = 'no_show' then
        v_suggest := 'retain';
      else
        v_limits := public._booking_limits(new.business_id, new.branch_id);
        v_suggest := case
          when coalesce(new.cancelled_at, now()) <= new.starts_at - make_interval(mins => round((v_limits ->> 'minCancel')::numeric * 60)::int)
            then 'refund' else 'retain' end;
      end if;
      update public.appointment_deposits
      set status = 'to_decide',
          suggested_action = v_suggest,
          events = events || jsonb_build_object('at', now(), 'action', 'to_decide', 'by', 'system', 'note', new.status)
      where id = d.id;
    elsif d.status = 'pending' then
      update public.appointment_deposits
      set status = 'expired',
          events = events || jsonb_build_object('at', now(), 'action', 'expired', 'by', 'system', 'note', new.status)
      where id = d.id;
    end if;
  elsif new.status in ('done', 'completed', 'charged') then
    if d.status = 'paid' then
      update public.appointment_deposits
      set status = 'applied',
          applied_at = now(),
          events = events || jsonb_build_object('at', now(), 'action', 'applied', 'by', 'system')
      where id = d.id;
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_deposit_on_appointment_status on public.appointments;
create trigger trg_deposit_on_appointment_status
  after update of status on public.appointments
  for each row execute function public._deposit_on_appointment_status();

-- 4) Configuración y regla: ¿este turno/cliente debe pagar seña?
create or replace function public._senas_config(p_business_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((select senas_config::jsonb from public.business_settings where business_id = p_business_id), '{}'::jsonb);
$$;

create or replace function public._deposit_requirement(
  p_business_id uuid,
  p_service_ids uuid[],
  p_total numeric,
  p_client_phone text,
  p_client_email text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  c jsonb := public._senas_config(p_business_id);
  v_scope text := coalesce(c ->> 'scope', 'selected');
  v_in_scope boolean := false;
  v_trigger text := coalesce(c ->> 'trigger', 'always');
  v_phone text := regexp_replace(coalesce(p_client_phone, ''), '\D', '', 'g');
  v_email text := nullif(lower(trim(coalesce(p_client_email, ''))), '');
  v_client_ids uuid[];
  v_served int := 0;
  v_noshows int := 0;
  v_reasons text[] := '{}';
  v_required boolean := false;
  v_amount numeric := 0;
  v_type text := coalesce(c ->> 'amount_type', 'percent');
  v_value numeric := coalesce(nullif(c ->> 'amount_value', '')::numeric, 0);
  v_min_ns int := coalesce(nullif(c ->> 'no_show_min', '')::int, 0);
begin
  if not coalesce((c ->> 'enabled')::boolean, false) then
    return jsonb_build_object('required', false, 'reasons', '[]'::jsonb);
  end if;

  if v_scope = 'all' then
    v_in_scope := true;
  else
    v_in_scope := exists (
      select 1 from jsonb_array_elements_text(coalesce(c -> 'services', '[]'::jsonb)) s
      where s.value::uuid = any(coalesce(p_service_ids, '{}'))
    );
  end if;

  if not v_in_scope then
    return jsonb_build_object('required', false, 'reasons', '[]'::jsonb);
  end if;

  if v_trigger = 'always' then
    v_required := true;
    v_reasons := array['siempre'];
  else
    select coalesce(array_agg(cl.id), '{}') into v_client_ids
    from public.clients cl
    where cl.business_id = p_business_id
      and ( (v_email is not null and lower(coalesce(cl.email, '')) = v_email)
         or (v_phone <> '' and regexp_replace(coalesce(cl.phone, ''), '\D', '', 'g') = v_phone) );

    select count(*) filter (where a.status in ('done','completed','charged')),
           count(*) filter (where a.status = 'no_show')
      into v_served, v_noshows
    from public.appointments a
    where a.client_id = any(v_client_ids);

    if coalesce((c ->> 'first_time')::boolean, false) and v_served = 0 then
      v_required := true;
      v_reasons := array_append(v_reasons, 'primera_vez');
    end if;
    if v_min_ns > 0 and v_noshows >= v_min_ns then
      v_required := true;
      v_reasons := array_append(v_reasons, 'faltas');
    end if;
  end if;

  if not v_required then
    return jsonb_build_object('required', false, 'reasons', '[]'::jsonb);
  end if;

  v_amount := case v_type
    when 'full' then coalesce(p_total, 0)
    when 'fixed' then least(v_value, coalesce(p_total, 0))
    else round(coalesce(p_total, 0) * least(v_value, 100) / 100)
  end;

  return jsonb_build_object('required', v_amount > 0, 'amount', v_amount, 'reasons', to_jsonb(v_reasons));
end;
$$;

-- Instrucciones de pago que ve el cliente (solo lo necesario).
create or replace function public._deposit_instructions(p_business_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'proof_mode', coalesce(c ->> 'proof_mode', 'review'),
    'hold_minutes', coalesce(nullif(c ->> 'hold_minutes', '')::int, 120),
    'message', c ->> 'message',
    'payment', coalesce(c -> 'payment', '{}'::jsonb)
  )
  from (select public._senas_config(p_business_id) as c) q;
$$;

-- 5) Cliente: crear la seña de su turno (si corresponde) y ver cómo pagar.
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
  select ap.id, ap.business_id, ap.branch_id, ap.client_id, ap.service_name, ap.service_price, ap.status::text as status
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

  if a.status not in ('pending', 'confirmed') then
    return jsonb_build_object('ok', true, 'required', false);
  end if;

  select phone, email into cl from public.clients where id = a.client_id;

  select coalesce(array_agg(p.id), '{}') into v_ids
  from public.price_catalog p
  where p.business_id = a.business_id
    and p.name = any(string_to_array(a.service_name, ' + '));

  -- El turno recién creado no cuenta como "ya atendido" ni como falta.
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

-- 6) Cliente: avisar que pagó (comprobante).
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
  if d.status not in ('pending', 'rejected', 'review') then
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

-- 7) Local: aprobar / rechazar el comprobante.
create or replace function public.review_deposit_v1(
  p_deposit_id uuid,
  p_approve boolean,
  p_amount numeric default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d record;
begin
  select * into d from public.appointment_deposits where id = p_deposit_id for update;
  if d.id is null then
    return jsonb_build_object('ok', false, 'error', 'Seña no encontrada');
  end if;
  if auth.uid() is null or not public.user_is_business_member(d.business_id) then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'error', 'Sin permiso');
  end if;
  if d.status not in ('review', 'pending') then
    return jsonb_build_object('ok', false, 'code', 'bad_state', 'error', 'La seña no está pendiente de revisión');
  end if;

  if p_approve then
    update public.appointment_deposits
    set status = 'paid',
        paid_amount = coalesce(p_amount, amount),
        approved_by = auth.uid(), approved_at = now(),
        events = events || jsonb_build_object('at', now(), 'action', 'approved', 'by', auth.uid(), 'note', p_note)
    where id = d.id;
    return jsonb_build_object('ok', true, 'status', 'paid');
  end if;

  update public.appointment_deposits
  set status = 'rejected', decision_note = p_note,
      events = events || jsonb_build_object('at', now(), 'action', 'rejected', 'by', auth.uid(), 'note', p_note)
  where id = d.id;
  return jsonb_build_object('ok', true, 'status', 'rejected');
end;
$$;

-- 8) Local: registrar una seña recibida directamente (Agenda / efectivo).
create or replace function public.record_deposit_received_v1(
  p_appointment_id uuid,
  p_amount numeric,
  p_method text default 'cash',
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  a record;
  v_method text := case when p_method in ('transfer','mercadopago','cash') then p_method else 'other' end;
  v_id uuid;
begin
  select id, business_id, branch_id, status::text as status into a from public.appointments where id = p_appointment_id;
  if a.id is null then
    return jsonb_build_object('ok', false, 'error', 'Turno no encontrado');
  end if;
  if auth.uid() is null or not public.user_is_business_member(a.business_id) then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'error', 'Sin permiso');
  end if;
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'El monto debe ser mayor a 0');
  end if;
  if a.status not in ('pending', 'confirmed') then
    return jsonb_build_object('ok', false, 'code', 'bad_state', 'error', 'El turno no admite seña');
  end if;

  insert into public.appointment_deposits (business_id, branch_id, appointment_id, status, amount, paid_amount, method,
                                           approved_by, approved_at, events)
  values (a.business_id, a.branch_id, a.id, 'paid', p_amount, p_amount, v_method, auth.uid(), now(),
          jsonb_build_array(jsonb_build_object('at', now(), 'action', 'received', 'by', auth.uid(), 'note', p_note)))
  on conflict (appointment_id) do update
    set status = 'paid', amount = excluded.amount, paid_amount = excluded.paid_amount, method = excluded.method,
        approved_by = auth.uid(), approved_at = now(),
        events = public.appointment_deposits.events || jsonb_build_object('at', now(), 'action', 'received', 'by', auth.uid(), 'note', p_note)
    where public.appointment_deposits.status in ('pending', 'review', 'rejected', 'expired')
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false, 'code', 'bad_state', 'error', 'La seña ya fue registrada');
  end if;
  return jsonb_build_object('ok', true, 'deposit_id', v_id, 'status', 'paid');
end;
$$;

-- 9) Local: decidir qué pasa con la seña de un turno cancelado / que no asistió.
create or replace function public.decide_deposit_v1(
  p_deposit_id uuid,
  p_action text,
  p_prof_pct numeric default null,
  p_local_pct numeric default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d record;
  c jsonb;
  v_dist text;
  v_prof numeric;
  v_local numeric;
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

  if p_action = 'refund' then
    update public.appointment_deposits
    set status = 'returned', refund_amount = paid_amount,
        decided_by = auth.uid(), decided_at = now(), decision_note = p_note,
        events = events || jsonb_build_object('at', now(), 'action', 'refunded', 'by', auth.uid(), 'note', p_note)
    where id = d.id;
    return jsonb_build_object('ok', true, 'status', 'returned', 'refund_amount', d.paid_amount);
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
$$;

-- 10) Permisos.
revoke all on function public._deposit_sync_appointment() from public, anon, authenticated;
revoke all on function public._deposit_after_write() from public, anon, authenticated;
revoke all on function public._deposit_on_appointment_status() from public, anon, authenticated;
revoke all on function public._senas_config(uuid) from public, anon, authenticated;
revoke all on function public._deposit_requirement(uuid, uuid[], numeric, text, text) from public, anon, authenticated;
revoke all on function public._deposit_instructions(uuid) from public, anon, authenticated;
revoke all on function public.ensure_public_deposit_v1(uuid) from public;
revoke all on function public.submit_deposit_proof_public_v1(uuid, text, text, text) from public;
revoke all on function public.review_deposit_v1(uuid, boolean, numeric, text) from public;
revoke all on function public.record_deposit_received_v1(uuid, numeric, text, text) from public;
revoke all on function public.decide_deposit_v1(uuid, text, numeric, numeric, text) from public;

grant execute on function public.ensure_public_deposit_v1(uuid) to anon, authenticated;
grant execute on function public.submit_deposit_proof_public_v1(uuid, text, text, text) to anon, authenticated;
grant execute on function public.review_deposit_v1(uuid, boolean, numeric, text) to authenticated;
grant execute on function public.record_deposit_received_v1(uuid, numeric, text, text) to authenticated;
grant execute on function public.decide_deposit_v1(uuid, text, numeric, numeric, text) to authenticated;
