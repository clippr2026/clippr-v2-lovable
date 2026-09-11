-- Cooldown server-side para el reenvío de invitaciones de equipo (admin
-- desde Equipo, y self-service desde /set-password cuando el link venció) —
-- ver supabase/functions/invite-team-member (acción "resend") y
-- supabase/functions/request-invite-resend. Columna puramente aditiva, sin
-- default especial: null = nunca se (re)envió una invitación con cooldown
-- registrado.
ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS last_invited_at timestamptz;
