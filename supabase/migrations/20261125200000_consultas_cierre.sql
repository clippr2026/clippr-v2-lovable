-- Cierre de consultas: quién la cerró (asesor, cliente o automático), cierre por parte del cliente
-- al borrar su chat, y cierre automático cuando el asesor contestó y nadie escribió en 12 horas.
-- Solo agrega una columna y funciones; no borra datos.
-- Reversión: supabase/manual/consultas_cierre_revertir.sql

alter table public.soporte_consultas
  add column cerrada_por text check (cerrada_por in ('asesor', 'cliente', 'automatico'));

-- Sin tarea programada: se aplica cada vez que alguien mira o usa las consultas. La hora de cierre
-- queda en las 12 horas cumplidas, no en el momento en que alguien miró.
create function public.soporte_cerrar_vencidas()
returns void language sql security definer set search_path = public as $$
  update public.soporte_consultas
     set estado = 'cerrada', cerrada_por = 'automatico', actualizada_en = actualizada_en + interval '12 hours'
   where estado = 'respondida' and actualizada_en <= now() - interval '12 hours'
$$;
-- De uso interno: no se llama desde la app.
revoke all on function public.soporte_cerrar_vencidas() from public, anon, authenticated;

-- El cliente cierra su consulta sin cerrar (al borrar la conversación).
create function public.soporte_cerrar_mia()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sin_sesion'; end if;
  perform public.soporte_cerrar_vencidas();
  update public.soporte_consultas set estado = 'cerrada', cerrada_por = 'cliente', actualizada_en = now(), leida_usuario_en = clock_timestamp()
   where user_id = auth.uid() and estado <> 'cerrada';
end $$;
revoke all on function public.soporte_cerrar_mia() from public, anon, authenticated;
grant execute on function public.soporte_cerrar_mia() to authenticated;

create or replace function public.soporte_cerrar(p_consulta uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es_dueno_clippr() then raise exception 'sin_permiso'; end if;
  perform public.soporte_cerrar_vencidas();
  update public.soporte_consultas set estado = 'cerrada', cerrada_por = 'asesor', actualizada_en = now()
   where id = p_consulta and estado <> 'cerrada';
end $$;

-- Pasa a poder escribir (antes era de solo lectura) para cerrar las vencidas antes de contestar.
create or replace function public.soporte_mi_consulta()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.soporte_cerrar_vencidas();
  return (
    select jsonb_build_object(
      'id', c.id,
      'estado', c.estado,
      'sin_leer', (select count(*) from public.soporte_mensajes s
                     where s.consulta_id = c.id and s.autor = 'asesor' and s.creado_en > c.leida_usuario_en),
      'respuestas', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'texto', s.texto) order by s.id)
                     from public.soporte_mensajes s where s.consulta_id = c.id and s.autor = 'asesor'), '[]'::jsonb)
    )
    from public.soporte_consultas c
    where c.user_id = auth.uid()
    order by c.creada_en desc
    limit 1
  );
end $$;

create or replace function public.soporte_bandeja()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.es_dueno_clippr() then raise exception 'sin_permiso'; end if;
  perform public.soporte_cerrar_vencidas();
  return coalesce((
    select jsonb_agg(f.fila order by f.cerrada, f.respondida, f.actualizada_en desc)
    from (
      select c.estado = 'cerrada' as cerrada, c.estado = 'respondida' as respondida, c.actualizada_en,
        jsonb_build_object(
          'id', c.id, 'estado', c.estado, 'cerrada_por', c.cerrada_por,
          'negocio', c.negocio_nombre, 'usuario', c.usuario_nombre,
          'email', c.usuario_email, 'pantalla', c.pantalla, 'actualizada_en', c.actualizada_en,
          'ultimo', (select left(s.texto, 140) from public.soporte_mensajes s
                       where s.consulta_id = c.id and s.autor <> 'clippi' order by s.id desc limit 1)
        ) as fila
      from public.soporte_consultas c
      order by (c.estado = 'cerrada'), c.actualizada_en desc
      limit 200
    ) f
  ), '[]'::jsonb);
end $$;

-- Pedir un asesor o escribirle después de las 12 horas no revive una consulta vencida.
create or replace function public.soporte_pedir_asesor(p_mensajes jsonb, p_pantalla text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_local uuid;
  v_id uuid;
  m jsonb;
begin
  if v_uid is null then raise exception 'sin_sesion'; end if;
  v_local := public.soporte_mi_local();
  if v_local is null then raise exception 'sin_permiso'; end if;
  if p_mensajes is null or jsonb_typeof(p_mensajes) <> 'array' or jsonb_array_length(p_mensajes) not between 1 and 20 then
    raise exception 'mensajes_invalidos';
  end if;
  -- Evita que dos toques seguidos creen dos consultas.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  perform public.soporte_cerrar_vencidas();

  select id into v_id from public.soporte_consultas where user_id = v_uid and estado <> 'cerrada';
  if v_id is not null then
    update public.soporte_consultas set estado = 'abierta', actualizada_en = now() where id = v_id;
    return v_id;
  end if;

  if (select count(*) from public.soporte_consultas where user_id = v_uid and creada_en > now() - interval '1 day') >= 5 then
    raise exception 'limite_diario';
  end if;

  insert into public.soporte_consultas (user_id, business_id, negocio_nombre, usuario_nombre, usuario_email, pantalla)
  values (
    v_uid, v_local,
    coalesce((select name from public.businesses where id = v_local), ''),
    coalesce((select full_name from public.profiles where id = v_uid), ''),
    coalesce((select email from auth.users where id = v_uid), ''),
    left(coalesce(p_pantalla, ''), 100)
  ) returning id into v_id;

  for m in select value from jsonb_array_elements(p_mensajes) loop
    if length(btrim(coalesce(m->>'texto', ''))) > 0 then
      -- Desde la app nunca se puede escribir como asesor.
      insert into public.soporte_mensajes (consulta_id, autor, texto)
      values (v_id, case when m->>'autor' = 'clippi' then 'clippi' else 'usuario' end, left(btrim(m->>'texto'), 2000));
    end if;
  end loop;
  return v_id;
end $$;

create or replace function public.soporte_escribir(p_consulta uuid, p_texto text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if length(btrim(coalesce(p_texto, ''))) = 0 then raise exception 'mensaje_vacio'; end if;
  perform public.soporte_cerrar_vencidas();
  perform 1 from public.soporte_consultas
    where id = p_consulta and user_id = auth.uid() and estado <> 'cerrada' for update;
  if not found then raise exception 'consulta_cerrada'; end if;
  if (select count(*) from public.soporte_mensajes s join public.soporte_consultas c on c.id = s.consulta_id
        where c.user_id = auth.uid() and s.autor = 'usuario' and s.creado_en > now() - interval '1 hour') >= 60 then
    raise exception 'limite_mensajes';
  end if;
  insert into public.soporte_mensajes (consulta_id, autor, texto) values (p_consulta, 'usuario', left(btrim(p_texto), 2000));
  update public.soporte_consultas set estado = 'abierta', actualizada_en = now() where id = p_consulta;
end $$;
