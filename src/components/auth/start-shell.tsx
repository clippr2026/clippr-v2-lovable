import * as React from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

// Marco común de las pantallas de alta (/empezar, /crear-cuenta, /bienvenida): fondo oscuro de Clippr
// con luces violeta/azul, logo arriba y un botón para volver.
export function StartShell({
  back,
  header,
  children,
}: {
  back?: { to: "/" | "/empezar" | "/login"; label: string };
  // Reemplaza el encabezado de siempre (volver + logo).
  header?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#05040b] text-white">
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute -top-[30%] -left-[18%] h-[780px] w-[780px] rounded-full opacity-35 blur-[130px]"
          style={{ background: "radial-gradient(circle, oklch(0.52 0.22 260 / 0.58), transparent 66%)" }}
        />
        <div
          className="absolute -bottom-[32%] -right-[18%] h-[760px] w-[760px] rounded-full opacity-30 blur-[130px]"
          style={{ background: "radial-gradient(circle, oklch(0.58 0.24 310 / 0.48), transparent 66%)" }}
        />
      </div>
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-md flex-col px-5 py-6">
        {header ?? (
        <div className="flex items-center justify-between">
          {back ? (
            <Link
              to={back.to}
              aria-label={back.label}
              className="grid h-11 w-11 place-items-center rounded-full bg-white/[0.06] text-white/80 ring-1 ring-white/10"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
          ) : (
            <span />
          )}
          <img src="/clippr-logo-login.webp" alt="Clippr" className="h-12 w-12 object-contain" />
          <span className="w-11" />
        </div>
        )}
        <div className="flex flex-1 flex-col pt-8">{children}</div>
      </div>
    </div>
  );
}

export const startCardCls = "rounded-2xl border border-white/10 bg-white/[0.03]";
export const startCardStyle: React.CSSProperties = {
  backgroundImage:
    "radial-gradient(110% 90% at 100% 0%, rgba(79,125,255,.16), transparent 62%), radial-gradient(90% 80% at 0% 100%, rgba(139,92,246,.12), transparent 65%)",
};
