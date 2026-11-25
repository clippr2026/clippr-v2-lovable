-- Consultas a un asesor desde Clippi y rol de dueño de la plataforma Clippr.
-- Las tablas no se leen ni se escriben directamente: todo pasa por estas funciones, que
-- comprueban quién es la persona. Solo agrega objetos nuevos; no modifica datos existentes.
-- Reversión: supabase/manual/consultas_clippr_revertir.sql

create table public.plataforma_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  creado_en timestamptz not null default now()
);

create table public.soporte_consultas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  negocio_nombre text not null default '',
  usuario_nombre text not null default '',
  usuario_email text not null default '',
  pantalla text not null default '',
  estado text not null default 'abierta' check (estado in ('abierta', 'respondida', 'cerrada')),
  creada_en timestamptz not null default now(),
  actualizada_en timestamptz not null default now(),
  leida_usuario_en timestamptz not null default now()
);
create index soporte_consultas_usuario on public.soporte_consultas (user_id, actualizada_en desc);
create index soporte_consultas_estado on public.soporte_consultas (estado, actualizada_en desc);
-- Una sola consulta sin cerrar por persona.
create unique index soporte_consultas_una_abierta on public.soporte_consultas (user_id) where estado <> 'cerrada';

create table public.soporte_mensajes (
  id bigint generated always as identity primary key,
  consulta_id uuid not null references public.soporte_consultas(id) on delete cascade,
  autor text not null check (autor in ('usuario', 'clippi', 'asesor')),
  texto text not null check (char_length(texto) between 1 and 2000),
  creado_en timestamptz not null default clock_timestamp()
);
create index soporte_mensajes_consulta on public.soporte_mensajes (consulta_id, id);

alter table public.plataforma_admins enable row level security;
alter table public.soporte_consultas enable row level security;
alter table public.soporte_mensajes enable row level security;
revoke all on public.plataforma_admins, public.soporte_consultas, public.soporte_mensajes from public, anon, authenticated;

create function public.es_dueno_clippr()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.plataforma_admins where user_id = auth.uid())
$$;

-- Local desde el que consulta: solo el dueño o un administrador general vigente.
create function public.soporte_mi_local()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select b.id from public.businesses b where b.owner_id = auth.uid() order by b.id limit 1),
    (select t.business_id from public.team_members t
      where t.auth_user_id = auth.uid() and t.role = 'admin_general'
        and lower(coalesce(t.status, 'active')) not in ('suspended', 'deleted', 'removed', 'inactive', 'blocked')
      limit 1)
  )
$$;

-- Crea la consulta (o suma a la que ya está abierta) con la conversación previa con Clippi.
create function public.soporte_pedir_asesor(p_mensajes jsonb, p_pantalla text default '')
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

create function public.soporte_escribir(p_consulta uuid, p_texto text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if length(btrim(coalesce(p_texto, ''))) = 0 then raise exception 'mensaje_vacio'; end if;
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

-- La última consulta propia, con las respuestas del asesor.
create function public.soporte_mi_consulta()
returns jsonb language sql stable security definer set search_path = public as $$
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
  order by c.actualizada_en desc
  limit 1
$$;

create function public.soporte_marcar_leida(p_consulta uuid)
returns void language sql security definer set search_path = public as $$
  update public.soporte_consultas set leida_usuario_en = clock_timestamp() where id = p_consulta and user_id = auth.uid()
$$;

-- ───── Solo el dueño de Clippr ─────
create function public.soporte_bandeja()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_dueno_clippr() then raise exception 'sin_permiso'; end if;
  return coalesce((
    select jsonb_agg(f.fila order by f.cerrada, f.respondida, f.actualizada_en desc)
    from (
      select c.estado = 'cerrada' as cerrada, c.estado = 'respondida' as respondida, c.actualizada_en,
        jsonb_build_object(
          'id', c.id, 'estado', c.estado, 'negocio', c.negocio_nombre, 'usuario', c.usuario_nombre,
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

create function public.soporte_mensajes_de(p_consulta uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_dueno_clippr() then raise exception 'sin_permiso'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'autor', autor, 'texto', texto, 'creado_en', creado_en) order by id)
    from public.soporte_mensajes where consulta_id = p_consulta), '[]'::jsonb);
end $$;

create function public.soporte_responder(p_consulta uuid, p_texto text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es_dueno_clippr() then raise exception 'sin_permiso'; end if;
  if length(btrim(coalesce(p_texto, ''))) = 0 then raise exception 'mensaje_vacio'; end if;
  update public.soporte_consultas set estado = 'respondida', actualizada_en = now()
    where id = p_consulta and estado <> 'cerrada';
  if not found then raise exception 'consulta_cerrada'; end if;
  insert into public.soporte_mensajes (consulta_id, autor, texto) values (p_consulta, 'asesor', left(btrim(p_texto), 2000));
end $$;

create function public.soporte_cerrar(p_consulta uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es_dueno_clippr() then raise exception 'sin_permiso'; end if;
  update public.soporte_consultas set estado = 'cerrada', actualizada_en = now() where id = p_consulta;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'es_dueno_clippr()', 'soporte_mi_local()', 'soporte_pedir_asesor(jsonb, text)', 'soporte_escribir(uuid, text)',
    'soporte_mi_consulta()', 'soporte_marcar_leida(uuid)', 'soporte_bandeja()', 'soporte_mensajes_de(uuid)',
    'soporte_responder(uuid, text)', 'soporte_cerrar(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  -- soporte_mi_local es de uso interno: no se llama desde la app.
  foreach f in array array[
    'es_dueno_clippr()', 'soporte_pedir_asesor(jsonb, text)', 'soporte_escribir(uuid, text)',
    'soporte_mi_consulta()', 'soporte_marcar_leida(uuid)', 'soporte_bandeja()', 'soporte_mensajes_de(uuid)',
    'soporte_responder(uuid, text)', 'soporte_cerrar(uuid)'
  ] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
