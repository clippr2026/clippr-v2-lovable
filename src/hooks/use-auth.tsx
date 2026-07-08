import * as React from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, type Profile } from "@/integrations/supabase/client";


export type PermKey =
  | "dashboard" | "agenda" | "caja" | "profesionales" | "clientes"
  | "configuracion" | "branding" | "horarios" | "equipo" | "servicios"
  | "catalogo" | "config_caja" | "senas" | "plan" | "asesor_ia";

const ALL_TRUE_PERMS: Record<PermKey, boolean> = {
  dashboard: true, agenda: true, caja: true, profesionales: true, clientes: true,
  configuracion: true, branding: true, horarios: true, equipo: true, servicios: true,
  catalogo: true, config_caja: true, senas: true, plan: true, asesor_ia: true,
};

export const ROLE_DEFAULTS: Record<string, Record<PermKey, boolean>> = {
  admin_general: { ...ALL_TRUE_PERMS },
  socio: { ...ALL_TRUE_PERMS, plan: false },
  admin_local: { ...ALL_TRUE_PERMS, plan: false, asesor_ia: false },
  recepcionista: {
    ...ALL_TRUE_PERMS, dashboard: false, profesionales: false, configuracion: false,
    branding: false, horarios: false, equipo: false, servicios: false, catalogo: false,
    config_caja: false, senas: false, plan: false, asesor_ia: false,
  },
  profesional: {
    ...ALL_TRUE_PERMS, dashboard: false, agenda: false, caja: false, profesionales: true,
    clientes: false, configuracion: false, branding: false, horarios: false, equipo: false,
    servicios: false, catalogo: false, config_caja: false, senas: false, plan: false,
    asesor_ia: false,
  },
  owner: { ...ALL_TRUE_PERMS },
};

export function getPermissions(role: string | null | undefined, rolePermissions: Record<string, Record<string, boolean>> | null): Record<PermKey, boolean> {
  const key = role ?? "owner";
  const custom = rolePermissions?.[key];
  const defaults = ROLE_DEFAULTS[key] ?? ROLE_DEFAULTS.owner;
  return { ...defaults, ...(custom ?? {}) } as Record<PermKey, boolean>;
}

// El form de Configuración guarda permisos con sus propias claves. Acá las
// traducimos a las PermKey que usa el guard de rutas (usePermGuard).
const TEAM_PERM_MAP: Record<PermKey, string> = {
  dashboard: "dashboard",
  agenda: "agenda",
  caja: "caja_cobro",
  profesionales: "panel_profesionales",
  clientes: "clientes",
  configuracion: "configuracion",
  branding: "branding",
  horarios: "horarios",
  equipo: "equipo",
  servicios: "servicios",
  catalogo: "catalogo",
  config_caja: "caja",
  senas: "senas",
  plan: "plan_facturacion",
  asesor_ia: "asesor_ia",
};

const ALL_PERM_KEYS = Object.keys(TEAM_PERM_MAP) as PermKey[];

function mapTeamPermissions(perms: Record<string, boolean> | null | undefined): Record<PermKey, boolean> {
  const source = perms ?? {};
  return ALL_PERM_KEYS.reduce((acc, key) => {
    acc[key] = source[TEAM_PERM_MAP[key]] === true;
    return acc;
  }, {} as Record<PermKey, boolean>);
}

const ALL_FALSE_PERMS: Record<PermKey, boolean> = ALL_PERM_KEYS.reduce(
  (acc, key) => { acc[key] = false; return acc; },
  {} as Record<PermKey, boolean>,
);

// Estados de team_member que NO otorgan acceso (acceso revocado o inactivo).
// Un miembro en cualquiera de estos estados se trata como SIN negocio.
const REVOKED_STATUSES = new Set(["suspended", "deleted", "removed", "inactive", "blocked"]);

type AuthState = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  businessId: string | null;
  signIn: (email: string, password: string, remember?: boolean) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  permissions: Record<PermKey, boolean>;
  rolePermissions: Record<string, Record<string, boolean>> | null;
  reloadRolePermissions: () => Promise<void>;
};

const AuthCtx = React.createContext<AuthState | undefined>(undefined);

/**
 * Portado de resolveBusinessId() de app.js (líneas 6623-6697).
 * 1) busca profile by id → 2) busca business por owner_id/owner_email/user_id
 * → 3) si no existe, crea uno → 4) upsert profile con business_id.
 */
async function resolveBusinessId(user: User): Promise<{ businessId: string | null; profile: Profile; teamPermissions: Record<PermKey, boolean> | null }> {
  const uid = user.id;
  const email = user.email ?? null;

  let profile: Profile | null = null;
  try {
    const { data } = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
    profile = data as Profile | null;
  } catch (e) {
    console.warn("[AUTH] profile fetch:", (e as Error).message);
  }

  // ¿Este usuario es un miembro del equipo invitado? Si lo es, hereda el negocio
  // del que lo invitó y NO debemos crearle un negocio nuevo.
  type TeamMemberRow = {
    id: string;
    email: string | null;
    role: string | null;
    permissions: Record<string, boolean> | null;
    status: string | null;
    business_id: string | null;
    full_name: string | null;
    professional_id: string | null;
  };
  const TM_COLS = "id, email, role, permissions, status, business_id, full_name, professional_id";
  let teamMember: TeamMemberRow | null = null;
  try {
    // 1) Por auth_user_id (enlace ya realizado en un login anterior).
    const { data: byUid } = await supabase
      .from("team_members")
      .select(TM_COLS)
      .eq("auth_user_id", uid)
      .maybeSingle();
    teamMember = (byUid as TeamMemberRow | null) ?? null;

    // 2) Fallback por email. Cubre al invitado cuyo auth_user_id todavía no fue
    //    enlazado: aún no completó set-password, el RPC accept_team_invitation
    //    falló, o entró directo por la pantalla de login. Sin este fallback el
    //    usuario cae en la rama "crear negocio" y ve un negocio vacío fantasma.
    if (!teamMember && email) {
      const { data: byEmail } = await supabase
        .from("team_members")
        .select(TM_COLS)
        .ilike("email", email)
        .order("created_at", { ascending: true })
        .limit(1);
      const row = (byEmail?.[0] as TeamMemberRow | undefined) ?? null;
      if (row) {
        teamMember = row;
        const rowRevoked = REVOKED_STATUSES.has(String(row.status ?? "active").toLowerCase());
        // Self-heal idempotente SOLO si el acceso sigue vigente. Un acceso
        // revocado (eliminado/suspendido) NUNCA debe re-enlazarse a este auth uid.
        if (!rowRevoked) {
          try {
            await supabase.from("team_members").update({ auth_user_id: uid }).eq("id", row.id);
          } catch (e) {
            console.warn("[AUTH] team_member self-link:", (e as Error).message);
          }
        }
      }
    }

    console.log(
      "[link] auth.uid:", uid,
      "| team_member:", teamMember
        ? JSON.stringify({ role: teamMember.role, status: teamMember.status, professional_id: teamMember.professional_id, business_id: teamMember.business_id })
        : null,
    );
  } catch (e) {
    console.warn("[AUTH] team_member fetch:", (e as Error).message);
  }

  // ── Resolución del negocio ────────────────────────────────────────────────
  // ¿El miembro está vigente? Un acceso revocado (eliminado/suspendido) no da
  // negocio aunque la fila tombstone siga existiendo.
  const memberActive =
    !!teamMember && !REVOKED_STATUSES.has(String(teamMember.status ?? "active").toLowerCase());

  // ¿El usuario es DUEÑO de un negocio? Independiente del profile/tombstone, para
  // que un dueño nunca quede bloqueado. Solo se busca si no es miembro activo.
  let ownedBizId: string | null = null;
  if (!memberActive) {
    const searches: Array<{ col: string; val: string | null }> = [
      { col: "owner_id", val: uid },
      { col: "owner_email", val: email },
      { col: "user_id", val: uid },
    ];
    for (const s of searches) {
      if (ownedBizId || !s.val) continue;
      try {
        const { data } = await supabase.from("businesses").select("id").eq(s.col, s.val).maybeSingle();
        if (data?.id) ownedBizId = data.id;
      } catch {
        /* columna puede no existir */
      }
    }
  }

  // Prioridad: miembro activo → su negocio; si no, dueño → su negocio; si no → null.
  // NUNCA usamos profile.business_id como fuente: eso es lo que "revivía" accesos
  // ya eliminados y los dejaba pegados a un negocio.
  let bizId: string | null = memberActive ? teamMember!.business_id : (ownedBizId ?? null);

  // Crear negocio SOLO para un dueño nuevo genuino: nunca fue invitado (no hay
  // fila en team_members, ni siquiera tombstone) y no posee negocio. Así un
  // acceso eliminado no genera un "negocio fantasma" al volver a entrar.
  if (!bizId && !teamMember && !ownedBizId) {
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const bizName =
      (meta.business_name as string | undefined) || email?.split("@")[0] || "Mi Negocio";
    try {
      const { data, error } = await supabase
        .from("businesses")
        .insert({ name: bizName, owner_id: uid, owner_email: email })
        .select("id")
        .single();
      if (error) throw error;
      bizId = data.id;
    } catch {
      try {
        const { data } = await supabase
          .from("businesses")
          .insert({ name: bizName })
          .select("id")
          .single();
        bizId = data?.id ?? null;
      } catch (e) {
        console.error("[AUTH] business create failed:", (e as Error).message);
      }
    }
  }

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const profileData: Profile = {
    id: uid,
    full_name:
      teamMember?.full_name ||
      profile?.full_name ||
      (meta.full_name as string | undefined) ||
      email?.split("@")[0] ||
      "Usuario",
    role: teamMember?.role || profile?.role || (meta.role as string | undefined) || "owner",
    email,
    business_id: bizId,
    employee_id: teamMember?.professional_id ?? profile?.employee_id ?? null,
  };

  // Permisos reales del usuario: si es team_member, salen de su fila.
  // Revocado/suspendido → sin permisos. Dueño (sin team_member) → null (defaults de rol).
  let teamPermissions: Record<PermKey, boolean> | null = null;
  if (teamMember) {
    teamPermissions = !memberActive
      ? { ...ALL_FALSE_PERMS }
      : mapTeamPermissions(teamMember.permissions);
  }

  // Persistimos el profile SIEMPRE (incluso con bizId null): así un acceso
  // revocado queda DESVINCULADO del negocio en la base (business_id = null) y no
  // "revive" en el próximo login.
  try {
    await supabase.from("profiles").upsert(profileData, { onConflict: "id" });
  } catch (e) {
    console.warn("[AUTH] profile upsert:", (e as Error).message);
  }

  return { businessId: bizId, profile: profileData, teamPermissions };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<Session | null>(null);
  const [profile, setProfile] = React.useState<Profile | null>(null);
  const [businessId, setBusinessId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [rolePermissions, setRolePermissions] = React.useState<Record<string, Record<string, boolean>> | null>(null);
  const [teamPermissions, setTeamPermissions] = React.useState<Record<PermKey, boolean> | null>(null);

  // Ref con la sesión actual, siempre al día (a diferencia del `session` de
  // useState, que quedaría "congelado" dentro del closure de
  // onAuthStateChange de abajo, ya que ese efecto se suscribe una sola vez).
  const sessionRef = React.useRef<Session | null>(null);
  React.useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const reloadRolePermissions = React.useCallback(async () => {
    if (!businessId) return;
    const { data } = await supabase
      .from("business_settings")
      .select("role_permissions")
      .eq("business_id", businessId)
      .maybeSingle();
    setRolePermissions((data?.role_permissions as Record<string, Record<string, boolean>> | null) ?? null);
  }, [businessId]);

  React.useEffect(() => {
    const handler = () => { void reloadRolePermissions(); };
    window.addEventListener("clippr:role-permissions-updated", handler);
    return () => window.removeEventListener("clippr:role-permissions-updated", handler);
  }, [reloadRolePermissions]);

  const hydrate = React.useCallback(async (s: Session | null) => {
    setSession(s);
    if (s?.user) {
      try {
        const { businessId: biz, profile: prof, teamPermissions: tp } = await resolveBusinessId(s.user);
        setBusinessId(biz);
        setProfile(prof);
        setTeamPermissions(tp);
        // Load role_permissions from business_settings
        if (biz) {
          supabase.from("business_settings").select("role_permissions").eq("business_id", biz).maybeSingle()
            .then(({ data }) => { if (data?.role_permissions) setRolePermissions(data.role_permissions as Record<string,Record<string,boolean>>); });
        }
      } catch (e) {
        console.error("[AUTH] hydrate:", (e as Error).message);
      }
    } else {
      setBusinessId(null);
      setProfile(null);
      setRolePermissions(null);
      setTeamPermissions(null);
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    let mounted = true;

    async function init() {
      // 1. Intentar sesión activa de Supabase
      const { data } = await supabase.auth.getSession();

      if (data.session) {
        if (mounted) hydrate(data.session);
        return;
      }

      // 2. Si no hay sesión activa pero el usuario marcó "Recordarme",
      //    intentar renovar con el refresh token guardado
      const savedRefreshToken = localStorage.getItem("clippr_refresh_token");
      const rememberActive = localStorage.getItem("clippr_remember_login") === "1";

      if (rememberActive && savedRefreshToken) {
        try {
          const { data: refreshData, error } = await supabase.auth.refreshSession({
            refresh_token: savedRefreshToken,
          });
          if (!error && refreshData.session) {
            // Actualizar el refresh token guardado
            localStorage.setItem("clippr_refresh_token", refreshData.session.refresh_token ?? "");
            if (mounted) hydrate(refreshData.session);
            return;
          }
        } catch {
          // Refresh token inválido, limpiar
          localStorage.removeItem("clippr_refresh_token");
          localStorage.removeItem("clippr_remember_login");
          localStorage.removeItem("clippr_remember_email");
        }
      }

      if (mounted) hydrate(null);
    }

    void init();

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (!mounted) return;
      if (event === "SIGNED_OUT") {
        setSession(null);
        setProfile(null);
        setBusinessId(null);
        setTeamPermissions(null);
        setLoading(false);
        return;
      }
      // Actualizar refresh token guardado cuando Supabase lo renueva automáticamente
      if (s?.refresh_token && localStorage.getItem("clippr_remember_login") === "1") {
        localStorage.setItem("clippr_refresh_token", s.refresh_token);
      }

      // Supabase dispara TOKEN_REFRESHED/SIGNED_IN cada vez que la pestaña
      // vuelve a primer plano en mobile (autoRefreshToken revisa la sesión al
      // recuperar visibilidad — típico al bloquear/desbloquear el teléfono o
      // cambiar de app y volver). Si ya teníamos hidratado a este MISMO
      // usuario, no hace falta repetir todo resolveBusinessId (varias
      // consultas a Supabase) ni reemplazar businessId/profile por objetos
      // nuevos: eso disparaba un refetch en cascada en Dashboard/Agenda/Caja
      // cada vez que se volvía a la app, sintiéndose como una recarga
      // involuntaria. Alcanza con refrescar la sesión (por el token nuevo).
      if (s?.user && s.user.id === sessionRef.current?.user?.id) {
        setSession(s);
        return;
      }

      hydrate(s);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [hydrate]);

  const signIn = React.useCallback(async (email: string, password: string, remember = false) => {
    const cleanEmail = email.trim();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

    if (!error && data.session) {
      if (remember) {
        localStorage.setItem("clippr_remember_login", "1");
        localStorage.setItem("clippr_remember_email", cleanEmail);
        // Guardar refresh token para restaurar sesión aunque el browser se cierre
        localStorage.setItem("clippr_refresh_token", data.session.refresh_token ?? "");
      } else {
        localStorage.removeItem("clippr_remember_login");
        localStorage.removeItem("clippr_remember_email");
        localStorage.removeItem("clippr_refresh_token");
      }

      await hydrate(data.session);
    }

    return { error: error?.message ?? null };
  }, [hydrate]);

  const signOut = React.useCallback(async () => {
    localStorage.removeItem("clippr_remember_login");
    localStorage.removeItem("clippr_remember_email");
    localStorage.removeItem("clippr_refresh_token");
    await supabase.auth.signOut();
  }, []);

  const permissions = React.useMemo(
    // Si el usuario es un team_member, sus permisos reales mandan.
    // Si no (dueño), se usan los defaults por rol.
    () => teamPermissions ?? getPermissions(profile?.role, rolePermissions),
    [teamPermissions, profile?.role, rolePermissions]
  );

  const value: AuthState = {
    loading,
    session,
    user: session?.user ?? null,
    profile,
    businessId,
    signIn,
    signOut,
    permissions,
    rolePermissions,
    reloadRolePermissions,
  };

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = React.useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
