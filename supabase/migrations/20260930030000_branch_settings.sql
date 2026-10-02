-- ============================================================================
-- Multi-sucursal — branch_settings (Horarios, Promociones, Catálogo:
-- categorías/orden/imágenes)
-- ============================================================================
-- business_settings.schedule es un JSONB que mezcla MUCHAS cosas: horario
-- semanal, _promotions, categorías/orden/imágenes de catálogo — esto SÍ
-- debe variar por sucursal — pero TAMBIÉN _branding, _caja,
-- _publicSiteStatus, _clientes, _pendingWalkInSales y toda la familia
-- _employee* (una por cada profesional) — todo esto es del NEGOCIO
-- COMPLETO, lo consultan más de 15 archivos distintos en toda la app, y no
-- debe volverse per-branch.
--
-- En vez de partir esa fila en dos "tipos" de contenido adentro de la
-- MISMA tabla (arriesgando romper los ~40 call-sites que ya leen
-- business_settings sin filtrar por sucursal), esta migración deja
-- business_settings TAL CUAL — ni una columna nueva, ni su constraint
-- única tocada, cero riesgo para todo lo que ya funciona — y crea una
-- tabla NUEVA, chica y de un solo propósito: public.branch_settings, con
-- una fila por sucursal, que Horarios/Promociones/Catálogo (categorías,
-- orden, imágenes) empiezan a usar en vez de business_settings.
--
-- Backfill: cada negocio arranca con UNA fila en branch_settings para su
-- PRIMERA sucursal (típicamente "Sucursal principal"), copiando el
-- schedule actual de business_settings — así Horarios/Promociones/
-- Catálogo de esa sucursal arrancan con los datos que el negocio ya tenía
-- configurados, sin perder nada. El resto de las sucursales (si ya
-- existen) arranca sin fila — mismo criterio que precios/catálogo: sin
-- configurar todavía se resuelve como vacío/default en la UI, nunca error.
--
-- Genérica, re-ejecutable, pensada para correr tal cual en producción más
-- adelante cuando el usuario lo indique explícitamente. NO tocar
-- producción (velos-app / myclippr.com) todavía — correr solo en
-- clippr-dev.
-- ============================================================================

create table if not exists public.branch_settings (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  branch_id   uuid not null references public.branches(id),
  schedule    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists idx_branch_settings_business_branch
  on public.branch_settings (business_id, branch_id);

comment on table public.branch_settings is
  'Configuración específica de UNA sucursal: horario semanal, promociones,
   categorías/orden/imágenes de catálogo. Todo lo que es del negocio
   completo (branding, caja, permisos, config de clientes, etc.) sigue
   viviendo en business_settings, sin cambios — ver migración.';

alter table public.branch_settings enable row level security;

drop policy if exists branch_settings_select on public.branch_settings;
create policy branch_settings_select on public.branch_settings
  for select
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
  );

drop policy if exists branch_settings_write on public.branch_settings;
create policy branch_settings_write on public.branch_settings
  for all
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  )
  with check (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  );

-- Mismo motivo que el GRANT agregado a branches en 20260930010000: las
-- policies de RLS de arriba solo restringen filas — sin el GRANT de nivel
-- tabla de abajo, PostgREST devuelve 42501 antes de evaluar RLS siquiera.
grant select, insert, update, delete on public.branch_settings to authenticated;

-- Backfill: primera sucursal de cada negocio ← copia del schedule actual.
do $$
declare
  v_row             record;
  v_first_branch_id uuid;
begin
  for v_row in
    select business_id, schedule from public.business_settings
  loop
    select id into v_first_branch_id
      from public.branches
      where business_id = v_row.business_id
      order by created_at asc
      limit 1;

    if v_first_branch_id is not null
       and not exists (
         select 1 from public.branch_settings
         where business_id = v_row.business_id and branch_id = v_first_branch_id
       )
    then
      insert into public.branch_settings (business_id, branch_id, schedule)
      values (v_row.business_id, v_first_branch_id, coalesce(v_row.schedule, '{}'::jsonb));
    end if;
  end loop;
end $$;

NOTIFY pgrst, 'reload schema';
