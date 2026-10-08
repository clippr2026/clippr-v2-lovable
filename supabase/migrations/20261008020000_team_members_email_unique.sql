-- ============================================================================
-- Un email = un único acceso por negocio (team_members)
-- ============================================================================
-- Bug real: Equipo → Accesos → Editar acceso podía "actualizar" el email de
-- un acceso a uno que ya pertenecía a OTRO acceso del mismo negocio (ej. una
-- invitación pendiente) sin ningún rechazo — el UPDATE del edge function
-- invite-team-member ni siquiera tocaba la columna email, así que no había
-- forma de que colisionara. Ya se corrigió esa función para validar antes
-- de actualizar (ver invite-team-member/index.ts), pero esa validación sola
-- no cierra una carrera real (dos ediciones casi simultáneas). Este índice
-- es el backstop: Postgres rechaza el segundo UPDATE/INSERT aunque el
-- chequeo de aplicación no haya alcanzado a verlo.
--
-- Parcial (where status not in (...)): un acceso suspendido/eliminado no
-- bloquea su email — ya no está vigente, el email queda libre para
-- reasignarse a otro acceso. Mismo criterio exacto que ya usa la rama
-- "create" de invite-team-member para decidir reactivar vs rechazar.
--
-- Si esta migración falla al crearse, es señal de que YA existe un
-- duplicado real en los datos (dos accesos activos/invitados con el mismo
-- email en el mismo negocio) — hay que resolverlo a mano antes de poder
-- aplicar el índice.
-- ============================================================================

create unique index if not exists team_members_business_email_unique
  on public.team_members (business_id, lower(email))
  where status not in ('deleted', 'removed', 'suspended', 'inactive');
