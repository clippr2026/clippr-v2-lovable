import * as React from "react";
import { Check } from "lucide-react";

// Estado final del demo (demoStep 5, ver BookingCard): reemplaza TODO el
// contenido de la tarjeta (título, servicio, profesional, día, horario,
// botón), no solo la grilla de horarios — durante estos ~2s la pantalla
// tiene que transmitir únicamente "turno confirmado", sin resumen ni
// ningún otro dato. Entra con fade+scale (mismo patrón que ServiceRow:
// estado local que pasa a "shown" un frame después del mount) para que no
// sea un corte seco.
export function Confirmation() {
  const [shown, setShown] = React.useState(false);

  React.useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      className="flex min-h-[360px] flex-col items-center justify-center gap-5 py-10 text-center sm:min-h-[420px] lg:min-h-[560px]"
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "scale(1)" : "scale(0.94)",
        transition: "opacity 500ms ease-out, transform 500ms ease-out",
      }}
    >
      <div
        className="grid h-20 w-20 shrink-0 place-items-center rounded-full lg:h-24 lg:w-24"
        style={{
          background: "linear-gradient(135deg, oklch(0.62 0.24 292), oklch(0.46 0.24 296))",
          boxShadow: "0 0 40px -6px oklch(0.6 0.24 292 / 0.75)",
        }}
      >
        <Check className="h-10 w-10 text-white lg:h-12 lg:w-12" strokeWidth={3} />
      </div>
      <div className="text-2xl font-bold text-white lg:text-3xl">Turno confirmado</div>
    </div>
  );
}
