import * as React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Briefcase, Building2, Gift, KeyRound, Star, UserRound } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { StartShell } from "@/components/auth/start-shell";
import { AccountButton } from "@/components/auth/account-button";
import { ProfessionalProfileForm } from "@/components/auth/professional-profile-form";
import { ProfessionalJoin } from "@/components/auth/professional-join";
import { ProfessionalResenas } from "@/components/auth/professional-resenas";
import { ProfessionalBolsa } from "@/components/auth/professional-bolsa";

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
  const [tab, setTab] = React.useState<"perfil" | "unirme" | "resenas" | "bolsa">("perfil");

  return (
    <StartShell
      header={
        <div className="flex items-center justify-between gap-3">
          <Link to="/" aria-label="Inicio" className="flex shrink-0 items-center gap-2">
            <img src="/clippr-logo-login.webp" alt="" className="h-11 w-11 shrink-0 object-contain" />
            <span className="font-display text-2xl font-medium">Clippr</span>
          </Link>
          <AccountButton />
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
          <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {(
              [
                ["perfil", "Mi perfil", UserRound],
                ["unirme", "Unirme", KeyRound],
                ["resenas", "Reseñas", Star],
                ["bolsa", "Mi bolsa", Building2],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-4 text-base font-semibold transition ${
                  tab === id ? "bg-gradient-to-r from-sky-400 to-violet-500 text-white" : "bg-white/[0.06] text-white/65"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
          <div className="mt-6">
            {user && tab === "perfil" && (
              <ProfessionalProfileForm userId={user.id} defaultName={(user.user_metadata as { full_name?: string } | undefined)?.full_name ?? ""} />
            )}
            {tab === "unirme" && <ProfessionalJoin />}
            {tab === "resenas" && <ProfessionalResenas />}
            {user && tab === "bolsa" && <ProfessionalBolsa userId={user.id} />}
          </div>
        </>
      )}

    </StartShell>
  );
}
