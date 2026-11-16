-- Clientes: ficha genérica "Sin agendar" para las ventas de personas que no se agendaron.
--
-- Hasta ahora, para cobrar a alguien sin cargarle datos, la caja usaba fichas comodín ("sin turno", "cliente st") que juntaban las
-- ventas de muchas personas distintas y mostraban un cliente con un monto inflado y varios barberos.
-- Cambio:
--   1. clients.es_generico (falso por defecto): marca una ficha como genérica.
--   2. clippr_clientes_grupos_v1 (la base de los grupos de Clientes) deja afuera las fichas genéricas: no entran en los grupos,
--      los conteos ni los historiales. Sus ventas y turnos siguen existiendo y contando en la caja y en lo que cobra cada barbero.
-- Esta migración no toca datos: la ficha genérica se arma aparte. Cómo revertirlo: volver a aplicar la función de
-- 20261115130000_clientes_pagos_por_cliente_del_turno.sql y alter table public.clients drop column es_generico;

alter table public.clients add column if not exists es_generico boolean not null default false;

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
         coalesce(r.n, 0),
         coalesce(gs.gasto, 0)
  from public.clients c
  join turno t on t.client_id = c.id
  left join r on r.client_id = c.id
  left join gastos gs on gs.client_id = c.id
  where c.business_id = p_business_id
    and not c.es_generico;
$$;

revoke all on function public.clippr_clientes_grupos_v1(uuid) from public, anon;
grant execute on function public.clippr_clientes_grupos_v1(uuid) to authenticated, service_role;
