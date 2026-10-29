-- Habilita realtime para work_sessions — Inicio (tarjeta "Fichaje de
-- jornada") y el panel admin de un profesional necesitan enterarse de un
-- fichaje hecho desde OTRO dispositivo (kiosco, panel del propio
-- profesional) sin que alguien recargue la página. Ver
-- src/components/dashboard/use-fichaje-hoy.ts — mismo patrón de
-- suscripción ya usado para commission_records en use-professionals-data.ts.
alter publication supabase_realtime add table work_sessions;
