-- Habilita realtime para attendance_confirmations — mismo motivo que
-- work_sessions (20261029020000): el Panel del profesional y Caja >
-- Liquidaciones necesitan enterarse de una confirmación/corrección de
-- presentismo hecha desde otro dispositivo sin que alguien recargue la
-- página. Ver src/hooks/use-professionals-data.ts (useProfPresentismo).
alter publication supabase_realtime add table attendance_confirmations;
