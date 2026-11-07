-- ============================================================================
-- Reseñas de la página pública  (BORRADOR — NO APLICADO)
-- ============================================================================
-- Solo suma: una tabla nueva, dos vistas públicas y dos funciones nuevas.
-- No modifica ni borra datos existentes.
--
-- Regla: un cliente que se atendió con un barbero (turno cobrado (status charged)) puede dejarle
-- UNA reseña a ese barbero. Si se atendió con 2 barberos, puede dejar 2 reseñas
-- (una a cada uno). Se identifica por su WhatsApp; el barbero ya viene marcado
-- por sus turnos, no se elige. Sin turnos cobrados no puede reseñar.
--
--   public.reviews              reseñas del negocio (cargadas por el dueño o enviadas
--                               por el cliente desde la página). Estado: pending |
--                               published | hidden. La página pública solo ve las
--                               published, sin etiqueta de origen.
--   public.public_reviews       vista pública: solo publicadas, sin teléfono ni notas.
--   public.public_review_stats  promedio y cantidad por negocio y por profesional.
--   public_find_review_barbers()  el cliente escribe su WhatsApp y ve con qué
--                               barberos se atendió y a cuáles ya les dejó reseña.
--                               Si no devuelve filas: "No encontramos tu número...".
--   public_submit_review()      guarda la reseña como pendiente (una por barbero).
--
-- Reversión (todo es aditivo):
--   drop function if exists public.public_submit_review(uuid, text, uuid, smallint, text);
--   drop function if exists public.public_find_review_barbers(uuid, text);
--   drop view if exists public.public_review_stats;
--   drop view if exists public.public_reviews;
--   drop table if exists public.reviews;
-- ============================================================================

-- ── 1. Tabla ────────────────────────────────────────────────────────────────
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  professional_id uuid references public.employees(id) on delete set null,
  client_name text not null check (char_length(trim(client_name)) between 1 and 80),
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 600),
  -- Fecha de la reseña (la original si se pasa de otro canal). Editable, nunca futura.
  review_date date not null default ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
  status text not null default 'pending' check (status in ('pending', 'published', 'hidden')),
  -- 'manual' = cargada por el dueño · 'page' = enviada por el cliente desde la página.
  source text not null default 'manual' check (source in ('manual', 'page')),
  -- Últimas 8 cifras del WhatsApp del cliente (solo reseñas de la página). Privado.
  phone_key text,
  -- Nota privada del dueño (ej. "Google", "WhatsApp"). No se muestra afuera.
  origin_note text check (origin_note is null or char_length(origin_note) <= 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reviews_date_not_future
    check (review_date <= ((now() at time zone 'America/Argentina/Buenos_Aires')::date) + 1)
);

-- Una sola reseña por cliente (por WhatsApp) y por barbero desde la página.
create unique index reviews_one_per_client_barber on public.reviews (business_id, phone_key, professional_id)
  where phone_key is not null;
create index reviews_business_status_date on public.reviews (business_id, status, review_date desc);
create index reviews_professional on public.reviews (professional_id) where professional_id is not null;

-- Tope de 50 reseñas cargadas a mano por negocio.
create or replace function public.reviews_limit_manual()
returns trigger
language plpgsql
as $$
begin
  if new.source = 'manual' and (
    select count(*) from public.reviews r where r.business_id = new.business_id and r.source = 'manual'
  ) >= 50 then
    raise exception 'Llegaste al máximo de 50 reseñas cargadas a mano.';
  end if;
  return new;
end;
$$;

create trigger trg_reviews_limit_manual
  before insert on public.reviews
  for each row execute function public.reviews_limit_manual();

alter table public.reviews enable row level security;

-- Dueño/encargados del negocio (todos menos 'profesional') gestionan las reseñas.
create policy reviews_select on public.reviews
  for select using (
    business_id in (select p.business_id from public.profiles p where p.id = auth.uid())
  );
create policy reviews_insert on public.reviews
  for insert with check (
    source = 'manual'
    and phone_key is null
    and business_id in (
      select p.business_id from public.profiles p
       where p.id = auth.uid() and p.role is distinct from 'profesional'
    )
  );
create policy reviews_update on public.reviews
  for update using (
    business_id in (
      select p.business_id from public.profiles p
       where p.id = auth.uid() and p.role is distinct from 'profesional'
    )
  );
create policy reviews_delete on public.reviews
  for delete using (
    business_id in (
      select p.business_id from public.profiles p
       where p.id = auth.uid() and p.role is distinct from 'profesional'
    )
  );

-- ── 2. Vistas públicas ──────────────────────────────────────────────────────
create view public.public_reviews as
  select r.id, r.business_id, r.professional_id,
         e.full_name as professional_name,
         r.client_name, r.rating, r.comment, r.review_date
    from public.reviews r
    left join public.employees e on e.id = r.professional_id
   where r.status = 'published';

create view public.public_review_stats as
  select business_id, professional_id,
         round(avg(rating)::numeric, 1) as avg_rating,
         count(*)::int as review_count
    from public.reviews
   where status = 'published'
   group by grouping sets ((business_id), (business_id, professional_id));

grant select on public.public_reviews to anon, authenticated;
grant select on public.public_review_stats to anon, authenticated;

-- ── 3. El cliente deja su reseña desde la página ────────────────────────────
-- Barberos que atendieron a ese WhatsApp (turnos cobrados) y si ya dejó su reseña.
create or replace function public.public_find_review_barbers(p_business_id uuid, p_phone text)
returns table (professional_id uuid, professional_name text, last_visit timestamptz, already_reviewed boolean)
language sql
security definer
set search_path = public
as $$
  with key as (
    select right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 8) as k,
           length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) as n
  ),
  visits as (
    select a.employee_id, max(a.starts_at) as last_visit
      from public.appointments a
      join public.clients c on c.id = a.client_id and c.business_id = a.business_id
      cross join key
     where a.business_id = p_business_id
       and a.status = 'charged'
       and key.n >= 8
       and right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 8) = key.k
     group by a.employee_id
  )
  select v.employee_id, e.full_name, v.last_visit,
         exists (select 1 from public.reviews r, key
                  where r.business_id = p_business_id and r.phone_key = key.k
                    and r.professional_id = v.employee_id)
    from visits v
    left join public.employees e on e.id = v.employee_id
   order by v.last_visit desc;
$$;

create or replace function public.public_submit_review(
  p_business_id uuid,
  p_phone text,
  p_professional_id uuid,
  p_rating smallint,
  p_comment text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_key text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 8);
  v_client_name text;
  v_first text;
  v_last text;
  v_name text;
  v_id uuid;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Elegí de 1 a 5 estrellas';
  end if;
  if p_comment is not null and char_length(p_comment) > 600 then
    raise exception 'El comentario es muy largo';
  end if;
  if length(v_digits) < 8 then
    raise exception 'Ingresá tu WhatsApp completo';
  end if;

  if p_professional_id is null then
    raise exception 'Falta el barbero';
  end if;

  -- Tiene que haberse atendido con ese barbero (turno cobrado (status charged)).
  select a.client_name into v_client_name
    from public.appointments a
    join public.clients c on c.id = a.client_id and c.business_id = a.business_id
   where a.business_id = p_business_id
     and a.status = 'charged'
     and a.employee_id = p_professional_id
     and right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 8) = v_key
   order by a.starts_at desc
   limit 1;
  if not found then
    raise exception 'No encontramos turnos tuyos con ese barbero';
  end if;

  if exists (
    select 1 from public.reviews r
     where r.business_id = p_business_id and r.phone_key = v_key and r.professional_id = p_professional_id
  ) then
    raise exception 'Ya le dejaste tu reseña a este barbero. ¡Gracias!';
  end if;

  -- Se muestra solo el nombre y la inicial del apellido.
  v_first := split_part(trim(coalesce(v_client_name, 'Cliente')), ' ', 1);
  v_last := nullif(split_part(trim(coalesce(v_client_name, '')), ' ', 2), '');
  v_name := initcap(v_first) || coalesce(' ' || upper(left(v_last, 1)) || '.', '');

  insert into public.reviews (business_id, professional_id, client_name, rating, comment, status, source, phone_key)
  values (p_business_id, p_professional_id, v_name, p_rating,
          nullif(trim(coalesce(p_comment, '')), ''), 'pending', 'page', v_key)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.public_find_review_barbers(uuid, text) from public;
revoke all on function public.public_submit_review(uuid, text, uuid, smallint, text) from public;
grant execute on function public.public_find_review_barbers(uuid, text) to anon, authenticated;
grant execute on function public.public_submit_review(uuid, text, uuid, smallint, text) to anon, authenticated;
