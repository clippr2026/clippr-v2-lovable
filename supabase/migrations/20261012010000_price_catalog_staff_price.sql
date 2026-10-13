-- Precio para colaboradores: beneficio especial por producto al vender a un
-- profesional/colaborador del negocio. Mismo patrón que effective_price
-- (columnas dedicadas en price_catalog, no JSONB — acá sí es config por
-- producto, no por empleado, así que no corresponde el patrón
-- _employeeServiceOverrides de business_settings.schedule).
alter table public.price_catalog
  add column if not exists staff_price_mode text not null default 'none',
  add column if not exists staff_discount_percent numeric null,
  add column if not exists staff_fixed_price numeric null;

alter table public.price_catalog
  drop constraint if exists price_catalog_staff_price_mode_check;
alter table public.price_catalog
  add constraint price_catalog_staff_price_mode_check
  check (staff_price_mode in ('none', 'percent', 'fixed'));

alter table public.price_catalog
  drop constraint if exists price_catalog_staff_discount_percent_check;
alter table public.price_catalog
  add constraint price_catalog_staff_discount_percent_check
  check (staff_discount_percent is null or (staff_discount_percent >= 0 and staff_discount_percent <= 100));

alter table public.price_catalog
  drop constraint if exists price_catalog_staff_fixed_price_check;
alter table public.price_catalog
  add constraint price_catalog_staff_fixed_price_check
  check (staff_fixed_price is null or staff_fixed_price >= 0);
