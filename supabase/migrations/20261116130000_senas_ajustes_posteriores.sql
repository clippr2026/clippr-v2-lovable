-- ============================================================================
-- APLICADO EN PRODUCCIÓN el 16/11/2026 — Señas: ingreso por fecha bancaria,
-- ajustes posteriores al cierre, movimientos fuera de jornada y reversión auditable.
-- ============================================================================
-- Reglas que implementa (paso 1 = solo base de datos):
--   1) Cada seña ya guarda 3 fechas independientes: credited_at (acreditación real),
--      approved_at (aprobación) y appointments.starts_at (turno). Esta migración no las cambia.
--   2) Al aprobarse, el ingreso se registra en la FECHA REAL de acreditación (hora de Buenos Aires),
--      sin importar cuándo se aprobó. Se acabó el "correr a la próxima caja abierta".
--   3) Caja de esa fecha abierta (o con actividad sin cerrar) .......... ingreso normal (cash_movements).
--   4) Caja de esa fecha CERRADA ........................................ "ajuste_posterior" (tabla nueva),
--        enlazado a ese cierre. NO toca caja_cierres ni cash_movements: el cierre original y el
--        efectivo contado quedan intactos.
--   5) Día SIN caja ni actividad (nunca se abrió) ....................... "fuera_de_jornada" (tabla nueva),
--        con la fecha real del ingreso. No crea caja ni cierre ficticio y no se traslada a otro día.
--   Misma lógica para cualquier método de pago (transferencia, efectivo o carga manual):
--        la fecha es la de acreditación (en efectivo/manual = el momento en que se registró).
--   6) Auditoría: usuario que aprobó (id y nombre), aprobada en, monto, método, cliente, servicio,
--        turno, comprobante y fecha bancaria, todo en cada ajuste.
--   7) Sin doble ingreso: un solo registro por seña y ciclo de aprobación (índices únicos). El cobro
--        del servicio sigue descontando la seña (medio de pago "sena", ver register-payment.ts).
--   8) Señas pendientes: no generan ningún registro hasta que se aprueban (como hoy).
--   9) Rechazo: no genera ingreso. Reversión de una aprobación: función reverse_deposit_approval_v1
--        (v2): exige la contraseña de autorización de administrador (la misma de "anular venta"),
--        validada en la base, con intentos fallidos que SÍ se guardan. Solo si la seña sigue "paid":
--        no usada en un cobro, sin decisión y sin parte pagada al profesional.
--        Es una reversión CONTABLE: neutraliza el ingreso original (resta lo mismo en la misma fecha)
--        pero NO mueve dinero: no crea ningún retiro ni gasto. Si hay que devolver plata de verdad,
--        eso es otra operación explícita (reembolso de seña / Retirar dinero). NUNCA borra ni edita
--        el original.
--  10) Vista senas_ingresos_por_fecha_bancaria para reportar por separado: ingreso en caja,
--        ajuste posterior, fuera de jornada y reversiones, por fecha bancaria.
--
-- NO modifica filas existentes. NO toca caja_cierres.
-- Cómo revertirla: archivos supabase/borradores/20261116130000_senas_ajustes_posteriores_ROLLBACK_A.sql (dejar de usarla, sin pérdida de
-- datos) y _ROLLBACK_B.sql (eliminar objetos; se niega a correr si ya hay datos).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A) cash_movements: ciclo de aprobación + evento "reversed"
--    (una seña revertida y vuelta a aprobar necesita un segundo 'received' sin chocar con el índice único)
-- ---------------------------------------------------------------------------
alter table public.cash_movements add column if not exists deposit_ciclo integer not null default 1;
-- Reversión contable: contra-asiento que neutraliza un ingreso de seña; no es plata que salió de la caja.
alter table public.cash_movements add column if not exists contable boolean not null default false;
alter table public.cash_movements add column if not exists revierte_id uuid references public.cash_movements(id);
alter table public.cash_movements add column if not exists motivo text;
alter table public.cash_movements add column if not exists usuario_id uuid;
alter table public.cash_movements add column if not exists registrado_en timestamptz; -- hora real de la operación (created_at queda en la fecha del original)

alter table public.cash_movements drop constraint if exists cash_movements_deposit_event_check;
alter table public.cash_movements
  add constraint cash_movements_deposit_event_check
  check (deposit_event = any (array['received'::text, 'refund'::text, 'prof_share'::text, 'reversed'::text]));

drop index if exists public.cash_movements_deposit_event_uidx;
create unique index if not exists cash_movements_deposit_event_uidx
  on public.cash_movements (deposit_id, deposit_event, deposit_ciclo)
  where deposit_id is not null;

-- ---------------------------------------------------------------------------
-- B) Registro de ajustes posteriores / movimientos fuera de jornada / reversiones (solo agrega, nunca edita)
-- ---------------------------------------------------------------------------
create table if not exists public.caja_ajustes_posteriores (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  branch_id uuid references public.branches(id),
  tipo text not null check (tipo in ('ajuste_posterior', 'fuera_de_jornada', 'reversion')),
  concepto text not null,
  fecha_bancaria date not null,
  cierre_id uuid references public.caja_cierres(id),
  deposit_id uuid not null references public.appointment_deposits(id),
  ciclo integer not null default 1,
  appointment_id uuid,
  monto numeric not null check (monto <> 0),
  metodo text not null check (metodo in ('efectivo', 'cuenta')),
  cliente text,
  servicio text,
  turno_inicio timestamptz,
  comprobante_path text,
  credited_at timestamptz,
  approved_at timestamptz,
  approved_by uuid,
  approved_by_nombre text,
  revierte_id uuid references public.caja_ajustes_posteriores(id),
  revierte_movimiento_id uuid references public.cash_movements(id),
  requiere_conciliacion boolean not null default false,
  motivo text,
  usuario_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid
);

create unique index if not exists caja_ajustes_uno_por_ciclo_uidx
  on public.caja_ajustes_posteriores (deposit_id, ciclo)
  where tipo in ('ajuste_posterior', 'fuera_de_jornada');
create unique index if not exists caja_ajustes_una_reversion_uidx
  on public.caja_ajustes_posteriores (revierte_id)
  where revierte_id is not null;
create unique index if not exists caja_ajustes_una_reversion_mov_uidx
  on public.caja_ajustes_posteriores (revierte_movimiento_id)
  where revierte_movimiento_id is not null;
create unique index if not exists cash_movements_una_reversion_uidx
  on public.cash_movements (revierte_id)
  where revierte_id is not null;
create index if not exists caja_ajustes_business_fecha_idx
  on public.caja_ajustes_posteriores (business_id, fecha_bancaria desc);
create index if not exists caja_ajustes_cierre_idx
  on public.caja_ajustes_posteriores (cierre_id) where cierre_id is not null;

alter table public.caja_ajustes_posteriores enable row level security;
revoke all on public.caja_ajustes_posteriores from anon, authenticated;
grant select on public.caja_ajustes_posteriores to authenticated;
drop policy if exists caja_ajustes_select on public.caja_ajustes_posteriores;
create policy caja_ajustes_select on public.caja_ajustes_posteriores
  for select to authenticated
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  );

-- Registro inalterable: nadie (ni la propia app) puede editar o borrar un ajuste.
create or replace function public._caja_ajustes_inalterable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Los ajustes posteriores no se pueden editar ni borrar (usar una reversión).';
end;
$$;
drop trigger if exists trg_caja_ajustes_inalterable on public.caja_ajustes_posteriores;
create trigger trg_caja_ajustes_inalterable
  before update or delete on public.caja_ajustes_posteriores
  for each row execute function public._caja_ajustes_inalterable();

-- ---------------------------------------------------------------------------
-- C) ¿La caja de ese día está cerrada? Mismo criterio que isCajaCerradaRow (caja-cierre.ts):
--    el ÚLTIMO evento 'cierre'/'reapertura' de `eventos`; sin eventos, cae a `estado`.
-- ---------------------------------------------------------------------------
create or replace function public._caja_dia_cerrado(p_business_id uuid, p_branch_id uuid, p_dia date)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((
    select case
             when ev.tipo is not null then ev.tipo = 'cierre'
             else lower(coalesce(cc.estado, '')) = 'cerrada'
           end
    from public.caja_cierres cc
    left join lateral (
      select e.elem ->> 'tipo' as tipo
      from jsonb_array_elements(
             case when jsonb_typeof(cc.eventos) = 'array' then cc.eventos else '[]'::jsonb end
           ) with ordinality as e(elem, ord)
      where e.elem ->> 'tipo' in ('cierre', 'reapertura')
      order by e.ord desc
      limit 1
    ) ev on true
    where cc.business_id = p_business_id
      and cc.branch_id is not distinct from p_branch_id
      and cc.fecha = p_dia
    limit 1
  ), false);
$$;
revoke all on function public._caja_dia_cerrado(uuid, uuid, date) from public, anon, authenticated;

-- ¿Ese día tuvo actividad de caja? Mismo criterio que datesWithActivity (caja-cierre.ts): cobros no anulados,
-- gastos que no son de "Fondos externos" y señas ya registradas en caja.
create or replace function public._caja_dia_con_actividad(p_business_id uuid, p_branch_id uuid, p_dia date)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    exists (
      select 1 from public.payments p
      where p.business_id = p_business_id
        and (p_branch_id is null or p.branch_id = p_branch_id or p.branch_id is null)
        and p.created_at >= (p_dia::timestamp at time zone 'America/Argentina/Buenos_Aires')
        and p.created_at < ((p_dia + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
        and coalesce(p.status, '') not in ('anulado', 'reembolsado')
    )
    or exists (
      select 1 from public.expenses e
      where e.business_id = p_business_id
        and (p_branch_id is null or e.branch_id = p_branch_id or e.branch_id is null)
        and e.date = p_dia
        and coalesce(e.funds_source, '') <> 'otros'
    )
    or exists (
      select 1 from public.cash_movements m
      where m.business_id = p_business_id
        and (p_branch_id is null or m.branch_id = p_branch_id or m.branch_id is null)
        and m.deposit_id is not null
        and m.extension_pendiente = false
        and m.deposit_event = 'received'
        and m.created_at >= (p_dia::timestamp at time zone 'America/Argentina/Buenos_Aires')
        and m.created_at < ((p_dia + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
    );
$$;
revoke all on function public._caja_dia_con_actividad(uuid, uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- D) Al aprobarse la seña: registrar el ingreso según el estado de la caja de la FECHA REAL de acreditación
--    Todo ocurre dentro de la misma transacción del UPDATE de la seña (atómico) y con índices únicos.
-- ---------------------------------------------------------------------------
create or replace function public._deposit_cash_movements()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_method text := case when new.method = 'cash' then 'efectivo' else 'cuenta' end;
  v_cred timestamptz;
  v_fecha date;
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_ciclo integer;
  v_cierre uuid;
  v_cliente text;
  v_servicio text;
  v_turno timestamptz;
  v_label text;
  v_user text;
  v_tipo text;
begin
  if new.status = 'paid' and new.paid_amount > 0
     and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    select a.client_name, a.service_name, a.starts_at
      into v_cliente, v_servicio, v_turno
    from public.appointments a
    where a.id = new.appointment_id;
    v_label := 'Seña – ' || coalesce(v_cliente, 'cliente') || ' – ' || coalesce(v_servicio, '');

    -- Fecha real en que entró el dinero (nunca en el futuro). Transferencia: la del comprobante;
    -- efectivo / carga manual: el momento en que se registró (ver _deposit_set_dates).
    v_cred := least(coalesce(new.credited_at, now()), now());
    v_fecha := (v_cred at time zone 'America/Argentina/Buenos_Aires')::date;

    -- Ciclo de aprobación: 1 la primera vez; +1 si antes fue revertida y se vuelve a aprobar.
    v_ciclo := 1
      + (select count(*) from public.cash_movements m where m.deposit_id = new.id and m.deposit_event = 'reversed')
      + (select count(*) from public.caja_ajustes_posteriores r where r.deposit_id = new.id and r.tipo = 'reversion');

    select coalesce(nullif(trim(p.full_name), ''), 'Caja') into v_user from public.profiles p where p.id = new.approved_by;

    if public._caja_dia_cerrado(new.business_id, new.branch_id, v_fecha) then
      v_tipo := 'ajuste_posterior';
    elsif v_fecha >= v_hoy or public._caja_dia_con_actividad(new.business_id, new.branch_id, v_fecha) then
      v_tipo := 'normal';
    else
      v_tipo := 'fuera_de_jornada';
    end if;

    if v_tipo = 'normal' then
      insert into public.cash_movements (business_id, branch_id, type, amount, note, created_by, method, deposit_id,
                                         deposit_event, deposit_ciclo, credited_at, created_at, extension_pendiente)
      values (new.business_id, new.branch_id, 'ingreso', new.paid_amount, v_label, 'Sistema · Seña', v_method, new.id,
              'received', v_ciclo, new.credited_at, v_cred, false)
      on conflict (deposit_id, deposit_event, deposit_ciclo) where deposit_id is not null do nothing;
    else
      if v_tipo = 'ajuste_posterior' then
        select c.id into v_cierre from public.caja_cierres c
        where c.business_id = new.business_id and c.branch_id is not distinct from new.branch_id and c.fecha = v_fecha
        limit 1;
      end if;
      -- Efectivo recibido fuera de la caja contada: queda marcado "requiere conciliación" (es plata física que
      -- ningún conteo de caja incluyó). Una transferencia es dinero en banco y no necesita conteo físico.
      insert into public.caja_ajustes_posteriores
        (business_id, branch_id, tipo, concepto, fecha_bancaria, cierre_id, deposit_id, ciclo, appointment_id, monto,
         metodo, cliente, servicio, turno_inicio, comprobante_path, credited_at, approved_at, approved_by,
         approved_by_nombre, usuario_id, requiere_conciliacion, created_by)
      values
        (new.business_id, new.branch_id, v_tipo,
         case v_tipo when 'ajuste_posterior' then 'Ajuste posterior al cierre' else 'Movimiento fuera de jornada' end,
         v_fecha, v_cierre, new.id, v_ciclo, new.appointment_id, new.paid_amount,
         v_method, v_cliente, v_servicio, v_turno, new.proof_path, new.credited_at, new.approved_at, new.approved_by,
         v_user, new.approved_by, (v_method = 'efectivo'), new.approved_by)
      on conflict (deposit_id, ciclo) where tipo in ('ajuste_posterior', 'fuera_de_jornada') do nothing;
    end if;
  end if;

  -- El reembolso no genera un retiro: lo registra decide_deposit_v1 como gasto del día.
  return null;
end;
$$;
revoke all on function public._deposit_cash_movements() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- E) Contraseña de autorización validada en la base, SIN perder los intentos fallidos
--    (la función existente _verify_caja_authorization_password los incrementa y luego lanza una excepción: el
--    rollback deshace el incremento y el bloqueo de 5 intentos nunca se activa; se comprobó en una copia).
--    Esta versión devuelve un texto en vez de lanzar, así la transacción termina bien y los intentos quedan.
-- ---------------------------------------------------------------------------
create or replace function public._caja_autorizacion_check_v1(p_business_id uuid, p_action_type text, p_password text)
returns text
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_row public.caja_authorization_codes;
begin
  select * into v_row from public.caja_authorization_codes
  where business_id = p_business_id and action_type = p_action_type
  for update;
  if not found then
    return 'no_configurada';
  end if;
  if v_row.locked_until is not null and v_row.locked_until > now() then
    return 'bloqueada';
  end if;
  if p_password is null or extensions.crypt(p_password, v_row.password_hash) is distinct from v_row.password_hash then
    update public.caja_authorization_codes
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 5 then now() + make_interval(mins => 15) else locked_until end
     where id = v_row.id;
    return 'incorrecta';
  end if;
  update public.caja_authorization_codes set failed_attempts = 0, locked_until = null where id = v_row.id;
  return 'ok';
end;
$$;
revoke all on function public._caja_autorizacion_check_v1(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- F) Revertir una aprobación: reversión CONTABLE auditable (no mueve dinero, no borra nada)
-- ---------------------------------------------------------------------------
drop function if exists public.reverse_deposit_approval_v1(uuid, text);
create or replace function public.reverse_deposit_approval_v1(p_deposit_id uuid, p_password text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d record;
  v_cm record;
  v_aj record;
  v_prof record;
  v_clave text;
  v_ciclo integer;
  v_user text;
  v_label text;
  v_cierre uuid;
  v_dia_original date;
  v_registro text;
  v_monto numeric;
begin
  select * into d from public.appointment_deposits where id = p_deposit_id for update; -- serializa aprobar/revertir
  if d.id is null then
    return jsonb_build_object('ok', false, 'error', 'Seña no encontrada');
  end if;

  select p.business_id, p.role, coalesce(nullif(trim(p.full_name), ''), 'Usuario') as nombre
    into v_prof from public.profiles p where p.id = auth.uid();
  if auth.uid() is null or v_prof.business_id is distinct from d.business_id or v_prof.role = 'profesional' then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'error', 'Sin permiso');
  end if;
  if coalesce(trim(p_reason), '') = '' or length(trim(p_reason)) > 100 then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'error', 'El motivo es obligatorio (hasta 100 caracteres)');
  end if;

  v_clave := public._caja_autorizacion_check_v1(d.business_id, 'void', p_password);
  if v_clave <> 'ok' then
    return jsonb_build_object('ok', false, 'code', 'auth_' || v_clave,
      'error', case v_clave
        when 'incorrecta' then 'Contraseña de autorización incorrecta'
        when 'bloqueada' then 'Demasiados intentos fallidos. Probá de nuevo en unos minutos.'
        else 'No hay contraseña de autorización configurada (Configuración → Seguridad).' end);
  end if;

  -- Solo una seña aprobada que todavía no se usó: una reversión nunca altera un turno cobrado, una deuda,
  -- una decisión (devolver/retener) ni una liquidación al profesional.
  if d.status <> 'paid' then
    return jsonb_build_object('ok', false, 'code', 'bad_state',
      'error', 'Solo se puede revertir una seña aprobada que todavía no se usó en un cobro ni se decidió');
  end if;
  if d.prof_share_paid_at is not null then
    return jsonb_build_object('ok', false, 'code', 'liquidated', 'error', 'La parte del profesional ya fue pagada');
  end if;
  if exists (
    select 1 from public.payments p
    where p.appointment_id = d.appointment_id and coalesce(p.status, '') not in ('anulado', 'reembolsado')
  ) then
    return jsonb_build_object('ok', false, 'code', 'charged', 'error', 'El turno ya tiene un cobro registrado');
  end if;

  select * into v_cm from public.cash_movements m
  where m.deposit_id = d.id and m.deposit_event = 'received' order by m.deposit_ciclo desc limit 1;
  select * into v_aj from public.caja_ajustes_posteriores r
  where r.deposit_id = d.id and r.tipo in ('ajuste_posterior', 'fuera_de_jornada') order by r.ciclo desc limit 1;
  if v_cm.id is null and v_aj.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_income', 'error', 'La seña no tiene un ingreso registrado');
  end if;

  select 'Reversión contable de seña – ' || coalesce(a.client_name, 'cliente') || ' – ' || coalesce(a.service_name, '')
    into v_label from public.appointments a where a.id = d.appointment_id;
  v_user := v_prof.nombre;

  if v_aj.id is null or coalesce(v_cm.deposit_ciclo, 0) >= v_aj.ciclo then
    v_ciclo := v_cm.deposit_ciclo;
    v_monto := v_cm.amount;
    v_dia_original := (v_cm.created_at at time zone 'America/Argentina/Buenos_Aires')::date;
    if public._caja_dia_cerrado(d.business_id, d.branch_id, v_dia_original) then
      -- Ese día ya cerró: el cierre no se toca; la reversión queda como ajuste posterior, vinculada al movimiento.
      select c.id into v_cierre from public.caja_cierres c
      where c.business_id = d.business_id and c.branch_id is not distinct from d.branch_id and c.fecha = v_dia_original limit 1;
      insert into public.caja_ajustes_posteriores
        (business_id, branch_id, tipo, concepto, fecha_bancaria, cierre_id, deposit_id, ciclo, appointment_id, monto,
         metodo, cliente, servicio, turno_inicio, comprobante_path, credited_at, approved_at, approved_by,
         approved_by_nombre, revierte_movimiento_id, requiere_conciliacion, motivo, usuario_id, created_by)
      select d.business_id, d.branch_id, 'reversion', 'Reversión contable de seña', v_dia_original, v_cierre, d.id, v_ciclo,
             d.appointment_id, -v_cm.amount, v_cm.method, a.client_name, a.service_name, a.starts_at, d.proof_path,
             v_cm.credited_at, d.approved_at, d.approved_by, null, v_cm.id, (v_cm.method = 'efectivo'),
             trim(p_reason), auth.uid(), auth.uid()
      from public.appointments a where a.id = d.appointment_id;
      v_registro := 'ajuste_posterior';
    else
      -- La caja de ese día sigue abierta: contra-asiento en la MISMA fecha y hora del ingreso original, así el
      -- día queda en cero. Es "contable": no representa plata que salió de la caja ni genera ningún gasto.
      insert into public.cash_movements (business_id, branch_id, type, amount, note, created_by, method, deposit_id,
                                         deposit_event, deposit_ciclo, credited_at, created_at, extension_pendiente,
                                         contable, revierte_id, motivo, usuario_id, registrado_en)
      values (d.business_id, d.branch_id, 'retiro', v_cm.amount, v_label || ' – ' || trim(p_reason), v_user, v_cm.method,
              d.id, 'reversed', v_ciclo, v_cm.credited_at, v_cm.created_at, false,
              true, v_cm.id, trim(p_reason), auth.uid(), now());
      v_registro := 'misma_caja';
    end if;
  else
    -- El ingreso original era un ajuste / fuera de jornada: se compensa con otro registro vinculado.
    v_ciclo := v_aj.ciclo;
    v_monto := v_aj.monto;
    insert into public.caja_ajustes_posteriores
      (business_id, branch_id, tipo, concepto, fecha_bancaria, cierre_id, deposit_id, ciclo, appointment_id, monto,
       metodo, cliente, servicio, turno_inicio, comprobante_path, credited_at, approved_at, approved_by,
       approved_by_nombre, revierte_id, requiere_conciliacion, motivo, usuario_id, created_by)
    values
      (v_aj.business_id, v_aj.branch_id, 'reversion', 'Reversión contable de ' || lower(v_aj.concepto), v_aj.fecha_bancaria,
       v_aj.cierre_id, v_aj.deposit_id, v_ciclo, v_aj.appointment_id, -v_aj.monto,
       v_aj.metodo, v_aj.cliente, v_aj.servicio, v_aj.turno_inicio, v_aj.comprobante_path, v_aj.credited_at,
       v_aj.approved_at, v_aj.approved_by, v_aj.approved_by_nombre, v_aj.id, v_aj.requiere_conciliacion,
       trim(p_reason), auth.uid(), auth.uid());
    v_registro := v_aj.tipo;
  end if;

  -- La seña vuelve a "a revisar"; la aprobación anterior queda guardada en events (no se pierde).
  update public.appointment_deposits
  set status = 'review',
      approved_by = null,
      approved_at = null,
      events = events || jsonb_build_object('at', now(), 'action', 'approval_reverted', 'by', auth.uid(),
                                            'by_name', v_user, 'note', trim(p_reason),
                                            'approved_by', d.approved_by, 'approved_at', d.approved_at,
                                            'registro_original', v_registro)
  where id = d.id;

  return jsonb_build_object('ok', true, 'status', 'review', 'monto', v_monto, 'registro_original', v_registro,
                            'devolucion_de_dinero', false);
end;
$$;
revoke all on function public.reverse_deposit_approval_v1(uuid, text, text) from public, anon;
grant execute on function public.reverse_deposit_approval_v1(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- G) Reportes y totales (solo lectura): señas por fecha bancaria, con cada clase por separado
--    Solo para quienes NO son "profesional" y solo de su propio negocio.
-- ---------------------------------------------------------------------------
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
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional';
revoke all on public.senas_ingresos_por_fecha_bancaria from public, anon;
grant select on public.senas_ingresos_por_fecha_bancaria to authenticated;

-- Detalle de un día: cierre ORIGINAL (tal cual quedó) + ajustes + total ajustado. No modifica nada.
--   · dinero en cuenta ajustado = esperado original + ajustes en cuenta.
--   · efectivo contado: SIEMPRE el original. Los ajustes en efectivo se informan aparte ("a conciliar").
create or replace function public.caja_total_ajustado_v1(p_business_id uuid, p_branch_id uuid, p_fecha date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_prof record;
  c record;
  v_items jsonb;
  v_cuenta numeric;
  v_efectivo numeric;
begin
  select p.business_id, p.role into v_prof from public.profiles p where p.id = auth.uid();
  if auth.uid() is null or v_prof.business_id is distinct from p_business_id or v_prof.role = 'profesional' then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'error', 'Sin permiso');
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at), '[]'::jsonb),
         coalesce(sum(r.monto) filter (where r.metodo = 'cuenta'), 0),
         coalesce(sum(r.monto) filter (where r.metodo = 'efectivo'), 0)
    into v_items, v_cuenta, v_efectivo
  from public.caja_ajustes_posteriores r
  where r.business_id = p_business_id and r.branch_id is not distinct from p_branch_id and r.fecha_bancaria = p_fecha;

  select cc.id, cc.total_cobrado, cc.dinero_cuenta_esperado, cc.dinero_cuenta_real, cc.efectivo_contado
    into c
  from public.caja_cierres cc
  where cc.business_id = p_business_id and cc.branch_id is not distinct from p_branch_id and cc.fecha = p_fecha
  limit 1;

  return jsonb_build_object(
    'ok', true, 'fecha', p_fecha,
    'cierre_original', case when c.id is null then null else jsonb_build_object(
        'cierre_id', c.id, 'total_cobrado', c.total_cobrado, 'dinero_cuenta_esperado', c.dinero_cuenta_esperado,
        'dinero_cuenta_real', c.dinero_cuenta_real, 'efectivo_contado', c.efectivo_contado) end,
    'ajustes_posteriores', jsonb_build_object('items', v_items, 'total_cuenta', v_cuenta, 'total_efectivo', v_efectivo),
    'total_ajustado', jsonb_build_object(
        'dinero_cuenta_esperado', case when c.id is null then v_cuenta else coalesce(c.dinero_cuenta_esperado, 0) + v_cuenta end,
        'efectivo_contado', c.efectivo_contado,                -- nunca cambia
        'efectivo_fisico_a_conciliar', v_efectivo));
end;
$$;
revoke all on function public.caja_total_ajustado_v1(uuid, uuid, date) from public, anon;
grant execute on function public.caja_total_ajustado_v1(uuid, uuid, date) to authenticated;

-- Conciliación por fecha bancaria (rango): cada clase por separado y el total recibido por banco / efectivo físico.
create or replace function public.senas_conciliacion_bancaria_v1(p_business_id uuid, p_branch_id uuid, p_desde date, p_hasta date)
returns table (fecha_bancaria date, clase text, medio text, total numeric, cantidad bigint)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_prof record;
begin
  select p.business_id, p.role into v_prof from public.profiles p where p.id = auth.uid();
  if auth.uid() is null or v_prof.business_id is distinct from p_business_id or v_prof.role = 'profesional' then
    raise exception 'Sin permiso';
  end if;
  return query
    select v.fecha_bancaria, v.clase, v.medio, sum(v.monto), count(*)
    from public.senas_ingresos_por_fecha_bancaria v
    where v.business_id = p_business_id
      and (p_branch_id is null or v.branch_id is not distinct from p_branch_id)
      and v.fecha_bancaria between p_desde and p_hasta
    group by v.fecha_bancaria, v.clase, v.medio
    order by v.fecha_bancaria, v.clase, v.medio;
end;
$$;
revoke all on function public.senas_conciliacion_bancaria_v1(uuid, uuid, date, date) from public, anon;
grant execute on function public.senas_conciliacion_bancaria_v1(uuid, uuid, date, date) to authenticated;

notify pgrst, 'reload schema';
-- El procedimiento de rollback está en el archivo aparte: 20261116130000_senas_ajustes_posteriores_ROLLBACK.sql
