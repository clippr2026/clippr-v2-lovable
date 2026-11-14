-- Señas: no juntar clientes distintos por datos de relleno (sobre la definición vigente "reglas por cliente").
--
-- Problema original: la regla "si ya faltó, pide seña" cruza clientes por correo o teléfono. Clientes cargados con
-- correo "." (y teléfono "." o "H") quedaban como la misma persona: si uno faltó, a todos se les pedía seña.
--
-- IMPORTANTE: esta migración REEMPLAZA a 20261114140000_senas_faltas_ignorar_datos_falsos.sql, que se había armado sobre
-- una definición vieja (anterior a 20261111050000_senas_reglas_por_cliente.sql) y dejó sin efecto las reglas por cliente
-- y por servicio. Esta parte toma la definición vigente y solo cambia cómo se leen el teléfono y el correo.
-- No toca datos. Cómo revertirlo: volver a crear public._deposit_requirement con la definición de
-- 20261111050000_senas_reglas_por_cliente.sql.

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
             count(*) filter (where a.status = 'no_show')
        into v_served, v_noshows
      from public.appointments a
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
