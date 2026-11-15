-- Clientes: grupos por frecuencia de visita (semanal, cada 2 semanas, cada 3 semanas, mensual, cada 2 meses o más),
-- más Nuevos, Una visita, Sin visitas y Perdidos, con historial de cambios de grupo por cliente.
--
-- Dos funciones NUEVAS (no se modifica ni se reemplaza ninguna existente: clippr_clients_list y
-- clippr_clients_segment_counts siguen igual, y con ellas el Asesor IA, el detalle mensual y el resto):
--   1. clippr_clientes_grupos_v1(negocio)            → grupo de cada cliente.
--   2. clippr_client_grupo_historial_v1(cliente)     → cambios de grupo del cliente, con fecha y motivo.
--
-- Reglas (una visita = un día con pago registrado, igual que la pantalla de Clientes):
--   · 0 visitas → sin_visitas.
--   · 1 visita → nuevo si pasaron 30 días o menos desde esa visita (o tiene un turno por venir); si no, una_visita.
--   · 2 o más visitas → por la mediana de días entre sus últimas 3 visitas (una ausencia aislada no cambia el grupo):
--       ≤10 semanal · 11–17 quincenal · 18–25 tres_semanas · 26–45 mensual · más de 45 dos_meses.
--     Pasa a perdido si lleva sin venir más de 1,5 veces su frecuencia (mínimo 30 días, máximo 120) y no tiene turno por venir.
-- No toca datos. Cómo revertirlo:
--   drop function public.clippr_client_grupo_historial_v1(uuid), public.clippr_clientes_grupos_v1(uuid);

create or replace function public.clippr_clientes_grupos_v1(p_business_id uuid)
returns table (client_id uuid, grupo text, cada_dias numeric, ultima_visita date, dias_visitas integer)
language sql
stable
as $$
  with tz as (
    select coalesce((select timezone from public.businesses where id = p_business_id), 'America/Argentina/Buenos_Aires') as z
  ),
  hoy as (select (now() at time zone (select z from tz))::date as d),
  dias as (
    select lower(btrim(p.client_name)) as k, (p.created_at at time zone (select z from tz))::date as d
    from public.payments p
    where p.business_id = p_business_id and p.client_name is not null and btrim(p.client_name) <> ''
    group by 1, 2
  ),
  g as (
    select k, d,
           d - lag(d) over (partition by k order by d) as gap,
           row_number() over (partition by k order by d desc) as rn_desc
    from dias
  ),
  r as (
    select k, count(*)::int as n, max(d) as ultima, min(d) as primera,
           percentile_cont(0.5) within group (order by gap) filter (where rn_desc <= 3 and gap is not null) as gap_reciente
    from g group by k
  ),
  turno as (
    select c.id as client_id,
           exists (
             select 1 from public.appointments a
             where a.business_id = c.business_id
               and (a.client_id = c.id or (a.client_id is null and lower(btrim(a.client_name)) = lower(btrim(c.full_name))))
               and a.starts_at >= now() and a.status in ('pending', 'confirmed')
           ) as por_venir
    from public.clients c
    where c.business_id = p_business_id
  )
  select c.id,
         case
           when coalesce(r.n, 0) = 0 then 'sin_visitas'
           when r.n = 1 then case when (select d from hoy) - r.primera <= 30 or t.por_venir then 'nuevo' else 'una_visita' end
           when not t.por_venir
                and (select d from hoy) - r.ultima > greatest(30, least(120, 1.5 * r.gap_reciente)) then 'perdido'
           when r.gap_reciente <= 10 then 'semanal'
           when r.gap_reciente <= 17 then 'quincenal'
           when r.gap_reciente <= 25 then 'tres_semanas'
           when r.gap_reciente <= 45 then 'mensual'
           else 'dos_meses'
         end,
         round(r.gap_reciente::numeric, 1),
         r.ultima,
         coalesce(r.n, 0)
  from public.clients c
  join turno t on t.client_id = c.id
  left join r on r.k = lower(btrim(c.full_name))
  where c.business_id = p_business_id;
$$;

-- Cambios de grupo de un cliente, reconstruidos con sus pagos (no se guarda nada aparte).
create or replace function public.clippr_client_grupo_historial_v1(p_client_id uuid)
returns table (fecha date, grupo text, motivo text)
language sql
stable
as $$
  with c as (
    select cl.id, cl.business_id, lower(btrim(cl.full_name)) as k, cl.created_at
    from public.clients cl where cl.id = p_client_id
  ),
  tz as (
    select coalesce((select b.timezone from public.businesses b join c on c.business_id = b.id), 'America/Argentina/Buenos_Aires') as z
  ),
  hoy as (select (now() at time zone (select z from tz))::date as d),
  v as (
    select (p.created_at at time zone (select z from tz))::date as d
    from public.payments p join c on p.business_id = c.business_id and lower(btrim(p.client_name)) = c.k
    group by 1
  ),
  vi as (
    select d, row_number() over (order by d) as i, lead(d) over (order by d) as siguiente from v
  ),
  g as (
    select d, i, siguiente,
           d - lag(d) over (order by d) as gap
    from vi
  ),
  gr as (
    -- mediana de los últimos 3 espacios hasta cada visita
    select d, i, siguiente,
           (select percentile_cont(0.5) within group (order by x.gap) from (select gap from g g2 where g2.i <= g.i and g2.gap is not null order by g2.i desc limit 3) x) as gap_reciente
    from g
  ),
  eventos as (
    select (select (cl.created_at at time zone (select z from tz))::date from public.clients cl where cl.id = p_client_id) as fecha,
           'sin_visitas'::text as grupo, 'Se cargó el cliente'::text as motivo
    union all
    -- visita 1: nuevo; si no vuelve en 30 días, pasa a una visita
    select d, 'nuevo', 'Primera visita' from gr where i = 1
    union all
    select d + 31, 'una_visita', 'Pasó el mes sin volver' from gr
      where i = 1 and (siguiente is null or siguiente > d + 30) and d + 31 <= (select d from hoy)
    union all
    -- visitas 2 en adelante: grupo por frecuencia
    select d,
           case when gap_reciente <= 10 then 'semanal' when gap_reciente <= 17 then 'quincenal'
                when gap_reciente <= 25 then 'tres_semanas' when gap_reciente <= 45 then 'mensual' else 'dos_meses' end,
           'Volvió: ritmo de ' || round(gap_reciente)::int || case when round(gap_reciente)::int = 1 then ' día' else ' días' end || ' entre visitas'
    from gr where i >= 2
    union all
    -- pasó a perdido si no volvió dentro del límite
    select d + (greatest(30, least(120, 1.5 * gap_reciente)))::int + 1, 'perdido', 'Pasó el tiempo sin volver'
    from gr
    where i >= 2 and (siguiente is null or siguiente - d > greatest(30, least(120, 1.5 * gap_reciente)))
      and d + (greatest(30, least(120, 1.5 * gap_reciente)))::int + 1 <= (select d from hoy)
  ),
  ordenados as (
    select fecha, grupo, motivo, lag(grupo) over (order by fecha, case grupo when 'sin_visitas' then 0 when 'nuevo' then 1 else 2 end) as anterior
    from eventos
  )
  select fecha, grupo, motivo from ordenados where anterior is distinct from grupo order by fecha;
$$;

revoke all on function public.clippr_clientes_grupos_v1(uuid) from public, anon;
revoke all on function public.clippr_client_grupo_historial_v1(uuid) from public, anon;
grant execute on function public.clippr_clientes_grupos_v1(uuid) to authenticated, service_role;
grant execute on function public.clippr_client_grupo_historial_v1(uuid) to authenticated, service_role;
