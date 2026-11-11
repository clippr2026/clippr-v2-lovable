-- ============================================================================
-- Señas: reglas por tipo de cliente, cada una con sus servicios
-- ============================================================================
-- Nueva forma de senas_config (clave `rules`):
--   rules.all     { enabled, all_services, services[] }          → a cualquier cliente
--   rules.first   { enabled, all_services, services[] }          → clientes que vienen por primera vez
--   rules.noshow  { enabled, min, all_services, services[] }     → clientes que faltaron `min` veces o más
-- Se pide seña si ALGUNA regla activada aplica: el cliente cumple la condición y alguno de los
-- servicios de la reserva está en la lista de la regla (o la regla vale para todos los servicios).
-- Una reserva mixta pide seña si cualquiera de sus servicios activa una regla.
--
-- Compatibilidad: si la configuración NO tiene `rules` (la de hoy), se evalúa exactamente igual que
-- antes (scope + trigger + always_services). No modifica filas ni configuraciones existentes.
--
-- Cómo revertirlo: volver a crear public._deposit_requirement con la definición de
-- 20261111040000_senas_servicios_siempre.sql y borrar public._senas_rule_applies.
-- ============================================================================

-- ¿La regla aplica a los servicios de la reserva? (activada y, o vale para todos, o hay uno de la lista)
create or replace function public._senas_rule_applies(p_rule jsonb, p_service_ids uuid[])
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select coalesce((p_rule ->> 'enabled')::boolean, false)
     and (
       coalesce((p_rule ->> 'all_services')::boolean, false)
       or exists (
         select 1 from jsonb_array_elements_text(coalesce(p_rule -> 'services', '[]'::jsonb)) s
         where s.value::uuid = any(coalesce(p_service_ids, '{}'))
       )
     );
$$;

revoke all on function public._senas_rule_applies(jsonb, uuid[]) from public, anon, authenticated;

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
  v_phone text := regexp_replace(coalesce(p_client_phone, ''), '\D', '', 'g');
  v_email text := nullif(lower(trim(coalesce(p_client_email, ''))), '');
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
