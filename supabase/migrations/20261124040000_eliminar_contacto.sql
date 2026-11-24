-- Profesional: elimina un contacto de "Actividad" (invitación que aceptó, postulación aceptada o alquiler aceptado).
-- No permite eliminar si ya es parte del equipo del local (empleado vinculado): ahí lo desvincula el local.
-- Reversión: drop function public.remove_my_contact(text, uuid);
create or replace function public.remove_my_contact(p_source text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_source = 'join' then
    if exists (select 1 from public.join_requests where id = p_id and user_id = auth.uid() and status = 'accepted' and employee_id is not null) then
      raise exception 'es_parte_del_equipo';
    end if;
    delete from public.join_requests
      where id = p_id and user_id = auth.uid()
        and ((status = 'pending' and initiated_by = 'business') or (status = 'accepted' and employee_id is null));
  elsif p_source = 'rental' then
    delete from public.rental_requests where id = p_id and user_id = auth.uid() and status = 'accepted';
  else
    raise exception 'accion_invalida';
  end if;
  if not found then raise exception 'solicitud_invalida'; end if;
end;
$$;

revoke all on function public.remove_my_contact(text, uuid) from public;
grant execute on function public.remove_my_contact(text, uuid) to authenticated;
