-- ============================================================================
-- Reseñas destacadas  (BORRADOR — NO APLICADO)
-- ============================================================================
-- Suma una columna a la tabla nueva public.reviews y la expone en la vista pública:
--
--   reviews.featured   true = el negocio la eligió para el carrusel de la página pública
--                      (hasta 10 por negocio; lo valida un trigger).
--   public_reviews     la vista pública suma la columna featured (al final, no rompe nada).
--
-- No toca turnos, clientes, pagos ni cajas. La tabla reviews está vacía o con las
-- reseñas cargadas por el negocio.
--
-- Reversión:
--   create or replace view public.public_reviews as
--     select r.id, r.business_id, r.professional_id, e.full_name as professional_name,
--            r.client_name, r.rating, r.comment, r.review_date
--       from public.reviews r left join public.employees e on e.id = r.professional_id
--      where r.status = 'published';
--   drop trigger if exists trg_reviews_limit_featured on public.reviews;
--   drop function if exists public.reviews_limit_featured();
--   alter table public.reviews drop column if exists featured;
-- ============================================================================

alter table public.reviews
  add column if not exists featured boolean not null default false;

-- Hasta 10 destacadas por negocio.
create or replace function public.reviews_limit_featured()
returns trigger
language plpgsql
as $$
begin
  if new.featured and (
    select count(*) from public.reviews r
     where r.business_id = new.business_id and r.featured and r.id <> new.id
  ) >= 10 then
    raise exception 'Ya tenés 10 reseñas destacadas. Quitá una para destacar otra.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reviews_limit_featured on public.reviews;
create trigger trg_reviews_limit_featured
  before insert or update of featured on public.reviews
  for each row execute function public.reviews_limit_featured();

-- Vista pública con la columna nueva al final (create or replace conserva los permisos).
create or replace view public.public_reviews as
  select r.id, r.business_id, r.professional_id,
         e.full_name as professional_name,
         r.client_name, r.rating, r.comment, r.review_date,
         r.featured
    from public.reviews r
    left join public.employees e on e.id = r.professional_id
   where r.status = 'published';
