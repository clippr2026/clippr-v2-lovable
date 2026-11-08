-- Cierra el acceso sin sesión a datos financieros.
--
-- Hallazgo (8/11/2026): con la clave pública de la página se podían leer (y
-- modificar) `expenses` y `caja_cierres` sin iniciar sesión:
--   1) políticas "all_access" (using true) para el rol anon,
--   2) el rol anon tenía permisos de escritura sobre esas tablas,
--   3) user_is_business_member() aceptaba a un anónimo cuando owner_email del
--      negocio está vacío (comparaba '' contra '').
-- Además `expenses` y `rejected_clients` tenían políticas "true" para cualquier
-- usuario logueado (de cualquier negocio).
--
-- No cambia datos. La app sigue funcionando para el dueño y el equipo por las
-- políticas *_member_all (user_is_business_member) que ya existían.

-- 1) Políticas abiertas.
drop policy if exists caja_cierres_all_access on public.caja_cierres;
drop policy if exists expenses_all_access on public.expenses;
drop policy if exists allow_authenticated on public.expenses;

drop policy if exists rejected_clients_rw on public.rejected_clients;
create policy rejected_clients_member_all on public.rejected_clients
  for all to authenticated
  using (public.user_is_business_member(business_id))
  with check (public.user_is_business_member(business_id));

-- 2) Permisos del rol anónimo: solo las vistas públicas de la página de reservas
--    y las reseñas; ninguna tabla interna (ni siquiera TRUNCATE/TRIGGER/REFERENCES).
do $$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and c.relname not like 'public\_booking\_%'
      and c.relname not in ('public_review_stats', 'public_reviews')
  loop
    execute format('revoke all on public.%I from anon', r.relname);
  end loop;
end $$;

-- Lo nuevo que se cree en el esquema ya no queda expuesto a anon por defecto.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- 3) Un anónimo (sin email) nunca coincide con un owner_email / email vacío.
create or replace function public.user_is_business_member(biz uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
      select
        exists (
          select 1 from public.businesses b
          where b.id = biz and ( b.owner_id = auth.uid() or ( nullif(auth.email(),'') is not null and lower(coalesce(b.owner_email,'')) = lower(auth.email()) ) )
        )
        or exists (
          -- Miembro del equipo VIGENTE (no revocado), por uid o por email.
          select 1 from public.team_members tm
          where tm.business_id = biz
            and lower(coalesce(tm.status,'active'))
                  not in ('suspended','deleted','removed','inactive','blocked')
            and ( tm.auth_user_id = auth.uid()
                  or ( nullif(auth.email(),'') is not null and lower(coalesce(tm.email,'')) = lower(auth.email()) ) )
        )
         or ( exists (select 1 from public.profiles p where p.id = auth.uid() and p.business_id = biz)   and exists (select 1 from public.businesses bo where bo.id = biz and bo.owner_id is null)   and not exists ( select 1 from public.team_members tm2 where tm2.business_id = biz       and lower(coalesce(tm2.status,'active')) in ('suspended','deleted','removed','inactive','blocked')       and ( tm2.auth_user_id = auth.uid() or ( nullif(auth.email(),'') is not null and lower(coalesce(tm2.email,'')) = lower(auth.email()) ) ) ) ) ;
    $function$;
