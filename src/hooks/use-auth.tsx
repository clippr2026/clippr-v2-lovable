import * as React from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, type Profile } from "@/integrations/supabase/client";


export type PermKey =
  | "dashboard" | "agenda" | "caja" | "profesionales" | "clientes"
  | "configuracion" | "branding" | "horarios" | "equipo" | "servicios"
  | "catalogo" | "config_caja" | "senas" | "plan";

const ALL_TRUE_PERMS: Record<PermKey, boolean> = {
  dashboard: true, agenda: true, caja: true, profesionales: true, clientes: true,
  configuracion: true, branding: true, horarios: true, equipo: true, servicios: true,
  catalogo: true, config_caja: true, senas: true, plan: true,
};

export const ROLE_DEFAULTS: Record<string, Record<PermKey, boolean>> = {
  admin_general: { ...ALL_TRUE_PERMS },
  socio: { ...ALL_TRUE_PERMS },
  admin_local: { ...ALL_TRUE_PERMS, dashboard: false, profesionales: false, branding: false, plan: false },
  recepcionista: {
    ...ALL_TRUE_PERMS, dashboard: false, profesionales: false, configuracion: false,
    branding: false, horarios: false, equipo: false, servicios: false, catalogo: false,
    config_caja: false, senas: false, plan: false,
  },
  profesional: {
    ...ALL_TRUE_PERMS, dashboard: false, agenda: false, caja: false, profesionales: true,
    clientes: false, configuracion: false, branding: false, horarios: false, equipo: false,
    servicios: false, catalogo: false, config_caja: false, senas: false, plan: false,
  },
  owner: { ...ALL_TRUE_PERMS },
};

export function getPermissions(role: string | null | undefined, rolePermissions: Record<string, Record<string, boolean>> | null): Record<PermKey, boolean> {
  const key = role ?? "owner";
  const custom = rolePermissions?.[key];
  const defaults = ROLE_DEFAULTS[key] ?? ROLE_DEFAULTS.owner;
  return { ...defaults, ...(custom ?? {}) } as Record<PermKey, boolean>;
}

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
async function resolveBusinessId(user: User): Promise<{ businessId: string | null; profile: Profile }> {
  const uid = user.id;
  const email = user.email ?? null;

  let profile: Profile | null = null;
  try {
    const { data } = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
    profile = data as Profile | null;
  } catch (e) {
    console.warn("[AUTH] profile fetch:", (e as Error).message);
  }

  let bizId: string | null = profile?.business_id ?? null;

  if (!bizId) {
    const searches: Array<{ col: string; val: string | null }> = [
      { col: "owner_id", val: uid },
      { col: "owner_email", val: email },
      { col: "user_id", val: uid },
    ];
    for (const s of searches) {
      if (bizId || !s.val) continue;
      try {
        const { data } = await supabase.from("businesses").select("id").eq(s.col, s.val).maybeSingle();
        if (data?.id) bizId = data.id;
      } catch {
        /* columna puede no existir */
      }
    }
  }

  if (!bizId) {
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
      profile?.full_name ||
      (meta.full_name as string | undefined) ||
      email?.split("@")[0] ||
      "Usuario",
    role: profile?.role || (meta.role as string | undefined) || "owner",
    email,
    business_id: bizId,
  };

  if (bizId) {
    try {
      await supabase.from("profiles").upsert(profileData, { onConflict: "id" });
    } catch (e) {
      console.warn("[AUTH] profile upsert:", (e as Error).message);
    }
  }

  return { businessId: bizId, profile: profileData };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<Session | null>(null);
  const [profile, setProfile] = React.useState<Profile | null>(null);
  const [businessId, setBusinessId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [rolePermissions, setRolePermissions] = React.useState<Record<string, Record<string, boolean>> | null>(null);

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
        const { businessId: biz, profile: prof } = await resolveBusinessId(s.user);
        setBusinessId(biz);
        setProfile(prof);
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
        setLoading(false);
        return;
      }
      // Actualizar refresh token guardado cuando Supabase lo renueva automáticamente
      if (s?.refresh_token && localStorage.getItem("clippr_remember_login") === "1") {
        localStorage.setItem("clippr_refresh_token", s.refresh_token);
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
    () => getPermissions(profile?.role, rolePermissions),
    [profile?.role, rolePermissions]
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
