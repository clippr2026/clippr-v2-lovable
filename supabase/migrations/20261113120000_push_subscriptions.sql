-- ============================================================================
-- Notificaciones push: suscripciones de los celulares (PWA)
-- ============================================================================
-- Una fila por celular/navegador suscripto. Hay dos apps instalables:
--   app = 'clippr' → quien gestiona el local (cuenta con sesión; user_id = auth.uid())
--   app = 'auro'   → clientes del local (sin sesión; se identifican por business_id; opcionalmente por teléfono)
--
-- La tabla NO se lee ni escribe directo desde la app (RLS activado, sin permisos para anon/authenticated):
--   · register_push_subscription_v1 → alta/actualización de una suscripción
--   · unregister_push_subscription_v1 → baja por endpoint
-- El envío lo hace el servidor (clave de servicio), que sí puede leer la tabla.
--
-- No modifica ni borra ninguna fila existente: agrega una tabla y dos funciones.
-- Cómo revertirlo: drop function register_push_subscription_v1, unregister_push_subscription_v1; drop table push_subscriptions.
-- ============================================================================

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  app text not null check (app in ('clippr', 'auro')),
  user_id uuid,
  client_phone text,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_subscriptions_business_app_idx
  on public.push_subscriptions (business_id, app);
create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id) where user_id is not null;

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

-- Alta/actualización. Con sesión (app 'clippr') el negocio sale del perfil del usuario;
-- sin sesión (app 'auro') se resuelve por el slug del local y solo se acepta app = 'auro'.
create or replace function public.register_push_subscription_v1(
  p_app text,
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null,
  p_business_slug text default null,
  p_client_phone text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_business uuid;
  v_user uuid := auth.uid();
begin
  if coalesce(p_endpoint, '') = '' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'Suscripción incompleta';
  end if;
  if p_app not in ('clippr', 'auro') then
    raise exception 'App inválida';
  end if;

  if p_app = 'clippr' then
    if v_user is null then
      raise exception 'Hay que iniciar sesión para activar los avisos';
    end if;
    select business_id into v_business from public.profiles where id = v_user;
    if v_business is null then
      raise exception 'Cuenta sin negocio';
    end if;
  else
    select id into v_business from public.businesses where slug = p_business_slug;
    if v_business is null then
      raise exception 'Local no encontrado';
    end if;
    v_user := null;
  end if;

  insert into public.push_subscriptions (business_id, app, user_id, client_phone, endpoint, p256dh, auth, user_agent)
  values (v_business, p_app, v_user, nullif(trim(p_client_phone), ''), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update set
    business_id = excluded.business_id,
    app = excluded.app,
    user_id = excluded.user_id,
    client_phone = coalesce(excluded.client_phone, public.push_subscriptions.client_phone),
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    user_agent = excluded.user_agent,
    last_seen_at = now();
end;
$$;

create or replace function public.unregister_push_subscription_v1(p_endpoint text)
returns void
language sql
security definer
set search_path to 'public'
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint;
$$;

revoke all on function public.register_push_subscription_v1(text, text, text, text, text, text, text) from public;
revoke all on function public.unregister_push_subscription_v1(text) from public;
grant execute on function public.register_push_subscription_v1(text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.unregister_push_subscription_v1(text) to anon, authenticated;
