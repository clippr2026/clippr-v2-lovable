import * as React from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { activarAvisos, desactivarAvisos, esIphoneSinInstalar, estaSuscripto, pushDisponible, type PushApp } from "@/lib/push";
import { cn } from "@/lib/utils";

// Botón "Activar avisos" de las dos apps instalables. No se muestra si el navegador no soporta push
// o si todavía no están configuradas las claves.
export function PushAvisosButton({
  app,
  businessSlug,
  className,
}: {
  app: PushApp;
  businessSlug?: string;
  className?: string;
}) {
  const [soportado, setSoportado] = React.useState(false);
  const [activo, setActivo] = React.useState(false);
  const [cargando, setCargando] = React.useState(false);

  React.useEffect(() => {
    setSoportado(pushDisponible());
    void estaSuscripto().then(setActivo).catch(() => {});
  }, []);

  if (!soportado) return null;

  async function alternar() {
    if (esIphoneSinInstalar()) {
      toast.info("En iPhone, primero instalá la app: Compartir → Agregar a pantalla de inicio. Después activá los avisos desde ahí.");
      return;
    }
    setCargando(true);
    try {
      if (activo) {
        await desactivarAvisos();
        setActivo(false);
        toast.success("Avisos desactivados");
      } else {
        await activarAvisos(app, { businessSlug });
        setActivo(true);
        toast.success("Avisos activados");
      }
    } catch (e) {
      toast.error((e as Error).message || "No se pudo cambiar los avisos");
    } finally {
      setCargando(false);
    }
  }

  return (
    <button
      type="button"
      onClick={alternar}
      disabled={cargando}
      className={cn(
        "inline-flex h-11 items-center justify-center gap-2 rounded-full border px-5 text-sm font-semibold transition disabled:opacity-60",
        activo
          ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
          : "border-violet-400/50 bg-violet-500/15 text-violet-100 hover:bg-violet-500/25",
        className,
      )}
    >
      {cargando ? <Loader2 className="size-4 animate-spin" /> : activo ? <Bell className="size-4" /> : <BellOff className="size-4" />}
      {activo ? "Avisos activados" : "Activar avisos"}
    </button>
  );
}
