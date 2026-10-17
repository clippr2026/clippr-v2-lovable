-- La nueva red de seguridad "avisar si llegan pagos/gastos atrasados de
-- una jornada en revisión" (CerrarDiaAnteriorCard, cash-register.tsx) se
-- suscribe a postgres_changes de payments Y expenses — payments ya estaba
-- en la publicación, expenses no, así que esa mitad del aviso nunca
-- hubiera disparado sin importar qué tan bien esté escrita la suscripción.
alter publication supabase_realtime add table expenses;
