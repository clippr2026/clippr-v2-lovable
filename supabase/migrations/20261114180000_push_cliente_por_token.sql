-- Avisos push del cliente: ligar el celular al cliente usando el link único de su turno (el del correo).
--
-- La app instalada desde el correo guarda ese link (token). Al activar los avisos, el celular se registra con
-- el token: el servidor resuelve a qué local y a qué cliente pertenece. Así se le puede avisar a ESE cliente
-- (confirmación, recordatorio, cambios) sin que tenga cuenta.
--
-- Cambios (solo agregan; no modifican ni borran filas existentes):
--   1. push_subscriptions.client_id (uuid, nulo): cliente dueño del celular. Las filas actuales quedan en null.
--   2. register_client_push_subscription_v1(token, endpoint, p256dh, auth, user_agent): alta por token.
--      · Token inexistente → error, no registra nada.
--      · Siempre app = 'auro' (cliente). Si ese celular ya estaba registrado como gestión ('clippr'), NO se pisa.
--      · Si el mismo celular ya estaba registrado para otro cliente, pasa a ser del cliente del token nuevo.
-- Cómo revertirlo:
--   drop function public.register_client_push_subscription_v1(uuid, text, text, text, text);
--   alter table public.push_subscriptions drop column client_id;  -- (solo si no se usa)

alter table public.push_subscriptions add column if not exists client_id uuid;

create index if not exists push_subscriptions_client_idx
  on public.push_subscriptions (client_id) where client_id is not null;

create or replace function public.register_client_push_subscription_v1(
  p_token uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_business uuid;
  v_client uuid;
  v_phone text;
begin
  if coalesce(p_endpoint, '') = '' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'Suscripción incompleta';
  end if;

  select ap.business_id, ap.client_id, c.phone
    into v_business, v_client, v_phone
  from public.appointments ap
  left join public.clients c on c.id = ap.client_id
  where ap.manage_token = p_token
  limit 1;

  if v_business is null then
    raise exception 'Link no válido';
  end if;

  insert into public.push_subscriptions (business_id, app, user_id, client_id, client_phone, endpoint, p256dh, auth, user_agent)
  values (v_business, 'auro', null, v_client, nullif(trim(v_phone), ''), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update set
    business_id = excluded.business_id,
    client_id = excluded.client_id,
    client_phone = coalesce(excluded.client_phone, public.push_subscriptions.client_phone),
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    user_agent = excluded.user_agent,
    last_seen_at = now()
  where public.push_subscriptions.app = 'auro';
end;
$$;

revoke all on function public.register_client_push_subscription_v1(uuid, text, text, text, text) from public;
grant execute on function public.register_client_push_subscription_v1(uuid, text, text, text, text) to anon, authenticated;
