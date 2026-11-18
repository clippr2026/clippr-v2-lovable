-- Clientes: quien vino una sola vez pasa a Perdido a los 60 días de su primera visita. Aplicada en producción el 18/11/2026.
--
-- Regla pedida por el dueño: 0 a 29 días = Nuevo, 30 a 59 = Una visita, 60 o más = Perdido (si no volvió y no tiene turno por venir).
-- Antes: Nuevo hasta 30 días, y Una visita para siempre (Perdido exigía 2 visitas o más). Con 2 visitas o más no cambia nada.
-- Solo cambia cómo se calcula el grupo: no modifica tablas ni datos. El grupo se calcula al consultar.
-- Cómo revertirlo: volver a aplicar clippr_clientes_grupos_v1 de 20261115180000_clientes_generico_sin_agendar.sql y
-- clippr_client_grupo_historial_v1 de 20261115130000_clientes_pagos_por_cliente_del_turno.sql.

create or replace function public.clippr_clientes_grupos_v1(p_business_id uuid)
returns table (client_id uuid, grupo text, cada_dias numeric, ultima_visita date, dias_visitas integer, gasto numeric)
language sql
stable
as $$
  with tz as (
    select coalesce((select timezone from public.businesses where id = p_business_id), 'America/Argentina/Buenos_Aires') as z
  ),
  hoy as (select (now() at time zone (select z from tz))::date as d),
  pagos as (
    select p.id,
           coalesce(p.client_id, a.client_id) as cid,
           nullif(lower(btrim(p.client_name)), '') as k,
           (p.created_at at time zone (select z from tz))::date as d,
           coalesce(p.total, p.amount, 0)::numeric as monto,
           f.solo_producto
    from public.payments p
    left join public.appointments a on a.id = p.appointment_id
    cross join lateral (
      select coalesce(
        jsonb_typeof(p.items) = 'array' and jsonb_array_length(p.items) > 0
        and not exists (select 1 from jsonb_array_elements(p.items) it where not coalesce((it ->> 'is_catalog')::boolean, false)),
        false) as solo_producto
    ) f
    where p.business_id = p_business_id
  ),
  -- dueño de cada pago: su cliente (directo o por el turno); sin cliente, todas las fichas con ese nombre
  dueno as (
    select pg.cid as client_id, pg.d, pg.monto, pg.solo_producto from pagos pg where pg.cid is not null
    union all
    select c.id, pg.d, pg.monto, pg.solo_producto
    from pagos pg
    join public.clients c on c.business_id = p_business_id and lower(btrim(c.full_name)) = pg.k
    where pg.cid is null and pg.k is not null
  ),
  dias as (
    -- solo cuentan los días con un servicio cobrado; la compra de solo producto no es una visita
    select o.client_id, o.d from dueno o group by o.client_id, o.d having bool_or(not o.solo_producto)
  ),
  g as (
    select client_id, d,
           d - lag(d) over (partition by client_id order by d) as gap,
           row_number() over (partition by client_id order by d desc) as rn_desc
    from dias
  ),
  r as (
    select client_id, count(*)::int as n, max(d) as ultima, min(d) as primera,
           percentile_cont(0.5) within group (order by gap) filter (where rn_desc <= 3 and gap is not null) as gap_reciente
    from g group by client_id
  ),
  gastos as (select o.client_id, sum(o.monto) as gasto from dueno o group by o.client_id),
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
           when r.n = 1 then case when t.por_venir or (select d from hoy) - r.primera < 30 then 'nuevo'
                                   when (select d from hoy) - r.primera >= 60 then 'perdido'
                                   else 'una_visita' end
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
         coalesce(r.n, 0),
         coalesce(gs.gasto, 0)
  from public.clients c
  join turno t on t.client_id = c.id
  left join r on r.client_id = c.id
  left join gastos gs on gs.client_id = c.id
  where c.business_id = p_business_id
    and not c.es_generico;
$$;


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
  v_todos as (
    select (p.created_at at time zone (select z from tz))::date as d,
           bool_or(not f.solo_producto) as con_servicio
    from public.payments p
    join c on p.business_id = c.business_id
    left join public.appointments a on a.id = p.appointment_id
    cross join lateral (
      select coalesce(
        jsonb_typeof(p.items) = 'array' and jsonb_array_length(p.items) > 0
        and not exists (select 1 from jsonb_array_elements(p.items) it where not coalesce((it ->> 'is_catalog')::boolean, false)),
        false) as solo_producto
    ) f
    where coalesce(p.client_id, a.client_id) = c.id
       or (coalesce(p.client_id, a.client_id) is null and lower(btrim(p.client_name)) = c.k)
    group by 1
  ),
  v as (
    select t.d from v_todos t where t.con_servicio
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
    -- visita 1: nuevo; a los 30 días sin volver pasa a una visita y a los 60 a perdido
    select d, 'nuevo', 'Primera visita' from gr where i = 1
    union all
    select d + 30, 'una_visita', 'Pasó el mes sin volver' from gr
      where i = 1 and (siguiente is null or siguiente >= d + 30) and d + 30 <= (select d from hoy)
    union all
    select d + 60, 'perdido', 'Pasaron 60 días sin volver' from gr
      where i = 1 and (siguiente is null or siguiente >= d + 60) and d + 60 <= (select d from hoy)
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
