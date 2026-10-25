-- ============================================================================
-- Autorizaciones de caja — set/has_caja_authorization_password
-- ============================================================================
-- set_caja_authorization_password: solo owner/admin_general del negocio
-- puede crear/cambiar la contraseña de "correction" o "void". Hashea con
-- pgcrypto (crypt + gen_salt('bf')) antes de guardar — el texto plano nunca
-- toca una columna ni un log.
--
-- has_caja_authorization_password: para que Configuración y los botones de
-- acción sepan si ya hay contraseña cargada sin exponer nada sensible.
-- Cualquier miembro autenticado del negocio puede consultarla (es solo un
-- booleano).
--
-- Cómo correrlo: pegar completo en el SQL Editor de Supabase (primero en
-- desarrollo, después en producción) y ejecutar. Requiere que
-- 20261025010000 ya haya corrido. Idempotente.
-- ============================================================================
begin;

create or replace function public.set_caja_authorization_password(
  p_business_id uuid,
  p_action_type text,
  p_new_password text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_role text;
  v_caller_business uuid;
begin
  if p_action_type not in ('correction', 'void') then
    raise exception 'Tipo de acción inválido';
  end if;

  if p_new_password is null or length(trim(p_new_password)) < 4 then
    raise exception 'La contraseña debe tener al menos 4 caracteres';
  end if;

  select p.role, p.business_id into v_role, v_caller_business
  from public.profiles p where p.id = auth.uid();

  if v_caller_business is distinct from p_business_id then
    raise exception 'No tenés permiso sobre este negocio';
  end if;

  if v_role not in ('owner', 'admin_general') then
    raise exception 'Solo el dueño o administrador general puede configurar esta contraseña';
  end if;

  insert into public.caja_authorization_codes (
    business_id, action_type, password_hash, failed_attempts, locked_until, updated_at, updated_by
  ) values (
    p_business_id, p_action_type, extensions.crypt(p_new_password, extensions.gen_salt('bf')),
    0, null, now(), auth.uid()
  )
  on conflict (business_id, action_type) do update
    set password_hash = excluded.password_hash,
        failed_attempts = 0,
        locked_until = null,
        updated_at = now(),
        updated_by = auth.uid();
end;
$$;

revoke all on function public.set_caja_authorization_password(uuid, text, text) from public;
grant execute on function public.set_caja_authorization_password(uuid, text, text) to authenticated;

create or replace function public.has_caja_authorization_password(
  p_business_id uuid,
  p_action_type text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_business uuid;
  v_exists boolean;
begin
  select p.business_id into v_caller_business
  from public.profiles p where p.id = auth.uid();

  if v_caller_business is distinct from p_business_id then
    raise exception 'No tenés permiso sobre este negocio';
  end if;

  select exists(
    select 1 from public.caja_authorization_codes
    where business_id = p_business_id and action_type = p_action_type
  ) into v_exists;

  return v_exists;
end;
$$;

revoke all on function public.has_caja_authorization_password(uuid, text) from public;
grant execute on function public.has_caja_authorization_password(uuid, text) to authenticated;

-- ── _verify_caja_authorization_password ─────────────────────────────────────
-- Helper interno (sin grant a authenticated — NO se expone directo, ver
-- "no permitir saltearse la autorización mediante llamadas directas a la
-- base de datos"): lo llaman void_payment_authorized/correct_payment_authorized
-- desde DENTRO de su misma transacción. Bloquea la fila
-- (`for update`) para serializar intentos concurrentes sobre el mismo
-- negocio+acción, compara con pgcrypto, lleva failed_attempts/locked_until,
-- y SIEMPRE lanza una excepción genérica en cualquier fallo (contraseña
-- incorrecta, sin configurar, bloqueada) — nunca revela cuál de los tres
-- pasó, para no dar pistas a quien esté probando contraseñas al voleo.
create or replace function public._verify_caja_authorization_password(
  p_business_id uuid,
  p_action_type text,
  p_password text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row public.caja_authorization_codes;
  v_max_attempts constant int := 5;
  v_lock_minutes constant int := 15;
begin
  select * into v_row
  from public.caja_authorization_codes
  where business_id = p_business_id and action_type = p_action_type
  for update;

  if not found then
    raise exception 'No hay contraseña de autorización configurada — pedile a un administrador que la configure en Configuración → Seguridad.';
  end if;

  if v_row.locked_until is not null and v_row.locked_until > now() then
    raise exception 'Demasiados intentos fallidos. Probá de nuevo en unos minutos.';
  end if;

  if p_password is null or extensions.crypt(p_password, v_row.password_hash) is distinct from v_row.password_hash then
    update public.caja_authorization_codes
      set failed_attempts = failed_attempts + 1,
          locked_until = case
            when failed_attempts + 1 >= v_max_attempts then now() + make_interval(mins => v_lock_minutes)
            else locked_until
          end
      where id = v_row.id;
    raise exception 'Contraseña de autorización incorrecta';
  end if;

  update public.caja_authorization_codes
    set failed_attempts = 0, locked_until = null
    where id = v_row.id;
end;
$$;

revoke all on function public._verify_caja_authorization_password(uuid, text, text) from public;
revoke all on function public._verify_caja_authorization_password(uuid, text, text) from authenticated;

NOTIFY pgrst, 'reload schema';

commit;
