-- payments no tenía ninguna columna que la vinculara a `clients` por ID: la
-- única relación era `client_name` (texto), comparado con `clients.full_name`
-- normalizado (lower/btrim) en clippr_clients_list/clippr_clients_segment_counts
-- y en el fetch de historial de la ficha (src/hooks/use-clients-data.ts). Eso
-- significa que un cliente con nombre repetido, un typo, o un nombre editado
-- después de cobrar podía perder o mezclar su historial de pagos sin que
-- ninguna FK lo detectara. `register-payment.ts` YA recibía `input.clientId`
-- en cada cobro (todos los llamadores de src/routes/cash-register.tsx ya lo
-- pasaban) pero nunca lo guardaba — el dato estaba disponible y se
-- descartaba. Esta migración agrega la columna, la completa para los pagos
-- ya existentes que hoy matchean por nombre (mismo criterio que ya usa el
-- sistema, no cambia ninguna atribución vigente) y hace que los RPC de
-- Clientes prioricen `client_id` cuando está presente, cayendo al match por
-- nombre solo para filas legacy que quedaron sin cliente asociado (ej.
-- "Cliente del mostrador", o un nombre que nunca matcheó ningún cliente).

alter table public.payments
  add column if not exists client_id uuid references public.clients(id) on delete set null;

create index if not exists payments_client_id_idx on public.payments(client_id);

-- Backfill best-effort: mismo criterio de matching (lower/btrim del nombre)
-- que ya usan los RPC hoy, así no se reatribuye nada distinto a lo que el
-- sistema ya consideraba "de este cliente" — solo lo deja explícito en una
-- FK real en vez de depender de comparar texto en cada consulta. Si dos
-- clientes del mismo negocio comparten nombre exacto, esta UPDATE puede
-- asociar el pago a cualquiera de los dos (misma ambigüedad que ya existe
-- hoy en el match por nombre); los pagos nuevos ya no tienen ese problema
-- porque se registran con el client_id real desde el momento del cobro.
update public.payments p
set client_id = c.id
from public.clients c
where p.client_id is null
  and p.client_name is not null
  and btrim(p.client_name) <> ''
  and c.business_id = p.business_id
  and lower(btrim(c.full_name)) = lower(btrim(p.client_name));

create or replace function public.clippr_clients_list(p_business_id uuid, p_search text DEFAULT ''::text, p_sort text DEFAULT 'nombre'::text, p_status text DEFAULT NULL::text, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
 returns table(id uuid, full_name text, phone text, email text, created_at timestamp with time zone, visits bigint, spent numeric, last_visit timestamp with time zone, last_visit_days integer, status text, vip_tag text, total_count bigint)
 language sql
 stable
as $function$
  with pay as (
    select
      -- client_id es la relación principal cuando está presente (pagos
      -- nuevos siempre lo tienen); el nombre normalizado es solo el
      -- fallback para pagos legacy sin cliente asociado.
      coalesce(client_id::text, lower(btrim(client_name))) as match_key,
      coalesce(total, amount, 0)::numeric as amount,
      created_at,
      (created_at at time zone 'UTC')::date as visit_day
    from public.payments
    where business_id = p_business_id
      and (
        client_id is not null
        or (client_name is not null and btrim(client_name) <> '')
      )
  ),
  per_client_pay as (
    select match_key,
           count(*)::bigint as visits,
           sum(amount)::numeric as spent,
           max(created_at) as last_visit
    from pay
    group by match_key
  ),
  days_distinct as (
    select distinct match_key, visit_day from pay
  ),
  gaps as (
    select match_key,
           row_number() over (partition by match_key order by visit_day) as rn,
           count(*) over (partition by match_key) as total_days,
           (visit_day - lag(visit_day) over (partition by match_key order by visit_day)) as gap_prev
    from days_distinct
  ),
  chains as (
    select match_key, rn, total_days,
           (gap_prev <= 15
            and lag(gap_prev) over (partition by match_key order by rn) <= 15
            and lag(gap_prev, 2) over (partition by match_key order by rn) <= 15) as chain4_end
    from gaps
  ),
  vip_calc as (
    select match_key,
           bool_or(coalesce(chain4_end, false)) as any4,
           bool_or(coalesce(chain4_end, false) and rn = total_days) as last4
    from chains
    group by match_key
  ),
  clients_filtered as (
    select id, full_name, phone, email, created_at, business_id,
           id::text as id_key,
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
      max(case when a.status = 'no_show' then a.starts_at end) as last_no_show_at
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
      af.last_no_show_at
    from clients_filtered cf
    left join per_client_pay pc on pc.match_key = cf.id_key or pc.match_key = cf.name_key
    left join vip_calc vc on vc.match_key = cf.id_key or vc.match_key = cf.name_key
    left join appt_flags af on af.client_id = cf.id
  ),
  computed as (
    select j.*,
      (case when j.last_visit is null then null
            else floor(extract(epoch from (now() - j.last_visit)) / 86400)::int end) as last_visit_days,
      (case when j.last_no_show_at is null then null
            else floor(extract(epoch from (now() - j.last_no_show_at)) / 86400)::int end) as days_since_no_show,
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
            when c.has_upcoming_active then 'nuevo'
            when c.days_since_no_show is null then 'nuevo'
            when c.days_since_no_show <= 45 then 'nuevo'
            when c.days_since_no_show < 60 then 'inactivo'
            else 'perdido'
          end
        when c.visits = 1 then
          case
            when c.has_upcoming_active then 'nuevo'
            when c.last_visit_days <= 45 then 'nuevo'
            when c.last_visit_days < 60 then 'inactivo'
            else 'perdido'
          end
        else
          case
            when c.vip_tag = 'vip' then 'vip'
            when c.has_upcoming_active then 'activo'
            when c.last_visit_days <= 45 then 'activo'
            when c.last_visit_days < 60 then 'inactivo'
            else 'perdido'
          end
      end) as status
    from computed c
  ),
  final as (
    select ws.*
    from with_status ws
    where p_status is null
       or ws.status = p_status
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

create or replace function public.clippr_clients_segment_counts(p_business_id uuid)
 returns table(status text, count bigint)
 language sql
 stable
as $function$
  with pay as (
    select
      coalesce(client_id::text, lower(btrim(client_name))) as match_key,
      created_at,
      (created_at at time zone 'UTC')::date as visit_day
    from public.payments
    where business_id = p_business_id
      and (
        client_id is not null
        or (client_name is not null and btrim(client_name) <> '')
      )
  ),
  per_client_pay as (
    select match_key,
           count(*)::bigint as visits,
           max(created_at) as last_visit
    from pay
    group by match_key
  ),
  days_distinct as (
    select distinct match_key, visit_day from pay
  ),
  gaps as (
    select match_key,
           row_number() over (partition by match_key order by visit_day) as rn,
           count(*) over (partition by match_key) as total_days,
           (visit_day - lag(visit_day) over (partition by match_key order by visit_day)) as gap_prev
    from days_distinct
  ),
  chains as (
    select match_key, rn, total_days,
           (gap_prev <= 15
            and lag(gap_prev) over (partition by match_key order by rn) <= 15
            and lag(gap_prev, 2) over (partition by match_key order by rn) <= 15) as chain4_end
    from gaps
  ),
  vip_calc as (
    select match_key,
           bool_or(coalesce(chain4_end, false) and rn = total_days) as last4
    from chains
    group by match_key
  ),
  appt_flags as (
    select
      c.id as client_id,
      bool_or(a.starts_at >= now() and a.status in ('pending', 'confirmed')) as has_upcoming_active,
      max(case when a.status = 'no_show' then a.starts_at end) as last_no_show_at
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
      af.last_no_show_at
    from public.clients c
    left join per_client_pay pc on pc.match_key = c.id::text or pc.match_key = lower(btrim(c.full_name))
    left join vip_calc vc on vc.match_key = c.id::text or vc.match_key = lower(btrim(c.full_name))
    left join appt_flags af on af.client_id = c.id
    where c.business_id = p_business_id
  ),
  computed as (
    select j.*,
      (case when j.last_visit is null then null
            else floor(extract(epoch from (now() - j.last_visit)) / 86400)::int end) as last_visit_days,
      (case when j.last_no_show_at is null then null
            else floor(extract(epoch from (now() - j.last_no_show_at)) / 86400)::int end) as days_since_no_show
    from joined j
  ),
  with_status as (
    select
      (case
        when c.visits = 0 then
          case
            when c.has_upcoming_active then 'nuevo'
            when c.days_since_no_show is null then 'nuevo'
            when c.days_since_no_show <= 45 then 'nuevo'
            when c.days_since_no_show < 60 then 'inactivo'
            else 'perdido'
          end
        when c.visits = 1 then
          case
            when c.has_upcoming_active then 'nuevo'
            when c.last_visit_days <= 45 then 'nuevo'
            when c.last_visit_days < 60 then 'inactivo'
            else 'perdido'
          end
        else
          case
            when c.last4 then 'vip'
            when c.has_upcoming_active then 'activo'
            when c.last_visit_days <= 45 then 'activo'
            when c.last_visit_days < 60 then 'inactivo'
            else 'perdido'
          end
      end) as status
    from computed c
  )
  select status, count(*)::bigint
  from with_status
  group by status;
$function$;
