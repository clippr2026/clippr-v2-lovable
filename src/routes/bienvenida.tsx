import * as React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Briefcase, Building2, Gift, KeyRound, Star, UserRound } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { StartShell } from "@/components/auth/start-shell";
import { AccountButton } from "@/components/auth/account-button";
import { ProfileWwwButton } from "@/components/auth/profile-www-button";
import { ProfessionalProfileForm } from "@/components/auth/professional-profile-form";
import { ProfessionalJoin } from "@/components/auth/professional-join";
import { ProfessionalResenas } from "@/components/auth/professional-resenas";
import { ProfessionalActividad } from "@/components/auth/professional-actividad";

export const Route = createFileRoute("/bienvenida")({
  head: () => ({ meta: [{ title: "Bienvenido — Clippr" }] }),
  component: BienvenidaPage,
});

// Pantalla de quien creó una cuenta de profesional o embajador y todavía no tiene negocio:
// para el profesional, el dueño de la barbería lo suma al equipo con este mismo correo.
function BienvenidaPage() {
  const { loading, session, businessId, user } = useAuth();
  const navigate = useNavigate();
  const tipo = (user?.user_metadata as { account_type?: string } | undefined)?.account_type;

  React.useEffect(() => {
    if (loading) return;
    if (!session) navigate({ to: "/login", replace: true });
    else if (businessId) navigate({ to: "/dashboard", replace: true });
  }, [loading, session, businessId, navigate]);

  const esEmbajador = tipo === "embajador";
  const dirtyRef = React.useRef(false);
  const onDirty = React.useCallback((d: boolean) => { dirtyRef.current = d; }, []);
  const [tab, setTab] = React.useState<"perfil" | "unirme" | "resenas" | "bolsa">("perfil");

  return (
    <StartShell
      header={
        <div className="-mx-5 -mt-6 flex items-center justify-between gap-3 border-b border-white/10 bg-black/70 px-4 py-3 backdrop-blur">
          <Link to="/" aria-label="Inicio" className="flex shrink-0 items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-full ring-1 ring-white/10">
              <img src="/clippr-logo-login.webp" alt="" className="h-8 w-8 object-contain" />
            </span>
            <span className="font-display text-xl font-medium">Clippr</span>
          </Link>
          <div className="flex items-center gap-2">
            {user && !esEmbajador && <ProfileWwwButton userId={user.id} />}
            <AccountButton />
          </div>
        </div>
      }
    >
      {esEmbajador ? (
        <>
          <div className="mx-auto grid h-20 w-20 place-items-center rounded-3xl bg-violet-500/20 text-violet-300 ring-1 ring-violet-300/25">
            <Gift className="h-10 w-10" />
          </div>
          <h1 className="mt-6 text-center font-display text-3xl font-bold">Tu cuenta está activa</h1>
          <p className="mt-3 text-center text-lg text-white/65">Muy pronto vas a poder recomendar Clippr y ganar recompensas.</p>
        </>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2 pb-1">
            {(
              [
                ["perfil", "Mi perfil", UserRound, "text-cyan-300"],
                ["unirme", "Unirme", KeyRound, "text-sky-300"],
                ["resenas", "Reseñas", Star, "text-amber-300"],
                ["bolsa", "Mi actividad", Building2, "text-violet-300"],
              ] as const
            ).map(([id, label, Icon, tint]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  if (tab === "perfil" && id !== "perfil" && dirtyRef.current && !window.confirm("Tenés cambios sin guardar en tu perfil. Si cambiás de pestaña, se pierden. ¿Salir igual?")) return;
                  setTab(id);
                }}
                className={`glass flex min-w-0 flex-col items-center gap-1.5 rounded-2xl px-1 py-4 transition-all ${
                  tab === id ? "bg-white/[0.04] shadow-[0_0_30px_-10px_var(--neon-blue)] ring-1 ring-primary/40" : "hover:bg-white/[0.04]"
                }`}
              >
                <Icon className={`h-5 w-5 ${tab === id ? tint : "text-muted-foreground"}`} />
                <span className={`max-w-full truncate text-[13px] font-medium ${tab === id ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
              </button>
            ))}
          </div>
          <div className="mt-6">
            {user && tab === "perfil" && (
              <ProfessionalProfileForm onDirtyChange={onDirty} userId={user.id} defaultName={(user.user_metadata as { full_name?: string } | undefined)?.full_name ?? ""} />
            )}
            {tab === "unirme" && <ProfessionalJoin />}
            {tab === "resenas" && <ProfessionalResenas />}
            {tab === "bolsa" && <ProfessionalActividad />}
          </div>
        </>
      )}

    </StartShell>
  );
}
