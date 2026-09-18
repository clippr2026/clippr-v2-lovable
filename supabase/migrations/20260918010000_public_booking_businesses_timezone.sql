-- La reserva pública calculaba horarios disponibles usando la hora/zona
-- horaria del DISPOSITIVO de quien reserva, nunca la del negocio (columna
-- `businesses.timezone`, ya existente y con default 'America/Argentina/Buenos_Aires').
-- La vista pública tampoco la exponía. Un visitante con el reloj/huso
-- desalineado del real del negocio veía los horarios corridos (síntoma
-- reportado: turnos ofrecidos desde las 08:00 con la barbería abriendo a
-- las 11:00 — 3hs de diferencia, exactamente el offset de Argentina).
create or replace view public.public_booking_businesses as
select
  id,
  name,
  slug,
  address,
  phone,
  email,
  instagram,
  logo_url,
  accent_color,
  avatar_url,
  cover_url,
  coalesce(timezone, 'America/Argentina/Buenos_Aires') as timezone
from public.businesses
where coalesce(is_active, true) = true;
