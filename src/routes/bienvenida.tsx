import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Copy, Gift } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { StartShell, startCardCls, startCardStyle } from "@/components/auth/start-shell";
import { ProfessionalProfileForm } from "@/components/auth/professional-profile-form";

export const Route = createFileRoute("/bienvenida")({
  head: () => ({ meta: [{ title: "Bienvenido — Clippr" }] }),
  component: BienvenidaPage,
});

// Pantalla de quien creó una cuenta de profesional o embajador y todavía no tiene negocio:
// para el profesional, el dueño de la barbería lo suma al equipo con este mismo correo.
function BienvenidaPage() {
  const { loading, session, businessId, user, signOut } = useAuth();
  const navigate = useNavigate();
  const tipo = (user?.user_metadata as { account_type?: string } | undefined)?.account_type;

  React.useEffect(() => {
    if (loading) return;
    if (!session) navigate({ to: "/login", replace: true });
    else if (businessId) navigate({ to: "/dashboard", replace: true });
  }, [loading, session, businessId, navigate]);

  const email = user?.email ?? "";
  const esEmbajador = tipo === "embajador";

  return (
    <StartShell>
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
          <h1 className="font-display text-3xl font-bold">Tu perfil</h1>
          <p className="mt-2 text-lg text-white/65">Queda guardado aunque cambies de barbería.</p>
          <div className="mt-6">
            {user && <ProfessionalProfileForm userId={user.id} defaultName={(user.user_metadata as { full_name?: string } | undefined)?.full_name ?? ""} />}
          </div>

          <div className={`${startCardCls} mt-6 p-4`} style={startCardStyle}>
            <div className="text-lg font-semibold">Ofertas laborales</div>
            <p className="mt-1 text-base text-white/60">Muy pronto vas a ver los avisos de las barberías.</p>
          </div>

          <div className={`${startCardCls} mt-4 p-4`} style={startCardStyle}>
            <div className="text-lg font-semibold">¿Ya trabajás con Clippr?</div>
            <p className="mt-1 text-base text-white/60">Pedile a tu barbería que te sume con este correo:</p>
            <div className="mt-3 flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-lg font-semibold">{email}</span>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(email);
                  toast.success("Correo copiado");
                }}
                aria-label="Copiar correo"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-500/15 text-violet-200 ring-1 ring-violet-400/40"
              >
                <Copy className="h-5 w-5" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 h-12 w-full rounded-full bg-white/5 text-base font-semibold text-white/80 ring-1 ring-white/10"
            >
              Ya me sumaron
            </button>
          </div>
        </>
      )}

      <button type="button" onClick={() => void signOut()} className="mt-auto pt-10 text-center text-base text-white/60 underline underline-offset-4">
        Cerrar sesión
      </button>
    </StartShell>
  );
}
