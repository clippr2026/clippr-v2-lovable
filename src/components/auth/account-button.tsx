import * as React from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, LayoutDashboard, LogOut, UserRound } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

const ROLE_LABEL: Record<string, string> = {
  owner: "Dueño",
  admin_general: "Admin. General",
  admin_local: "Admin local",
  socio: "Socio",
  recepcionista: "Recepcionista",
  profesional: "Profesional",
};

// Arriba a la derecha: con sesión muestra el perfil (avatar con menú); sin sesión, "Iniciar sesión" y "Registrarse".
export function AccountButton() {
  const { session, user, profile, businessId, signOut, loading } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [photo, setPhoto] = React.useState<string | null>(null);
  const userId = user?.id ?? null;
  const employeeId = (profile as { employee_id?: string | null } | null)?.employee_id ?? null;

  // Foto de la cuenta: la del perfil de barbero vinculado y, si no hay, la del perfil profesional.
  React.useEffect(() => {
    let cancelled = false;
    setPhoto(null);
    if (!userId) return;
    void (async () => {
      let url: string | null = null;
      if (employeeId) {
        const { data } = await supabase.from("employees").select("avatar_url").eq("id", employeeId).maybeSingle();
        url = (data as { avatar_url?: string | null } | null)?.avatar_url ?? null;
      }
      if (!url) {
        const { data } = await (supabase as any).from("professional_profiles").select("avatar_url").eq("user_id", userId).maybeSingle();
        url = (data as { avatar_url?: string | null } | null)?.avatar_url ?? null;
      }
      if (!cancelled) setPhoto(url || null);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, employeeId]);

  if (loading) return <span className="h-11 w-11" />;

  if (!session) {
    return (
      <div className="flex items-center gap-3">
        <Link to="/login" search={{ volver: "/bolsa-de-trabajo" } as never} className="whitespace-nowrap text-[15px] font-medium text-white/65 transition hover:text-white">
          Iniciar sesión
        </Link>
        <Link
          to="/empezar"
          className="group inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2.5 text-[15px] font-semibold text-white transition hover:brightness-110"
          style={{ background: "linear-gradient(135deg, oklch(0.62 0.24 292), oklch(0.46 0.24 296))", boxShadow: "0 10px 30px -10px oklch(0.55 0.26 292 / 0.65)" }}
        >
          Registrarse
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    );
  }

  const meta = (user?.user_metadata ?? {}) as { full_name?: string; account_type?: string };
  const name = profile?.full_name || meta.full_name || user?.email?.split("@")[0] || "Mi cuenta";
  const role = businessId ? ROLE_LABEL[profile?.role ?? "owner"] ?? "Equipo" : meta.account_type === "embajador" ? "Embajador" : "Profesional";
  const panelTo = businessId ? "/dashboard" : "/bienvenida";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Mi cuenta"
        aria-expanded={open}
        className="grid h-11 w-11 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-sky-400 to-violet-500 text-lg font-bold text-white ring-2 ring-violet-300/40"
      >
        {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : (name[0] || "A").toUpperCase()}
      </button>
      {open && (
        <>
          <button type="button" aria-label="Cerrar" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-14 z-50 w-72 rounded-2xl border border-white/10 bg-[#0d0b18] p-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-sky-400 to-violet-500 text-lg font-bold text-white">
                {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : (name[0] || "A").toUpperCase()}
              </span>
              <div className="min-w-0">
                <div className="truncate text-lg font-semibold">{name}</div>
                <div className="truncate text-sm text-white/60">{user?.email}</div>
                <span className="mt-1 inline-flex rounded-full bg-white/[0.06] px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-white/70 ring-1 ring-white/10">{role}</span>
              </div>
            </div>
            <div className="mt-3 border-t border-white/10 pt-2">
              <Link to={panelTo} className="flex h-12 items-center gap-3 rounded-xl px-2 text-base font-semibold text-white/90">
                {businessId ? <LayoutDashboard className="h-5 w-5 text-violet-300" /> : <UserRound className="h-5 w-5 text-violet-300" />}
                {businessId ? "Ir a mi panel" : "Mi perfil"}
              </Link>
              <button type="button" onClick={() => void signOut().then(() => setOpen(false))} className="flex h-12 w-full items-center gap-3 rounded-xl px-2 text-left text-base font-semibold text-red-400">
                <LogOut className="h-5 w-5" />
                Cerrar sesión
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
