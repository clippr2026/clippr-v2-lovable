-- Señas: perdonar las faltas de un cliente hasta una fecha.
--
-- La regla "pedir seña a quien faltó" contaba todas las faltas (turnos "No asistió") del cliente, para siempre. No había forma de
-- dejar pasar una falta puntual sin sacarle la regla a todos.
-- Cambio:
--   1. clients.faltas_perdonadas_hasta (fecha y hora, vacío por defecto): las faltas de turnos hasta ese momento no cuentan para
--      pedir seña. Si el cliente vuelve a faltar después, esa falta nueva sí cuenta y se le vuelve a pedir.
--   2. _deposit_requirement cuenta solo las faltas posteriores a esa fecha. El resto queda idéntico a la definición vigente.
-- La columna queda vacía para todos: no cambia nada hasta que se le carga una fecha a un cliente.
-- Cómo revertirlo: volver a aplicar 20261114170000_senas_reglas_por_cliente_ignorar_datos_falsos.sql y
--   alter table public.clients drop column faltas_perdonadas_hasta;

alter table public.clients add column if not exists faltas_perdonadas_hasta timestamptz;

CREATE OR REPLACE FUNCTION public._deposit_requirement(p_business_id uuid, p_service_ids uuid[], p_total numeric, p_client_phone text, p_client_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c jsonb := public._senas_config(p_business_id);
  v_rules jsonb := c -> 'rules';
  v_scope text := coalesce(c ->> 'scope', 'selected');
  v_in_scope boolean := false;
  v_trigger text := coalesce(c ->> 'trigger', 'always');
  -- Datos de relleno (correo sin "@", teléfono de menos de 8 números) no identifican a nadie: no se usan para juntar
  -- clientes distintos y contarles las faltas de otros.
  v_phone text := case when length(regexp_replace(coalesce(p_client_phone, ''), '\D', '', 'g')) >= 8 then regexp_replace(p_client_phone, '\D', '', 'g') else '' end;
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
  v_always boolean := false;
  v_rule_first boolean := false;
  v_rule_noshow boolean := false;
begin
  if not coalesce((c ->> 'enabled')::boolean, false) then
    return jsonb_build_object('required', false, 'reasons', '[]'::jsonb);
  end if;

  if v_rules is not null and jsonb_typeof(v_rules) = 'object' then
    -- ── Reglas por tipo de cliente ──
    v_rule_first := public._senas_rule_applies(v_rules -> 'first', p_service_ids);
    v_rule_noshow := public._senas_rule_applies(v_rules -> 'noshow', p_service_ids);

    if public._senas_rule_applies(v_rules -> 'all', p_service_ids) then
      v_required := true;
      v_reasons := array['siempre'];
    end if;

    if v_rule_first or v_rule_noshow then
      select coalesce(array_agg(cl.id), '{}') into v_client_ids
      from public.clients cl
      where cl.business_id = p_business_id
        and ( (v_email is not null and lower(coalesce(cl.email, '')) = v_email)
           or (v_phone <> '' and regexp_replace(coalesce(cl.phone, ''), '\D', '', 'g') = v_phone) );

      select count(*) filter (where a.status in ('done','completed','charged')),
             count(*) filter (where a.status = 'no_show'
                              and a.starts_at > coalesce(cl2.faltas_perdonadas_hasta, '-infinity'::timestamptz))
        into v_served, v_noshows
      from public.appointments a
      join public.clients cl2 on cl2.id = a.client_id
      where a.client_id = any(v_client_ids);

      if v_rule_first and v_served = 0 then
        v_required := true;
        v_reasons := array_append(v_reasons, 'primera_vez');
      end if;
      if v_rule_noshow
         and v_noshows >= greatest(1, coalesce(nullif(v_rules -> 'noshow' ->> 'min', '')::int, 1)) then
        v_required := true;
        v_reasons := array_append(v_reasons, 'faltas');
      end if;
    end if;
  else
    -- ── Configuración anterior (sin `rules`): igual que antes ──
    v_always := exists (
      select 1 from jsonb_array_elements_text(coalesce(c -> 'always_services', '[]'::jsonb)) s
      where s.value::uuid = any(coalesce(p_service_ids, '{}'))
    );

    if v_always then
      v_required := true;
      v_reasons := array['siempre'];
    else
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
               count(*) filter (where a.status = 'no_show'
                                and a.starts_at > coalesce(cl2.faltas_perdonadas_hasta, '-infinity'::timestamptz))
          into v_served, v_noshows
        from public.appointments a
        join public.clients cl2 on cl2.id = a.client_id
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
$function$;

revoke all on function public._deposit_requirement(uuid, uuid[], numeric, text, text) from public, anon, authenticated;
