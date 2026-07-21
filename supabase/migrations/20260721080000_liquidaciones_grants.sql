-- ============================================================================
-- Liquidaciones — permisos de tabla faltantes (causa real de "permission
-- denied for table commission_records / professional_settlements")
-- ============================================================================
-- La migración original (20260719215606_liquidaciones_system.sql) creó las
-- tablas, RLS y policies, pero nunca le dio GRANT de tabla al rol
-- `authenticated` — sin eso, Postgres rechaza el acceso ANTES de evaluar
-- las políticas RLS, sin importar si la policy sería permisiva o no. Por
-- eso el error era "permission denied", no un resultado vacío.
--
-- Esto no afectaba al RPC register_settlement_payment porque corre como
-- `security definer` (privilegios del dueño de la función, no del rol
-- authenticated) — por eso el pago funcionaba pero la lectura directa
-- desde el cliente no.
--
-- Seguro re-ejecutar: todo es GRANT (idempotente) y DROP POLICY IF EXISTS
-- + CREATE POLICY. No borra ni modifica ninguna fila de datos.
-- ============================================================================

-- ── 1. GRANT de tabla para el rol authenticated ─────────────────────────────
grant usage on schema public to authenticated;

grant select, insert, update, delete
  on table public.commission_records
  to authenticated;

grant select, insert, update, delete
  on table public.professional_settlements
  to authenticated;

grant select, insert, update, delete
  on table public.settlement_commission_links
  to authenticated;

-- Estas tablas usan uuid con gen_random_uuid() como default (no
-- secuencias), así que no hace falta GRANT sobre ninguna sequence. El RPC
-- ya tiene su propio grant execute (ver 20260721060000_liquidaciones_rpc.sql).

-- ── 2. RLS: reafirma las mismas políticas ya creadas (sin cambios de
--    lógica — el error era de GRANT, no de estas policies). Se repiten acá
--    por completitud, en el mismo script que soluciona el problema real.
--    Patrón: "profesional" solo ve/edita lo suyo; cualquier otro rol
--    (admin general, socio, admin local, recepcionista) tiene acceso
--    completo dentro de su propio negocio.
alter table public.commission_records enable row level security;
alter table public.professional_settlements enable row level security;
alter table public.settlement_commission_links enable row level security;

drop policy if exists commission_records_select on public.commission_records;
create policy commission_records_select on public.commission_records
  for select
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (
      (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
      or professional_id = (select p.employee_id from public.profiles p where p.id = auth.uid())
    )
  );

drop policy if exists commission_records_write on public.commission_records;
create policy commission_records_write on public.commission_records
  for all
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  )
  with check (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  );

drop policy if exists settlements_select on public.professional_settlements;
create policy settlements_select on public.professional_settlements
  for select
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (
      (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
      or professional_id = (select p.employee_id from public.profiles p where p.id = auth.uid())
    )
  );

drop policy if exists settlements_write on public.professional_settlements;
create policy settlements_write on public.professional_settlements
  for all
  using (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  )
  with check (
    business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
    and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
  );

drop policy if exists settlement_links_select on public.settlement_commission_links;
create policy settlement_links_select on public.settlement_commission_links
  for select
  using (
    exists (
      select 1 from public.professional_settlements s
      where s.id = settlement_commission_links.settlement_id
        and s.business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
        and (
          (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
          or s.professional_id = (select p.employee_id from public.profiles p where p.id = auth.uid())
        )
    )
  );

drop policy if exists settlement_links_write on public.settlement_commission_links;
create policy settlement_links_write on public.settlement_commission_links
  for all
  using (
    exists (
      select 1 from public.professional_settlements s
      where s.id = settlement_commission_links.settlement_id
        and s.business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
        and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
    )
  )
  with check (
    exists (
      select 1 from public.professional_settlements s
      where s.id = settlement_commission_links.settlement_id
        and s.business_id = (select p.business_id from public.profiles p where p.id = auth.uid())
        and (select p.role from public.profiles p where p.id = auth.uid()) is distinct from 'profesional'
    )
  );

-- ── 3. Verificación rápida (solo lectura) ───────────────────────────────────
-- Confirma que authenticated ahora tiene los privilegios de tabla.
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('commission_records', 'professional_settlements', 'settlement_commission_links')
  and grantee = 'authenticated'
order by table_name, privilege_type;
