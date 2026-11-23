-- Señas por faltas: no juntar clientes distintos por datos de relleno.
--
-- Problema: la regla "si ya faltó, pide seña" cruza clientes por correo o teléfono. Hay clientes cargados con
-- correo "." (y teléfono "." o "H"); todos esos quedaban como "la misma persona", así que si UNO faltó, a todos
-- los demás con correo "." se les pedía seña. Caso real: Sebastian H (0 faltas propias) recibió seña de $10.950.
--
-- Cambio: solo se usa el correo si tiene "@" y el teléfono si tiene 8 dígitos o más. No toca datos existentes;
-- solo reemplaza la función que decide si corresponde pedir seña.
-- Cómo revertirlo: volver a aplicar la definición de public._deposit_requirement de 20261108220000_senas_sistema.sql.

create or replace function public._deposit_requirement(
  p_business_id uuid,
  p_service_ids uuid[],
  p_total numeric,
  p_client_phone text,
  p_client_email text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  c jsonb := public._senas_config(p_business_id);
  v_scope text := coalesce(c ->> 'scope', 'selected');
  v_in_scope boolean := false;
  v_trigger text := coalesce(c ->> 'trigger', 'always');
  v_phone text := case when length(regexp_replace(coalesce(p_client_phone, ''), '\D', '', 'g')) >= 8 then regexp_replace(p_client_phone, '\D', '', 'g') else '' end;
  -- Un correo sin "@" (por ejemplo ".") o un teléfono corto/sin dígitos (por ejemplo "H") son datos de relleno, no
  -- identifican a nadie: no se usan para juntar clientes distintos y contarles las faltas de otros.
  v_email text := case when position('@' in coalesce(p_client_email, '')) > 1 then nullif(lower(trim(p_client_email)), '') end;
  v_client_ids uuid[];
  v_served int := 0;
  v_noshows int := 0;
  v_reasons text[] := '{}';
  v_required boolean := false;
  v_amount numeric := 0;
  v_type text := coalesce(c ->> 'amount_type', 'percent');
  v_value numeric := coalesce(nullif(c ->> 'amount_value', '')::numeric, 0);
  v_min_ns int := coalesce(nullif(c ->> 'no_show_min', '')::int, 0);
begin
  if not coalesce((c ->> 'enabled')::boolean, false) then
    return jsonb_build_object('required', false, 'reasons', '[]'::jsonb);
  end if;

  if v_scope = 'all' then
    v_in_scope := true;
  else
    v_in_scope := exists (
      select 1 from jsonb_array_elements_text(coalesce(c -> 'services', '[]'::jsonb)) s
      where s.value::uuid = any(coalesce(p_service_ids, '{}'))
    );
  end if;

  if not v_in_scope then
    return jsonb_build_object('required', false, 'reasons', '[]'::jsonb);
  end if;

  if v_trigger = 'always' then
    v_required := true;
    v_reasons := array['siempre'];
  else
    select coalesce(array_agg(cl.id), '{}') into v_client_ids
    from public.clients cl
    where cl.business_id = p_business_id
      and ( (v_email is not null and lower(coalesce(cl.email, '')) = v_email)
         or (v_phone <> '' and regexp_replace(coalesce(cl.phone, ''), '\D', '', 'g') = v_phone) );

    select count(*) filter (where a.status in ('done','completed','charged')),
           count(*) filter (where a.status = 'no_show')
      into v_served, v_noshows
    from public.appointments a
    where a.client_id = any(v_client_ids);

    if coalesce((c ->> 'first_time')::boolean, false) and v_served = 0 then
      v_required := true;
      v_reasons := array_append(v_reasons, 'primera_vez');
    end if;
    if v_min_ns > 0 and v_noshows >= v_min_ns then
      v_required := true;
      v_reasons := array_append(v_reasons, 'faltas');
    end if;
  end if;

  if not v_required then
    return jsonb_build_object('required', false, 'reasons', '[]'::jsonb);
  end if;

  v_amount := case v_type
    when 'full' then coalesce(p_total, 0)
    when 'fixed' then least(v_value, coalesce(p_total, 0))
    else round(coalesce(p_total, 0) * least(v_value, 100) / 100)
  end;

  return jsonb_build_object('required', v_amount > 0, 'amount', v_amount, 'reasons', to_jsonb(v_reasons));
end;
$$;

revoke all on function public._deposit_requirement(uuid, uuid[], numeric, text, text) from public, anon, authenticated;
