-- ============================================================================
-- Perfil público del profesional: fecha de nacimiento, nacionalidad y desde
-- cuándo trabaja en el rubro 
-- ============================================================================
-- Se cargan en Configuración → Equipo (editar profesional) y se muestran en la
-- página de reservas al abrir un profesional: Edad / Nacionalidad / Experiencia.
--
--   employees.birth_date        fecha de nacimiento (dato privado: NUNCA sale
--                               por la vista pública, solo la edad calculada)
--   employees.nationality       texto libre (ej. "Argentina")
--   employees.experience_since  desde cuándo trabaja en el rubro (se muestra
--                               como años calculados, siempre al día)
--
-- La vista pública public_booking_employees suma al final: age_years,
-- nationality, experience_years (create or replace conserva los permisos).
--
-- No toca turnos, cobros, comisiones ni cajas. Columnas nuevas y nullable.
--
-- Reversión:
--   create or replace view public.public_booking_employees as
--     select id, business_id, full_name, avatar_url, is_active, branch_id
--       from public.employees where coalesce(is_active, true) = true;
--   alter table public.employees drop column if exists birth_date,
--     drop column if exists nationality, drop column if exists experience_since;
-- ============================================================================

alter table public.employees
  add column if not exists birth_date date,
  add column if not exists nationality text,
  add column if not exists experience_since date;

create or replace view public.public_booking_employees as
  select id, business_id, full_name, avatar_url, is_active, branch_id,
         case when birth_date is null then null
              else date_part('year', age(current_date, birth_date))::int end as age_years,
         nationality,
         case when experience_since is null then null
              else date_part('year', age(current_date, experience_since))::int end as experience_years
    from public.employees
   where coalesce(is_active, true) = true;
