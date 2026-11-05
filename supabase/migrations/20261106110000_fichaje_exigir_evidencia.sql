-- ============================================================================
-- Fichaje con selfie + (QR o ubicación) — Paso 2 de 2: exigir la evidencia
-- ============================================================================
-- Aplicar SOLO después de que el paso 1 esté aplicado Y la pantalla nueva
-- desplegada: desde acá, un usuario con rol 'profesional' ya no puede crear ni
-- cerrar su jornada escribiendo directo en work_sessions (eso saltearía la
-- selfie y la ubicación); tiene que pasar por fichar_con_evidencia().
-- Administradores, socios, recepción, etc. siguen cargando y corrigiendo
-- jornadas como siempre (Historial de jornadas, Salidas pendientes, fichar en
-- nombre de un barbero).
--
-- Reversión:
--   drop trigger if exists trg_work_sessions_exigir_evidencia on public.work_sessions;
--   drop function if exists public.work_sessions_exigir_evidencia();
-- ============================================================================

create or replace function public.work_sessions_exigir_evidencia()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  -- Las escrituras de fichar_con_evidencia() marcan la transacción.
  if coalesce(current_setting('app.fichaje_evidencia', true), '') = '1' then
    return new;
  end if;

  select p.role into v_role from public.profiles p where p.id = auth.uid();
  if v_role = 'profesional' then
    raise exception 'Para fichar necesitás la selfie y estar en el local (QR o ubicación). Actualizá la app e intentá de nuevo.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_work_sessions_exigir_evidencia on public.work_sessions;
create trigger trg_work_sessions_exigir_evidencia
  before insert or update on public.work_sessions
  for each row execute function public.work_sessions_exigir_evidencia();
