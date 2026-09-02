import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MapPin, Instagram, MessageCircle, ArrowRight } from "lucide-react";
import auroStyloLogo from "@/assets/auro-stylo-logo.jpeg";
import auroRecoletaPhoto from "@/assets/auro-recoleta.png";
import auroMonserratPhoto from "@/assets/auro-monserrat.jpeg";

export const Route = createFileRoute("/auro-stylo")({
  head: () => ({
    meta: [
      { title: "Auro Stylo — Elegí tu sucursal" },
      {
        name: "description",
        content: "Reservá tu turno en Auro Stylo Monserrat o Auro Stylo Recoleta.",
      },
    ],
  }),
  component: AuroStyloBranchPage,
});

// Página propia de Auro Stylo (sin marca Clippr/AgendaPro a la vista) para
// elegir sucursal antes de reservar. Monserrat reserva en el sistema Clippr
// del negocio; Recoleta todavía reserva en su AgendaPro externo — por eso un
// link es interno (target por defecto) y el otro abre en pestaña nueva.
const BRANCHES: Array<{
  name: string;
  address: string;
  href: string;
  external: boolean;
  // Sin foto todavía -> se usa el placeholder degradado.
  image?: string;
}> = [
  {
    name: "AURO MONSERRAT",
    address: "Av. Independencia 1255, CABA",
    href: "https://myclippr.com/negocio/auro-stylo",
    external: false,
    image: auroMonserratPhoto,
  },
  {
    name: "AURO RECOLETA",
    address: "Paraguay 1268, CABA",
    href: "https://aurostylo.site.agendapro.com/ar/sucursal/307993",
    external: true,
    image: auroRecoletaPhoto,
  },
];

function AuroStyloBranchPage() {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#08070b] text-white">
      {/* Glow ambiental muy sutil, mismo criterio "premium" que el resto de
          la app — no compite con el contenido, solo le da profundidad al
          fondo negro. */}
      <div
        className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[620px] -translate-x-1/2 rounded-full opacity-40 blur-[110px]"
        style={{ background: "radial-gradient(closest-side, rgba(124,58,237,0.35), transparent)" }}
      />
      <div
        className="pointer-events-none absolute bottom-[-160px] right-[-120px] h-[360px] w-[360px] rounded-full opacity-30 blur-[110px]"
        style={{ background: "radial-gradient(closest-side, rgba(56,132,255,0.3), transparent)" }}
      />

      <div className="relative mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center px-5 py-12 sm:py-16">
        {/* Header */}
        <div className="flex flex-col items-center text-center">
          <img
            src={auroStyloLogo}
            alt="Auro Stylo"
            className="h-20 w-20 shrink-0 rounded-full object-cover sm:h-24 sm:w-24"
          />
          <h1 className="mt-8 text-[26px] font-bold tracking-tight sm:text-3xl">Elegí tu sucursal</h1>
          <p className="mt-2 text-sm text-white/50">Seleccioná dónde querés reservar tu turno</p>
        </div>

        {/* Tarjetas de sucursal */}
        <div className="mt-10 w-full space-y-5 sm:mt-12">
          {BRANCHES.map((branch) => (
            <a
              key={branch.name}
              href={branch.href}
              target={branch.external ? "_blank" : undefined}
              rel={branch.external ? "noreferrer" : undefined}
              className="group block overflow-hidden rounded-[28px] border border-white/[0.08] bg-white/[0.04] transition-all duration-300 ease-out hover:-translate-y-1 hover:border-violet-400/25 hover:bg-white/[0.06] hover:shadow-[0_28px_70px_-30px_rgba(124,58,237,0.45)] active:scale-[0.985] active:transition-none"
            >
              {/* Foto horizontal de la sucursal — object-cover, centrada,
                  sin overlay/degradado/filtro encima (imagen real tal cual
                  la mandó el negocio). Sin foto todavía, placeholder
                  degradado violeta/azul. */}
              <div className="relative h-36 w-full overflow-hidden sm:h-44">
                {branch.image ? (
                  <img
                    src={branch.image}
                    alt={branch.name}
                    className="h-full w-full object-cover object-center transition-transform duration-500 ease-out group-hover:scale-[1.04]"
                  />
                ) : (
                  <>
                    <div
                      className="absolute inset-0 transition-transform duration-500 ease-out group-hover:scale-[1.04]"
                      style={{
                        background:
                          "linear-gradient(135deg, rgba(96,165,250,0.20), rgba(124,58,237,0.28))",
                      }}
                    />
                    <div className="absolute inset-0 grid place-items-center">
                      <MapPin className="h-7 w-7 text-white/25" strokeWidth={1.5} />
                    </div>
                  </>
                )}
              </div>

              <div className="p-5 sm:p-6">
                <div className="text-lg font-bold tracking-wide sm:text-xl">{branch.name}</div>
                <p className="mt-1 text-sm text-white/50">{branch.address}</p>

                <div
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-4 text-sm font-bold tracking-wide transition group-hover:brightness-110"
                  style={{
                    background: "linear-gradient(135deg, #60a5fa, #7c3aed)",
                    boxShadow: "0 16px 36px -14px rgba(124,58,237,0.55)",
                  }}
                >
                  RESERVAR TURNO
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </div>
              </div>
            </a>
          ))}
        </div>

        {/* Footer discreto — sin ninguna mención a Clippr/AgendaPro */}
        <div className="mt-16 flex flex-col items-center gap-3 pb-4 text-white/35 sm:mt-20">
          <div className="flex items-center gap-3">
            <Instagram className="h-4 w-4" />
            <span className="text-white/20">·</span>
            <MessageCircle className="h-4 w-4" />
          </div>
          <p className="text-xs">© Auro Stylo</p>
        </div>
      </div>
    </main>
  );
}
