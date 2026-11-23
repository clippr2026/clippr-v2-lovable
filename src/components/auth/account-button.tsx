import * as React from "react";
import { Link } from "@tanstack/react-router";
import { LayoutDashboard, LogOut, UserRound } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

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
  if (loading) return <span className="h-11 w-11" />;

  if (!session) {
    return (
      <div className="flex items-center gap-2">
        <Link to="/login" className="inline-flex h-10 items-center rounded-full bg-white/[0.06] px-4 text-[15px] font-semibold text-white/85 ring-1 ring-white/10">
          Iniciar sesión
        </Link>
        <Link to="/empezar" className="inline-flex h-10 items-center rounded-full bg-gradient-to-r from-sky-400 to-violet-500 px-4 text-[15px] font-semibold text-white">
          Registrarse
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
        className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-sky-400 to-violet-500 text-lg font-bold text-white ring-2 ring-violet-300/40"
      >
        {(name[0] || "A").toUpperCase()}
      </button>
      {open && (
        <>
          <button type="button" aria-label="Cerrar" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-14 z-50 w-72 rounded-2xl border border-white/10 bg-[#0d0b18] p-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky-400 to-violet-500 text-lg font-bold text-white">{(name[0] || "A").toUpperCase()}</span>
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
