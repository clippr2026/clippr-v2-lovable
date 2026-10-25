-- ============================================================================
-- Eliminar cobro — delete_payment_authorized
-- ============================================================================
-- "Eliminar cobro" (deletePayment, register-payment.ts) quedó afuera del
-- alcance original de las contraseñas de autorización (20261025010000 en
-- adelante) — en la práctica, borrar un cobro es la acción MÁS destructiva
-- de todas (borrado físico, se lleva puestas comisión/propina por cascade,
-- sin ningún registro posterior) y quedó dejándose hacer sin pedir nada.
-- Corrige eso: reutiliza la MISMA contraseña de "void" (no se pide una
-- tercera contraseña nueva — borrar es, si acaso, una anulación más
-- fuerte, no una categoría distinta) y replica exactamente el guard de
-- liquidación que ya tenía deletePayment client-side, ahora server-side.
--
-- Nota: esto protege el camino pensado (el botón de la UI) pero la tabla
-- payments sigue permitiendo delete directo por RLS para cualquier
-- miembro autenticado del negocio, igual que antes de este archivo —
-- cerrar ESE otro camino requiere revisar esa policy aparte (afecta
-- cualquier otro lugar que borre payments directo), fuera de este alcance.
--
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase (primero en
-- desarrollo, después en producción) y ejecutar. Requiere que
-- 20261025010000/20261025020000 ya hayan corrido. Idempotente.
-- ============================================================================
begin;

-- payment_authorization_log.payment_id se creó (20261025010000) con
-- "on delete cascade" — correcto para corrección/anulación (el payment
-- nunca se borra ahí), pero fatal para ESTA acción: borrar el payment
-- se llevaría puesto, en cascada, el log que recién se escribió para
-- auditar ese mismo borrado. Pasa a "on delete set null" — el registro
-- sobrevive al borrado (before_snapshot ya tiene todo lo necesario),
-- solo pierde la referencia viva al payment que ya no existe.
alter table public.payment_authorization_log
  alter column payment_id drop not null;

do $$
declare
  v_conname text;
begin
  select con.conname into v_conname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'payment_authorization_log'
    and con.contype = 'f'
    and pg_get_constraintdef(con.oid) ilike '%payment_id%references%payments%';

  if v_conname is not null then
    execute format('alter table public.payment_authorization_log drop constraint %I', v_conname);
  end if;

  alter table public.payment_authorization_log
    add constraint payment_authorization_log_payment_id_fkey
    foreign key (payment_id) references public.payments(id) on delete set null;
end $$;

create or replace function public.delete_payment_authorized(
  p_payment_id uuid,
  p_business_id uuid,
  p_password text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_business uuid;
  v_caller_name text;
  v_payment public.payments;
  v_already_settled boolean;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'El motivo es obligatorio';
  end if;

  select p.business_id into v_caller_business
  from public.profiles p where p.id = auth.uid();

  if v_caller_business is distinct from p_business_id then
    raise exception 'No tenés permiso sobre este negocio';
  end if;

  select coalesce(nullif(trim(e.full_name), ''), 'Usuario') into v_caller_name
  from public.profiles p
  left join public.employees e on e.id = p.employee_id
  where p.id = auth.uid();

  perform public._verify_caja_authorization_password(p_business_id, 'void', p_password);

  select * into v_payment
  from public.payments
  where id = p_payment_id and business_id = p_business_id
  for update;

  if not found then
    raise exception 'Cobro no encontrado';
  end if;

  -- Mismo chequeo que ya hacía deletePayment (register-payment.ts) client-
  -- side, ahora server-side: comisión/propina ya liquidada (settlement_run_id
  -- en commission_records/tip_records), o algún COBRO puntual de una venta
  -- pendiente/parcial ya liquidado (commission_collection_events/
  -- tip_collection_events vía payment_collections).
  select
    exists(select 1 from public.commission_records where sale_id = p_payment_id and settlement_run_id is not null)
    or exists(select 1 from public.tip_records where sale_id = p_payment_id and settlement_run_id is not null)
    or exists(
      select 1 from public.payment_collections pc
      where pc.payment_id = p_payment_id
        and (
          exists(select 1 from public.commission_collection_events e where e.payment_collection_id = pc.id and e.settlement_run_id is not null)
          or exists(select 1 from public.tip_collection_events e where e.payment_collection_id = pc.id and e.settlement_run_id is not null)
        )
    )
  into v_already_settled;

  if v_already_settled then
    raise exception 'Este cobro ya forma parte de una liquidación cerrada — no se puede eliminar desde acá sin perder ese detalle histórico.';
  end if;

  insert into public.payment_authorization_log (
    business_id, payment_id, action_type, reason, performed_by, performed_by_name,
    before_snapshot, after_snapshot
  ) values (
    p_business_id, p_payment_id, 'void', 'Eliminación completa — ' || trim(p_reason), auth.uid(), v_caller_name,
    jsonb_build_object(
      'total', coalesce(v_payment.total, v_payment.amount), 'client_name', v_payment.client_name,
      'service_name', v_payment.service_name, 'status', v_payment.status
    ),
    jsonb_build_object('deleted', true)
  );
  -- Log ANTES del delete, aunque ya no haga falta por el "on delete set
  -- null" de arriba — más defensivo: si algo falla entre el insert y el
  -- delete, al menos queda registrado el intento.

  delete from public.payments where id = p_payment_id and business_id = p_business_id;
end;
$$;

revoke all on function public.delete_payment_authorized(uuid, uuid, text, text) from public;
grant execute on function public.delete_payment_authorized(uuid, uuid, text, text) to authenticated;

NOTIFY pgrst, 'reload schema';

commit;
