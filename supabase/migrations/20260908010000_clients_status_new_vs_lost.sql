-- Corrige la clasificación de clientes (Nuevo/Activo/Inactivo/Perdido/VIP).
--
-- Antes: un cliente con 0 visitas (0 pagos) nunca podía ser "nuevo" salvo que
-- su primer pago cayera en el mes calendario actual; si todavía no había
-- pagado nada (por ejemplo: sacó su primer turno pero todavía no llegó la
-- fecha), `last_visit is null` lo mandaba directo a "perdido".
--
-- Ahora: un cliente con 0 visitas es "nuevo" salvo que su primera
-- oportunidad de asistir ya haya pasado y haya quedado marcada como
-- `no_show`, y no tenga un turno futuro `pending`/`confirmed` en danza (en
-- cuyo caso sigue "nuevo" hasta que ese turno se resuelva). Un cliente con
-- historial (visits >= 1) que caería en "perdido" por los 76+ días sin
-- volver, pero ya sacó un turno futuro activo, se muestra como "activo"
-- hasta que ese turno se resuelva (si termina en no_show, vuelve a
-- "perdido"; si se completa, se reclasifica por su actividad real).
--
-- Esta es la única lógica de clasificación de clientes de todo Clippr:
-- ambas RPC la comparten y el frontend (src/hooks/use-clients-data.ts) solo
-- lee `status`/`vip_tag`/`visits`/`spent` de acá, nunca los recalcula.

CREATE OR REPLACE FUNCTION public.clippr_clients_list(p_business_id uuid, p_search text DEFAULT ''::text, p_sort text DEFAULT 'nombre'::text, p_status text DEFAULT NULL::text, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, full_name text, phone text, email text, created_at timestamp with time zone, visits bigint, spent numeric, last_visit timestamp with time zone, last_visit_days integer, status text, vip_tag text, total_count bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with pay as (
    select
      lower(btrim(client_name)) as name_key,
      coalesce(total, amount, 0)::numeric as amount,
      created_at,
      (created_at at time zone 'UTC')::date as visit_day
    from public.payments
    where business_id = p_business_id
      and client_name is not null
      and btrim(client_name) <> ''
  ),
  per_client_pay as (
    select name_key,
           count(*)::bigint as visits,
           sum(amount)::numeric as spent,
           max(created_at) as last_visit
    from pay
    group by name_key
  ),
  days_distinct as (
    select distinct name_key, visit_day from pay
  ),
  gaps as (
    select name_key,
           row_number() over (partition by name_key order by visit_day) as rn,
           count(*) over (partition by name_key) as total_days,
           (visit_day - lag(visit_day) over (partition by name_key order by visit_day)) as gap_prev
    from days_distinct
  ),
  chains as (
    select name_key, rn, total_days,
           (gap_prev <= 15
            and lag(gap_prev) over (partition by name_key order by rn) <= 15
            and lag(gap_prev, 2) over (partition by name_key order by rn) <= 15) as chain4_end
    from gaps
  ),
  vip_calc as (
    select name_key,
           bool_or(coalesce(chain4_end, false)) as any4,
           bool_or(coalesce(chain4_end, false) and rn = total_days) as last4
    from chains
    group by name_key
  ),
  clients_filtered as (
    select id, full_name, phone, email, created_at, business_id,
           lower(btrim(full_name)) as name_key
    from public.clients
    where business_id = p_business_id
      and (
        coalesce(p_search, '') = ''
        or full_name ilike '%' || p_search || '%'
        or phone     ilike '%' || p_search || '%'
        or email     ilike '%' || p_search || '%'
      )
  ),
  appt_flags as (
    select
      cf.id as client_id,
      bool_or(a.starts_at >= now() and a.status in ('pending', 'confirmed')) as has_upcoming_active,
      bool_or(a.status = 'no_show') as has_no_show
    from clients_filtered cf
    join public.appointments a
      on a.business_id = cf.business_id
     and (
          a.client_id = cf.id
          or (a.client_id is null and lower(btrim(a.client_name)) = cf.name_key)
         )
    group by cf.id
  ),
  joined as (
    select
      cf.id, cf.full_name, cf.phone, cf.email, cf.created_at,
      coalesce(pc.visits, 0)::bigint as visits,
      coalesce(pc.spent, 0)::numeric as spent,
      pc.last_visit,
      coalesce(vc.last4, false) as last4,
      coalesce(vc.any4, false) as any4,
      coalesce(af.has_upcoming_active, false) as has_upcoming_active,
      coalesce(af.has_no_show, false) as has_no_show
    from clients_filtered cf
    left join per_client_pay pc on pc.name_key = cf.name_key
    left join vip_calc vc on vc.name_key = cf.name_key
    left join appt_flags af on af.client_id = cf.id
  ),
  computed as (
    select j.*,
      (case when j.last_visit is null then null
            else floor(extract(epoch from (now() - j.last_visit)) / 86400)::int end) as last_visit_days,
      (case when j.last4 then 'vip'
            when j.any4  then 'ex_vip'
            else null end) as vip_tag
    from joined j
  ),
  with_status as (
    select c.*,
      (case
        when c.visits = 0 then
          case
            when c.has_no_show and not c.has_upcoming_active then 'perdido'
            else 'nuevo'
          end
        when c.vip_tag = 'vip' then 'vip'
        when c.last_visit_days <= 45 then 'activo'
        when c.last_visit_days < 76 then 'inactivo'
        when c.has_upcoming_active then 'activo'
        else 'perdido'
      end) as status
    from computed c
  ),
  final as (
    select * from with_status
    where p_status is null or status = p_status
  )
  select
    id, full_name, phone, email, created_at, visits, spent, last_visit,
    last_visit_days, status, vip_tag,
    count(*) over () as total_count
  from final
  order by
    case when p_sort = 'gasto'     then spent end desc nulls last,
    case when p_sort = 'recientes' then created_at end desc nulls last,
    case when p_sort = 'nombre'    then lower(full_name) end asc nulls last,
    lower(full_name) asc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
$function$;

CREATE OR REPLACE FUNCTION public.clippr_clients_segment_counts(p_business_id uuid)
 RETURNS TABLE(status text, count bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with pay as (
    select
      lower(btrim(client_name)) as name_key,
      created_at,
      (created_at at time zone 'UTC')::date as visit_day
    from public.payments
    where business_id = p_business_id
      and client_name is not null
      and btrim(client_name) <> ''
  ),
  per_client_pay as (
    select name_key,
           count(*)::bigint as visits,
           max(created_at) as last_visit
    from pay
    group by name_key
  ),
  days_distinct as (
    select distinct name_key, visit_day from pay
  ),
  gaps as (
    select name_key,
           row_number() over (partition by name_key order by visit_day) as rn,
           count(*) over (partition by name_key) as total_days,
           (visit_day - lag(visit_day) over (partition by name_key order by visit_day)) as gap_prev
    from days_distinct
  ),
  chains as (
    select name_key, rn, total_days,
           (gap_prev <= 15
            and lag(gap_prev) over (partition by name_key order by rn) <= 15
            and lag(gap_prev, 2) over (partition by name_key order by rn) <= 15) as chain4_end
    from gaps
  ),
  vip_calc as (
    select name_key,
           bool_or(coalesce(chain4_end, false) and rn = total_days) as last4
    from chains
    group by name_key
  ),
  appt_flags as (
    select
      c.id as client_id,
      bool_or(a.starts_at >= now() and a.status in ('pending', 'confirmed')) as has_upcoming_active,
      bool_or(a.status = 'no_show') as has_no_show
    from public.clients c
    join public.appointments a
      on a.business_id = c.business_id
     and (
          a.client_id = c.id
          or (a.client_id is null and lower(btrim(a.client_name)) = lower(btrim(c.full_name)))
         )
    where c.business_id = p_business_id
    group by c.id
  ),
  joined as (
    select
      c.id,
      coalesce(pc.visits, 0)::bigint as visits,
      pc.last_visit,
      coalesce(vc.last4, false) as last4,
      coalesce(af.has_upcoming_active, false) as has_upcoming_active,
      coalesce(af.has_no_show, false) as has_no_show
    from public.clients c
    left join per_client_pay pc on pc.name_key = lower(btrim(c.full_name))
    left join vip_calc vc on vc.name_key = lower(btrim(c.full_name))
    left join appt_flags af on af.client_id = c.id
    where c.business_id = p_business_id
  ),
  with_status as (
    select
      (case
        when j.visits = 0 then
          case
            when j.has_no_show and not j.has_upcoming_active then 'perdido'
            else 'nuevo'
          end
        when j.last4 then 'vip'
        when floor(extract(epoch from (now() - j.last_visit)) / 86400)::int <= 45 then 'activo'
        when floor(extract(epoch from (now() - j.last_visit)) / 86400)::int < 76 then 'inactivo'
        when j.has_upcoming_active then 'activo'
        else 'perdido'
      end) as status
    from joined j
  )
  select status, count(*)::bigint
  from with_status
  group by status;
$function$;
