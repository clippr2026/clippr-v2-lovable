-- Permisos de tabla para la bolsa de trabajo.
--
-- Las tablas nuevas de "public" no reciben automáticamente permisos de lectura/escritura para el rol
-- "authenticated" en este proyecto (el privilegio por defecto solo trae TRUNCATE/REFERENCES/TRIGGER/
-- MAINTAIN). Sin esto, aunque las policies de RLS estén bien, cualquier lectura o escritura desde la app
-- falla con "permission denied". Las policies de RLS de cada tabla siguen mandando: este GRANT solo
-- habilita que se evalúen. "anon" (sin sesión) no recibe nada.
--
-- Reversión: revoke select, insert, update, delete on ... from authenticated;

grant select, insert, update, delete on public.professional_profiles to authenticated;
grant select, insert, update, delete on public.professional_private to authenticated;
grant select, insert, update, delete on public.job_postings to authenticated;
