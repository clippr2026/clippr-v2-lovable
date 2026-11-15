-- Aviso a mano al celular de un cliente: permiso y cantidad de celulares.
--
-- La agenda muestra "Enviar aviso" solo si el cliente tiene la app con avisos activados. El envío lo hace el
-- servidor de la web, que primero pregunta con el usuario logueado si el cliente es de SU local.
-- Función nueva (la ejecuta quien tiene sesión): devuelve cuántos celulares tiene el cliente con avisos, o null si el
-- cliente no es del local de quien pregunta. No expone las claves de los celulares.
-- No modifica datos. Cómo revertirlo: drop function public.staff_client_push_count_v1(uuid);

create or replace function public.staff_client_push_count_v1(p_client_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_business uuid;
begin
  select p.business_id into v_business from public.profiles p where p.id = auth.uid();
  if v_business is null then
    return null;
  end if;
  if not exists (select 1 from public.clients c where c.id = p_client_id and c.business_id = v_business) then
    return null;
  end if;
  return (select count(*)::int from public.push_subscriptions s where s.app = 'auro' and s.client_id = p_client_id);
end;
$$;

revoke all on function public.staff_client_push_count_v1(uuid) from public, anon;
grant execute on function public.staff_client_push_count_v1(uuid) to authenticated;
