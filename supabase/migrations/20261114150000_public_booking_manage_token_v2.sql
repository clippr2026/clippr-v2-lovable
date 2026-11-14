-- Token del turno recién creado: reconocerlo por teléfono O por correo.
--
-- Problema: la página de reservas obtiene el token del turno con el teléfono que escribió el cliente. Si ese teléfono
-- no coincide con el guardado (formato distinto en un cliente que ya existía, o un dato de relleno como "H"), no
-- obtiene el token, no consulta la seña y muestra "Turno confirmado", mientras el servidor sí la creaba al mandar el
-- correo: el cliente quedaba sin saber que debía seña y el turno se cancelaba solo.
--
-- Cambio: función nueva (v2) que acepta también el correo. La v1 queda como está. No toca datos existentes.
-- Cómo revertirlo: drop function public.public_booking_manage_token_v2(uuid, text, text);
create or replace function public.public_booking_manage_token_v2(p_appointment_id uuid, p_phone text, p_email text default null)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select a.manage_token
  from public.appointments a
  join public.clients c on c.id = a.client_id
  where a.id = p_appointment_id
    and a.created_at > now() - interval '30 minutes'
    and (
      (regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') <> ''
        and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = regexp_replace(p_phone, '\D', '', 'g'))
      or
      (position('@' in coalesce(p_email, '')) > 1
        and lower(coalesce(c.email, '')) = lower(trim(p_email)))
    );
$$;

revoke all on function public.public_booking_manage_token_v2(uuid, text, text) from public;
grant execute on function public.public_booking_manage_token_v2(uuid, text, text) to anon, authenticated;
