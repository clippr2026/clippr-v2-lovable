-- Plazos de cancelación y reprogramación del cliente: 3 horas por defecto (antes 2) cuando la
-- sucursal no los configuró en Configuración → Horarios. Solo reemplaza la función; no toca datos.

create or replace function public._booking_limits(p_business_id uuid, p_branch_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'minCancel', coalesce(nullif(s ->> 'minCancel', '')::numeric, 3),
    'minReschedule', coalesce(nullif(s ->> 'minReschedule', '')::numeric, 3),
    'minAdvance', coalesce(nullif(s ->> 'minAdvance', '')::numeric, 60),
    'maxAdvance', coalesce(nullif(s ->> 'maxAdvance', '')::numeric, 30)
  )
  from (
    select (
      select bs.schedule -> '_settings'
      from public.branch_settings bs
      where bs.business_id = p_business_id
        and bs.branch_id is not distinct from p_branch_id
      limit 1
    ) as s
  ) q;
$$;
