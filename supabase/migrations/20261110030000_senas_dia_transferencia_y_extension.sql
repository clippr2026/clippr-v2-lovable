-- Señas, nueva forma (pedido del 10/11):
--   1) La seña aprobada entra en la caja del DÍA DE LA TRANSFERENCIA (comprobante), no del día en que se aprueba.
--      Si ese día no tuvo caja, la app lo muestra como "caja pendiente de cierre" (lo resuelve el frontend).
--      Si la caja de ese día YA está cerrada, el movimiento queda marcado "extensión pendiente": el cierre
--      original no se toca y se cierra aparte con close_caja_extension_v1 (tabla caja_cierre_extensiones).
--      Seña en efectivo / cargada a mano: entra en el momento, como hasta ahora.
--   2) El reembolso deja de ser un retiro de caja: es un GASTO del día ("Reembolso de seña") con origen
--      Caja o Fondos externos, creado por decide_deposit_v1 en la misma operación.
-- No modifica ni borra ninguna fila existente: agrega columnas, una tabla y reemplaza dos funciones.
--
-- Cómo revertirlo: volver a crear _deposit_cash_movements y decide_deposit_v1 (5 parámetros) desde
-- 20261109080000_senas_fechas_acreditacion.sql y 20261108220000_senas_sistema.sql; las columnas y la tabla
-- nuevas pueden quedar (sin la app nueva no se usan).

create table if not exists public.caja_cierre_extensiones (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  branch_id uuid references public.branches(id),
  fecha date not null,
  cierre_id uuid references public.caja_cierres(id),
  total_banco numeric not null default 0,
  total_efectivo numeric not null default 0,
  detalle jsonb not null default '[]'::jsonb,
  closed_by text,
  closed_by_user uuid,
  closed_at timestamptz not null default now()
);
create index if not exists caja_cierre_extensiones_business_fecha_idx
  on public.caja_cierre_extensiones (business_id, fecha desc);

alter table public.caja_cierre_extensiones enable row level security;
drop policy if exists caja_cierre_extensiones_member_select on public.caja_cierre_extensiones;
create policy caja_cierre_extensiones_member_select on public.caja_cierre_extensiones
  for select to authenticated using (public.user_is_business_member(business_id));
revoke all on public.caja_cierre_extensiones from anon, authenticated;
grant select on public.caja_cierre_extensiones to authenticated;

alter table public.cash_movements
  add column if not exists extension_pendiente boolean not null default false,
  add column if not exists cierre_extension_id uuid references public.caja_cierre_extensiones(id);

alter table public.expenses add column if not exists deposit_id uuid references public.appointment_deposits(id) on delete set null;
create unique index if not exists expenses_deposit_uidx on public.expenses (deposit_id) where deposit_id is not null;

create or replace function public._deposit_cash_movements()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_method text := case when new.method = 'cash' then 'efectivo' else 'cuenta' end;
  v_label text;
  v_created timestamptz;
  v_cerrada boolean;
begin
  if new.status = 'paid' and new.paid_amount > 0
     and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    select 'Seña – ' || coalesce(a.client_name, 'cliente') || ' – ' || coalesce(a.service_name, '')
      into v_label
    from public.appointments a
    where a.id = new.appointment_id;

    -- Transferencia: el ingreso es del día en que se transfirió. Efectivo / a mano: del momento.
    v_created := case
      when v_method = 'cuenta' and new.credited_at is not null and new.credited_at < now() then new.credited_at
      else now()
    end;
    -- Caja de ese día ya cerrada: no se toca el cierre, queda como extensión pendiente.
    select exists (
      select 1 from public.caja_cierres c
      where c.business_id = new.business_id
        and c.branch_id is not distinct from new.branch_id
        and c.fecha = (v_created at time zone 'America/Argentina/Buenos_Aires')::date
        and c.estado = 'cerrada'
    ) into v_cerrada;

    insert into public.cash_movements (business_id, branch_id, type, amount, note, created_by, method, deposit_id,
                                       deposit_event, credited_at, created_at, extension_pendiente)
    values (new.business_id, new.branch_id, 'ingreso', new.paid_amount, v_label, 'Sistema · Seña', v_method, new.id,
            'received', new.credited_at, v_created, v_cerrada)
    on conflict (deposit_id, deposit_event) where deposit_id is not null do nothing;
  end if;

  -- El reembolso ya no genera un retiro: lo registra decide_deposit_v1 como gasto del día.
  return null;
end;
$$;
revoke all on function public._deposit_cash_movements() from public, anon, authenticated;

drop function if exists public.decide_deposit_v1(uuid, text, numeric, numeric, text);
create or replace function public.decide_deposit_v1(
  p_deposit_id uuid,
  p_action text,
  p_prof_pct numeric default null,
  p_local_pct numeric default null,
  p_note text default null,
  p_funds_source text default 'caja'
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
$$;
revoke all on function public.decide_deposit_v1(uuid, text, numeric, numeric, text, text) from public, anon;
grant execute on function public.decide_deposit_v1(uuid, text, numeric, numeric, text, text) to authenticated;

-- Cerrar la extensión de un día ya cerrado: junta las señas pendientes de ese día en un registro aparte.
create or replace function public.close_caja_extension_v1(p_business_id uuid, p_branch_id uuid, p_fecha date)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ext uuid;
  v_cierre uuid;
  v_user text;
  v_banco numeric;
  v_efectivo numeric;
  v_detalle jsonb;
  v_n int;
begin
  if auth.uid() is null or not public.user_is_business_member(p_business_id) then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'error', 'Sin permiso');
  end if;

  perform 1 from public.cash_movements m
  where m.business_id = p_business_id and m.branch_id is not distinct from p_branch_id
    and m.extension_pendiente and m.cierre_extension_id is null and m.deposit_id is not null
    and (m.created_at at time zone 'America/Argentina/Buenos_Aires')::date = p_fecha
  for update;

  select count(*),
         coalesce(sum(m.amount) filter (where m.method = 'cuenta'), 0),
         coalesce(sum(m.amount) filter (where m.method = 'efectivo'), 0),
         coalesce(jsonb_agg(jsonb_build_object('movimiento_id', m.id, 'deposit_id', m.deposit_id, 'monto', m.amount,
                                               'metodo', m.method, 'nota', m.note, 'acreditada_en', m.credited_at)
                            order by m.created_at), '[]'::jsonb)
    into v_n, v_banco, v_efectivo, v_detalle
  from public.cash_movements m
  where m.business_id = p_business_id and m.branch_id is not distinct from p_branch_id
    and m.extension_pendiente and m.cierre_extension_id is null and m.deposit_id is not null
    and (m.created_at at time zone 'America/Argentina/Buenos_Aires')::date = p_fecha;

  if v_n = 0 then
    return jsonb_build_object('ok', false, 'code', 'empty', 'error', 'No hay señas pendientes de cierre para ese día');
  end if;

  select c.id into v_cierre from public.caja_cierres c
  where c.business_id = p_business_id and c.branch_id is not distinct from p_branch_id and c.fecha = p_fecha;
  select coalesce(nullif(trim(p.full_name), ''), 'Caja') into v_user from public.profiles p where p.id = auth.uid();

  insert into public.caja_cierre_extensiones (business_id, branch_id, fecha, cierre_id, total_banco, total_efectivo,
                                              detalle, closed_by, closed_by_user)
  values (p_business_id, p_branch_id, p_fecha, v_cierre, v_banco, v_efectivo, v_detalle, coalesce(v_user, 'Caja'), auth.uid())
  returning id into v_ext;

  update public.cash_movements m
  set cierre_extension_id = v_ext
  where m.business_id = p_business_id and m.branch_id is not distinct from p_branch_id
    and m.extension_pendiente and m.cierre_extension_id is null and m.deposit_id is not null
    and (m.created_at at time zone 'America/Argentina/Buenos_Aires')::date = p_fecha;

  return jsonb_build_object('ok', true, 'extension_id', v_ext, 'cantidad', v_n, 'total_banco', v_banco, 'total_efectivo', v_efectivo);
end;
$$;
revoke all on function public.close_caja_extension_v1(uuid, uuid, date) from public, anon;
grant execute on function public.close_caja_extension_v1(uuid, uuid, date) to authenticated;

notify pgrst, 'reload schema';
