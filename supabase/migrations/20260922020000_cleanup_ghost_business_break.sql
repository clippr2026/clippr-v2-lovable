-- horarios-section.tsx (Configuración → Horarios, el horario general del
-- NEGOCIO) pisaba breakStart/breakEnd a un valor fijo "12:00"/"13:00" en
-- CADA guardado — sin ninguna UI que muestre o permita editar ese campo a
-- otro valor. resolveDaySchedule unía ese descanso "fantasma" del negocio
-- con el descanso propio de cada profesional (Configuración → Equipo →
-- Horarios), así que cambiar el descanso de un profesional (ej. de
-- 12:00-13:00 a 13:00-14:00) dejaba los DOS bloques visibles en la Agenda:
-- el nuevo del profesional Y el viejo heredado del negocio.
--
-- El código ya se corrigió (deja de escribir ese valor, y
-- resolveDaySchedule ya no une el descanso del negocio con el del
-- profesional — el del profesional manda solo). Esta migración limpia el
-- dato fantasma que ya quedó guardado en producción: para CUALQUIER
-- negocio, si el horario semanal general (schedule.mon/tue/.../sun, NO
-- _employeeSchedules ni _employeeSpecialDates de ningún profesional) tiene
-- EXACTAMENTE breakStart="12:00" y breakEnd="13:00", se lo quita. Ese valor
-- puntual no puede ser una configuración real de ningún negocio: nunca
-- existió una pantalla donde alguien pudiera haberlo elegido ni haberlo
-- visto — es 100% el efecto del bug. No se toca el descanso propio de
-- ningún profesional (_employeeSchedules/_employeeSpecialDates): ese sí es
-- editable por el usuario desde siempre y puede ser una configuración real
-- y deliberada, así que no se borra a ciegas.

do $$
declare
  r record;
  keys text[] := array['mon','tue','wed','thu','fri','sat','sun'];
  k text;
  updated jsonb;
  day jsonb;
begin
  for r in
    select business_id, schedule
    from public.business_settings
    where schedule is not null
  loop
    updated := r.schedule;
    foreach k in array keys loop
      day := updated -> k;
      if day is not null
         and jsonb_typeof(day) = 'object'
         and (day ->> 'breakStart') = '12:00'
         and (day ->> 'breakEnd') = '13:00'
      then
        updated := jsonb_set(updated, array[k], (day - 'breakStart') - 'breakEnd');
      end if;
    end loop;

    if updated is distinct from r.schedule then
      update public.business_settings
        set schedule = updated
        where business_id = r.business_id;
    end if;
  end loop;
end $$;
