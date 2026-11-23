import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Gift, Store, UserRound } from "lucide-react";
import { StartShell, startCardCls, startCardStyle } from "@/components/auth/start-shell";

export const Route = createFileRoute("/empezar")({
  head: () => ({
    meta: [
      { title: "Empezar — Clippr" },
      { name: "description", content: "Creá tu negocio, tu perfil de profesional o sumate como embajador de Clippr." },
    ],
  }),
  component: EmpezarPage,
});

const OPTIONS = [
  {
    tipo: "negocio",
    icon: Store,
    title: "Soy dueño",
    desc: "Creá tu negocio y publicá ofertas laborales.",
  },
  {
    tipo: "profesional",
    icon: UserRound,
    title: "Soy profesional",
    desc: "Unite a un negocio o buscá ofertas laborales.",
  },
  {
    tipo: "embajador",
    icon: Gift,
    title: "Quiero ser embajador",
    desc: "Recomendá Clippr y ganá recompensas.",
  },
] as const;

function EmpezarPage() {
  return (
    <StartShell back={{ to: "/", label: "Volver" }}>
      <h1 className="font-display text-4xl font-bold leading-tight">¡Bienvenido!</h1>
      <p className="mt-2 text-lg text-white/65">Elegí cómo querés empezar.</p>

      <div className="mt-8 space-y-3">
        {OPTIONS.map((o) => (
          <Link
            key={o.tipo}
            to="/crear-cuenta"
            search={{ tipo: o.tipo }}
            className={`${startCardCls} flex items-center gap-4 p-4 transition active:scale-[0.99]`}
            style={startCardStyle}
          >
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-violet-500/20 text-violet-300 ring-1 ring-violet-300/25">
              <o.icon className="h-7 w-7" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xl font-semibold">{o.title}</span>
              <span className="block text-base text-white/60">{o.desc}</span>
            </span>
            <ChevronRight className="h-6 w-6 shrink-0 text-white/40" />
          </Link>
        ))}
      </div>

      <p className="mt-auto pt-10 text-center text-base text-white/60">
        ¿Ya tenés cuenta?{" "}
        <Link to="/login" className="font-semibold text-white underline underline-offset-4">
          Iniciar sesión
        </Link>
      </p>
    </StartShell>
  );
}
