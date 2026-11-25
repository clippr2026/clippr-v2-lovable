-- Quita todo lo que agrega 20261125120000_consultas_clippr.sql. Borra las consultas guardadas.
-- No toca ninguna tabla anterior. Publicar antes la versión de la app sin Consultas.
begin;
drop function if exists public.soporte_cerrar(uuid);
drop function if exists public.soporte_responder(uuid, text);
drop function if exists public.soporte_mensajes_de(uuid);
drop function if exists public.soporte_bandeja();
drop function if exists public.soporte_marcar_leida(uuid);
drop function if exists public.soporte_mi_consulta();
drop function if exists public.soporte_escribir(uuid, text);
drop function if exists public.soporte_pedir_asesor(jsonb, text);
drop function if exists public.soporte_mi_local();
drop function if exists public.es_dueno_clippr();
drop table if exists public.soporte_mensajes;
drop table if exists public.soporte_consultas;
drop table if exists public.plataforma_admins;
commit;
