-- Se ejecuta UNA vez, después de aplicar la migración y de crear el usuario en
-- Supabase → Authentication → Add user (con la contraseña que elija el dueño, correo confirmado).
-- Reemplazar CORREO_DEL_DUENO. Falla si ese usuario ya tiene un local o es parte de un equipo.
do $$
declare v_uid uuid;
begin
  select id into v_uid from auth.users where lower(email) = lower('CORREO_DEL_DUENO') and email_confirmed_at is not null;
  if v_uid is null then raise exception 'No hay un usuario confirmado con ese correo'; end if;
  if exists (select 1 from public.businesses where owner_id = v_uid)
     or exists (select 1 from public.team_members where auth_user_id = v_uid) then
    raise exception 'Esa cuenta ya pertenece a un local: usar una cuenta aparte';
  end if;
  insert into public.plataforma_admins (user_id) values (v_uid) on conflict do nothing;
end $$;
