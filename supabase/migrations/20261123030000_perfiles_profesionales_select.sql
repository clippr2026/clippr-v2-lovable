-- Arreglo de la subida de fotos del perfil del profesional (20261123010000).
--
-- La API de Storage inserta con RETURNING, y en Postgres un INSERT ... RETURNING exige también una
-- policy de SELECT: sin ella la subida falla con "new row violates row-level security policy".
-- Se agrega solo la lectura del bucket "perfiles-profesionales", que ya es público (cualquiera con el
-- link puede ver las fotos), así que no se abre nada nuevo. No toca ninguna otra tabla ni dato.
--
-- Reversión: drop policy "perfiles_profesionales_select" on storage.objects;

create policy "perfiles_profesionales_select"
  on storage.objects for select to authenticated
  using (bucket_id = 'perfiles-profesionales');
